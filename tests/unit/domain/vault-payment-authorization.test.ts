import assert from "node:assert/strict";
import test from "node:test";
import { createVaultPaymentAuthorization } from "../../../src/domain/payments/vault-payment-authorization.js";

const input = {
  vaultAddress: "0x1111111111111111111111111111111111111111" as const,
  operationId: "payment-001",
  recipient: "0x2222222222222222222222222222222222222222" as const,
  amount: 10_000n,
  invoiceReference: "invoice-001",
  policyReference: "policy-v1",
  authorizer: "0x3333333333333333333333333333333333333333" as const,
  issuedAt: 1_700_000_000,
};

test("creates a deterministic payment authorization with a bounded lifetime", () => {
  const first = createVaultPaymentAuthorization(input);
  const second = createVaultPaymentAuthorization(input);

  assert.deepEqual(first, second);
  assert.equal(first.validAfter, input.issuedAt);
  assert.equal(first.deadline, input.issuedAt + 1_800);
  assert.equal(first.amount, input.amount);
});

test("binds payment, invoice, and policy identities independently", () => {
  const original = createVaultPaymentAuthorization(input);
  const paymentChanged = createVaultPaymentAuthorization({
    ...input,
    operationId: "payment-002",
  });
  const invoiceChanged = createVaultPaymentAuthorization({
    ...input,
    invoiceReference: "invoice-002",
  });
  const policyChanged = createVaultPaymentAuthorization({
    ...input,
    policyReference: "policy-v2",
  });

  assert.notEqual(paymentChanged.paymentId, original.paymentId);
  assert.notEqual(invoiceChanged.invoiceHash, original.invoiceHash);
  assert.notEqual(policyChanged.policyHash, original.policyHash);
});
