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
      trackPaymentV2: jest.fn(),
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
  const paymentHash =
    '4185fab4f82fe707648d99c0714a32a354950a31c928e37701b18f29be44e070';

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
    const failedPayment = {
      status: 'FAILED',
      failure_reason: 'FAILURE_REASON_ERROR',
      payment_preimage: '',
    };
    lndGrcpMock.services.Router.sendPaymentV2.mockReturnValue({
      on: jest.fn((_event, callback) => {
        callback(failedPayment);
      }),
    });

    await expect(lnd.payInvoice(pr, 1000)).rejects.toEqual(failedPayment);
  });

  describe('trackPayment', () => {
    it('should track a payment successfully', async () => {
      const successfulPayment = {
        status: 'SUCCEEDED',
        payment_preimage:
          '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
        failure_reason: undefined,
      };

      lndGrcpMock.services.Router.trackPaymentV2.mockReturnValue({
        on: jest.fn((event, callback) => {
          if (event === 'data') {
            callback(successfulPayment);
          }
          return { on: jest.fn() };
        }),
      });

      const result = await lnd.trackPayment(paymentHash);

      expect(lndGrcpMock.services.Router.trackPaymentV2).toHaveBeenCalledWith({
        payment_hash: Buffer.from(paymentHash, 'hex'),
        no_inflight_updates: true,
      });
      expect(result).toEqual(successfulPayment);
    });

    it('should reject with full payment object when payment has FAILED status', async () => {
      const failedPayment = {
        status: 'FAILED',
        failure_reason: 'FAILURE_REASON_TIMEOUT',
        payment_preimage: '',
      };

      lndGrcpMock.services.Router.trackPaymentV2.mockReturnValue({
        on: jest.fn((event, callback) => {
          if (event === 'data') {
            callback(failedPayment);
          }
          return { on: jest.fn() };
        }),
      });

      await expect(lnd.trackPayment(paymentHash)).rejects.toEqual(
        failedPayment,
      );
    });

    it('should reject with full payment object for non SUCCEEDED/FAILED status', async () => {
      const initiatedPayment = {
        status: 'INITIATED',
        failure_reason: undefined,
        payment_preimage: '',
      };

      lndGrcpMock.services.Router.trackPaymentV2.mockReturnValue({
        on: jest.fn((event, callback) => {
          if (event === 'data') {
            callback(initiatedPayment);
          }
          return { on: jest.fn() };
        }),
      });

      await expect(lnd.trackPayment(paymentHash)).rejects.toEqual(
        initiatedPayment,
      );
    });

    it('should reject with Error object on connection issues', async () => {
      const connectionError = new Error('Connection error');

      lndGrcpMock.services.Router.trackPaymentV2.mockReturnValue({
        on: jest.fn((event, callback) => {
          if (event === 'error') {
            callback(connectionError);
          }
          return { on: jest.fn() };
        }),
      });

      await expect(lnd.trackPayment(paymentHash)).rejects.toEqual(
        connectionError,
      );
    });
  });
});
