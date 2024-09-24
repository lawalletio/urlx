import { LndService } from '@services/lnd';

const mockCall = {
  on: jest.fn().mockReturnThis(),
};

const lndGrcpMock = {
  state: 'active',
  connect: jest.fn(async () => {
    return;
  }),
  on: jest.fn(),
  waitForState: jest.fn(async () => {
    return;
  }),
  services: {
    Lightning: {
      subscribeInvoices: jest.fn().mockReturnValue(mockCall),
      addInvoice: jest.fn(),
    },
    Router: {
      sendPaymentV2: jest.fn(),
    },
  },
};
jest.mock('@services/redis', () => {
  return {
    __esModule: true,
    default: {
      hGet: jest.fn(),
      hSet: jest.fn(),
    },
  };
});
jest.mock('lnd-grpc', () => {
  return jest.fn().mockImplementation(() => lndGrcpMock);
});

describe('lnd service', () => {
  const outbox = {
    publish: jest.fn(),
  };
  const lnd = new LndService('', outbox);
  const pr =
    'lnbc15u1p3xnhl2pp5jptserfk3zk4qy42tlucycrfwxhydvlemu9pqr93tuzlv9cc7g3sdqsvfhkcap3xyhx7un8cqzpgxqzjcsp5f8c52y2stc300gl6s4xswtjpc37hrnnr3c9wvtgjfuvqmpm35evq9qyyssqy4lgd8tj637qcjp05rdpxxykjenthxftej7a2zzmwrmrl70fyj9hvj0rewhzj7jfyuwkwcg9g2jpwtk3wkjtwnkdks84hsnu8xps5vsq4gj5hs';
  it('should generate invoice', async () => {
    lndGrcpMock.services.Lightning.addInvoice.mockResolvedValue({
      payment_request: pr,
    });

    const invoice = await lnd.generateInvoice(1000n, null);

    expect(lndGrcpMock.services.Lightning.addInvoice).toHaveBeenCalledWith(
      expect.objectContaining({ value_msat: '1000' }),
    );
    expect(invoice).toBe(pr);
  });
  it('should generate invoice with comment', async () => {
    const memo = 'To the moon!';
    lndGrcpMock.services.Lightning.addInvoice.mockResolvedValue({
      payment_request: pr,
    });

    const invoice = await lnd.generateInvoice(1000n, memo);

    expect(lndGrcpMock.services.Lightning.addInvoice).toHaveBeenCalledWith(
      expect.objectContaining({ value_msat: '1000', memo }),
    );
    expect(invoice).toBe(pr);
  });
  it('should pay an invoice', async () => {
    lndGrcpMock.services.Router.sendPaymentV2.mockReturnValue({
      on: jest.fn((_event, callback) => {
        callback({ status: 'SUCCEEDED' });
      }),
    });

    await lnd.payInvoice(pr, 1000);

    expect(lndGrcpMock.services.Router.sendPaymentV2).toHaveBeenCalledWith(
      expect.objectContaining({ payment_request: pr }),
    );
  });
  it('should reject on failed payment', async () => {
    lndGrcpMock.services.Router.sendPaymentV2.mockReturnValue({
      on: jest.fn((_event, callback) => {
        callback({ status: 'FAILED', failure_reason: 'FAILURE_REASON_ERROR' });
      }),
    });

    await expect(lnd.payInvoice(pr, 1000)).rejects.toBe('FAILURE_REASON_ERROR');
  });
});
