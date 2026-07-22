import assert from "node:assert/strict";
import test from "node:test";
import {
  initialPaymentLifecycleState,
  transitionPaymentLifecycle,
} from "../../../src/domain/payments/payment-lifecycle.js";
import { transitionInvoiceLifecycle } from "../../../src/domain/invoices/invoice-lifecycle.js";

test("enforces invoice intake, validation, evaluation, and archival order", () => {
  assert.equal(transitionInvoiceLifecycle("RECEIVED", "VALIDATE"), "VALIDATED");
  assert.equal(transitionInvoiceLifecycle("VALIDATED", "EVALUATE"), "EVALUATED");
  assert.equal(transitionInvoiceLifecycle("EVALUATED", "ARCHIVE"), "ARCHIVED");
  assert.throws(() => transitionInvoiceLifecycle("RECEIVED", "EVALUATE"));
  assert.throws(() => transitionInvoiceLifecycle("ARCHIVED", "VALIDATE"));
});

test("maps deterministic policy decisions to explicit initial lifecycle states", () => {
  assert.equal(initialPaymentLifecycleState("AUTO_APPROVED"), "AUTO_APPROVED");
  assert.equal(
    initialPaymentLifecycleState("NEEDS_REVIEW"),
    "AWAITING_HUMAN_APPROVAL",
  );
  assert.equal(initialPaymentLifecycleState("BLOCKED"), "BLOCKED");
});

test("permits only the explicit authorization and settlement sequence", () => {
  assert.equal(
    transitionPaymentLifecycle("AUTO_APPROVED", "VERIFY_AUTHORIZATION"),
    "AUTHORIZED",
  );
  assert.equal(
    transitionPaymentLifecycle("AWAITING_HUMAN_APPROVAL", "HUMAN_APPROVE"),
    "HUMAN_APPROVED",
  );
  assert.equal(
    transitionPaymentLifecycle("HUMAN_APPROVED", "VERIFY_AUTHORIZATION"),
    "AUTHORIZED",
  );
  assert.equal(
    transitionPaymentLifecycle("AUTHORIZED", "SUBMIT_PAYMENT"),
    "SUBMITTED",
  );
  assert.equal(
    transitionPaymentLifecycle("SUBMITTED", "CONFIRM_SETTLEMENT"),
    "SETTLED",
  );
});

test("rejects bypasses, duplicate transitions, and settlement before submission", () => {
  assert.throws(
    () => transitionPaymentLifecycle("BLOCKED", "VERIFY_AUTHORIZATION"),
    /cannot apply/,
  );
  assert.throws(
    () => transitionPaymentLifecycle("AWAITING_HUMAN_APPROVAL", "SUBMIT_PAYMENT"),
    /cannot apply/,
  );
  assert.throws(
    () => transitionPaymentLifecycle("AUTHORIZED", "CONFIRM_SETTLEMENT"),
    /cannot apply/,
  );
  assert.throws(
    () => transitionPaymentLifecycle("SETTLED", "CONFIRM_SETTLEMENT"),
    /cannot apply/,
  );
});
