import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_PAYMENT_POLICY,
  evaluatePaymentPolicy,
  type PaymentPolicyInput,
} from "../../../src/domain/policies/payment-policy.js";

const USDC = 1_000_000n;
const verifiedWallet = "0x2222222222222222222222222222222222222222";

const routineInvoice: PaymentPolicyInput = {
  vendor: {
    status: "VERIFIED",
    active: true,
    verifiedWalletAddress: verifiedWallet,
  },
  workOrder: {
    status: "ACTIVE",
    vendorMatches: true,
    validAtEvaluation: true,
    remainingAmountBaseUnits: 2_000n * USDC,
  },
  invoice: {
    vendorMatches: true,
    workOrderMatches: true,
    amountBaseUnits: 500n * USDC,
    currency: "USDC",
    proposedRecipientAddress: verifiedWallet,
    fileHashPreviouslySeen: false,
    fingerprintPreviouslySeen: false,
    invoiceNumberPreviouslySeenForVendor: false,
    criticalFieldProvenanceComplete: true,
  },
  treasury: {
    spentTodayBaseUnits: 500n * USDC,
  },
};

function reasonCodes(input: PaymentPolicyInput): string[] {
  return evaluatePaymentPolicy(input).ruleResults.map(
    (result) => result.reasonCode,
  );
}

test("auto-approves a routine invoice exactly at both policy boundaries", () => {
  const result = evaluatePaymentPolicy(routineInvoice);

  assert.equal(result.decision, "AUTO_APPROVED");
  assert.equal(result.policyVersion, DEFAULT_PAYMENT_POLICY.version);
  assert.equal(result.ruleResults.every((rule) => rule.outcome === "PASS"), true);
});

test("blocks a duplicate invoice before any payment can be authorized", () => {
  const input: PaymentPolicyInput = {
    ...routineInvoice,
    invoice: {
      ...routineInvoice.invoice,
      fileHashPreviouslySeen: true,
      fingerprintPreviouslySeen: true,
    },
  };

  const result = evaluatePaymentPolicy(input);

  assert.equal(result.decision, "BLOCKED");
  assert.ok(reasonCodes(input).includes("DUPLICATE_FILE_HASH"));
  assert.ok(reasonCodes(input).includes("DUPLICATE_INVOICE_FINGERPRINT"));
});

test("blocks recipient substitution even when every other rule passes", () => {
  const input: PaymentPolicyInput = {
    ...routineInvoice,
    invoice: {
      ...routineInvoice.invoice,
      proposedRecipientAddress: "0x3333333333333333333333333333333333333333",
    },
  };

  const result = evaluatePaymentPolicy(input);

  assert.equal(result.decision, "BLOCKED");
  assert.ok(reasonCodes(input).includes("RECIPIENT_MISMATCH"));
});

test("requires review one base unit above the automatic-payment limit", () => {
  const input: PaymentPolicyInput = {
    ...routineInvoice,
    invoice: {
      ...routineInvoice.invoice,
      amountBaseUnits: DEFAULT_PAYMENT_POLICY.autoPayLimitBaseUnits + 1n,
    },
    treasury: {
      spentTodayBaseUnits: 0n,
    },
  };

  const result = evaluatePaymentPolicy(input);

  assert.equal(result.decision, "NEEDS_REVIEW");
  assert.ok(reasonCodes(input).includes("AUTO_PAY_LIMIT_EXCEEDED"));
});

test("requires review when provenance or projected daily spend exceeds policy", () => {
  const input: PaymentPolicyInput = {
    ...routineInvoice,
    invoice: {
      ...routineInvoice.invoice,
      amountBaseUnits: 1n * USDC,
      criticalFieldProvenanceComplete: false,
    },
    treasury: {
      spentTodayBaseUnits: DEFAULT_PAYMENT_POLICY.dailyTreasuryLimitBaseUnits,
    },
  };

  const result = evaluatePaymentPolicy(input);

  assert.equal(result.decision, "NEEDS_REVIEW");
  assert.ok(reasonCodes(input).includes("CRITICAL_FIELD_PROVENANCE_MISSING"));
  assert.ok(reasonCodes(input).includes("DAILY_TREASURY_LIMIT_EXCEEDED"));
});

test("applies block precedence over simultaneous review results", () => {
  const input: PaymentPolicyInput = {
    ...routineInvoice,
    workOrder: {
      ...routineInvoice.workOrder,
      remainingAmountBaseUnits: 100n * USDC,
    },
    invoice: {
      ...routineInvoice.invoice,
      amountBaseUnits: 600n * USDC,
    },
  };

  const result = evaluatePaymentPolicy(input);

  assert.equal(result.decision, "BLOCKED");
  assert.ok(reasonCodes(input).includes("WORK_ORDER_BALANCE_EXCEEDED"));
  assert.ok(reasonCodes(input).includes("AUTO_PAY_LIMIT_EXCEEDED"));
});

test("returns identical ordered rule evidence for identical inputs", () => {
  const first = evaluatePaymentPolicy(routineInvoice);
  const second = evaluatePaymentPolicy(routineInvoice);

  assert.deepEqual(first, second);
  assert.deepEqual(
    first.ruleResults.map((rule) => rule.ruleId),
    [
      "invoice.amount.positive",
      "vendor.status.verified",
      "vendor.state.active",
      "vendor.wallet.exact-match",
      "invoice.vendor.reference-match",
      "invoice.work-order.reference-match",
      "invoice.file-hash.unique",
      "invoice.fingerprint.unique",
      "invoice.number.unique-per-vendor",
      "work-order.status.active",
      "work-order.vendor.match",
      "work-order.validity-window.current",
      "work-order.balance.sufficient",
      "invoice.currency.supported",
      "invoice.provenance.critical-fields",
      "payment.amount.auto-limit",
      "treasury.spend.daily-limit",
    ],
  );
});

test("rejects contradictory policy configuration", () => {
  assert.throws(
    () =>
      evaluatePaymentPolicy(routineInvoice, {
        ...DEFAULT_PAYMENT_POLICY,
        autoPayLimitBaseUnits: 2_000n * USDC,
        dailyTreasuryLimitBaseUnits: 1_000n * USDC,
      }),
    /cannot exceed the daily limit/,
  );
});
