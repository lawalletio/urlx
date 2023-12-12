import { Debugger } from 'debug';
import type { Response } from 'express';
import type { ExtendedRequest } from '@type/request';
import { nip19 } from 'nostr-tools';

import { logger, requiredEnvVar } from '@lib/utils';

const log: Debugger = logger.extend('rest:lnurlp:pubkey:get');
const debug: Debugger = log.extend('debug');

const lawalletApiDomain = requiredEnvVar('LAWALLET_API_DOMAIN');
const nostrPublicKey = requiredEnvVar('NOSTR_PUBLIC_KEY');

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
 * Handles lud-06 requests
 *
 */
const handler = async (req: ExtendedRequest, res: Response) => {
  const pubkey = validatePubkey(req.params?.pubkey);
  if (pubkey === null) {
    debug('Invalid pubkey');
    res.status(422).send('Invalid pubkey');
    return;
  }

  res
    .status(200)
    .json({
      status: 'OK',
      tag: 'payRequest',
      commentAllowed: 255,
      callback: `${lawalletApiDomain}/lnurlp/${pubkey}/callback`,
      metadata: '[["text/plain", "lawallet"]]',
      minSendable: 1000, // 1 SAT
      maxSendable: 10000000000, // 0.1 BTC
      nostrPubkey: nostrPublicKey,
      allowsNostr: true,
      accountPubKey: pubkey,
    })
    .send();
};

export default handler;
