import type { VaultPaymentAuthorization } from "../../domain/payments/vault-payment-authorization.js";

export type VaultPaymentReadiness = Readonly<{
  recipientApproved: boolean;
  paymentAlreadyUsed: boolean;
  paused: boolean;
  vaultBalance: bigint;
  maxPaymentAmount: bigint;
  dailyLimit: bigint;
  spentToday: bigint;
}>;

export type VaultStatus = Readonly<{
  recipientApproved: boolean;
  paused: boolean;
  vaultBalance: bigint;
  maxPaymentAmount: bigint;
  dailyLimit: bigint;
  spentToday: bigint;
}>;

export interface VaultReaderPort {
  getStatus(
    vaultAddress: `0x${string}`,
    recipientAddress: `0x${string}`,
  ): Promise<VaultStatus>;

  isRecipientApproved(
    vaultAddress: `0x${string}`,
    recipientAddress: `0x${string}`,
  ): Promise<boolean>;

  getPaymentReadiness(
    vaultAddress: `0x${string}`,
    authorization: VaultPaymentAuthorization,
  ): Promise<VaultPaymentReadiness>;
}
