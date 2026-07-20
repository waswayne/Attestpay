import type { VaultPaymentAuthorization } from "../../domain/payments/vault-payment-authorization.js";
import type { VaultReaderPort } from "../ports/vault-reader.port.js";

export async function assertVaultCanPay(
  reader: VaultReaderPort,
  vaultAddress: `0x${string}`,
  authorization: VaultPaymentAuthorization,
  nowSeconds = Math.floor(Date.now() / 1_000),
): Promise<void> {
  const state = await reader.getPaymentReadiness(vaultAddress, authorization);

  if (state.paused) throw new Error("Vault payment execution is paused.");
  if (!state.recipientApproved) {
    throw new Error("The payment recipient is not approved by the vault.");
  }
  if (state.paymentAlreadyUsed) {
    throw new Error("The vault payment ID has already been consumed.");
  }
  if (nowSeconds < authorization.validAfter) {
    throw new Error("The payment authorization is not valid yet.");
  }
  if (nowSeconds > authorization.deadline) {
    throw new Error("The payment authorization has expired; use a new operation ID.");
  }
  if (authorization.amount > state.maxPaymentAmount) {
    throw new Error("The payment exceeds the vault per-payment limit.");
  }
  if (state.spentToday + authorization.amount > state.dailyLimit) {
    throw new Error("The payment exceeds the vault daily limit.");
  }
  if (authorization.amount > state.vaultBalance) {
    throw new Error("The vault has insufficient USDC for this payment.");
  }
}
