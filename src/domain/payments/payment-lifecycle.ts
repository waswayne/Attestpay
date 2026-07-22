import type { PaymentDecision } from "../policies/payment-policy.js";

export type PaymentLifecycleState =
  | "AUTO_APPROVED"
  | "AWAITING_HUMAN_APPROVAL"
  | "BLOCKED"
  | "HUMAN_APPROVED"
  | "AUTHORIZED"
  | "SUBMITTED"
  | "SETTLED"
  | "FAILED";

export type PaymentLifecycleEvent =
  | "HUMAN_APPROVE"
  | "HUMAN_REJECT"
  | "VERIFY_AUTHORIZATION"
  | "SUBMIT_PAYMENT"
  | "CONFIRM_SETTLEMENT"
  | "FAIL_PAYMENT";

const TRANSITIONS: Readonly<
  Record<PaymentLifecycleState, Partial<Record<PaymentLifecycleEvent, PaymentLifecycleState>>>
> = Object.freeze({
  AUTO_APPROVED: { VERIFY_AUTHORIZATION: "AUTHORIZED" },
  AWAITING_HUMAN_APPROVAL: {
    HUMAN_APPROVE: "HUMAN_APPROVED",
    HUMAN_REJECT: "BLOCKED",
  },
  BLOCKED: {},
  HUMAN_APPROVED: { VERIFY_AUTHORIZATION: "AUTHORIZED" },
  AUTHORIZED: { SUBMIT_PAYMENT: "SUBMITTED", FAIL_PAYMENT: "FAILED" },
  SUBMITTED: { CONFIRM_SETTLEMENT: "SETTLED", FAIL_PAYMENT: "FAILED" },
  SETTLED: {},
  FAILED: {},
});

export function initialPaymentLifecycleState(
  decision: PaymentDecision,
): PaymentLifecycleState {
  switch (decision) {
    case "AUTO_APPROVED":
      return "AUTO_APPROVED";
    case "NEEDS_REVIEW":
      return "AWAITING_HUMAN_APPROVAL";
    case "BLOCKED":
      return "BLOCKED";
  }
}

export function transitionPaymentLifecycle(
  current: PaymentLifecycleState,
  event: PaymentLifecycleEvent,
): PaymentLifecycleState {
  const next = TRANSITIONS[current][event];
  if (!next) {
    throw new Error(`Payment lifecycle cannot apply ${event} while ${current}.`);
  }
  return next;
}
