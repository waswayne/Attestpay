import {
  bigintToCanonicalDecimal,
  requireCanonicalInstant,
  requireSha256Hash,
  requireStableIdentifier,
  sha256CanonicalRecord,
  type Sha256Hash,
} from "../shared/canonical-record.js";
import type { CanonicalEvmAddress } from "../shared/canonical-evm-address.js";

export type ManualApprovalDecision = "APPROVED" | "REJECTED";

export type ManualApproval = Readonly<{
  schemaVersion: "attestpay.manual-approval.v1";
  approvalId: string;
  paymentReference: string;
  decisionHash: Sha256Hash;
  approverId: string;
  approverAddress: CanonicalEvmAddress;
  decision: ManualApprovalDecision;
  chainId: bigint;
  vaultAddress: CanonicalEvmAddress;
  recipientAddress: CanonicalEvmAddress;
  usdcTokenAddress: CanonicalEvmAddress;
  amountBaseUnits: bigint;
  decidedAt: string;
}>;

export function createManualApproval(
  input: Omit<ManualApproval, "schemaVersion">,
): ManualApproval {
  if (input.chainId <= 0n || input.amountBaseUnits <= 0n) {
    throw new Error("Manual approval chain and amount must be positive.");
  }
  return Object.freeze({
    schemaVersion: "attestpay.manual-approval.v1",
    approvalId: requireStableIdentifier(input.approvalId, "Approval ID"),
    paymentReference: requireStableIdentifier(
      input.paymentReference,
      "Payment reference",
    ),
    decisionHash: requireSha256Hash(input.decisionHash, "Decision hash"),
    approverId: requireStableIdentifier(input.approverId, "Approver ID"),
    approverAddress: input.approverAddress,
    decision: input.decision,
    chainId: input.chainId,
    vaultAddress: input.vaultAddress,
    recipientAddress: input.recipientAddress,
    usdcTokenAddress: input.usdcTokenAddress,
    amountBaseUnits: input.amountBaseUnits,
    decidedAt: requireCanonicalInstant(input.decidedAt, "Approval time"),
  });
}

export function generateManualApprovalHash(approval: ManualApproval): Sha256Hash {
  return sha256CanonicalRecord(approval.schemaVersion, [
    ["approvalId", approval.approvalId],
    ["paymentReference", approval.paymentReference],
    ["decisionHash", approval.decisionHash],
    ["approverId", approval.approverId],
    ["approverAddress", approval.approverAddress],
    ["decision", approval.decision],
    ["chainId", bigintToCanonicalDecimal(approval.chainId)],
    ["vaultAddress", approval.vaultAddress],
    ["recipientAddress", approval.recipientAddress],
    ["usdcTokenAddress", approval.usdcTokenAddress],
    ["amountBaseUnits", bigintToCanonicalDecimal(approval.amountBaseUnits)],
    ["decidedAt", approval.decidedAt],
  ]);
}
