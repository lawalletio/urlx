import { Debugger } from 'debug';
import type { Response } from 'express';
import type { ExtendedRequest } from '@type/request';
import { nip19, nip57 } from 'nostr-tools';

import { createHash } from 'crypto';

import { logger } from '@lib/utils';
import lnbits from '@services/lnbits';
import redis from '@services/redis';

const log: Debugger = logger.extend('rest:lnurlp:pubkey:callback:get');
const debug: Debugger = log.extend('debug');
const error: Debugger = log.extend('error');

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
 * Handles lud-06 and nip-57 callback requests
 *
 * Verifies that the query contains a non-zero positive amount and
 * generates and returns a lightning invoice for that amount.
 * Also stores a map between the invoice hash and the pubkey that will
 * receive the funds. If the query includes a nostr query, treat it as a
 * nip-57 zap request
 */
const handler = async (req: ExtendedRequest, res: Response) => {
  const amount: bigint | null = validateAmount(req.query?.amount);
  if (amount === null) {
    debug('Invalid amount');
    res.status(422).send();
    return;
  }

  const comment = req.query?.comment?.toString() ?? '';
  if (255 < comment.length) {
    debug('Comment too long');
    res.status(422).send();
    return;
  }

  const pubkey = validatePubkey(req.params?.pubkey);
  if (pubkey === null) {
    debug('Invalid pubkey');
    res.status(422).send();
    return;
  }

  const isNip57 = typeof req.query?.nostr === 'string';
  const zapRequest = isNip57 ? (req.query?.nostr as string) : '';
  if (isNip57) {
    const err = nip57.validateZapRequest(zapRequest);
    if (typeof err === 'string') {
      debug('Invalid zap request: %s', err);
      res.status(422).send();
      return;
    }
  }

  let pr: string | null;
  try {
    pr = await lnbits.generateInvoice(amount, comment);
  } catch (e) {
    pr = null;
    error('Error generating invoice: %O', e);
  }
  if (null === pr) {
    res.status(500).send();
    return;
  }

  redis.hSet(createHash('sha256').update(pr).digest('hex'), {
    pubkey,
    zapRequest,
  });
  res.status(200).json({ pr, routes: [] }).send();
};

export default handler;
