import {
  requireCanonicalInstant,
  requireStableIdentifier,
} from "../shared/canonical-record.js";

export type WorkOrderStatus = "ACTIVE" | "DRAFT" | "EXPIRED" | "CLOSED";

export type CanonicalWorkOrder = Readonly<{
  id: string;
  vendorId: string;
  externalReference: string;
  maximumAmountBaseUnits: bigint;
  committedAmountBaseUnits: bigint;
  currency: "USDC";
  validFrom: string;
  validUntil: string;
  status: WorkOrderStatus;
}>;

const WORK_ORDER_STATUSES: readonly WorkOrderStatus[] = [
  "ACTIVE",
  "DRAFT",
  "EXPIRED",
  "CLOSED",
];

export function createCanonicalWorkOrder(input: {
  id: string;
  vendorId: string;
  externalReference: string;
  maximumAmountBaseUnits: bigint;
  committedAmountBaseUnits: bigint;
  currency: string;
  validFrom: string;
  validUntil: string;
  status: WorkOrderStatus;
}): CanonicalWorkOrder {
  const id = requireStableIdentifier(input.id, "Work-order ID");
  const vendorId = requireStableIdentifier(input.vendorId, "Work-order vendor ID");
  const externalReference = requireStableIdentifier(
    input.externalReference,
    "Work-order external reference",
  );
  const validFrom = requireCanonicalInstant(input.validFrom, "Work-order valid-from");
  const validUntil = requireCanonicalInstant(input.validUntil, "Work-order valid-until");

  if (input.maximumAmountBaseUnits <= 0n) {
    throw new Error("Work-order maximum amount must be positive base units.");
  }
  if (input.committedAmountBaseUnits < 0n) {
    throw new Error("Work-order committed amount cannot be negative.");
  }
  if (input.committedAmountBaseUnits > input.maximumAmountBaseUnits) {
    throw new Error("Work-order committed amount cannot exceed its maximum.");
  }
  if (input.currency.trim().toUpperCase() !== "USDC") {
    throw new Error("Canonical work orders support USDC only.");
  }
  if (validFrom >= validUntil) {
    throw new Error("Work-order validity must end after it begins.");
  }
  if (!WORK_ORDER_STATUSES.includes(input.status)) {
    throw new Error("Work-order status is invalid.");
  }

  return Object.freeze({
    id,
    vendorId,
    externalReference,
    maximumAmountBaseUnits: input.maximumAmountBaseUnits,
    committedAmountBaseUnits: input.committedAmountBaseUnits,
    currency: "USDC",
    validFrom,
    validUntil,
    status: input.status,
  });
}

export function remainingWorkOrderBalance(workOrder: CanonicalWorkOrder): bigint {
  return workOrder.maximumAmountBaseUnits - workOrder.committedAmountBaseUnits;
}

export function isWithinWorkOrderValidityWindow(
  workOrder: CanonicalWorkOrder,
  evaluatedAt: string,
): boolean {
  const canonicalEvaluationTime = requireCanonicalInstant(
    evaluatedAt,
    "Policy evaluation time",
  );
  return (
    canonicalEvaluationTime >= workOrder.validFrom &&
    canonicalEvaluationTime <= workOrder.validUntil
  );
}
