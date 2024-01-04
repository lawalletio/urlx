import NDK, { NostrEvent } from '@nostr-dev-kit/ndk';
import { getReadNDK } from '@services/ndk';
import redis from '@services/redis';
import { Context } from '@type/request';

const URLX_PUBKEY =
  '54dcdeb9685a9acc900fe09b53dddb0103a58924df2b4e6144daaa301261acd4';
const LEDGER_PUBKEY =
  'c07b4bee4ae6604d76e1ff5ce6019364d3d8f21256d1f6033b568638f009be6c';
process.env.NOSTR_PUBLIC_KEY = URLX_PUBKEY;
process.env.LEDGER_PUBLIC_KEY = LEDGER_PUBKEY;
// the keys must exist before importing the handler
import { getHandler } from '@nostr/inboundTransaction';

jest.mock('@services/redis', () => {
  return {
    __esModule: true,
    default: {
      hGet: jest.fn(),
      hSet: jest.fn(),
    },
  };
});

jest.mock('@services/ndk', () => {
  return {
    __esModule: true,
    getReadNDK: jest.fn(),
  };
});

describe('inboundTransaction handler', () => {
  const ctx: Context = {
    lnd: {} as any,
    outbox: {
      publish: jest.fn(async () => {
        return;
      }),
    },
  };
  const okEventId =
    '2a35ae821e88ff118e3be9f99f4106afd5a6eb07a8ef1f08b143ddb22cfd4e82';
  const startEventId =
    'e5e3120b26a35c9876fef9ed35931de3bff21ab6a022d10b3fcc0744325a3abd';

  it('should publish internal transaction', async () => {
    const pr =
      'lnbc15u1p3xnhl2pp5jptserfk3zk4qy42tlucycrfwxhydvlemu9pqr93tuzlv9cc7g3sdqsvfhkcap3xyhx7un8cqzpgxqzjcsp5f8c52y2stc300gl6s4xswtjpc37hrnnr3c9wvtgjfuvqmpm35evq9qyyssqy4lgd8tj637qcjp05rdpxxykjenthxftej7a2zzmwrmrl70fyj9hvj0rewhzj7jfyuwkwcg9g2jpwtk3wkjtwnkdks84hsnu8xps5vsq4gj5hs';
    const pubkey =
      '9a956a0d672b041e0d7312e7667248c027e7d00d5d8eb9bcdace11603e8828c4';
    const okEvent: NostrEvent = {
      id: okEventId,
      created_at: 1,
      kind: 1112,
      content: '{}',
      tags: [
        ['p', URLX_PUBKEY],
        ['p', URLX_PUBKEY],
        ['e', startEventId],
      ],
      pubkey: LEDGER_PUBKEY,
    };
    const startEvent: NostrEvent = {
      id: startEventId,
      created_at: 1,
      content: '{"tokens":{"BTC":"332000"}}',
      tags: [
        ['p', LEDGER_PUBKEY],
        ['p', URLX_PUBKEY],
        ['bolt11', pr],
      ],
      pubkey: URLX_PUBKEY,
    };
    jest
      .mocked(redis.hGet)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(pubkey);
    jest.mocked(getReadNDK).mockReturnValue({
      fetchEvent: jest.fn().mockResolvedValue(startEvent as NostrEvent),
    } as unknown as NDK);

    const handler = getHandler(ctx);
    await handler(okEvent);

    expect(ctx.outbox.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 1112,
        pubkey: URLX_PUBKEY,
        tags: [
          ['p', LEDGER_PUBKEY],
          ['p', pubkey],
          ['t', 'internal-transaction-start'],
          ['e', startEventId],
        ],
      }),
    );
    expect(redis.hSet).toHaveBeenCalledWith(okEventId, 'handled', 'true');
  });

  it.each`
    tags
    ${undefined}
    ${[]}
    ${[['p', URLX_PUBKEY], ['e', '123']]}
    ${[['p', URLX_PUBKEY], ['p', '123'], ['e', startEventId]]}
    ${[['p', '123'], ['p', URLX_PUBKEY], ['e', startEventId]]}
    ${[['p', '123'], ['p', '123'], ['e', startEventId]]}
  `(
    'should not publish event when the event is malformed',
    async ({ tags }) => {
      const okEvent: NostrEvent = {
        id: okEventId,
        created_at: 1,
        kind: 1112,
        content: '{}',
        tags,
        pubkey: LEDGER_PUBKEY,
      };

      const handler = getHandler(ctx);
      await handler(okEvent);

      expect(ctx.outbox.publish).not.toHaveBeenCalled();
      expect(redis.hSet).toHaveBeenCalledWith(okEventId, 'handled', 'true');
    },
  );

  it.each([
    null,
    {
      id: startEventId,
      created_at: 1,
      content: '{"tokens":{"BTC":"332000"}}',
      tags: [
        ['p', LEDGER_PUBKEY],
        ['p', URLX_PUBKEY],
      ],
      pubkey: URLX_PUBKEY,
    },
  ])(
    'should not publisht event when there is problems with the start event',
    async (startEvent) => {
      const okEvent: NostrEvent = {
        id: okEventId,
        created_at: 1,
        kind: 1112,
        content: '{}',
        tags: [
          ['p', URLX_PUBKEY],
          ['p', URLX_PUBKEY],
          ['e', startEventId],
        ],
        pubkey: LEDGER_PUBKEY,
      };
      jest.mocked(getReadNDK).mockReturnValue({
        fetchEvent: jest
          .fn()
          .mockResolvedValue(startEvent as unknown as NostrEvent),
      } as unknown as NDK);

      const handler = getHandler(ctx);
      await handler(okEvent);

      expect(ctx.outbox.publish).not.toHaveBeenCalled();
      expect(redis.hSet).toHaveBeenCalledWith(okEventId, 'handled', 'true');
    },
  );
});
