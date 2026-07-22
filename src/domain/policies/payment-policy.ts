import type { VendorVerificationStatus } from "../vendors/vendor.js";
import type { WorkOrderStatus } from "../work-orders/work-order.js";

export type RuleOutcome = "PASS" | "REVIEW" | "BLOCK" | "NOT_APPLICABLE";

export type PaymentDecision = "AUTO_APPROVED" | "NEEDS_REVIEW" | "BLOCKED";

export type PaymentPolicy = Readonly<{
  version: string;
  currency: "USDC";
  autoPayLimitBaseUnits: bigint;
  dailyTreasuryLimitBaseUnits: bigint;
}>;

export type PaymentPolicyInput = Readonly<{
  vendor: Readonly<{
    status: VendorVerificationStatus;
    active: boolean;
    verifiedWalletAddress: string;
  }>;
  workOrder: Readonly<{
    status: WorkOrderStatus;
    vendorMatches: boolean;
    validAtEvaluation: boolean;
    remainingAmountBaseUnits: bigint;
  }>;
  invoice: Readonly<{
    vendorMatches: boolean;
    workOrderMatches: boolean;
    amountBaseUnits: bigint;
    currency: string;
    proposedRecipientAddress: string;
    fileHashPreviouslySeen: boolean;
    fingerprintPreviouslySeen: boolean;
    invoiceNumberPreviouslySeenForVendor: boolean;
    criticalFieldProvenanceComplete: boolean;
  }>;
  treasury: Readonly<{
    spentTodayBaseUnits: bigint;
  }>;
}>;

export type PolicyRuleResult = Readonly<{
  ruleId: string;
  outcome: RuleOutcome;
  reasonCode: string;
  evidenceReferences: readonly string[];
}>;

export type PaymentPolicyEvaluation = Readonly<{
  policyVersion: string;
  decision: PaymentDecision;
  ruleResults: readonly PolicyRuleResult[];
}>;

const USDC_BASE_UNITS = 1_000_000n;

export const DEFAULT_PAYMENT_POLICY: PaymentPolicy = Object.freeze({
  version: "attestpay-demo-policy-v1",
  currency: "USDC",
  autoPayLimitBaseUnits: 500n * USDC_BASE_UNITS,
  dailyTreasuryLimitBaseUnits: 1_000n * USDC_BASE_UNITS,
});

function ruleResult(
  ruleId: string,
  outcome: RuleOutcome,
  reasonCode: string,
  ...evidenceReferences: string[]
): PolicyRuleResult {
  return Object.freeze({
    ruleId,
    outcome,
    reasonCode,
    evidenceReferences: Object.freeze(evidenceReferences),
  });
}

export function assertPaymentPolicyConfiguration(
  policy: PaymentPolicy,
): void {
  if (!policy.version.trim()) {
    throw new Error("Payment policy version must be a stable non-empty identifier.");
  }
  if (policy.currency !== "USDC") {
    throw new Error("The AttestPay demo policy supports USDC only.");
  }
  if (
    policy.autoPayLimitBaseUnits <= 0n ||
    policy.dailyTreasuryLimitBaseUnits <= 0n
  ) {
    throw new Error("Payment policy limits must be positive integer base units.");
  }
  if (policy.autoPayLimitBaseUnits > policy.dailyTreasuryLimitBaseUnits) {
    throw new Error("The automatic-payment limit cannot exceed the daily limit.");
  }
}

function assertCanonicalState(input: PaymentPolicyInput): void {
  if (input.workOrder.remainingAmountBaseUnits < 0n) {
    throw new Error("Work-order remaining amount cannot be negative.");
  }
  if (input.treasury.spentTodayBaseUnits < 0n) {
    throw new Error("Treasury spend-to-date cannot be negative.");
  }
}

/**
 * Evaluates canonical payment facts in a fixed rule order.
 *
 * The function is intentionally pure: it performs no I/O, reads no clock, and
 * never calls an AI provider, wallet, blockchain, or database.
 */
export function evaluatePaymentPolicy(
  input: PaymentPolicyInput,
  policy: PaymentPolicy = DEFAULT_PAYMENT_POLICY,
): PaymentPolicyEvaluation {
  assertPaymentPolicyConfiguration(policy);
  assertCanonicalState(input);

  const amountIsPositive = input.invoice.amountBaseUnits > 0n;
  const recipientMatches =
    input.vendor.verifiedWalletAddress.length > 0 &&
    input.invoice.proposedRecipientAddress.length > 0 &&
    input.vendor.verifiedWalletAddress.toLowerCase() ===
      input.invoice.proposedRecipientAddress.toLowerCase();
  const projectedDailySpend =
    input.treasury.spentTodayBaseUnits + input.invoice.amountBaseUnits;

  const ruleResults: readonly PolicyRuleResult[] = Object.freeze([
    ruleResult(
      "invoice.amount.positive",
      amountIsPositive ? "PASS" : "BLOCK",
      amountIsPositive ? "INVOICE_AMOUNT_VALID" : "INVOICE_AMOUNT_INVALID",
      "invoice.amountBaseUnits",
    ),
    ruleResult(
      "vendor.status.verified",
      input.vendor.status === "VERIFIED" ? "PASS" : "BLOCK",
      input.vendor.status === "VERIFIED"
        ? "VENDOR_VERIFIED"
        : "VENDOR_NOT_VERIFIED",
      "vendor.status",
    ),
    ruleResult(
      "vendor.state.active",
      input.vendor.active ? "PASS" : "BLOCK",
      input.vendor.active ? "VENDOR_ACTIVE" : "VENDOR_INACTIVE",
      "vendor.active",
    ),
    ruleResult(
      "vendor.wallet.exact-match",
      recipientMatches ? "PASS" : "BLOCK",
      recipientMatches ? "RECIPIENT_MATCHED" : "RECIPIENT_MISMATCH",
      "vendor.verifiedWalletAddress",
      "invoice.proposedRecipientAddress",
    ),
    ruleResult(
      "invoice.vendor.reference-match",
      input.invoice.vendorMatches ? "PASS" : "BLOCK",
      input.invoice.vendorMatches
        ? "INVOICE_VENDOR_MATCHED"
        : "INVOICE_VENDOR_MISMATCH",
      "invoice.vendorMatches",
    ),
    ruleResult(
      "invoice.work-order.reference-match",
      input.invoice.workOrderMatches ? "PASS" : "BLOCK",
      input.invoice.workOrderMatches
        ? "INVOICE_WORK_ORDER_MATCHED"
        : "INVOICE_WORK_ORDER_MISMATCH",
      "invoice.workOrderMatches",
    ),
    ruleResult(
      "invoice.file-hash.unique",
      input.invoice.fileHashPreviouslySeen ? "BLOCK" : "PASS",
      input.invoice.fileHashPreviouslySeen
        ? "DUPLICATE_FILE_HASH"
        : "FILE_HASH_UNIQUE",
      "invoice.fileHashPreviouslySeen",
    ),
    ruleResult(
      "invoice.fingerprint.unique",
      input.invoice.fingerprintPreviouslySeen ? "BLOCK" : "PASS",
      input.invoice.fingerprintPreviouslySeen
        ? "DUPLICATE_INVOICE_FINGERPRINT"
        : "INVOICE_FINGERPRINT_UNIQUE",
      "invoice.fingerprintPreviouslySeen",
    ),
    ruleResult(
      "invoice.number.unique-per-vendor",
      input.invoice.invoiceNumberPreviouslySeenForVendor ? "BLOCK" : "PASS",
      input.invoice.invoiceNumberPreviouslySeenForVendor
        ? "DUPLICATE_INVOICE_NUMBER"
        : "INVOICE_NUMBER_UNIQUE",
      "invoice.invoiceNumberPreviouslySeenForVendor",
    ),
    ruleResult(
      "work-order.status.active",
      input.workOrder.status === "ACTIVE" ? "PASS" : "BLOCK",
      input.workOrder.status === "ACTIVE"
        ? "WORK_ORDER_ACTIVE"
        : "WORK_ORDER_NOT_ACTIVE",
      "workOrder.status",
    ),
    ruleResult(
      "work-order.vendor.match",
      input.workOrder.vendorMatches ? "PASS" : "BLOCK",
      input.workOrder.vendorMatches
        ? "WORK_ORDER_VENDOR_MATCHED"
        : "WORK_ORDER_VENDOR_MISMATCH",
      "workOrder.vendorMatches",
    ),
    ruleResult(
      "work-order.validity-window.current",
      input.workOrder.validAtEvaluation ? "PASS" : "BLOCK",
      input.workOrder.validAtEvaluation
        ? "WORK_ORDER_WITHIN_VALIDITY_WINDOW"
        : "WORK_ORDER_OUTSIDE_VALIDITY_WINDOW",
      "workOrder.validAtEvaluation",
    ),
    ruleResult(
      "work-order.balance.sufficient",
      amountIsPositive &&
        input.workOrder.remainingAmountBaseUnits >= input.invoice.amountBaseUnits
        ? "PASS"
        : "BLOCK",
      amountIsPositive &&
        input.workOrder.remainingAmountBaseUnits >= input.invoice.amountBaseUnits
        ? "WORK_ORDER_BALANCE_SUFFICIENT"
        : "WORK_ORDER_BALANCE_EXCEEDED",
      "workOrder.remainingAmountBaseUnits",
      "invoice.amountBaseUnits",
    ),
    ruleResult(
      "invoice.currency.supported",
      input.invoice.currency.toUpperCase() === policy.currency ? "PASS" : "BLOCK",
      input.invoice.currency.toUpperCase() === policy.currency
        ? "CURRENCY_SUPPORTED"
        : "CURRENCY_UNSUPPORTED",
      "invoice.currency",
      "policy.currency",
    ),
    ruleResult(
      "invoice.provenance.critical-fields",
      input.invoice.criticalFieldProvenanceComplete ? "PASS" : "REVIEW",
      input.invoice.criticalFieldProvenanceComplete
        ? "CRITICAL_FIELD_PROVENANCE_PRESENT"
        : "CRITICAL_FIELD_PROVENANCE_MISSING",
      "invoice.criticalFieldProvenanceComplete",
    ),
    ruleResult(
      "payment.amount.auto-limit",
      amountIsPositive &&
        input.invoice.amountBaseUnits <= policy.autoPayLimitBaseUnits
        ? "PASS"
        : "REVIEW",
      amountIsPositive &&
        input.invoice.amountBaseUnits <= policy.autoPayLimitBaseUnits
        ? "AUTO_PAY_LIMIT_PASSED"
        : "AUTO_PAY_LIMIT_EXCEEDED",
      "invoice.amountBaseUnits",
      "policy.autoPayLimitBaseUnits",
    ),
    ruleResult(
      "treasury.spend.daily-limit",
      amountIsPositive && projectedDailySpend <= policy.dailyTreasuryLimitBaseUnits
        ? "PASS"
        : "REVIEW",
      amountIsPositive && projectedDailySpend <= policy.dailyTreasuryLimitBaseUnits
        ? "DAILY_TREASURY_LIMIT_PASSED"
        : "DAILY_TREASURY_LIMIT_EXCEEDED",
      "treasury.spentTodayBaseUnits",
      "invoice.amountBaseUnits",
      "policy.dailyTreasuryLimitBaseUnits",
    ),
  ]);

  const decision: PaymentDecision = ruleResults.some(
    (result) => result.outcome === "BLOCK",
  )
    ? "BLOCKED"
    : ruleResults.some((result) => result.outcome === "REVIEW")
      ? "NEEDS_REVIEW"
      : "AUTO_APPROVED";

  return Object.freeze({
    policyVersion: policy.version,
    decision,
    ruleResults,
  });
}
