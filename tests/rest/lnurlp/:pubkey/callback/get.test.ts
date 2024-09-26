import get from '@rest/lnurlp/:pubkey/callback/get';
import type { ExtendedRequest } from '@type/request';
import type { Response } from 'express';

jest.mock('@services/redis', () => ({
  hSet: jest.fn().mockResolvedValue(true),
}));

describe('GET /lnurlp/:pubkey/callback', () => {
  it('should include verify url on success', async () => {
    const pr =
      'lnbc10n1pn02ekrpp5r3ce6rhp0r9qd37kwa7pq0r3nn7jd9hq0nuctgh4pmycauxfhsmsdqqcqzzsxqyz5vqsp5qjl9juug84vute0ghle00pmrl7u2dljuk59d49q5v2awuk5puqes9qyyssqqud5nztsnd98ew3rlajv59gafcl3nvy8ss6v9dmcqqfjzz0nv9uk805jtelm8ww35vatcmu7xt849jx4xntv23hs0nd4lwhua8jr3ycqezgj3y';
    const pubkey =
      '46fdede0158d7a5dfee21f62476916a7fb69d6037ee29e51bac136cc2643ab5f';
    const mockReq = {
      params: {
        pubkey,
      },
      query: {
        amount: '1000',
        comment: 'comment',
      },
      context: {
        lnd: {
          generateInvoice: jest.fn().mockResolvedValue(pr),
        },
      },
    } as unknown as ExtendedRequest;
    const mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      send: jest.fn(),
    } as unknown as Response;

    await expect(get(mockReq, mockRes)).resolves.toBeUndefined();

    expect(mockRes.status).toHaveBeenCalledWith(200);
    expect(mockRes.json).toHaveBeenCalledWith({
      pr,
      routes: [],
      verify:
        'https://unittest.lawallet.ar/lnurlp/verify/1c719d0ee178ca06c7d6777c103c719cfd2696e07cf985a2f50ec98ef0c9bc37',
    });
    expect(mockRes.send).toHaveBeenCalled();
  });
});
