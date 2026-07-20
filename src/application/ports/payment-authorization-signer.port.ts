import type { VaultPaymentAuthorization } from "../../domain/payments/vault-payment-authorization.js";

export type SignVaultPaymentAuthorization = Readonly<{
  vaultAddress: `0x${string}`;
  authorization: VaultPaymentAuthorization;
  explanation: string;
}>;

export interface PaymentAuthorizationSignerPort {
  signVaultPaymentAuthorization(
    input: SignVaultPaymentAuthorization,
  ): Promise<`0x${string}`>;
}
