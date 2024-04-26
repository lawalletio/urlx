import { Request } from 'express';
import { Outbox } from '@services/outbox';
import { LndService } from '@services/lnd';

export interface Context {
  outbox: Outbox;
  lnd: LndService;
}

export interface ExtendedRequest extends Request {
  context: Context;
}
