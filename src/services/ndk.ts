import NDK, {
  NDKPrivateKeySigner,
  NDKRelay,
  NDKRelaySet,
} from '@nostr-dev-kit/ndk';

import { logger, requiredEnvVar } from '@lib/utils';
import { Debugger } from 'debug';

const log: Debugger = logger.extend('services:ndk');
const debug: Debugger = log.extend('debug');
const warn: Debugger = log.extend('warn');

const INACTIVE_TIMEOUT = 10 * 60 * 1000; // 10 minutes
const INFO_TIMEOUT = 24 * 60 * 60 * 1000; // 24 hours
let writeNDK: NDK;
let readNDK: NDK;

type TempRelay = {
  relay: NDKRelay;
  timer: NodeJS.Timeout;
};

type RelayInfo = {
  isPrivate: boolean;
};
const tempRelaysPool = new Map<string, TempRelay>();
const relayInfoMap = new Map<string, RelayInfo>();

/**
 * Return the NDK instance for fetching events from relays.
 *
 * Create it if it does not exist.
 */
export function getReadNDK(): NDK {
  if (!readNDK) {
    readNDK = new NDK({
      explicitRelayUrls: process.env.NOSTR_RELAYS?.split(','),
    });
  }
  return readNDK;
}

/**
 * Return the NDK instance for publishing events to relay.
 *
 * Create it if it does not exist.
 */
export function getWriteNDK(): NDK {
  if (!writeNDK) {
    writeNDK = new NDK({
      explicitRelayUrls: [requiredEnvVar('NOSTR_WRITE_RELAY')],
      signer: new NDKPrivateKeySigner(process.env.NOSTR_PRIVATE_KEY),
    });
  }
  return writeNDK;
}

export function getSignerNDK(): NDK {
  return new NDK({
    signer: new NDKPrivateKeySigner(process.env.NOSTR_PRIVATE_KEY),
  }).on('error', (e) => {
    warn('Unexpected error from ndk: %O', e);
  });
}

function removeTempRelay(relayUrl: string): void {
  const tempRelay = tempRelaysPool.get(relayUrl);
  if (tempRelay) {
    log('%s ws inactive for %d ms, disconnecting', relayUrl, INACTIVE_TIMEOUT);
    clearTimeout(tempRelay.timer);
    tempRelay.relay.disconnect();
    tempRelaysPool.delete(relayUrl);
  }
}

function removeRelayInfo(relayUrl: string): void {
  const relayInfo = relayInfoMap.get(relayUrl);
  if (relayInfo) {
    log(
      'Deleting %s from info map, already passed %d ms',
      relayUrl,
      INFO_TIMEOUT,
    );
    relayInfoMap.delete(relayUrl);
  }
}

/**
 * Checks if a relay is private
 *
 * We define a relay as private if there is some authorization or payment that
 * needs to be done in order to publish events
 *
 * @param url of the relay to check
 * @returns true if the relay is private, false otherwise
 */
async function isPrivateRelay(urlString: string): Promise<boolean> {
  const relayInfo = relayInfoMap.get(urlString);
  if (relayInfo) {
    debug('We know %s. isPrivate: %O', urlString, relayInfo.isPrivate);
    return relayInfo.isPrivate;
  }
  let isPrivate: boolean = false;
  const url = new URL(urlString);
  url.protocol = 'https';
  let info: any;
  try {
    info = await (
      await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/nostr+json',
        },
      })
    ).json();
  } catch {
    // if we fail to get this info we wont be able to connect
    warn('Unable to fetch relay info for %s', urlString);
    isPrivate = true;
  }
  isPrivate =
    isPrivate ||
    (info?.limitation?.min_pow_difficulty ?? 0) > 0 ||
    (info?.limitation?.auth_required ?? false) ||
    (info?.limitation?.payment_required ?? false) ||
    (info?.limitation?.restricted_writes ?? false);
  setTimeout(removeRelayInfo, INFO_TIMEOUT, urlString);
  relayInfoMap.set(urlString, { isPrivate });
  return isPrivate;
}

/**
 * Returns a set of connected relays for publishing
 *
 * Reuses connection to known relays.
 */
export async function connectToTempRelays(
  relayUrls: string[],
  ndk: NDK,
): Promise<NDKRelaySet> {
  const relays: NDKRelay[] = [];
  for (const url of relayUrls) {
    if (await isPrivateRelay(url)) {
      log('Wont publish to private relay %s', url);
      continue;
    }
    let tempRelay = tempRelaysPool.get(url);
    const timer = setTimeout(() => removeTempRelay(url), INACTIVE_TIMEOUT);
    if (tempRelay) {
      clearTimeout(tempRelay.timer);
      tempRelay.timer = timer;
    } else {
      const relay = new NDKRelay(url);
      relay.connect().catch((e) => {
        warn('Error connecting to relay %s: %O', url, e);
        removeTempRelay(url);
      });
      relay.on('connect', () => {
        log('Connected to %s for %d ms', url, INACTIVE_TIMEOUT);
      });
      relay.on('error', (e) => {
        warn('Could not publish to %s error: %O', url, e);
      });
      relay.on('publish:failed', (event, err) => {
        warn('Could not publish to %s event %s error: %O', url, event.id, err);
      });
      tempRelay = { relay, timer };
      tempRelaysPool.set(url, tempRelay);
    }
    relays.push(tempRelay.relay);
  }
  return new NDKRelaySet(new Set(relays), ndk);
}
