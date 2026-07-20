import { submitTreasuryTransfer } from "../../application/use-cases/submit-treasury-transfer.js";
import { verifyUsdcSettlement } from "../../application/use-cases/verify-usdc-settlement.js";
import { loadCircleTestRecipientConfig } from "../../config/circle-test-recipient.config.js";
import { loadCircleTreasuryConfig } from "../../config/circle-treasury.config.js";
import { parseUsdcAmount } from "../../domain/payments/usdc-amount.js";
import { ArcSettlementVerifierAdapter } from "../../infrastructure/arc/arc-settlement-verifier.adapter.js";
import { CircleTreasuryPaymentAdapter } from "../../infrastructure/circle/circle-treasury-payment.adapter.js";
import { CircleTreasuryWalletAdapter } from "../../infrastructure/circle/circle-treasury-wallet.adapter.js";
import {
  loadOrCreateTestTransferAttempt,
  recordTestTransferSettlement,
  recordTestTransferStatus,
  recordTestTransferSubmission,
} from "../../infrastructure/local/test-transfer-attempt.store.js";

const [operationId, amount] = process.argv.slice(2);

if (!operationId || !amount) {
  throw new Error(
    "Usage: npm run circle:send-test -- <operation-id> <usdc-amount>",
  );
}

parseUsdcAmount(amount);

const treasuryConfig = loadCircleTreasuryConfig();
const recipientConfig = loadCircleTestRecipientConfig();
const wallet = new CircleTreasuryWalletAdapter(treasuryConfig);
const payments = new CircleTreasuryPaymentAdapter(treasuryConfig);
const settlementVerifier = new ArcSettlementVerifierAdapter();

let attempt = await loadOrCreateTestTransferAttempt({
  operationId,
  amount,
  destinationAddress: recipientConfig.address,
});

console.log("Controlled Arc Testnet transfer:");
console.log(`  Operation: ${attempt.operationId}`);
console.log(`  Amount: ${attempt.amount} USDC`);
console.log(`  Recipient: ${attempt.destinationAddress}`);

if (!attempt.transactionId) {
  const submission = await submitTreasuryTransfer(wallet, payments, {
    idempotencyKey: attempt.idempotencyKey,
    destinationAddress: attempt.destinationAddress,
    amount: attempt.amount,
    reference: `attestpay:test:${attempt.operationId}`,
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
await recordTestTransferStatus(attempt, status);

console.log("Transaction hash observed:");
console.log(`  State: ${status.state}`);
console.log(`  Hash: ${status.transactionHash}`);
console.log("  Note: a transaction hash is submission evidence, not settlement proof.");

if (!status.transactionHash) {
  throw new Error("Circle returned no transaction hash to reconcile.");
}

const settlement = await verifyUsdcSettlement(settlementVerifier, {
  transactionHash: status.transactionHash,
  senderAddress: treasuryConfig.walletAddress,
  recipientAddress: recipientConfig.address,
  amount: attempt.amount,
});
await recordTestTransferSettlement(attempt, settlement);

console.log("Arc settlement verified:");
console.log(`  Block: ${settlement.blockNumber}`);
console.log(`  USDC event index: ${settlement.logIndex}`);
console.log(
  `  Explorer: https://testnet.arcscan.app/tx/${settlement.transactionHash}`,
);
