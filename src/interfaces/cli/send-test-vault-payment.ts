import { assertVaultCanPay } from "../../application/use-cases/assert-vault-can-pay.js";
import { submitArcContractCall } from "../../application/use-cases/submit-arc-contract-call.js";
import { loadAttestPayVaultConfig } from "../../config/attestpay-vault.config.js";
import { loadCircleTestRecipientConfig } from "../../config/circle-test-recipient.config.js";
import { loadCircleTreasuryConfig } from "../../config/circle-treasury.config.js";
import { loadCircleVaultAuthorizerConfig } from "../../config/circle-vault-authorizer.config.js";
import { parseUsdcAmount } from "../../domain/payments/usdc-amount.js";
import { ArcSettlementVerifierAdapter } from "../../infrastructure/arc/arc-settlement-verifier.adapter.js";
import { ARC_MEMO_ADDRESS } from "../../infrastructure/arc/arc-memo.js";
import { ArcVaultReaderAdapter } from "../../infrastructure/arc/arc-vault-reader.adapter.js";
import { prepareArcVaultPayment } from "../../infrastructure/arc/attestpay-vault.js";
import { CircleTreasuryPaymentAdapter } from "../../infrastructure/circle/circle-treasury-payment.adapter.js";
import { CircleVaultAuthorizationSignerAdapter } from "../../infrastructure/circle/circle-vault-authorization-signer.adapter.js";
import {
  authorizationFromAttempt,
  loadOrCreateVaultPaymentAttempt,
  recordVaultOperationStatus,
  recordVaultOperationSubmission,
  recordVaultPaymentSettlement,
  recordVaultPaymentSignature,
} from "../../infrastructure/local/vault-operation-attempt.store.js";

const [operationId, amount, invoiceReference, policyReference] =
  process.argv.slice(2);
if (!operationId || !amount || !invoiceReference || !policyReference) {
  throw new Error(
    "Usage: npm run vault:send-test -- <operation-id> <usdc-amount> <invoice-reference> <policy-reference>",
  );
}

const amountAtomic = parseUsdcAmount(amount);
const treasury = loadCircleTreasuryConfig();
const vault = loadAttestPayVaultConfig();
const recipient = loadCircleTestRecipientConfig();
const authorizer = loadCircleVaultAuthorizerConfig();
const reader = new ArcVaultReaderAdapter();
const payments = new CircleTreasuryPaymentAdapter(treasury);
const signer = new CircleVaultAuthorizationSignerAdapter(authorizer);
const verifier = new ArcSettlementVerifierAdapter();
const authorizationReference = `vault-payment:${operationId}`;

let attempt = await loadOrCreateVaultPaymentAttempt({
  operationId,
  vaultAddress: vault.address,
  recipientAddress: recipient.address,
  authorizerAddress: authorizer.walletAddress,
  amount,
  amountAtomic,
  invoiceReference,
  policyReference,
  authorizationReference,
});
const authorization = authorizationFromAttempt(attempt);

console.log("AttestPay controlled vault payment:");
console.log(`  Operation: ${attempt.operationId}`);
console.log(`  Payment ID: ${authorization.paymentId}`);
console.log(`  Invoice hash: ${authorization.invoiceHash}`);
console.log(`  Policy hash: ${authorization.policyHash}`);
console.log(`  Amount: ${attempt.amount} USDC`);
console.log(`  Recipient: ${attempt.recipientAddress}`);
console.log(`  Authorization expires: ${new Date(authorization.deadline * 1_000).toISOString()}`);

let signature = attempt.signature;
if (!attempt.transactionId) {
  await assertVaultCanPay(reader, vault.address, authorization);
  if (!signature) {
    signature = await signer.signVaultPaymentAuthorization({
      vaultAddress: vault.address,
      authorization,
      explanation: `AttestPay vault payment ${attempt.operationId}`,
    });
  }

  const prepared = prepareArcVaultPayment({
    vaultAddress: vault.address,
    authorization,
    signature,
    authorizationReference,
  });
  attempt = await recordVaultPaymentSignature(attempt, signature, {
    memoId: prepared.memoId,
    memoData: prepared.memoData,
    vaultCallDataHash: prepared.vaultCallDataHash,
  });
  const submission = await submitArcContractCall(payments, {
    idempotencyKey: attempt.idempotencyKey,
    contractAddress: ARC_MEMO_ADDRESS,
    callData: prepared.contractCallData,
    reference: `attestpay:vault-pay:${attempt.operationId}`,
  });
  attempt = await recordVaultOperationSubmission(attempt, submission);
  console.log(`  Circle transaction: ${submission.transactionId}`);
  console.log(`  Submitted state: ${submission.state}`);
} else {
  console.log(`  Resuming Circle transaction: ${attempt.transactionId}`);
}

if (!attempt.transactionId) throw new Error("Vault payment transaction ID was not persisted.");
if (!attempt.signature || !attempt.memoId || !attempt.memoData || !attempt.vaultCallDataHash) {
  throw new Error("The signed vault payment evidence was not persisted.");
}
const memoId = attempt.memoId;
const memoData = attempt.memoData;
const vaultCallDataHash = attempt.vaultCallDataHash;
const status = await payments.waitForTransactionHash(
  attempt.transactionId,
  AbortSignal.timeout(180_000),
);
attempt = await recordVaultOperationStatus(attempt, status);
if (!status.transactionHash) {
  throw new Error("Circle returned no vault payment transaction hash to reconcile.");
}

const evidence = await verifier.verifyVaultPaymentSettlement({
  transactionHash: status.transactionHash,
  recipientAddress: recipient.address,
  amount: attempt.amount,
  memoId,
  memoData,
  transferCallDataHash: vaultCallDataHash,
  vaultAddress: vault.address,
  executorAddress: treasury.walletAddress,
  authorizerAddress: authorizer.walletAddress,
  paymentId: authorization.paymentId,
  invoiceHash: authorization.invoiceHash,
  policyHash: authorization.policyHash,
});
await recordVaultPaymentSettlement(attempt, evidence);

console.log("Vault payment settlement verified:");
console.log(`  Circle state: ${status.state}`);
console.log(`  Block: ${evidence.blockNumber}`);
console.log(`  Transfer event index: ${evidence.logIndex}`);
console.log(`  Payment event index: ${evidence.paymentEventLogIndex}`);
console.log(`  Memo event index: ${evidence.memoLogIndex}`);
console.log(`  Explorer: https://testnet.arcscan.app/tx/${evidence.transactionHash}`);
