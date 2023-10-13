import LndGrpc from 'lnd-grpc';
import { AddInvoiceResponse, ILndGrpc } from '@type/lnd-grpc';
import { logger, requiredEnvVar } from '@lib/utils';
import { Debugger } from 'debug';
import redis from '@services/redis';
import { lnInboundTx } from '@lib/events';
import { Outbox, OutboxService } from '@services/outbox';
import { getWriteNDK } from '@services/ndk';

const log: Debugger = logger.extend('services:lnd');
const warn: Debugger = log.extend('warn');
const error: Debugger = log.extend('error');

/**
 * Handles communication with LND.
 *
 * Responsible for keeping the gRPC connection with LND and makes
 * available methods for generating and paying invoices. Also includes
 * the subscriptions to received payments.
 */
class LndService {
  private grpc: ILndGrpc;

  /**
   * Starts connection ups and sets subscriptions up.
   */
  constructor(private readonly outbox: Outbox) {
    this.grpc = new LndGrpc({
      lndconnectUri: requiredEnvVar('LNDCONNECT_URI'),
    });
    this.connect().then(() => this.setUpSubscriptions());
  }

  async generateInvoice(amount: bigint): Promise<AddInvoiceResponse> {
    await this.grpc.waitForState('active');
    const { Lightning } = this.grpc.services;
    return Lightning.addInvoice({
      value_msat: amount.toString(),
    });
  }

  /**
   * Pays a given lightning invoice
   *
   * Tries to pay an invoice, return a void promise that resolves on
   * success and fails otherwise with reason.
   */
  async payInvoice(invoice: string): Promise<void> {
    await this.grpc.waitForState('active');
    const { Router } = this.grpc.services;
    const call = Router.sendPaymentV2({
      payment_request: invoice,
      timeout_seconds: 5,
      no_inflight_updates: true,
      fee_limit_msat: 1001,
    });
    return new Promise<void>((resolve, reject) => {
      call.on('data', (res: any) => {
        if ('SUCCEEDED' === res.status) {
          resolve();
        } else {
          reject(res.failure_reason);
        }
      });
      call.on('error', (e: Error) => reject(e));
    });
  }

  /**
   * Connects to LND through gRPC
   *
   * Throws on errors.
   */
  private async connect() {
    log('before connect, state: %s', this.grpc.state);
    await this.grpc.connect().catch((e) => {
      error('Unexpected error connecting: %O', e);
      throw e;
    });
    log('after connect, state: %s', this.grpc.state);
    this.grpc.on('locked', () => log('wallet locked!'));
    this.grpc.on('active', () => log('wallet unlocked!'));
    this.grpc.on('disconnected', () => warn('Disconnected from lnd'));
    this.grpc.on('error', (e: Error) => {
      error('Unexpected error: %O', e);
      throw e;
    });
  }

  /**
   * Subscribes to any settled invoice.
   */
  private async setUpSubscriptions() {
    const { Lightning } = this.grpc.services;
    const call = Lightning.subscribeInvoices({
      add_index: Infinity,
      settle_index: 0,
    });
    call.on('data', async (res: any) => {
      // Publish inbound-tx if an invoice generated by us is settled
      if (res.state === 'SETTLED') {
        const pubkey = await redis.getDel(res.r_hash);
        if (null !== pubkey) {
          this.outbox.publish(
            lnInboundTx(res.amt_paid_msat, res.payment_request, pubkey),
          );
        }
      }
    });
  }
}

const lnd = new LndService(new OutboxService(getWriteNDK()));

export default lnd;
