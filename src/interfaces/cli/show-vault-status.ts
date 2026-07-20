import { formatUnits } from "viem";
import { loadAttestPayVaultConfig } from "../../config/attestpay-vault.config.js";
import { loadCircleTestRecipientConfig } from "../../config/circle-test-recipient.config.js";
import { ArcVaultReaderAdapter } from "../../infrastructure/arc/arc-vault-reader.adapter.js";

const vault = loadAttestPayVaultConfig();
const recipient = loadCircleTestRecipientConfig();
const status = await new ArcVaultReaderAdapter().getStatus(
  vault.address,
  recipient.address,
);

console.log("AttestPay vault status:");
console.log(`  Address: ${vault.address}`);
console.log(`  Balance: ${formatUnits(status.vaultBalance, 6)} USDC`);
console.log(`  Paused: ${status.paused ? "YES" : "NO"}`);
console.log(`  Test recipient approved: ${status.recipientApproved ? "YES" : "NO"}`);
console.log(`  Per-payment limit: ${formatUnits(status.maxPaymentAmount, 6)} USDC`);
console.log(`  Daily limit: ${formatUnits(status.dailyLimit, 6)} USDC`);
console.log(`  Spent today: ${formatUnits(status.spentToday, 6)} USDC`);
