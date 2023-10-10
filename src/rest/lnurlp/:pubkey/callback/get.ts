import { Debugger } from 'debug';
import type { Response } from 'express';
import type { ExtendedRequest } from '@type/request';
import { nip19 } from 'nostr-tools';

import { logger } from '@lib/utils';
import lnd from '@services/lnd';
import redis from '@services/redis';

const log: Debugger = logger.extend('rest:lnurlp:pubkey:callback:get');
const debug: Debugger = log.extend('debug');

/**
 * Extract a valid pubkey from the given argument
 *
 * Check if the given argument is a valid hex pubkey or npub and return its hex
 * representation if valid, null otherwise.
 */
function validatePubkey(pubkey: any): string | null {
  const lowHex32BRegex: RegExp = /^[0-9a-f]{64}$/;
  const npubRegex: RegExp = /^npub1[023456789acdefghjklmnpqrstuvwxyz]{6,}$/;

  if (typeof pubkey === 'string') {
    if (lowHex32BRegex.test(pubkey)) {
      return pubkey;
    } else if (npubRegex.test(pubkey)) {
      return validatePubkey(
        nip19.decode<'npub'>(pubkey as `npub1${string}`).data,
      );
    }
  }
  return null;
}

/**
 * Extract a valid amount from the given argument
 *
 * Check if the given argument is a valid amount its bigint representation
 * if valid, null otherwise.
 */
function validateAmount(amount: any): bigint | null {
  if (typeof amount === 'string') {
    let parsedAmount;
    try {
      parsedAmount = BigInt(amount);
      if (0n <= parsedAmount) {
        return parsedAmount;
      }
    } catch {
      /* ... */
    }
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
  const amount = validateAmount(req.query?.amount);
  if (amount === null) {
    debug('Invalid amount');
  }

  const pubkey = validatePubkey(req.params?.pubkey);
  if (pubkey === null) {
    debug('Invalid pubkey');
  }

  if (null === amount || null === pubkey) {
    res.status(422).send();
    return;
  }

  const invoice = await lnd.generateInvoice(amount);
  redis.set(invoice.r_hash, pubkey, { NX: true });
  res.status(200).json({ pr: invoice.payment_request, routes: [] }).send();
};

export default handler;
