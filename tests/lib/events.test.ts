import { internalTx } from '@lib/events';

const LEDGER_PUBKEY =
  'c07b4bee4ae6604d76e1ff5ce6019364d3d8f21256d1f6033b568638f009be6c';
const NOSTR_PUBKEY =
  '8d55a1e374342c0fa7939a6deebdffdd238de82c1c767bee93a9ab030c8c51fb';
const RECEIVER_PUBKEY =
  '20cf6caf06a0d13a4aa5ec7d30e8c5d6e85922f71610763a6e645b35bdfc9386';
process.env.LEDGER_PUBLIC_KEY = LEDGER_PUBKEY;
process.env.NOSTR_PUBLIC_KEY = NOSTR_PUBKEY;

describe('Events utils', () => {
  describe('internalTx', () => {
    it('should create internal transaction event', () => {
      const content = '{"tokens":{"BTC":"332000"}}';

      const event = internalTx(RECEIVER_PUBKEY, content);
      const [target, receiver] = event.tags
        .filter((t) => 'p' === t[0])
        .map((t) => t[1]);
      const eTag = event.tags.find((t) => 'e' === t[0]);

      expect(event.content).toBe(content);
      expect(event.kind).toBe(1112);
      expect(target).toBe(LEDGER_PUBKEY);
      expect(receiver).toBe(RECEIVER_PUBKEY);
      expect(eTag).toBeUndefined();
    });

    it('should add e-tag', () => {
      const eventId =
        '2a35ae821e88ff118e3be9f99f4106afd5a6eb07a8ef1f08b143ddb22cfd4e82';
      const content = '{"tokens":{"BTC":"332000"}}';

      const event = internalTx(RECEIVER_PUBKEY, content, [['e', eventId]]);
      const [target, receiver] = event.tags
        .filter((t) => 'p' === t[0])
        .map((t) => t[1]);
      const eTag = event.tags.find((t) => 'e' === t[0]);

      expect(event.content).toBe(content);
      expect(event.kind).toBe(1112);
      expect(target).toBe(LEDGER_PUBKEY);
      expect(receiver).toBe(RECEIVER_PUBKEY);
      expect(eTag).toEqual(['e', eventId]);
    });
  });
});
