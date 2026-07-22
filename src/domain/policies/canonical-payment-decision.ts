import type { CanonicalInvoice } from "../invoices/invoice.js";
import {
  bigintToCanonicalDecimal,
  requireCanonicalInstant,
  sha256CanonicalRecord,
  type CanonicalField,
  type CanonicalValue,
  type Sha256Hash,
} from "../shared/canonical-record.js";
import type { TreasurySpendRecord } from "../treasury/treasury-spend.js";
import type { CanonicalVendor } from "../vendors/vendor.js";
import {
  isWithinWorkOrderValidityWindow,
  remainingWorkOrderBalance,
  type CanonicalWorkOrder,
} from "../work-orders/work-order.js";
import {
  assertPaymentPolicyConfiguration,
  DEFAULT_PAYMENT_POLICY,
  evaluatePaymentPolicy,
  type PaymentPolicy,
  type PaymentPolicyEvaluation,
  type PaymentPolicyInput,
  type PolicyRuleResult,
} from "./payment-policy.js";

export type DuplicateInvoiceEvidence = Readonly<{
  fileHashPreviouslySeen: boolean;
  fingerprintPreviouslySeen: boolean;
  invoiceNumberPreviouslySeenForVendor: boolean;
}>;

export type CanonicalPaymentEvaluationInput = Readonly<{
  vendor: CanonicalVendor;
  workOrder: CanonicalWorkOrder;
  invoice: CanonicalInvoice;
  treasurySpendRecords: readonly TreasurySpendRecord[];
  duplicateEvidence: DuplicateInvoiceEvidence;
  evaluatedAt: string;
}>;

export type DeterministicPaymentEvaluation = PaymentPolicyEvaluation &
  Readonly<{
    invoiceFingerprint: Sha256Hash;
    policyDefinitionHash: Sha256Hash;
    canonicalInputHash: Sha256Hash;
    decisionHash: Sha256Hash;
  }>;

function canonicalNestedRecord(
  schemaVersion: string,
  fields: readonly CanonicalField[],
): CanonicalValue {
  return [
    schemaVersion,
    fields.map(([name, value]) => [name, value]),
  ];
}

function sortedTreasurySpendRecords(
  records: readonly TreasurySpendRecord[],
): readonly TreasurySpendRecord[] {
  const sorted = [...records].sort((first, second) =>
    first.id < second.id ? -1 : first.id > second.id ? 1 : 0,
  );

  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index]?.id === sorted[index - 1]?.id) {
      throw new Error("Treasury-spend record IDs must be unique.");
    }
  }

  return Object.freeze(sorted);
}

function sumTreasurySpend(records: readonly TreasurySpendRecord[]): bigint {
  return records.reduce(
    (total, record) => total + record.amountBaseUnits,
    0n,
  );
}

export function buildPaymentPolicyInput(
  input: CanonicalPaymentEvaluationInput,
): PaymentPolicyInput {
  const evaluatedAt = requireCanonicalInstant(
    input.evaluatedAt,
    "Policy evaluation time",
  );
  const treasurySpendRecords = sortedTreasurySpendRecords(
    input.treasurySpendRecords,
  );

  return Object.freeze({
    vendor: Object.freeze({
      status: input.vendor.verificationStatus,
      active: input.vendor.active,
      verifiedWalletAddress: input.vendor.verifiedWalletAddress ?? "",
    }),
    workOrder: Object.freeze({
      status: input.workOrder.status,
      vendorMatches: input.workOrder.vendorId === input.vendor.id,
      validAtEvaluation: isWithinWorkOrderValidityWindow(
        input.workOrder,
        evaluatedAt,
      ),
      remainingAmountBaseUnits: remainingWorkOrderBalance(input.workOrder),
    }),
    invoice: Object.freeze({
      vendorMatches: input.invoice.vendorId === input.vendor.id,
      workOrderMatches: input.invoice.workOrderId === input.workOrder.id,
      amountBaseUnits: input.invoice.amountBaseUnits,
      currency: input.invoice.currency,
      proposedRecipientAddress: input.invoice.proposedRecipientAddress,
      fileHashPreviouslySeen:
        input.duplicateEvidence.fileHashPreviouslySeen,
      fingerprintPreviouslySeen:
        input.duplicateEvidence.fingerprintPreviouslySeen,
      invoiceNumberPreviouslySeenForVendor:
        input.duplicateEvidence.invoiceNumberPreviouslySeenForVendor,
      criticalFieldProvenanceComplete:
        input.invoice.criticalFieldProvenanceState === "COMPLETE",
    }),
    treasury: Object.freeze({
      spentTodayBaseUnits: sumTreasurySpend(treasurySpendRecords),
    }),
  });
}

export function generateCanonicalPolicyInputHash(
  input: CanonicalPaymentEvaluationInput,
): Sha256Hash {
  const evaluatedAt = requireCanonicalInstant(
    input.evaluatedAt,
    "Policy evaluation time",
  );
  const treasurySpendRecords = sortedTreasurySpendRecords(
    input.treasurySpendRecords,
  );

  return sha256CanonicalRecord("attestpay.policy-input.v1", [
    ["evaluatedAt", evaluatedAt],
    [
      "vendor",
      canonicalNestedRecord("attestpay.vendor.v1", [
        ["id", input.vendor.id],
        ["displayName", input.vendor.displayName],
        ["verifiedWalletAddress", input.vendor.verifiedWalletAddress],
        ["verificationStatus", input.vendor.verificationStatus],
        ["active", input.vendor.active],
        ["verificationMethod", input.vendor.verificationMethod],
        [
          "verificationEvidenceReference",
          input.vendor.verificationEvidenceReference,
        ],
      ]),
    ],
    [
      "workOrder",
      canonicalNestedRecord("attestpay.work-order.v1", [
        ["id", input.workOrder.id],
        ["vendorId", input.workOrder.vendorId],
        ["externalReference", input.workOrder.externalReference],
        [
          "maximumAmountBaseUnits",
          bigintToCanonicalDecimal(input.workOrder.maximumAmountBaseUnits),
        ],
        [
          "committedAmountBaseUnits",
          bigintToCanonicalDecimal(input.workOrder.committedAmountBaseUnits),
        ],
        ["currency", input.workOrder.currency],
        ["validFrom", input.workOrder.validFrom],
        ["validUntil", input.workOrder.validUntil],
        ["status", input.workOrder.status],
      ]),
    ],
    [
      "invoice",
      canonicalNestedRecord("attestpay.invoice.v1", [
        ["id", input.invoice.id],
        ["vendorId", input.invoice.vendorId],
        ["workOrderId", input.invoice.workOrderId],
        ["invoiceNumberNormalized", input.invoice.invoiceNumberNormalized],
        [
          "amountBaseUnits",
          bigintToCanonicalDecimal(input.invoice.amountBaseUnits),
        ],
        ["currency", input.invoice.currency],
        [
          "proposedRecipientAddress",
          input.invoice.proposedRecipientAddress,
        ],
        ["rawFileHash", input.invoice.rawFileHash],
        [
          "criticalFieldProvenanceState",
          input.invoice.criticalFieldProvenanceState,
        ],
        ["fingerprint", input.invoice.fingerprint],
      ]),
    ],
    [
      "duplicateEvidence",
      canonicalNestedRecord("attestpay.duplicate-evidence.v1", [
        [
          "fileHashPreviouslySeen",
          input.duplicateEvidence.fileHashPreviouslySeen,
        ],
        [
          "fingerprintPreviouslySeen",
          input.duplicateEvidence.fingerprintPreviouslySeen,
        ],
        [
          "invoiceNumberPreviouslySeenForVendor",
          input.duplicateEvidence.invoiceNumberPreviouslySeenForVendor,
        ],
      ]),
    ],
    [
      "treasurySpendRecords",
      treasurySpendRecords.map((record) =>
        canonicalNestedRecord("attestpay.treasury-spend.v1", [
          ["id", record.id],
          ["amountBaseUnits", bigintToCanonicalDecimal(record.amountBaseUnits)],
          ["currency", record.currency],
        ]),
      ),
    ],
  ]);
}

export function generatePolicyDefinitionHash(
  policy: PaymentPolicy,
): Sha256Hash {
  assertPaymentPolicyConfiguration(policy);

  return sha256CanonicalRecord("attestpay.policy-definition.v1", [
    ["version", policy.version],
    ["currency", policy.currency],
    [
      "autoPayLimitBaseUnits",
      bigintToCanonicalDecimal(policy.autoPayLimitBaseUnits),
    ],
    [
      "dailyTreasuryLimitBaseUnits",
      bigintToCanonicalDecimal(policy.dailyTreasuryLimitBaseUnits),
    ],
  ]);
}

export function generateDecisionHash(input: {
  policyVersion: string;
  policyDefinitionHash: Sha256Hash;
  canonicalInputHash: Sha256Hash;
  decision: PaymentPolicyEvaluation["decision"];
  ruleResults: readonly PolicyRuleResult[];
}): Sha256Hash {
  return sha256CanonicalRecord("attestpay.policy-decision.v1", [
    ["policyVersion", input.policyVersion],
    ["policyDefinitionHash", input.policyDefinitionHash],
    ["canonicalInputHash", input.canonicalInputHash],
    ["decision", input.decision],
    [
      "orderedRuleResults",
      input.ruleResults.map((ruleResult) =>
        canonicalNestedRecord("attestpay.policy-rule-result.v1", [
          ["ruleId", ruleResult.ruleId],
          ["outcome", ruleResult.outcome],
          ["reasonCode", ruleResult.reasonCode],
          ["evidenceReferences", ruleResult.evidenceReferences],
        ]),
      ),
    ],
  ]);
}

/**
 * Runs the complete offline decision path. The caller supplies the evaluation
 * instant and already-selected daily spend records; this function reads no clock
 * and performs no database, network, AI, Circle, or Arc calls.
 */
export function evaluateCanonicalPayment(
  input: CanonicalPaymentEvaluationInput,
  policy: PaymentPolicy = DEFAULT_PAYMENT_POLICY,
): DeterministicPaymentEvaluation {
  const policyInput = buildPaymentPolicyInput(input);
  const evaluation = evaluatePaymentPolicy(policyInput, policy);
  const policyDefinitionHash = generatePolicyDefinitionHash(policy);
  const canonicalInputHash = generateCanonicalPolicyInputHash(input);
  const decisionHash = generateDecisionHash({
    policyVersion: evaluation.policyVersion,
    policyDefinitionHash,
    canonicalInputHash,
    decision: evaluation.decision,
    ruleResults: evaluation.ruleResults,
  });

  return Object.freeze({
    ...evaluation,
    invoiceFingerprint: input.invoice.fingerprint,
    policyDefinitionHash,
    canonicalInputHash,
    decisionHash,
  });
}
