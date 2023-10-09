import { NDKEvent, NostrEvent } from '@nostr-dev-kit/ndk';
import { nip26 } from 'nostr-tools';

import { nowInSeconds, requiredEnvVar } from '@lib/utils';

export enum Kind {
  REGULAR = 1112,
  EPHEMERAL = 21111,
  PARAMETRIZED_REPLACEABLE = 31111,
}

/**
 * Create an inbound transaction event based on paid invoice
 */
export function lnInboundTx(
  amount: bigint,
  invoice: string,
  pubkey: string,
): NostrEvent {
  const content = {
    tokens: { bitcoin: amount },
    memo: invoice,
  };
  return {
    content: JSON.stringify(content),
    created_at: nowInSeconds(),
    kind: Kind.REGULAR.valueOf(),
    pubkey: requiredEnvVar('NOSTR_PUBLIC_KEY'),
    tags: [
      ['p', requiredEnvVar('LEDGER_PUBLIC_KEY')],
      ['p', pubkey],
      ['t', 'inbound-transaction-start'],
    ],
  };
}

/**
 * Create an outbound-tx event from a internal-tx event
 */
export function lnOutboundTx(event: NDKEvent): NostrEvent {
  return {
    content: event.content,
    created_at: nowInSeconds(),
    kind: Kind.REGULAR.valueOf(),
    pubkey: requiredEnvVar('NOSTR_PUBLIC_KEY'),
    tags: [
      ['p', requiredEnvVar('LEDGER_PUBLIC_KEY')],
      event.tags.filter((t) => 'p' === t[0])[1],
      ['e', event.id],
      ['t', 'outbound-transaction-start'],
    ],
  };
}

/**
 * Create an internal-tx event that reverts another internal-tx event
 */
export function revertTx(event: NDKEvent): NostrEvent {
  const content = JSON.parse(event.content);
  content.memo = 'Revert failed outbound';
  const author = event.tags.some((t) => 'delegation' === t[0])
    ? nip26.getDelegator(event)
    : event.pubkey;
  return {
    content: JSON.stringify(content),
    created_at: nowInSeconds(),
    kind: Kind.REGULAR.valueOf(),
    pubkey: requiredEnvVar('NOSTR_PUBLIC_KEY'),
    tags: [
      ['p', requiredEnvVar('LEDGER_PUBLIC_KEY')],
      ['p', author],
      ['e', event.id],
      ['t', 'internal-transaction-start'],
    ],
  };
}
