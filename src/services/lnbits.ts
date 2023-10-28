import LNBits from 'lnbits';
import { LNBitsWalletClass } from 'lnbits/lib/wallet';

import { requiredEnvVar, httpsRequest, jsonParseOrNull } from '@lib/utils';

import { Outbox, OutboxService } from '@services/outbox';
import { getWriteNDK } from '@services/ndk';

const lnurlpUri: string = requiredEnvVar('LNURLP_URI');

type PayInvoicePromise = ReturnType<LNBitsWalletClass['payInvoice']>;

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

  async generateInvoice(
    amount: bigint,
    comment: string | null,
  ): Promise<string | null> {
    let url: URL = new URL(lnurlpUri);
    url.searchParams.append('amount', amount.toString());
    if (null !== comment) {
      url.searchParams.append('comment', comment);
    }
    const body: string = (await httpsRequest(url)) ?? '';
    return jsonParseOrNull(body)?.pr ?? null;
  }

  /**
   * Pays a given lightning invoice
   *
   * Tries to pay an invoice, return a void promise that resolves on
   * success and fails otherwise with reason.
   */
  async payInvoice(invoice: string): PayInvoicePromise {
    return this.wallet.payInvoice({ bolt11: invoice, out: true });
  }
}

const lnbits = new LNBitsService(new OutboxService(getWriteNDK()));

export default lnbits;
