import { submitArcContractCall } from "../../application/use-cases/submit-arc-contract-call.js";
import { loadAttestPayVaultConfig } from "../../config/attestpay-vault.config.js";
import { loadCircleTestRecipientConfig } from "../../config/circle-test-recipient.config.js";
import { loadCircleTreasuryConfig } from "../../config/circle-treasury.config.js";
import { ArcSettlementVerifierAdapter } from "../../infrastructure/arc/arc-settlement-verifier.adapter.js";
import { ARC_MEMO_ADDRESS } from "../../infrastructure/arc/arc-memo.js";
import { ArcVaultReaderAdapter } from "../../infrastructure/arc/arc-vault-reader.adapter.js";
import { prepareArcVaultRecipientApproval } from "../../infrastructure/arc/attestpay-vault.js";
import { CircleTreasuryPaymentAdapter } from "../../infrastructure/circle/circle-treasury-payment.adapter.js";
import {
  loadOrCreateVaultApprovalAttempt,
  recordVaultApprovalSettlement,
  recordVaultOperationStatus,
  recordVaultOperationSubmission,
} from "../../infrastructure/local/vault-operation-attempt.store.js";

const [operationId] = process.argv.slice(2);
if (!operationId) {
  throw new Error("Usage: npm run vault:approve-recipient -- <operation-id>");
}

const treasury = loadCircleTreasuryConfig();
const vault = loadAttestPayVaultConfig();
const recipient = loadCircleTestRecipientConfig();
const payments = new CircleTreasuryPaymentAdapter(treasury);
const reader = new ArcVaultReaderAdapter();
const verifier = new ArcSettlementVerifierAdapter();
const authorizationReference = `recipient-approval:${operationId}`;
const memo = prepareArcVaultRecipientApproval({
  vaultAddress: vault.address,
  recipientAddress: recipient.address,
  approved: true,
  authorizationReference,
});

let attempt = await loadOrCreateVaultApprovalAttempt({
  operationId,
  vaultAddress: vault.address,
  recipientAddress: recipient.address,
  approved: true,
  authorizationReference,
  memoId: memo.memoId,
  memoData: memo.memoData,
  vaultCallDataHash: memo.vaultCallDataHash,
});

console.log("AttestPay vault recipient approval:");
console.log(`  Operation: ${attempt.operationId}`);
console.log(`  Vault: ${attempt.vaultAddress}`);
console.log(`  Recipient: ${attempt.recipientAddress}`);

if (!attempt.transactionId) {
  if (await reader.isRecipientApproved(vault.address, recipient.address)) {
    console.log("  State: already approved onchain");
    process.exit(0);
  }

  const submission = await submitArcContractCall(payments, {
    idempotencyKey: attempt.idempotencyKey,
    contractAddress: ARC_MEMO_ADDRESS,
    callData: memo.contractCallData,
    reference: `attestpay:approve:${attempt.operationId}`,
  });
  attempt = await recordVaultOperationSubmission(attempt, submission);
  console.log(`  Circle transaction: ${submission.transactionId}`);
  console.log(`  Submitted state: ${submission.state}`);
} else {
  console.log(`  Resuming Circle transaction: ${attempt.transactionId}`);
}

if (!attempt.transactionId) throw new Error("Approval transaction ID was not persisted.");
const status = await payments.waitForTransactionHash(
  attempt.transactionId,
  AbortSignal.timeout(180_000),
);
attempt = await recordVaultOperationStatus(attempt, status);
if (!status.transactionHash) {
  throw new Error("Circle returned no approval transaction hash to reconcile.");
}

const evidence = await verifier.verifyVaultRecipientApproval({
  transactionHash: status.transactionHash,
  vaultAddress: vault.address,
  administratorAddress: treasury.walletAddress,
  recipientAddress: recipient.address,
  approved: true,
  memoId: memo.memoId,
  memoData: memo.memoData,
  vaultCallDataHash: memo.vaultCallDataHash,
});
await recordVaultApprovalSettlement(attempt, evidence);

if (!(await reader.isRecipientApproved(vault.address, recipient.address))) {
  throw new Error("Arc receipt succeeded but the recipient is not currently approved.");
}

console.log("Vault recipient approval verified:");
console.log(`  Block: ${evidence.blockNumber}`);
console.log(`  Approval event index: ${evidence.approvalLogIndex}`);
console.log(`  Memo event index: ${evidence.memoLogIndex}`);
console.log(`  Explorer: https://testnet.arcscan.app/tx/${evidence.transactionHash}`);
