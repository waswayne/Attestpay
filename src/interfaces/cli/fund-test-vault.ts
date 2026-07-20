import { submitTreasuryTransfer } from "../../application/use-cases/submit-treasury-transfer.js";
import { verifyUsdcSettlement } from "../../application/use-cases/verify-usdc-settlement.js";
import { loadAttestPayVaultConfig } from "../../config/attestpay-vault.config.js";
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
  throw new Error("Usage: npm run vault:fund -- <operation-id> <usdc-amount>");
}
parseUsdcAmount(amount);

const treasury = loadCircleTreasuryConfig();
const vault = loadAttestPayVaultConfig();
const wallet = new CircleTreasuryWalletAdapter(treasury);
const payments = new CircleTreasuryPaymentAdapter(treasury);
const verifier = new ArcSettlementVerifierAdapter();
let attempt = await loadOrCreateTestTransferAttempt({
  operationId,
  amount,
  destinationAddress: vault.address,
});

console.log("AttestPay vault funding:");
console.log(`  Operation: ${attempt.operationId}`);
console.log(`  Vault: ${attempt.destinationAddress}`);
console.log(`  Amount: ${attempt.amount} USDC`);

if (!attempt.transactionId) {
  const submission = await submitTreasuryTransfer(wallet, payments, {
    idempotencyKey: attempt.idempotencyKey,
    destinationAddress: attempt.destinationAddress,
    amount: attempt.amount,
    reference: `attestpay:vault-fund:${attempt.operationId}`,
  });
  attempt = await recordTestTransferSubmission(attempt, submission);
  console.log(`  Circle transaction: ${submission.transactionId}`);
  console.log(`  Submitted state: ${submission.state}`);
} else {
  console.log(`  Resuming Circle transaction: ${attempt.transactionId}`);
}

if (!attempt.transactionId) throw new Error("Funding transaction ID was not persisted.");
const status = await payments.waitForTransactionHash(
  attempt.transactionId,
  AbortSignal.timeout(180_000),
);
attempt = await recordTestTransferStatus(attempt, status);
if (!status.transactionHash) {
  throw new Error("Circle returned no funding transaction hash to reconcile.");
}

const evidence = await verifyUsdcSettlement(verifier, {
  transactionHash: status.transactionHash,
  senderAddress: treasury.walletAddress,
  recipientAddress: vault.address,
  amount: attempt.amount,
});
await recordTestTransferSettlement(attempt, evidence);

console.log("Vault funding verified:");
console.log(`  Block: ${evidence.blockNumber}`);
console.log(`  USDC event index: ${evidence.logIndex}`);
console.log(`  Explorer: https://testnet.arcscan.app/tx/${evidence.transactionHash}`);
