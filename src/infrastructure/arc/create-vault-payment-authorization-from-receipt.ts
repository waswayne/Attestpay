import { keccak256, stringToHex } from "viem";
import {
  generateAuthorizationReceiptHash,
  generateAuthorizationReplayKey,
  type CanonicalAuthorizationReceipt,
} from "../../domain/payments/canonical-authorization-receipt.js";
import type { VaultPaymentAuthorization } from "../../domain/payments/vault-payment-authorization.js";

function sha256HashToBytes32(hash: `sha256:${string}`): `0x${string}` {
  return `0x${hash.slice("sha256:".length)}`;
}

/**
 * Derives the narrower onchain instruction from a verified application receipt.
 * policyHash is the complete receipt hash, so every product authorization field
 * remains transitively bound by the vault signature and settlement event.
 */
export function createVaultPaymentAuthorizationFromReceipt(
  receipt: CanonicalAuthorizationReceipt,
): VaultPaymentAuthorization {
  const receiptHash = generateAuthorizationReceiptHash(receipt);
  const replayKey = generateAuthorizationReplayKey(receipt);
  const validAfter = Math.floor(Date.parse(receipt.issuedAt) / 1_000);
  const deadline = Math.floor(Date.parse(receipt.expiresAt) / 1_000);

  return Object.freeze({
    paymentId: keccak256(
      stringToHex(`attestpay:vault-payment:v1:${receiptHash}:${replayKey}`),
    ),
    recipient: receipt.recipientAddress,
    amount: receipt.amountBaseUnits,
    invoiceHash: sha256HashToBytes32(receipt.policyInputHash),
    policyHash: sha256HashToBytes32(receiptHash),
    validAfter,
    deadline,
    authorizer: receipt.authorizer,
  });
}
