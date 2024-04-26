import LndGrpc from 'lnd-grpc';
import {
  getWriteRelayHostname,
  logger,
  requiredEnvVar,
  shuffled,
} from '@lib/utils';
import { Debugger } from 'debug';
import redis from '@services/redis';
import { lnInboundTx } from '@lib/events';
import { Outbox, OutboxService } from '@services/outbox';
import { connectToTempRelays, getSignerNDK } from '@services/ndk';
import { commandOptions } from 'redis';
import { nip57 } from 'nostr-tools';
import { NostrEvent } from '@nostr-dev-kit/ndk';
import { createHash } from 'crypto';

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
export class LndService {
  private grpc: LndGrpc;

  /**
   * Starts connection up and sets subscriptions up.
   */
  constructor(
    lndconnectUri: string,
    private readonly outbox: Outbox,
  ) {
    this.grpc = new LndGrpc({ lndconnectUri });
    this.connect().then(() => this.setUpSubscriptions());
  }

  async generateInvoice(
    amount: bigint,
    comment: string | null,
  ): Promise<string | null> {
    await this.grpc.waitForState('active');
    const { Lightning } = this.grpc.services;
    const invoice: AddInvoiceRequest = {
      value_msat: amount.toString(),
    };
    if (comment) {
      invoice.memo = comment;
    }
    const res: AddInvoiceResponse = await Lightning.addInvoice(invoice);
    return res.payment_request;
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
      fee_limit_msat: 1001, // TODO: is this ok?
      allow_self_payment: true,
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
    call.on('data', async (invoice: Invoice) => {
      // Publish inbound-tx if an invoice generated by us is settled
      if (invoice.state === 'SETTLED') {
        log('Received settled invoice');
        const prHash: string = createHash('sha256')
          .update(invoice.payment_request)
          .digest('hex');
        if (1 !== (await redis.incr(`a:${prHash}`))) {
          await redis.decr(`a:${prHash}`);
          warn('Already processing invoice');
          return;
        }
        const [pubkey, zapRequest, comment, handled] = await redis.hmGet(
          commandOptions({ returnBuffers: false }),
          prHash,
          ['pubkey', 'zapRequest', 'comment', 'handled'],
        );
        if (!pubkey) {
          log('Invoice not generated by us');
          await redis.decr(`a:${prHash}`);
        }
        if ('true' === (handled ?? 'false')) {
          log('Already handled');
          await redis.decr(`a:${prHash}`);
        }
        if (zapRequest) {
          const zapReceipt = nip57.makeZapReceipt({
            zapRequest,
            bolt11: invoice.payment_request,
            paidAt: new Date(),
          });
          const theWriteRelayHostname: string = await getWriteRelayHostname();
          const relayUrls = shuffled<string>(
            JSON.parse(zapRequest)
              .tags.find((t: string[]) => 'relays' === t[0])
              .slice(1)
              .filter((r: string) => {
                try {
                  return new URL(r).hostname !== theWriteRelayHostname;
                } catch (e) {
                  return false;
                }
              }),
          ).slice(-5);
          const ndk = getSignerNDK();
          const relaySet = connectToTempRelays(relayUrls, ndk);
          new OutboxService(ndk)
            .publish(zapReceipt as NostrEvent, relaySet)
            .catch((e) =>
              warn('Could not publish zapReceipt to external: %O', e),
            );
          this.outbox.publish(zapReceipt as NostrEvent).catch((e) => {
            error('Could not publish zapReceipt to internal: %O', e);
          });
        }
        this.outbox
          .publish(
            lnInboundTx(
              BigInt(invoice.amt_paid_msat),
              invoice.payment_request,
              requiredEnvVar('NOSTR_PUBLIC_KEY'),
              comment,
            ),
          )
          .then(async () => {
            await redis.hSet(prHash, 'handled', 'true');
            await redis.decr(`a:${prHash}`);
          })
          .catch(async (e) => {
            error('Could not publish inboundTx: %O', e);
            await redis.decr(`a:${prHash}`);
          });
      }
    });
  }
}
