import type { TreasuryPaymentStatus } from "./treasury-payment.port.js";
import type { VaultPaymentSettlementEvidence } from "./settlement-verifier.port.js";
import type {
  CanonicalAuthorizationReceipt,
} from "../../domain/payments/canonical-authorization-receipt.js";
import type { ManualApproval } from "../../domain/payments/manual-approval.js";
import type { PaymentLifecycleState } from "../../domain/payments/payment-lifecycle.js";
import type { VaultPaymentAuthorization } from "../../domain/payments/vault-payment-authorization.js";
import type { PaymentDecision } from "../../domain/policies/payment-policy.js";
import type { CanonicalEvmAddress } from "../../domain/shared/canonical-evm-address.js";
import type { Sha256Hash } from "../../domain/shared/canonical-record.js";

export type PaymentWorkflow = Readonly<{
  id: string;
  idempotencyKey: string;
  version: number;
  state: PaymentLifecycleState;
  decision: PaymentDecision;
  decisionHash: Sha256Hash;
  policyDefinitionHash: Sha256Hash;
  policyInputHash: Sha256Hash;
  authorizer: CanonicalEvmAddress;
  chainId: bigint;
  vaultAddress: CanonicalEvmAddress;
  recipientAddress: CanonicalEvmAddress;
  usdcTokenAddress: CanonicalEvmAddress;
  amountBaseUnits: bigint;
  paymentReference: string;
  nonce: string;
  issuedAt: string;
  expiresAt: string;
  approval: ManualApproval | null;
  receipt: CanonicalAuthorizationReceipt | null;
  receiptSignature: `0x${string}` | null;
  receiptHash: Sha256Hash | null;
  replayKey: Sha256Hash | null;
  vaultAuthorization: VaultPaymentAuthorization | null;
  vaultSignature: `0x${string}` | null;
  preparedCall: Readonly<{
    contractAddress: `0x${string}`;
    contractCallData: `0x${string}`;
    memoId: `0x${string}`;
    memoData: `0x${string}`;
    vaultCallDataHash: `0x${string}`;
  }> | null;
  submission: TreasuryPaymentStatus | null;
  settlement: VaultPaymentSettlementEvidence | null;
  failureReason: string | null;
  createdAt: string;
  updatedAt: string;
}>;

export type PaymentWorkflowAuditEvent = Readonly<{
  workflowId: string;
  sequence: number;
  eventType: string;
  occurredAt: string;
  payload: Readonly<Record<string, string | boolean | null>>;
}>;

export interface PaymentWorkflowRepositoryPort {
  create(
    workflow: PaymentWorkflow,
    event: PaymentWorkflowAuditEvent,
  ): Promise<void>;
  get(id: string): Promise<PaymentWorkflow | null>;
  list(): Promise<readonly PaymentWorkflow[]>;
  listAuditEvents(id: string): Promise<readonly PaymentWorkflowAuditEvent[]>;
  save(
    workflow: PaymentWorkflow,
    expectedVersion: number,
    event: PaymentWorkflowAuditEvent,
  ): Promise<boolean>;
  authorizeAtomically(input: {
    workflow: PaymentWorkflow;
    expectedVersion: number;
    replayKey: Sha256Hash;
    receiptHash: Sha256Hash;
    event: PaymentWorkflowAuditEvent;
  }): Promise<boolean>;
}
