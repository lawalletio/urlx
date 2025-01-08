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

declare interface LookupInvoiceMsg {
  payment_hash: Buffer;
}

declare interface CancelInvoiceMsg {
  payment_hash: Buffer;
}

declare enum PaymentStatus {
  IN_FLIGHT = 'IN_FLIGHT',
  SUCCEEDED = 'SUCCEEDED',
  FAILED = 'FAILED',
  INITIATED = 'INITIATED',
}

declare enum PaymentFailureReason {
  FAILURE_REASON_NONE = 'FAILURE_REASON_NONE',
  FAILURE_REASON_TIMEOUT = 'FAILURE_REASON_TIMEOUT',
  FAILURE_REASON_NO_ROUTE = 'FAILURE_REASON_NO_ROUTE',
  FAILURE_REASON_ERROR = 'FAILURE_REASON_ERROR',
  FAILURE_REASON_INCORRECT_PAYMENT_DETAILS = 'FAILURE_REASON_INCORRECT_PAYMENT_DETAILS',
  FAILURE_REASON_INSUFFICIENT_BALANCE = 'FAILURE_REASON_INSUFFICIENT_BALANCE',
}

declare interface Payment {
  failure_reason: keyof typeof PaymentFailureReason;
  status: keyof typeof PaymentStatus;
  payment_preimage: string;
}

declare interface ConnectOptions {
  host: string,
  cert: string,
  macaroon: string 
}

declare interface LightningService {
  addInvoice(invoice: AddInvoiceRequest): Promise<AddInvoiceResponse>;
  subscribeInvoices(any): EventEmitter;
}

declare interface RouterService {
  sendPaymentV2(any): EventEmitter;
}

declare interface InvoicesService {
  lookupInvoiceV2(LookupInvoiceMsg): EventEmitter;
  cancelInvoice(CancelInvoiceMsg): EventEmitter;
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
    Invoices: InvoicesService;
  };
}

declare module 'lnd-grpc';
