export interface AddInvoiceResponse {
  r_hash: Buffer;
  payment_request: string;
  add_index: number;
  payment_address: Buffer;
}

interface LightningService {
  addInvoice(any): Promise<AddInvoiceResponse>;
  subscribeInvoices(any): EventEmitter;
}

interface RouterService {
  sendPaymentV2(any): EventEmitter;
}

export interface ILndGrpc {
  state: 'ready' | 'locked' | 'active';
  connect(): Promise<void>;
  waitForState(string): Promise<void>;
  on(string, Function): void;
  services: {
    Lightning: LightningService;
    Router: RouterService;
  };
}
