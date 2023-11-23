import { Debugger } from 'debug';
import type { Response } from 'express';
import type { ExtendedRequest } from '@type/request';

import { logger } from '@lib/utils';
import redis from '@services/redis';

const log: Debugger = logger.extend('rest:invoice:invoiceHash:get');
const debug: Debugger = log.extend('debug');

/**
 * Retrieve data associated to the given invoice hash
 *
 */
const handler = async (req: ExtendedRequest, res: Response) => {
  const invoiceHash: string | null = req.params?.invoiceHash;
  if (null === invoiceHash) {
    debug('Non-existing invoice hash');
    res.status(422).send();
    return;
  }
  if (!/^[0-9a-f]$/i.test(invoiceHash)) {
    debug('Malformed invoice hash');
    res.status(422).send();
    return;
  }

  const response: { [key: string]: string } = await redis.hGetAll(invoiceHash);
  if (!response) {
    debug('Unknown invoice hash');
    res.status(422).send();
    return;
  }

  res.status(200).json(response).send();
};

export default handler;
