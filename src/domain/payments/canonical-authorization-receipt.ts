import type { CanonicalEvmAddress } from "../shared/canonical-evm-address.js";
import {
  bigintToCanonicalDecimal,
  requireCanonicalInstant,
  requireSha256Hash,
  requireStableIdentifier,
  serializeCanonicalRecord,
  sha256CanonicalRecord,
  type CanonicalField,
  type Sha256Hash,
} from "../shared/canonical-record.js";

export const AUTHORIZATION_RECEIPT_SCHEMA_VERSION =
  "attestpay.authorization-receipt.v1" as const;

export type AuthorizationOutcome = "AUTO_APPROVED" | "HUMAN_APPROVED";

export type CanonicalAuthorizationReceipt = Readonly<{
  schemaVersion: typeof AUTHORIZATION_RECEIPT_SCHEMA_VERSION;
  decisionHash: Sha256Hash;
  policyDefinitionHash: Sha256Hash;
  policyInputHash: Sha256Hash;
  authorizationOutcome: AuthorizationOutcome;
  authorizer: CanonicalEvmAddress;
  chainId: bigint;
  vaultAddress: CanonicalEvmAddress;
  recipientAddress: CanonicalEvmAddress;
  usdcTokenAddress: CanonicalEvmAddress;
  amountBaseUnits: bigint;
  paymentReference: string;
  nonce: string;
  issuedAt: string;
  expiresAt: string;
}>;

export type CreateCanonicalAuthorizationReceipt = Omit<
  CanonicalAuthorizationReceipt,
  "schemaVersion"
>;

function canonicalReceiptFields(
  receipt: CanonicalAuthorizationReceipt,
): readonly CanonicalField[] {
  return [
    ["schemaVersion", receipt.schemaVersion],
    ["decisionHash", receipt.decisionHash],
    ["policyDefinitionHash", receipt.policyDefinitionHash],
    ["policyInputHash", receipt.policyInputHash],
    ["authorizationOutcome", receipt.authorizationOutcome],
    ["authorizer", receipt.authorizer],
    ["chainId", bigintToCanonicalDecimal(receipt.chainId)],
    ["vaultAddress", receipt.vaultAddress],
    ["recipientAddress", receipt.recipientAddress],
    ["usdcTokenAddress", receipt.usdcTokenAddress],
    ["amountBaseUnits", bigintToCanonicalDecimal(receipt.amountBaseUnits)],
    ["paymentReference", receipt.paymentReference],
    ["nonce", receipt.nonce],
    ["issuedAt", receipt.issuedAt],
    ["expiresAt", receipt.expiresAt],
  ];
}

export function assertCanonicalAuthorizationReceipt(
  receipt: CanonicalAuthorizationReceipt,
): void {
  if (receipt.schemaVersion !== AUTHORIZATION_RECEIPT_SCHEMA_VERSION) {
    throw new Error("Unsupported authorization-receipt schema version.");
  }
  if (
    requireSha256Hash(receipt.decisionHash, "Payment decision hash") !==
      receipt.decisionHash ||
    requireSha256Hash(
      receipt.policyDefinitionHash,
      "Policy-definition hash",
    ) !== receipt.policyDefinitionHash ||
    requireSha256Hash(receipt.policyInputHash, "Policy-input hash") !==
      receipt.policyInputHash
  ) {
    throw new Error("Authorization receipt hashes must already be canonical.");
  }
  if (
    receipt.authorizationOutcome !== "AUTO_APPROVED" &&
    receipt.authorizationOutcome !== "HUMAN_APPROVED"
  ) {
    throw new Error("Authorization outcome must permit payment.");
  }
  if (receipt.chainId <= 0n) {
    throw new Error("Authorization chain ID must be positive.");
  }
  if (receipt.amountBaseUnits <= 0n) {
    throw new Error("Authorization amount must be positive base units.");
  }
  if (
    requireStableIdentifier(receipt.paymentReference, "Payment reference") !==
      receipt.paymentReference ||
    requireStableIdentifier(receipt.nonce, "Authorization nonce") !== receipt.nonce
  ) {
    throw new Error("Authorization identifiers must already be canonical.");
  }

  const issuedAt = requireCanonicalInstant(
    receipt.issuedAt,
    "Authorization issue time",
  );
  const expiresAt = requireCanonicalInstant(
    receipt.expiresAt,
    "Authorization expiry time",
  );
  if (issuedAt !== receipt.issuedAt || expiresAt !== receipt.expiresAt) {
    throw new Error("Authorization times must already be canonical UTC instants.");
  }
  if (Date.parse(expiresAt) <= Date.parse(issuedAt)) {
    throw new Error("Authorization expiry must be after its issue time.");
  }
}

export function createCanonicalAuthorizationReceipt(
  input: CreateCanonicalAuthorizationReceipt,
): CanonicalAuthorizationReceipt {
  const receipt: CanonicalAuthorizationReceipt = {
    schemaVersion: AUTHORIZATION_RECEIPT_SCHEMA_VERSION,
    decisionHash: requireSha256Hash(input.decisionHash, "Payment decision hash"),
    policyDefinitionHash: requireSha256Hash(
      input.policyDefinitionHash,
      "Policy-definition hash",
    ),
    policyInputHash: requireSha256Hash(input.policyInputHash, "Policy-input hash"),
    authorizationOutcome: input.authorizationOutcome,
    authorizer: input.authorizer,
    chainId: input.chainId,
    vaultAddress: input.vaultAddress,
    recipientAddress: input.recipientAddress,
    usdcTokenAddress: input.usdcTokenAddress,
    amountBaseUnits: input.amountBaseUnits,
    paymentReference: requireStableIdentifier(
      input.paymentReference,
      "Payment reference",
    ),
    nonce: requireStableIdentifier(input.nonce, "Authorization nonce"),
    issuedAt: requireCanonicalInstant(input.issuedAt, "Authorization issue time"),
    expiresAt: requireCanonicalInstant(
      input.expiresAt,
      "Authorization expiry time",
    ),
  };

  assertCanonicalAuthorizationReceipt(receipt);
  return Object.freeze(receipt);
}

export function serializeCanonicalAuthorizationReceipt(
  receipt: CanonicalAuthorizationReceipt,
): string {
  assertCanonicalAuthorizationReceipt(receipt);
  return serializeCanonicalRecord(
    AUTHORIZATION_RECEIPT_SCHEMA_VERSION,
    canonicalReceiptFields(receipt),
  );
}

export function generateAuthorizationReceiptHash(
  receipt: CanonicalAuthorizationReceipt,
): Sha256Hash {
  assertCanonicalAuthorizationReceipt(receipt);
  return sha256CanonicalRecord(
    AUTHORIZATION_RECEIPT_SCHEMA_VERSION,
    canonicalReceiptFields(receipt),
  );
}

/**
 * Replay uniqueness is scoped to one authorizer, chain, vault, and nonce. This
 * intentionally rejects a second independently signed receipt that reuses the
 * same nonce for that authority boundary.
 */
export function generateAuthorizationReplayKey(
  receipt: CanonicalAuthorizationReceipt,
): Sha256Hash {
  assertCanonicalAuthorizationReceipt(receipt);
  return sha256CanonicalRecord("attestpay.authorization-replay-key.v1", [
    ["authorizer", receipt.authorizer],
    ["chainId", bigintToCanonicalDecimal(receipt.chainId)],
    ["vaultAddress", receipt.vaultAddress],
    ["nonce", receipt.nonce],
  ]);
}
