import { Request } from 'express';
import { Outbox } from '@services/outbox';

export interface Context {
  outbox: Outbox;
}

export interface ExtendedRequest extends Request {
  context: Context;
}
