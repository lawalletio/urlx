declare interface AddInvoiceResponse {
  r_hash: Buffer;
  payment_request: string;
  add_index: number;
  payment_address: Buffer;
}

declare interface AddInvoiceRequest {
  memo?: string;
  value_msat: string;
}

declare interface Invoice {
  amt_paid_msat: number;
  memo: string;
  payment_request: string;
  r_preimage: Buffer;
  state: 'OPEN' | 'SETTLED' | 'CANCELED' | 'ACCEPTED';
  value_msat: string;
}

declare interface LightningService {
  addInvoice(invoice: AddInvoiceRequest): Promise<AddInvoiceResponse>;
  subscribeInvoices(any): EventEmitter;
}

declare interface RouterService {
  sendPaymentV2(any): EventEmitter;
}

declare interface LndGrpc {
  constructor();

  state: 'ready' | 'locked' | 'active';

  connect(): Promise<void>;
  waitForState(string): Promise<void>;
  on(string, Function): void;
  services: {
    Lightning: LightningService;
    Router: RouterService;
  };
}

declare module 'lnd-grpc';
