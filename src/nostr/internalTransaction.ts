import { Debugger } from 'debug';

import type { NDKEvent, NDKFilter, NostrEvent } from '@nostr-dev-kit/ndk';

import { Kind, lnOutboundTx, revertTx } from '@lib/events';
import { logger, nowInSeconds, requiredEnvVar } from '@lib/utils';

import lnd from '@services/lnd';
import redis from '@services/redis';
import { Context } from '@type/request';
import { Outbox } from '@services/outbox';
import { getReadNDK } from '@services/ndk';

const log: Debugger = logger.extend('nostr:internalTransaction');

const warn: Debugger = log.extend('warn');
const debug: Debugger = log.extend('debug');

const invoiceAmountRegex: RegExp = /^\D+(?<amount>\d+)(?<multiplier>[mnpu]?)1/i;
const BITCOIN_TOKEN_NAME = 'BTC';

const filter: NDKFilter = {
  kinds: [Kind.REGULAR.valueOf()],
  '#p': [requiredEnvVar('NOSTR_PUBLIC_KEY')],
  '#t': ['internal-transaction-ok'],
  since: nowInSeconds() - 86000,
};

/**
 * Extract invoice amount in millisats from invoice
 */
function extractAmount(invoice: string): bigint | null {
  const matches = invoice.match(invoiceAmountRegex);
  if (matches?.groups) {
    const multipliers: Record<string, number> = {
      p: 1e-1, // picobitcoin
      n: 1e2, // nanobitcoin
      u: 1e5, // microbitcoin
      m: 1e8, // millibitcoin
      '': 1e11, // bitcoin (default)
    };

    try {
      return BigInt(
        parseInt(matches.groups.amount) *
          multipliers[matches.groups.multiplier],
      );
    } catch {
      debug('Unparsable invoice amount');
    }
  }
  return null;
}

/**
 * Extract value of first "p" tag, or null if none found
 */
function extractFirstP(event: NostrEvent): string | null {
  try {
    return event.tags.filter((t) => 'p' === t[0])[0][1];
  } catch {
    /* ... */
  }
  return null;
}

/**
 * Extract value of first "e" tag, or null if none found
 */
function extractFirstE(event: NostrEvent): string | null {
  try {
    return event.tags.filter((t) => 'e' === t[0])[0][1];
  } catch {
    /* ... */
  }
  return null;
}

/**
 * Extract value of first "bolt11" tag, or null if none found
 */
function extractBolt11(event: NDKEvent): string | null {
  const bolt11 = event.tags.find((t) => 'bolt11' === t[0]);
  if (undefined !== bolt11) {
    return bolt11[1];
  }
  return null;
}

/**
 * Mark the given event id as handled in Redis
 */
async function markHandled(eventId: string) {
  redis.hSet(eventId, 'handled', 'true');
}

/**
 * Publish a revert of the given event
 */
function doRevertTx(outbox: Outbox, event: NDKEvent): void {
  outbox.publish(revertTx(event));
}

/**
 * Return the internal-transaction-ok handler
 */
const getHandler = (ctx: Context): ((event: NostrEvent) => void) => {
  /**
   * Handle internal-transaction-ok
   *
   * If the internal transaction ok is one not generated by us and not
   * previously handled, get invoice and try to pay it. Publish an
   * outbound transaction on success or a revert transaction on error.
   */
  return async (event: NostrEvent) => {
    if (event.id === undefined) {
      throw new Error('Received event without id from relay');
    }

    const eventId: string = event.id;

    if ((await redis.hGet(eventId, 'handled')) !== null) {
      debug('Already handled event %s', eventId);
      return;
    }

    const target = extractFirstP(event);
    const startEventId = extractFirstE(event);

    if (null === target) {
      warn('No target found');
    }
    if (null === startEventId) {
      warn('No starting event found');
    }
    if (null === target || null === startEventId) {
      return;
    }

    // originated by me
    if (requiredEnvVar('NOSTR_PUBLIC_KEY') === target) {
      return;
    }

    const startEvent = await getReadNDK().fetchEvent(startEventId);

    debug('start event: %O', startEvent);

    if (startEvent === null) {
      warn('Did not find internalTx start for ok');
      await markHandled(eventId);
      return;
    }

    const bolt11 = extractBolt11(startEvent);

    if (null === bolt11) {
      warn('Received internal tx without invoice');
      doRevertTx(ctx.outbox, startEvent);
      await markHandled(eventId);
      return;
    }

    const content = JSON.parse(startEvent.content, (k, v) =>
      isNaN(v) ? v : BigInt(v),
    );

    if (content.tokens[BITCOIN_TOKEN_NAME] !== extractAmount(bolt11)) {
      warn('Content amount and invoice amount are different');
      doRevertTx(ctx.outbox, startEvent);
      await markHandled(eventId);
      return;
    }

    lnd
      .payInvoice(bolt11)
      .then(() => {
        log('Paid invoice for: %O', startEvent.id);
        ctx.outbox.publish(lnOutboundTx(startEvent));
      })
      .catch((error) => {
        warn('Failed paying invoice, reverting transaction: %O', error);
        doRevertTx(ctx.outbox, startEvent);
      })
      .finally(async () => {
        await markHandled(eventId);
      });
  };
};

export { filter, getHandler };
