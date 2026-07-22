import type { CanonicalAuthorizationReceipt } from "../../domain/payments/canonical-authorization-receipt.js";

export interface AuthorizationReceiptSignerPort {
  signAuthorizationReceipt(input: {
    receipt: CanonicalAuthorizationReceipt;
    explanation: string;
  }): Promise<`0x${string}`>;
}
