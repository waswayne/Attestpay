import { submitTreasuryMemoTransfer } from "../../application/use-cases/submit-treasury-memo-transfer.js";
import { verifyMemoUsdcSettlement } from "../../application/use-cases/verify-memo-usdc-settlement.js";
import { loadCircleTestRecipientConfig } from "../../config/circle-test-recipient.config.js";
import { loadCircleTreasuryConfig } from "../../config/circle-treasury.config.js";
import { parseUsdcAmount } from "../../domain/payments/usdc-amount.js";
import { prepareArcMemoTransfer } from "../../infrastructure/arc/arc-memo.js";
import { ArcSettlementVerifierAdapter } from "../../infrastructure/arc/arc-settlement-verifier.adapter.js";
import { CircleTreasuryPaymentAdapter } from "../../infrastructure/circle/circle-treasury-payment.adapter.js";
import { CircleTreasuryWalletAdapter } from "../../infrastructure/circle/circle-treasury-wallet.adapter.js";
import {
  loadOrCreateTestMemoTransferAttempt,
  recordTestMemoTransferSettlement,
  recordTestTransferStatus,
  recordTestTransferSubmission,
} from "../../infrastructure/local/test-transfer-attempt.store.js";

const [operationId, amount, authorizationReference] = process.argv.slice(2);

if (!operationId || !amount || !authorizationReference) {
  throw new Error(
    "Usage: npm run circle:send-memo-test -- <operation-id> <usdc-amount> <authorization-reference>",
  );
}

parseUsdcAmount(amount);

const treasuryConfig = loadCircleTreasuryConfig();
const recipientConfig = loadCircleTestRecipientConfig();
const wallet = new CircleTreasuryWalletAdapter(treasuryConfig);
const payments = new CircleTreasuryPaymentAdapter(treasuryConfig);
const settlementVerifier = new ArcSettlementVerifierAdapter();
const memo = prepareArcMemoTransfer({
  recipientAddress: recipientConfig.address,
  amount,
  authorizationReference,
});

let attempt = await loadOrCreateTestMemoTransferAttempt({
  operationId,
  amount,
  destinationAddress: recipientConfig.address,
  authorizationReference,
});

console.log("Controlled Arc memo transfer:");
console.log(`  Operation: ${attempt.operationId}`);
console.log(`  Authorization: ${authorizationReference}`);
console.log(`  Memo ID: ${memo.memoId}`);
console.log(`  Amount: ${attempt.amount} USDC`);
console.log(`  Recipient: ${attempt.destinationAddress}`);

if (!attempt.transactionId) {
  const submission = await submitTreasuryMemoTransfer(wallet, payments, {
    idempotencyKey: attempt.idempotencyKey,
    destinationAddress: attempt.destinationAddress,
    amount: attempt.amount,
    reference: `attestpay:memo:${attempt.operationId}`,
    authorizationReference,
  });
  attempt = await recordTestTransferSubmission(attempt, submission);
  console.log(`  Circle transaction: ${submission.transactionId}`);
  console.log(`  Submitted state: ${submission.state}`);
} else {
  console.log(`  Resuming Circle transaction: ${attempt.transactionId}`);
}

if (!attempt.transactionId) {
  throw new Error("Circle transaction ID was not persisted.");
}

const status = await payments.waitForTransactionHash(
  attempt.transactionId,
  AbortSignal.timeout(180_000),
);
attempt = await recordTestTransferStatus(attempt, status);

if (!status.transactionHash) {
  throw new Error("Circle returned no transaction hash to reconcile.");
}

const settlement = await verifyMemoUsdcSettlement(settlementVerifier, {
  transactionHash: status.transactionHash,
  senderAddress: treasuryConfig.walletAddress,
  recipientAddress: recipientConfig.address,
  amount: attempt.amount,
  memoId: memo.memoId,
  memoData: memo.memoData,
  transferCallDataHash: memo.transferCallDataHash,
});
await recordTestMemoTransferSettlement(attempt, settlement, memo);

console.log("Arc memo settlement verified:");
console.log(`  Circle state: ${status.state}`);
console.log(`  Block: ${settlement.blockNumber}`);
console.log(`  Transfer event index: ${settlement.logIndex}`);
console.log(`  Memo event index: ${settlement.memoLogIndex}`);
console.log(`  Memo sequence: ${settlement.memoIndex}`);
console.log(
  `  Explorer: https://testnet.arcscan.app/tx/${settlement.transactionHash}`,
);
