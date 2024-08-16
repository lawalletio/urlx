import { getWriteRelayHostname, hashPaymentRequest } from '@lib/utils';
import EventEmitter from 'events';
import { ClientRequest, IncomingMessage, request } from 'http';

jest.mock('http', () => {
  return {
    __esModule: true,
    request: jest.fn(),
  };
});

describe('', () => {
  describe('getWriteRelayHostname', () => {
    it('should ask the relay for its hostname only once', async () => {
      const expectedHostname = 'lawallet.ar';
      process.env.NOSTR_WRITE_RELAY = 'ws://nostream:8000';
      jest.mocked(request).mockImplementation((url, options, callback) => {
        const incomingMessage = new EventEmitter();
        const enc = new TextEncoder();
        if (callback) {
          callback(incomingMessage as IncomingMessage);
          incomingMessage.emit(
            'data',
            enc.encode('{"payments_url":"http://lawallet.ar/"}'),
          );
          incomingMessage.emit('end');
        }
        return { end: jest.fn() } as unknown as ClientRequest;
      });

      const hostname1 = await getWriteRelayHostname();
      const hostname2 = await getWriteRelayHostname();

      expect(request).toHaveBeenCalledTimes(1);
      expect(hostname1).toBe(expectedHostname);
      expect(hostname2).toBe(expectedHostname);
    });
  });

  describe('hashPaymentRequest', () => {
    it('should generate the same hash for both cases', async () => {
      const lowerPr = 'lnbc15u1p3xnhl2pp5jptserfk3zk4qy42tlucycrfwxhydvlemu9pqr93tuzlv9cc7g3sdqsvfhkcap3xyhx7un8cqzpgxqzjcsp5f8c52y2stc300gl6s4xswtjpc37hrnnr3c9wvtgjfuvqmpm35evq9qyyssqy4lgd8tj637qcjp05rdpxxykjenthxftej7a2zzmwrmrl70fyj9hvj0rewhzj7jfyuwkwcg9g2jpwtk3wkjtwnkdks84hsnu8xps5vsq4gj5hs ';
      const upperPr = lowerPr.toUpperCase();
      const expectedHash = 'a16a13d3e9a8c719ecbce91513aa0f532581b102a028704fa8bd7a2bf9a5fd06';

      const lowerHash = hashPaymentRequest(lowerPr);
      const upperHash = hashPaymentRequest(upperPr);


      expect(lowerHash).toEqual(expectedHash);
      expect(lowerHash).toEqual(upperHash);
    });
  });
});
