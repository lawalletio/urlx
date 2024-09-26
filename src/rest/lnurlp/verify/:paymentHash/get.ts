import { Debugger } from 'debug';
import type { Response } from 'express';
import type { ExtendedRequest } from '@type/request';

import { hashPaymentRequest, logger } from '@lib/utils';
import redis from '@services/redis';

const log: Debugger = logger.extend('rest:lnurlp:verify:paymentHash:get');
const debug: Debugger = log.extend('debug');

/**
 * Lud-21 endpoint
 *
 * Return if a given invoice is settled and the preimage if it is.
 */
const handler = async (req: ExtendedRequest, res: Response) => {
  const paymentHash: string = req.params.paymentHash;
  if (null === paymentHash) {
    debug('Malformed payment hash');
    res
      .status(422)
      .json({
        status: 'ERROR',
        reason: 'Malformed payment hash',
      })
      .send();
    return;
  }

  let invoice: Invoice | undefined = undefined;
  try {
    invoice = await req.context.lnd.getInvoice(paymentHash);
  } catch (e) {
    debug('Error getting invoice: %O', e);
    res
      .status(404)
      .json({
        status: 'ERROR',
        reason: 'Invoice not found',
      })
      .send();
    return;
  }

  const prHash = hashPaymentRequest(invoice.payment_request);
  const paid = 'true' === (await redis.hGet(prHash, 'paid'));
  const settled: boolean = paid || invoice.state === 'SETTLED';
  const preimage: string | null = settled
    ? invoice.r_preimage.toString('hex')
    : null;
  res
    .status(200)
    .json({ status: 'OK', settled, preimage, pr: invoice.payment_request })
    .send();
};

export default handler;
