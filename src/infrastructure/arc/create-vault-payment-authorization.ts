import { keccak256, stringToHex } from "viem";
import { AUTHORIZATION_REFERENCE_PATTERN } from "../../domain/payments/authorization-reference.js";
import type { VaultPaymentAuthorization } from "../../domain/payments/vault-payment-authorization.js";

const AUTHORIZATION_LIFETIME_SECONDS = 30 * 60;

/** Creates the EVM-specific hashes consumed by AttestPayVault on Arc. */
export function createVaultPaymentAuthorization(input: {
  vaultAddress: `0x${string}`;
  operationId: string;
  recipient: `0x${string}`;
  amount: bigint;
  invoiceReference: string;
  policyReference: string;
  authorizer: `0x${string}`;
  issuedAt: number;
}): VaultPaymentAuthorization {
  if (
    !AUTHORIZATION_REFERENCE_PATTERN.test(input.operationId) ||
    !AUTHORIZATION_REFERENCE_PATTERN.test(input.invoiceReference) ||
    !AUTHORIZATION_REFERENCE_PATTERN.test(input.policyReference)
  ) {
    throw new Error("Payment, invoice, and policy references must be stable identifiers.");
  }
  if (!Number.isSafeInteger(input.issuedAt) || input.issuedAt <= 0) {
    throw new Error("Authorization issue time must be a positive Unix timestamp.");
  }
  if (input.amount <= 0n) {
    throw new Error("Vault payment amount must be positive.");
  }

  return Object.freeze({
    paymentId: keccak256(
      stringToHex(
        `attestpay:payment:v1:${input.vaultAddress.toLowerCase()}:${input.operationId}`,
      ),
    ),
    recipient: input.recipient,
    amount: input.amount,
    invoiceHash: keccak256(
      stringToHex(`attestpay:invoice:v1:${input.invoiceReference}`),
    ),
    policyHash: keccak256(
      stringToHex(`attestpay:policy:v1:${input.policyReference}`),
    ),
    validAfter: input.issuedAt,
    deadline: input.issuedAt + AUTHORIZATION_LIFETIME_SECONDS,
    authorizer: input.authorizer,
  });
}
