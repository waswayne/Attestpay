import {
  hashTypedData,
  isHex,
  recoverTypedDataAddress,
  size,
  type Address,
  type Hex,
} from "viem";
import type { AuthorizationReplayProtectionPort } from "../../application/ports/authorization-replay-protection.port.js";
import {
  assertCanonicalAuthorizationReceipt,
  generateAuthorizationReceiptHash,
  generateAuthorizationReplayKey,
  type CanonicalAuthorizationReceipt,
} from "../../domain/payments/canonical-authorization-receipt.js";
import {
  requireCanonicalInstant,
  type Sha256Hash,
} from "../../domain/shared/canonical-record.js";
import {
  canonicalEvmAddressesEqual,
  parseCanonicalEvmAddress,
} from "../../shared/validation/evm.js";

export const AUTHORIZATION_RECEIPT_EIP712_NAME = "AttestPayAuthorization";
export const AUTHORIZATION_RECEIPT_EIP712_VERSION = "1";

export const AUTHORIZATION_RECEIPT_EIP712_TYPES = {
  AuthorizationReceipt: [
    { name: "schemaVersion", type: "string" },
    { name: "decisionHash", type: "string" },
    { name: "policyDefinitionHash", type: "string" },
    { name: "policyInputHash", type: "string" },
    { name: "authorizationOutcome", type: "string" },
    { name: "authorizer", type: "address" },
    { name: "chainId", type: "uint256" },
    { name: "vaultAddress", type: "address" },
    { name: "recipientAddress", type: "address" },
    { name: "usdcTokenAddress", type: "address" },
    { name: "amountBaseUnits", type: "uint256" },
    { name: "paymentReference", type: "string" },
    { name: "nonce", type: "string" },
    { name: "issuedAt", type: "string" },
    { name: "expiresAt", type: "string" },
    { name: "receiptHash", type: "string" },
  ],
} as const;

export type AuthorizationReceiptVerificationContext = Readonly<{
  decisionHash: Sha256Hash;
  policyDefinitionHash: Sha256Hash;
  policyInputHash: Sha256Hash;
  authorizationOutcome: CanonicalAuthorizationReceipt["authorizationOutcome"];
  expectedAuthorizer: string;
  chainId: bigint;
  vaultAddress: string;
  recipientAddress: string;
  usdcTokenAddress: string;
  amountBaseUnits: bigint;
  paymentReference: string;
  nonce: string;
}>;

export type AuthorizationReceiptContextField =
  | "decisionHash"
  | "policyDefinitionHash"
  | "policyInputHash"
  | "authorizationOutcome"
  | "authorizer"
  | "chainId"
  | "vaultAddress"
  | "recipientAddress"
  | "usdcTokenAddress"
  | "amountBaseUnits"
  | "paymentReference"
  | "nonce";

export type AuthorizationReceiptVerificationFailureCode =
  | "INVALID_RECEIPT"
  | "INVALID_VERIFICATION_TIME"
  | "CONTEXT_MISMATCH"
  | "NOT_YET_VALID"
  | "EXPIRED"
  | "MALFORMED_SIGNATURE"
  | "SIGNER_MISMATCH"
  | "REPLAYED"
  | "REPLAY_CHECK_FAILED";

export type AuthorizationReceiptVerificationResult =
  | Readonly<{
      valid: true;
      code: "VALID";
      receiptHash: Sha256Hash;
      payloadHash: Hex;
      replayKey: Sha256Hash;
      recoveredSigner: Address;
    }>
  | Readonly<{
      valid: false;
      code: AuthorizationReceiptVerificationFailureCode;
      receiptHash?: Sha256Hash;
      payloadHash?: Hex;
      replayKey?: Sha256Hash;
      recoveredSigner?: Address;
      field?: AuthorizationReceiptContextField;
    }>;

type AuthorizationReceiptSigner = Readonly<{
  address: Address;
  signTypedData(
    typedData: ReturnType<typeof getAuthorizationReceiptTypedData>,
  ): Promise<Hex>;
}>;

function assertCanonicalReceiptAddresses(
  receipt: CanonicalAuthorizationReceipt,
): void {
  const addresses = [
    receipt.authorizer,
    receipt.vaultAddress,
    receipt.recipientAddress,
    receipt.usdcTokenAddress,
  ] as const;

  for (const address of addresses) {
    if (parseCanonicalEvmAddress(address) !== address) {
      throw new Error("Authorization receipt contains a non-canonical EVM address.");
    }
  }
}

export function getAuthorizationReceiptTypedData(
  receipt: CanonicalAuthorizationReceipt,
) {
  assertCanonicalAuthorizationReceipt(receipt);
  assertCanonicalReceiptAddresses(receipt);
  const receiptHash = generateAuthorizationReceiptHash(receipt);

  return {
    domain: {
      name: AUTHORIZATION_RECEIPT_EIP712_NAME,
      version: AUTHORIZATION_RECEIPT_EIP712_VERSION,
      chainId: receipt.chainId,
      verifyingContract: receipt.vaultAddress,
    },
    types: AUTHORIZATION_RECEIPT_EIP712_TYPES,
    primaryType: "AuthorizationReceipt" as const,
    message: {
      ...receipt,
      receiptHash,
    },
  } as const;
}

export function generateAuthorizationPayloadHash(
  receipt: CanonicalAuthorizationReceipt,
): Hex {
  return hashTypedData(getAuthorizationReceiptTypedData(receipt));
}

export function serializeAuthorizationReceiptTypedData(
  receipt: CanonicalAuthorizationReceipt,
): string {
  const typedData = getAuthorizationReceiptTypedData(receipt);
  return JSON.stringify(
    {
      ...typedData,
      types: {
        EIP712Domain: [
          { name: "name", type: "string" },
          { name: "version", type: "string" },
          { name: "chainId", type: "uint256" },
          { name: "verifyingContract", type: "address" },
        ],
        ...typedData.types,
      },
    },
    (_key, value) => (typeof value === "bigint" ? value.toString() : value),
  );
}

export async function signCanonicalAuthorizationReceipt(
  receipt: CanonicalAuthorizationReceipt,
  signer: AuthorizationReceiptSigner,
): Promise<Hex> {
  if (!canonicalEvmAddressesEqual(receipt.authorizer, signer.address)) {
    throw new Error("Authorization receipt is assigned to a different signer.");
  }

  return signer.signTypedData(getAuthorizationReceiptTypedData(receipt));
}

function contextMismatch(
  field: AuthorizationReceiptContextField,
  receiptHash: Sha256Hash,
  payloadHash: Hex,
  replayKey: Sha256Hash,
): AuthorizationReceiptVerificationResult {
  return {
    valid: false,
    code: "CONTEXT_MISMATCH",
    field,
    receiptHash,
    payloadHash,
    replayKey,
  };
}

function addressesEqual(first: string, second: string): boolean {
  try {
    return canonicalEvmAddressesEqual(first, second);
  } catch {
    return false;
  }
}

function mismatchedContextField(
  receipt: CanonicalAuthorizationReceipt,
  context: AuthorizationReceiptVerificationContext,
): AuthorizationReceiptContextField | undefined {
  if (receipt.decisionHash !== context.decisionHash) return "decisionHash";
  if (receipt.policyDefinitionHash !== context.policyDefinitionHash) {
    return "policyDefinitionHash";
  }
  if (receipt.policyInputHash !== context.policyInputHash) return "policyInputHash";
  if (receipt.authorizationOutcome !== context.authorizationOutcome) {
    return "authorizationOutcome";
  }
  if (!addressesEqual(receipt.authorizer, context.expectedAuthorizer)) {
    return "authorizer";
  }
  if (receipt.chainId !== context.chainId) return "chainId";
  if (!addressesEqual(receipt.vaultAddress, context.vaultAddress)) {
    return "vaultAddress";
  }
  if (
    !addressesEqual(receipt.recipientAddress, context.recipientAddress)
  ) {
    return "recipientAddress";
  }
  if (
    !addressesEqual(receipt.usdcTokenAddress, context.usdcTokenAddress)
  ) {
    return "usdcTokenAddress";
  }
  if (receipt.amountBaseUnits !== context.amountBaseUnits) return "amountBaseUnits";
  if (receipt.paymentReference !== context.paymentReference) {
    return "paymentReference";
  }
  if (receipt.nonce !== context.nonce) return "nonce";
  return undefined;
}

export async function verifyCanonicalAuthorizationReceipt(input: {
  receipt: CanonicalAuthorizationReceipt;
  signature: string;
  expected: AuthorizationReceiptVerificationContext;
  verifiedAt: string;
  replayProtection: AuthorizationReplayProtectionPort;
}): Promise<AuthorizationReceiptVerificationResult> {
  let receiptHash: Sha256Hash;
  let payloadHash: Hex;
  let replayKey: Sha256Hash;

  try {
    assertCanonicalAuthorizationReceipt(input.receipt);
    assertCanonicalReceiptAddresses(input.receipt);
    receiptHash = generateAuthorizationReceiptHash(input.receipt);
    payloadHash = generateAuthorizationPayloadHash(input.receipt);
    replayKey = generateAuthorizationReplayKey(input.receipt);
  } catch {
    return { valid: false, code: "INVALID_RECEIPT" };
  }

  const contextField = mismatchedContextField(input.receipt, input.expected);
  if (contextField) {
    return contextMismatch(contextField, receiptHash, payloadHash, replayKey);
  }

  let verifiedAt: string;
  try {
    verifiedAt = requireCanonicalInstant(input.verifiedAt, "Verification time");
  } catch {
    return {
      valid: false,
      code: "INVALID_VERIFICATION_TIME",
      receiptHash,
      payloadHash,
      replayKey,
    };
  }

  const verifiedAtMs = Date.parse(verifiedAt);
  if (verifiedAtMs < Date.parse(input.receipt.issuedAt)) {
    return {
      valid: false,
      code: "NOT_YET_VALID",
      receiptHash,
      payloadHash,
      replayKey,
    };
  }
  if (verifiedAtMs >= Date.parse(input.receipt.expiresAt)) {
    return {
      valid: false,
      code: "EXPIRED",
      receiptHash,
      payloadHash,
      replayKey,
    };
  }

  if (!isHex(input.signature) || size(input.signature) !== 65) {
    return {
      valid: false,
      code: "MALFORMED_SIGNATURE",
      receiptHash,
      payloadHash,
      replayKey,
    };
  }

  let recoveredSigner: Address;
  try {
    recoveredSigner = await recoverTypedDataAddress({
      ...getAuthorizationReceiptTypedData(input.receipt),
      signature: input.signature,
    });
  } catch {
    return {
      valid: false,
      code: "MALFORMED_SIGNATURE",
      receiptHash,
      payloadHash,
      replayKey,
    };
  }

  if (
    !canonicalEvmAddressesEqual(recoveredSigner, input.receipt.authorizer) ||
    !canonicalEvmAddressesEqual(recoveredSigner, input.expected.expectedAuthorizer)
  ) {
    return {
      valid: false,
      code: "SIGNER_MISMATCH",
      receiptHash,
      payloadHash,
      replayKey,
      recoveredSigner,
    };
  }

  let consumed: boolean;
  try {
    consumed = await input.replayProtection.consume({ replayKey, receiptHash });
  } catch {
    return {
      valid: false,
      code: "REPLAY_CHECK_FAILED",
      receiptHash,
      payloadHash,
      replayKey,
      recoveredSigner,
    };
  }
  if (!consumed) {
    return {
      valid: false,
      code: "REPLAYED",
      receiptHash,
      payloadHash,
      replayKey,
      recoveredSigner,
    };
  }

  return {
    valid: true,
    code: "VALID",
    receiptHash,
    payloadHash,
    replayKey,
    recoveredSigner,
  };
}
