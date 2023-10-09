import { Debugger } from 'debug';
import type { Response } from 'express';
import type { ExtendedRequest } from '@type/request';
import { nip19 } from 'nostr-tools';

import { logger } from '@lib/utils';
import lnd from '@services/lnd';
import redis from '@services/redis';

const log: Debugger = logger.extend('rest:lnurlp:pubkey:callback:get');
const debug: Debugger = log.extend('debug');

const lowHex32BRegex: RegExp = /^\x{64}$/;
const npubRegex: RegExp = /^npub1[023456789acdefghjklmnpqrstuvwxyz]{6,}$/;

/**
 * Extract a valid pubkey from a string
 *
 * Check if a string is a valid hex pubkey or npub and return its hex
 * representation if valid, null otherwise.
 */
function validPubkey(pubkey: string): string | null {
  if (lowHex32BRegex.test(pubkey)) {
    return pubkey;
  } else if (npubRegex.test(pubkey)) {
    pubkey = nip19.decode<'npub'>(pubkey as `npub1${string}`).data;
    return lowHex32BRegex.test(pubkey) ? pubkey : null;
  }
  return null;
}

/**
 * Handles lud-06 callback requests
 *
 * Verifies that the query contains a non-zero positive amount and
 * generates and returns a lightning invoice for that amount.
 * Also stores a map between the invoice hash and the pubkey that will
 * receive the funds.
 */
const handler = async (req: ExtendedRequest, res: Response) => {
  if (typeof req.query.amount !== 'string') {
    debug('Received request without amount');
    res.status(422).send();
    return;
  }
  let amount;
  try {
    amount = BigInt(req.query.amount);
  } catch {
    debug('Amount is not an integer');
  }
  if (undefined === amount || amount <= 0) {
    debug('Amount is not a positive integer');
    res.status(422).send();
    return;
  }
  const pubkey = validPubkey(req.params.pubkey);
  if (pubkey === null) {
    debug('Invalid pubkey');
    res.status(422).send();
    return;
  }
  const invoice = await lnd.generateInvoice(amount);
  redis.set(invoice.r_hash, pubkey, { NX: true });
  res.status(200).json({ pr: invoice.payment_request, routes: [] }).send();
};

export default handler;
