import type { CanonicalEvmAddress } from "../shared/canonical-evm-address.js";
import {
  bigintToCanonicalDecimal,
  requireSha256Hash,
  requireStableIdentifier,
  sha256CanonicalRecord,
  sha256Bytes,
  type Sha256Hash,
} from "../shared/canonical-record.js";

export type CriticalFieldProvenanceState = "COMPLETE" | "INCOMPLETE";

export type CanonicalInvoice = Readonly<{
  id: string;
  vendorId: string;
  workOrderId: string;
  invoiceNumberRaw: string;
  invoiceNumberNormalized: string;
  amountBaseUnits: bigint;
  currency: "USDC";
  proposedRecipientAddress: CanonicalEvmAddress;
  rawFileHash: Sha256Hash;
  criticalFieldProvenanceState: CriticalFieldProvenanceState;
  fingerprint: Sha256Hash;
}>;

const PROVENANCE_STATES: readonly CriticalFieldProvenanceState[] = [
  "COMPLETE",
  "INCOMPLETE",
];

/** Hashes raw invoice bytes before any extraction or document interpretation. */
export function generateRawInvoiceFileHash(value: Uint8Array): Sha256Hash {
  if (value.byteLength === 0) {
    throw new Error("Raw invoice file cannot be empty.");
  }

  return sha256Bytes(value);
}

export function normalizeInvoiceNumber(value: string): string {
  const normalized = value
    .normalize("NFKC")
    .trim()
    .toUpperCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");

  if (!normalized || normalized.length > 128) {
    throw new Error("Invoice number must normalize to 1 to 128 letters or digits.");
  }

  return normalized;
}

export function generateInvoiceFingerprint(input: {
  vendorId: string;
  workOrderId: string;
  invoiceNumber: string;
  amountBaseUnits: bigint;
  currency: string;
  proposedRecipientAddress: CanonicalEvmAddress;
}): Sha256Hash {
  const vendorId = requireStableIdentifier(input.vendorId, "Invoice vendor ID");
  const workOrderId = requireStableIdentifier(
    input.workOrderId,
    "Invoice work-order ID",
  );
  const invoiceNumberNormalized = normalizeInvoiceNumber(input.invoiceNumber);
  const currency = input.currency.trim().toUpperCase();

  if (input.amountBaseUnits <= 0n) {
    throw new Error("Invoice amount must be positive integer base units.");
  }
  if (currency !== "USDC") {
    throw new Error("Canonical invoices support USDC only.");
  }

  return sha256CanonicalRecord("attestpay.invoice-fingerprint.v1", [
    ["vendorId", vendorId],
    ["workOrderId", workOrderId],
    ["invoiceNumberNormalized", invoiceNumberNormalized],
    ["amountBaseUnits", bigintToCanonicalDecimal(input.amountBaseUnits)],
    ["currency", currency],
    ["proposedRecipientAddress", input.proposedRecipientAddress],
  ]);
}

export function createCanonicalInvoice(input: {
  id: string;
  vendorId: string;
  workOrderId: string;
  invoiceNumber: string;
  amountBaseUnits: bigint;
  currency: string;
  proposedRecipientAddress: CanonicalEvmAddress;
  rawFileHash: string;
  criticalFieldProvenanceState: CriticalFieldProvenanceState;
}): CanonicalInvoice {
  const id = requireStableIdentifier(input.id, "Invoice ID");
  const vendorId = requireStableIdentifier(input.vendorId, "Invoice vendor ID");
  const workOrderId = requireStableIdentifier(
    input.workOrderId,
    "Invoice work-order ID",
  );
  const invoiceNumberRaw = input.invoiceNumber.normalize("NFKC").trim();
  const invoiceNumberNormalized = normalizeInvoiceNumber(invoiceNumberRaw);
  const currency = input.currency.trim().toUpperCase();
  const rawFileHash = requireSha256Hash(input.rawFileHash, "Raw invoice file hash");

  if (input.amountBaseUnits <= 0n) {
    throw new Error("Invoice amount must be positive integer base units.");
  }
  if (currency !== "USDC") {
    throw new Error("Canonical invoices support USDC only.");
  }
  if (!PROVENANCE_STATES.includes(input.criticalFieldProvenanceState)) {
    throw new Error("Critical-field provenance state is invalid.");
  }

  const fingerprint = generateInvoiceFingerprint({
    vendorId,
    workOrderId,
    invoiceNumber: invoiceNumberNormalized,
    amountBaseUnits: input.amountBaseUnits,
    currency,
    proposedRecipientAddress: input.proposedRecipientAddress,
  });

  return Object.freeze({
    id,
    vendorId,
    workOrderId,
    invoiceNumberRaw,
    invoiceNumberNormalized,
    amountBaseUnits: input.amountBaseUnits,
    currency: "USDC",
    proposedRecipientAddress: input.proposedRecipientAddress,
    rawFileHash,
    criticalFieldProvenanceState: input.criticalFieldProvenanceState,
    fingerprint,
  });
}
