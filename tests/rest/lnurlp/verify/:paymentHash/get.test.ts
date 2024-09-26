import get from '@rest/lnurlp/verify/:paymentHash/get';
import type { ExtendedRequest } from '@type/request';
import type { Response } from 'express';

jest.mock('@services/redis', () => ({
  hGet: jest.fn().mockResolvedValue(undefined),
}));

describe('GET /lnurlp/verify/:paymentHash', () => {
  it('should error on null payment hash', async () => {
    const mockReq = {
      params: { paymentHash: null },
    } as unknown as ExtendedRequest;
    const mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      send: jest.fn(),
    } as unknown as Response;
    const expectedError = {
      status: 'ERROR',
      reason: 'Malformed payment hash',
    };

    get(mockReq, mockRes);

    expect(mockRes.status).toHaveBeenCalledWith(422);
    expect(mockRes.json).toHaveBeenCalledWith(expectedError);
    expect(mockRes.send).toHaveBeenCalled();
  });

  it('should error on invoice not found', async () => {
    const mockReq = {
      params: { paymentHash: 'paymentHash' },
      context: {
        lnd: {
          getInvoice: jest
            .fn()
            .mockRejectedValue(new Error('Invoice not found')),
        },
      },
    } as unknown as ExtendedRequest;
    const mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      send: jest.fn(),
    } as unknown as Response;
    const expectedError = {
      status: 'ERROR',
      reason: 'Invoice not found',
    };

    await expect(get(mockReq, mockRes)).resolves.toBeUndefined();

    expect(mockReq.context.lnd.getInvoice).toHaveBeenCalledWith('paymentHash');
    expect(mockRes.status).toHaveBeenCalledWith(404);
    expect(mockRes.json).toHaveBeenCalledWith(expectedError);
    expect(mockRes.send).toHaveBeenCalled();
  });

  it.each([
    {
      expected: { settled: true, preimage: '0123456789abcdef', pr: 'pr' },
      invoice: {
        state: 'SETTLED',
        r_preimage: Buffer.from('0123456789abcdef', 'hex'),
        payment_request: 'pr',
      },
    },
    {
      expected: { settled: false, preimage: null, pr: 'pr' },
      invoice: {
        state: 'CANCELED',
        r_preimage: Buffer.from('0123456789abcdef', 'hex'),
        payment_request: 'pr',
      },
    },
    {
      expected: { settled: false, preimage: null, pr: 'pr' },
      invoice: {
        state: 'ACCEPTED',
        r_preimage: Buffer.from('0123456789abcdef', 'hex'),
        payment_request: 'pr',
      },
    },
    {
      expected: { settled: false, preimage: null, pr: 'pr' },
      invoice: {
        state: 'OPEN',
        r_preimage: Buffer.from('0123456789abcdef', 'hex'),
        payment_request: 'pr',
      },
    },
  ])('should return invoice details', async ({ expected, invoice }) => {
    const mockReq = {
      params: { paymentHash: 'paymentHash' },
      context: {
        lnd: {
          getInvoice: jest.fn().mockResolvedValue(invoice),
        },
      },
    } as unknown as ExtendedRequest;
    const mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      send: jest.fn(),
    } as unknown as Response;

    await expect(get(mockReq, mockRes)).resolves.toBeUndefined();

    expect(mockReq.context.lnd.getInvoice).toHaveBeenCalledWith('paymentHash');
    expect(mockRes.status).toHaveBeenCalledWith(200);
    expect(mockRes.json).toHaveBeenCalledWith({ status: 'OK', ...expected });
    expect(mockRes.send).toHaveBeenCalled();
  });
});
