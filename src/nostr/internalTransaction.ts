import { Debugger } from 'debug';
import type { NDKFilter, NostrEvent } from '@nostr-dev-kit/ndk';

import { logger, requiredEnvVar } from '../lib/utils';
import outbox from '@services/outbox';
import { Kind, lnOutboundTx, revertTx } from '@lib/events';
import lnd from '@services/lnd';
import redis from '@services/redis';

const log: Debugger = logger.extend('nostr:internalTransaction');
const warn: Debugger = log.extend('warn');
const debug: Debugger = log.extend('debug');
const invoiceAmountRegex: RegExp = /^\D+(?<amount>\d+)(?<multiplier>[mnpu]?)1/i;

const filter: NDKFilter = {
  kinds: [Kind.REGULAR.valueOf()],
  '#p': [requiredEnvVar('NOSTR_PUBLIC_KEY')],
  '#t': ['internal-transaction-ok'],
  since: Math.round(Date.now() / 1000) - 86000,
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
      return (
        BigInt(matches.groups.amount) *
        BigInt(multipliers[matches.groups.multiplier])
      );
    } catch {
      debug('Unparsable invoice amount');
    }
  }
  return null;
}

/**
 * Return the internal-transaction-ok handler
 */
const getHandler = (): ((event: NostrEvent) => void) => {
  /**
   * Handle internal-transaction-ok
   *
   * If the internal transaction ok is one not generated by us and not
   * previously handled, get invoice and try to pay it. Publish an
   * outbound transaction on success or a revert transaction on error.
   */
  return async (event: NostrEvent) => {
    const target = event.tags.filter((t) => 'p' === t[0])[0][1];
    // originated by me
    if (requiredEnvVar('NOSTR_PUBLIC_KEY') === target) {
      return;
    }
    if (event.id === undefined) {
      throw new Error('Received event without id from relay');
    }
    const eventId: string = event.id;
    if ((await redis.hGet(eventId, 'handled')) !== null) {
      debug('Already handled event %s', eventId);
      return;
    }
    const startEventId = event.tags.filter((t) => 'e' === t[0])[0][1];
    const startEvent = await outbox.getEvent(startEventId);
    debug('start event: %O', startEvent);
    if (startEvent === null) {
      warn('Did not found internalTx start for ok');
      await redis.hSet(eventId, 'handled', 'true');
      return;
    }
    const content = JSON.parse(startEvent.content);
    const bolt11Tag = startEvent.tags.find((t) => 'bolt11' === t[0]);
    if (undefined === bolt11Tag) {
      warn('Received internal tx without invoice');
      outbox.publish(revertTx(startEvent));
      await redis.hSet(eventId, 'handled', 'true');
      return;
    }
    if (content.tokens.bitcoin !== extractAmount(bolt11Tag[1])) {
      warn('Content amount and invoice amount are different');
      outbox.publish(revertTx(startEvent));
      await redis.hSet(eventId, 'handled', 'true');
      return;
    }
    lnd
      .payInvoice(bolt11Tag[1])
      .then(() => {
        log('Paid invoice for: %O', startEvent.id);
        outbox.publish(lnOutboundTx(startEvent));
      })
      .catch((error) => {
        warn('Failed paying invoice, reverting transaction: %O', error);
        outbox.publish(revertTx(startEvent));
      })
      .finally(async () => {
        await redis.hSet(eventId, 'handled', 'true');
      });
  };
};

export { filter, getHandler };
