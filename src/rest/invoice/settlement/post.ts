import type { Response } from 'express';

import type { ExtendedRequest } from '@type/request';
import { Debugger } from 'debug';
import {
  httpsRequest,
  jsonParseOrNull,
  logger,
  requiredEnvVar,
  shuffled,
} from '@lib/utils';
import redis from '@services/redis';
import { commandOptions } from 'redis';
import { nip57 } from 'nostr-tools';
import { connectToTempRelays, getSignerNDK } from '@services/ndk';
import { OutboxService } from '@services/outbox';
import { lnInboundTx } from '@lib/events';
import { createHash } from 'crypto';
import { URL } from 'url';

const log: Debugger = logger.extend('rest:invoice:settlement:post');
const warn: Debugger = log.extend('warn');
const error: Debugger = log.extend('error');
const debug: Debugger = log.extend('debug');

var writeRelayHostname: string | null = null;

const getWriteRelayHostname = async (): Promise<string> => {
  if (null === writeRelayHostname) {
    writeRelayHostname = new URL(
      jsonParseOrNull(
        (await httpsRequest(requiredEnvVar('NOSTR_WRITE_RELAY'), {
          headers: { Accept: 'application/nostr+json' },
        })) ?? '',
      )?.payments_url ?? 'https://example.com',
    ).hostname;
  }
  return writeRelayHostname;
};

type LnbitsInvoice = {
  payment_hash: string;
  payment_request: string;
  amount: number;
  comment: string | null;
  lnurlp: string;
  body: string;
};

/**
 * Validates received invoice
 */
function validateInvoice(invoice: LnbitsInvoice): boolean {
  if (
    typeof invoice.payment_request !== 'string' ||
    typeof invoice.amount !== 'number'
  ) {
    return false;
  }
  return true;
}

/**
 * Handles the callback from lnbits for paid invoices
 *
 * Checks if the invoice was generated through urlx and if so makes the
 * funds movements in lawallet, implements nip-57.
 */
const handler = async (req: ExtendedRequest, res: Response) => {
  const invoice: LnbitsInvoice = req.body;
  log('Received invoice');
  debug('%O', invoice);
  if (!validateInvoice(invoice)) {
    warn('Received invalid invoice');
    res.status(400).send();
    return;
  }
  const prHash: string = createHash('sha256')
    .update(invoice.payment_request)
    .digest('hex');
  const [pubkey, zapRequest] = await redis.hmGet(
    commandOptions({ returnBuffers: false }),
    prHash,
    ['pubkey', 'zapRequest'],
  );
  if (!pubkey) {
    log('Invoice not generated by us');
    res.status(404).send();
  }
  if (zapRequest) {
    const zapReceipt = nip57.makeZapReceipt({
      zapRequest,
      bolt11: invoice.payment_request,
      paidAt: new Date(),
    });
    const theWriteRelayHostname: string = await getWriteRelayHostname();
    const relayUrls = shuffled<string>(
      JSON.parse(zapRequest)
        .tags.find((t: string[]) => 'relays' === t[0])
        .slice(1)
        .filter((r: string) => {
          try {
            return new URL(r).hostname !== theWriteRelayHostname;
          } catch (e) {
            return false;
          }
        }),
    ).slice(-5);
    const ndk = getSignerNDK();
    const relaySet = connectToTempRelays(relayUrls, ndk);
    new OutboxService(ndk)
      .publish(zapReceipt, relaySet)
      .catch((e) => warn('Could not publish zapReceipt to external: %O', e));
    req.context.outbox.publish(zapReceipt).catch((e) => {
      error('Could not publish zapReceipt to internal: %O', e);
    });
  }
  req.context.outbox
    .publish(
      lnInboundTx(BigInt(invoice.amount), invoice.payment_request, pubkey),
    )
    .then(async () => {
      await redis.del(prHash);
      res.status(204).send();
    })
    .catch((e) => {
      error('Could not publish inboundTx: %O', e);
      res.status(500).send();
    });
};

export default handler;
