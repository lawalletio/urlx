import LNBits from 'lnbits';
import { LNBitsWalletClass } from 'lnbits/lib/wallet';

import { requiredEnvVar } from '@lib/utils';

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

  async generateInvoice(amount: bigint): Promise<string> {
    // 1. pegarle a una url de ENV
    // 2. extraer el "pr" de esa url
    // 3. retornar ese "pr"
    return `${lnurlpUri}?amount=${amount}`;
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
