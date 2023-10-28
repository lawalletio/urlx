import LNBits from 'lnbits';
import { LNBitsWalletClass } from 'lnbits/lib/wallet';

import { requiredEnvVar } from '@lib/utils';

import { get } from 'https';
import { IncomingMessage } from 'http';

import { Outbox, OutboxService } from '@services/outbox';
import { getWriteNDK } from '@services/ndk';

const lnurlpUri: string = requiredEnvVar('LNURLP_URI');

/**
 * Handles communication with LNBits.
 *
 */
class LNBitsService {
  private wallet: LNBitsWalletClass;

  /**
   * Starts connection ups and sets subscriptions up.
   */
  constructor(private readonly outbox: Outbox) {
    this.wallet = LNBits({
      adminKey: requiredEnvVar('LNBITS_ADMIN_KEY'),
      invoiceReadKey: requiredEnvVar('LNBITS_INVOICE_READ_KEY'),
      endpoint: requiredEnvVar('LNBITS_ENDPOINT'),
    }).wallet;
  }

  async generateInvoice(amount: bigint): Promise<string | null> {
    var invoice: string | null = '';
    return new Promise((resolve, reject) => {
      get(`${lnurlpUri}?amount=${amount}`, (res: IncomingMessage) => {
        var bodyChunks: Uint8Array[] = [];
        res
          .on('data', (chunk: Uint8Array) => {
            bodyChunks.push(chunk);
          })
          .on('end', () => {
            invoice =
              JSON.parse(Buffer.concat(bodyChunks).toString())?.pr ?? null;
            resolve(invoice);
          })
          .on('error', (e) => {
            reject(e);
          });
      });
    });
  }

  /**
   * Pays a given lightning invoice
   *
   * Tries to pay an invoice, return a void promise that resolves on
   * success and fails otherwise with reason.
   */
  async payInvoice(invoice: string): Promise<void> {
    this.wallet.payInvoice({ bolt11: invoice, out: true });
  }
}

const lnbits = new LNBitsService(new OutboxService(getWriteNDK()));

export default lnbits;
