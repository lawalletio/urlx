import { getWriteRelayHostname } from '@lib/utils';
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
});
