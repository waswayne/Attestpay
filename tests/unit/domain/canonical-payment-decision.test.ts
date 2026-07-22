import assert from "node:assert/strict";
import test from "node:test";
import { createCanonicalInvoice } from "../../../src/domain/invoices/invoice.js";
import {
  evaluateCanonicalPayment,
  generateDecisionHash,
  generatePolicyDefinitionHash,
  type CanonicalPaymentEvaluationInput,
} from "../../../src/domain/policies/canonical-payment-decision.js";
import { DEFAULT_PAYMENT_POLICY } from "../../../src/domain/policies/payment-policy.js";
import { createTreasurySpendRecord } from "../../../src/domain/treasury/treasury-spend.js";
import { createCanonicalVendor } from "../../../src/domain/vendors/vendor.js";
import { createCanonicalWorkOrder } from "../../../src/domain/work-orders/work-order.js";
import type { CanonicalEvmAddress } from "../../../src/domain/shared/canonical-evm-address.js";
import { parseCanonicalEvmAddress } from "../../../src/shared/validation/evm.js";

const USDC = 1_000_000n;
const VERIFIED_WALLET = parseCanonicalEvmAddress(
  "0x2222222222222222222222222222222222222222",
);
const OTHER_WALLET = parseCanonicalEvmAddress(
  "0x3333333333333333333333333333333333333333",
);
const RAW_FILE_HASH = `sha256:${"b".repeat(64)}`;

function canonicalInput(overrides: {
  invoiceAmount?: bigint;
  invoiceRecipient?: CanonicalEvmAddress;
  workOrderMaximum?: bigint;
  workOrderCommitted?: bigint;
  duplicate?: boolean;
  treasuryAmounts?: readonly bigint[];
} = {}): CanonicalPaymentEvaluationInput {
  const vendor = createCanonicalVendor({
    id: "vendor-001",
    displayName: "Synthetic Design Vendor",
    verifiedWalletAddress: VERIFIED_WALLET,
    verificationStatus: "VERIFIED",
    active: true,
    verificationMethod: "ADMIN_CONFIRMATION",
    verificationEvidenceReference: "verification-001",
  });
  const workOrder = createCanonicalWorkOrder({
    id: "work-order-001",
    vendorId: vendor.id,
    externalReference: "PO-001",
    maximumAmountBaseUnits: overrides.workOrderMaximum ?? 2_000n * USDC,
    committedAmountBaseUnits: overrides.workOrderCommitted ?? 0n,
    currency: "USDC",
    validFrom: "2026-07-01T00:00:00Z",
    validUntil: "2026-08-01T00:00:00Z",
    status: "ACTIVE",
  });
  const invoice = createCanonicalInvoice({
    id: "invoice-001",
    vendorId: vendor.id,
    workOrderId: workOrder.id,
    invoiceNumber: "INV / 001",
    amountBaseUnits: overrides.invoiceAmount ?? 500n * USDC,
    currency: "USDC",
    proposedRecipientAddress:
      overrides.invoiceRecipient ?? VERIFIED_WALLET,
    rawFileHash: RAW_FILE_HASH,
    criticalFieldProvenanceState: "COMPLETE",
  });
  const treasurySpendRecords = (overrides.treasuryAmounts ?? [500n * USDC]).map(
    (amount, index) =>
      createTreasurySpendRecord({
        id: `treasury-spend-${index + 1}`,
        amountBaseUnits: amount,
        currency: "USDC",
      }),
  );

  return {
    vendor,
    workOrder,
    invoice,
    treasurySpendRecords,
    duplicateEvidence: {
      fileHashPreviouslySeen: overrides.duplicate ?? false,
      fingerprintPreviouslySeen: overrides.duplicate ?? false,
      invoiceNumberPreviouslySeenForVendor: overrides.duplicate ?? false,
    },
    evaluatedAt: "2026-07-21T12:00:00Z",
  };
}

function reasonCodes(input: CanonicalPaymentEvaluationInput): string[] {
  return evaluateCanonicalPayment(input).ruleResults.map(
    (result) => result.reasonCode,
  );
}

test("produces identical hashes and decisions for identical canonical inputs", () => {
  const input = canonicalInput({ treasuryAmounts: [200n * USDC, 300n * USDC] });
  const first = evaluateCanonicalPayment(input);
  const equivalentlyNormalizedInvoice = createCanonicalInvoice({
    id: input.invoice.id,
    vendorId: input.invoice.vendorId,
    workOrderId: input.invoice.workOrderId,
    invoiceNumber: "INV-001",
    amountBaseUnits: input.invoice.amountBaseUnits,
    currency: input.invoice.currency,
    proposedRecipientAddress: input.invoice.proposedRecipientAddress,
    rawFileHash: input.invoice.rawFileHash,
    criticalFieldProvenanceState:
      input.invoice.criticalFieldProvenanceState,
  });
  const second = evaluateCanonicalPayment({
    ...input,
    invoice: equivalentlyNormalizedInvoice,
    treasurySpendRecords: [...input.treasurySpendRecords].reverse(),
  });

  assert.equal(first.decision, "AUTO_APPROVED");
  assert.deepEqual(first, second);
  assert.match(first.policyDefinitionHash, /^sha256:[a-f0-9]{64}$/);
  assert.match(first.canonicalInputHash, /^sha256:[a-f0-9]{64}$/);
  assert.match(first.decisionHash, /^sha256:[a-f0-9]{64}$/);
});

test("binds exact policy limits into the policy and decision hashes", () => {
  const input = canonicalInput({
    invoiceAmount: 400n * USDC,
    treasuryAmounts: [],
  });
  const firstPolicy = {
    ...DEFAULT_PAYMENT_POLICY,
    version: "same-version",
    autoPayLimitBaseUnits: 500n * USDC,
    dailyTreasuryLimitBaseUnits: 1_000n * USDC,
  } as const;
  const changedLimits = {
    ...firstPolicy,
    autoPayLimitBaseUnits: 600n * USDC,
    dailyTreasuryLimitBaseUnits: 1_200n * USDC,
  } as const;

  const first = evaluateCanonicalPayment(input, firstPolicy);
  const changed = evaluateCanonicalPayment(input, changedLimits);

  assert.equal(first.decision, "AUTO_APPROVED");
  assert.equal(changed.decision, first.decision);
  assert.equal(changed.canonicalInputHash, first.canonicalInputHash);
  assert.notEqual(changed.policyDefinitionHash, first.policyDefinitionHash);
  assert.notEqual(changed.decisionHash, first.decisionHash);
  assert.equal(
    generatePolicyDefinitionHash(firstPolicy),
    first.policyDefinitionHash,
  );
});

test("changes canonical input and decision hashes for a material invoice change", () => {
  const original = evaluateCanonicalPayment(
    canonicalInput({ invoiceAmount: 400n * USDC, treasuryAmounts: [] }),
  );
  const changed = evaluateCanonicalPayment(
    canonicalInput({ invoiceAmount: 400n * USDC + 1n, treasuryAmounts: [] }),
  );

  assert.equal(original.decision, changed.decision);
  assert.notEqual(original.invoiceFingerprint, changed.invoiceFingerprint);
  assert.notEqual(original.canonicalInputHash, changed.canonicalInputHash);
  assert.notEqual(original.decisionHash, changed.decisionHash);
});

test("binds the decision hash to stable ordered rule results", () => {
  const result = evaluateCanonicalPayment(canonicalInput());
  const sameOrder = generateDecisionHash(result);
  const changedOrder = generateDecisionHash({
    ...result,
    ruleResults: [...result.ruleResults].reverse(),
  });

  assert.equal(sameOrder, result.decisionHash);
  assert.notEqual(changedOrder, result.decisionHash);
});

test("blocks duplicate invoice evidence from canonical records", () => {
  const input = canonicalInput({ duplicate: true });
  const result = evaluateCanonicalPayment(input);

  assert.equal(result.decision, "BLOCKED");
  assert.ok(reasonCodes(input).includes("DUPLICATE_FILE_HASH"));
  assert.ok(reasonCodes(input).includes("DUPLICATE_INVOICE_FINGERPRINT"));
  assert.ok(reasonCodes(input).includes("DUPLICATE_INVOICE_NUMBER"));
});

test("blocks a proposed recipient changed from the verified vendor wallet", () => {
  const input = canonicalInput({ invoiceRecipient: OTHER_WALLET });
  const result = evaluateCanonicalPayment(input);

  assert.equal(result.decision, "BLOCKED");
  assert.ok(reasonCodes(input).includes("RECIPIENT_MISMATCH"));
});

test("blocks an active work order outside its canonical validity window", () => {
  const input: CanonicalPaymentEvaluationInput = {
    ...canonicalInput(),
    evaluatedAt: "2026-08-01T00:00:00.001Z",
  };
  const result = evaluateCanonicalPayment(input);

  assert.equal(result.decision, "BLOCKED");
  assert.ok(reasonCodes(input).includes("WORK_ORDER_OUTSIDE_VALIDITY_WINDOW"));
});

test("blocks a work order owned by a different vendor", () => {
  const input = canonicalInput();
  const mismatchedWorkOrder = createCanonicalWorkOrder({
    ...input.workOrder,
    vendorId: "vendor-002",
  });
  const mismatchedInput: CanonicalPaymentEvaluationInput = {
    ...input,
    workOrder: mismatchedWorkOrder,
  };
  const result = evaluateCanonicalPayment(mismatchedInput);

  assert.equal(result.decision, "BLOCKED");
  assert.ok(reasonCodes(mismatchedInput).includes("WORK_ORDER_VENDOR_MISMATCH"));
});

test("routes an excessive but otherwise valid amount to review", () => {
  const input = canonicalInput({
    invoiceAmount: 500n * USDC + 1n,
    treasuryAmounts: [],
  });
  const result = evaluateCanonicalPayment(input);

  assert.equal(result.decision, "NEEDS_REVIEW");
  assert.ok(reasonCodes(input).includes("AUTO_PAY_LIMIT_EXCEEDED"));
});

test("auto-approves a routine canonical payment at the configured boundaries", () => {
  const result = evaluateCanonicalPayment(canonicalInput());

  assert.equal(result.decision, "AUTO_APPROVED");
  assert.equal(result.ruleResults.every((rule) => rule.outcome === "PASS"), true);
});

test("keeps BLOCK precedence when a simultaneous amount rule requires review", () => {
  const input = canonicalInput({
    invoiceAmount: 600n * USDC,
    workOrderMaximum: 100n * USDC,
    treasuryAmounts: [],
  });
  const result = evaluateCanonicalPayment(input);

  assert.equal(result.decision, "BLOCKED");
  assert.ok(reasonCodes(input).includes("WORK_ORDER_BALANCE_EXCEEDED"));
  assert.ok(reasonCodes(input).includes("AUTO_PAY_LIMIT_EXCEEDED"));
});
