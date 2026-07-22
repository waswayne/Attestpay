import assert from "node:assert/strict";
import test from "node:test";
import {
  createCanonicalInvoice,
  generateRawInvoiceFileHash,
  normalizeInvoiceNumber,
} from "../../../src/domain/invoices/invoice.js";
import {
  createCanonicalVendor,
} from "../../../src/domain/vendors/vendor.js";
import type { CanonicalEvmAddress } from "../../../src/domain/shared/canonical-evm-address.js";
import {
  canonicalEvmAddressesEqual,
  parseCanonicalEvmAddress,
} from "../../../src/shared/validation/evm.js";
import {
  createCanonicalWorkOrder,
  remainingWorkOrderBalance,
} from "../../../src/domain/work-orders/work-order.js";

const WALLET = parseCanonicalEvmAddress(
  "0x2222222222222222222222222222222222222222",
);
const OTHER_WALLET = parseCanonicalEvmAddress(
  "0x3333333333333333333333333333333333333333",
);
const RAW_FILE_HASH = `sha256:${"a".repeat(64)}`;

function createWorkOrder(overrides: Partial<{
  maximumAmountBaseUnits: bigint;
  committedAmountBaseUnits: bigint;
}> = {}) {
  return createCanonicalWorkOrder({
    id: "work-order-001",
    vendorId: "vendor-001",
    externalReference: "PO-001",
    maximumAmountBaseUnits: 2_000_000_000n,
    committedAmountBaseUnits: 500_000_000n,
    currency: "usdc",
    validFrom: "2026-07-01T00:00:00Z",
    validUntil: "2026-08-01T00:00:00Z",
    status: "ACTIVE",
    ...overrides,
  });
}

function createInvoice(overrides: Partial<{
  invoiceNumber: string;
  amountBaseUnits: bigint;
  proposedRecipientAddress: CanonicalEvmAddress;
}> = {}) {
  return createCanonicalInvoice({
    id: "invoice-001",
    vendorId: "vendor-001",
    workOrderId: "work-order-001",
    invoiceNumber: "INV-001",
    amountBaseUnits: 500_000_000n,
    currency: "USDC",
    proposedRecipientAddress: WALLET,
    rawFileHash: RAW_FILE_HASH,
    criticalFieldProvenanceState: "COMPLETE",
    ...overrides,
  });
}

test("normalizes equivalent invoice-number punctuation and casing", () => {
  assert.equal(normalizeInvoiceNumber("  inv / 001  "), "INV-001");
  assert.equal(normalizeInvoiceNumber("INV___001"), "INV-001");
  assert.equal(
    normalizeInvoiceNumber("\uFF49\uFF4E\uFF56\uFF0D001"),
    "INV-001",
  );
  assert.throws(() => normalizeInvoiceNumber("---"), /must normalize/);
});

test("hashes raw invoice bytes with deterministic SHA-256", () => {
  const bytes = new TextEncoder().encode("synthetic invoice fixture");

  assert.equal(generateRawInvoiceFileHash(bytes), generateRawInvoiceFileHash(bytes));
  assert.notEqual(
    generateRawInvoiceFileHash(bytes),
    generateRawInvoiceFileHash(new TextEncoder().encode("changed fixture")),
  );
  assert.throws(() => generateRawInvoiceFileHash(new Uint8Array()), /cannot be empty/);
});

test("normalizes and compares EVM wallets without trusting input casing", () => {
  const mixedCase = "0x52908400098527886E0F7030069857D2E4169EE7";
  const lowerCase = mixedCase.toLowerCase();

  assert.equal(parseCanonicalEvmAddress(lowerCase), mixedCase);
  assert.equal(canonicalEvmAddressesEqual(mixedCase, lowerCase), true);
  assert.equal(canonicalEvmAddressesEqual(WALLET, OTHER_WALLET), false);
  assert.throws(() => parseCanonicalEvmAddress("not-a-wallet"), /valid EVM/);
  assert.throws(
    () => parseCanonicalEvmAddress("0x0000000000000000000000000000000000000000"),
    /zero address/,
  );
});

test("calculates deterministic work-order remaining-balance boundaries", () => {
  assert.equal(remainingWorkOrderBalance(createWorkOrder()), 1_500_000_000n);
  assert.equal(
    remainingWorkOrderBalance(
      createWorkOrder({ committedAmountBaseUnits: 2_000_000_000n }),
    ),
    0n,
  );
  assert.equal(
    remainingWorkOrderBalance(
      createWorkOrder({ committedAmountBaseUnits: 0n }),
    ),
    2_000_000_000n,
  );
});

test("rejects negative, inconsistent, and overcommitted work orders", () => {
  assert.throws(
    () => createWorkOrder({ committedAmountBaseUnits: -1n }),
    /cannot be negative/,
  );
  assert.throws(
    () => createWorkOrder({ maximumAmountBaseUnits: 0n }),
    /must be positive/,
  );
  assert.throws(
    () =>
      createWorkOrder({
        maximumAmountBaseUnits: 10n,
        committedAmountBaseUnits: 11n,
      }),
    /cannot exceed/,
  );
});

test("rejects vendor states that could treat unverified wallet data as trusted", () => {
  assert.throws(
    () =>
      createCanonicalVendor({
        id: "vendor-001",
        displayName: "Synthetic Vendor",
        verifiedWalletAddress: WALLET,
        verificationStatus: "PENDING",
        active: false,
        verificationMethod: null,
        verificationEvidenceReference: null,
      }),
    /pending vendor cannot own trusted verification evidence/,
  );
  assert.throws(
    () =>
      createCanonicalVendor({
        id: "vendor-001",
        displayName: "Synthetic Vendor",
        verifiedWalletAddress: null,
        verificationStatus: "VERIFIED",
        active: true,
        verificationMethod: null,
        verificationEvidenceReference: null,
      }),
    /require wallet verification evidence/,
  );
});

test("gives equivalent normalized invoices the same fingerprint", () => {
  const first = createInvoice({ invoiceNumber: "inv / 001" });
  const second = createInvoice({ invoiceNumber: "INV-001" });

  assert.equal(first.invoiceNumberNormalized, second.invoiceNumberNormalized);
  assert.equal(first.fingerprint, second.fingerprint);
});

test("changes an invoice fingerprint when a payment material field changes", () => {
  const original = createInvoice();
  const amountChanged = createInvoice({ amountBaseUnits: 500_000_001n });
  const recipientChanged = createInvoice({
    proposedRecipientAddress: OTHER_WALLET,
  });

  assert.notEqual(amountChanged.fingerprint, original.fingerprint);
  assert.notEqual(recipientChanged.fingerprint, original.fingerprint);
});
