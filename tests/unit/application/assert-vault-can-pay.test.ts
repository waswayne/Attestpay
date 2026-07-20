import assert from "node:assert/strict";
import test from "node:test";
import type { VaultReaderPort } from "../../../src/application/ports/vault-reader.port.js";
import { assertVaultCanPay } from "../../../src/application/use-cases/assert-vault-can-pay.js";
import type { VaultPaymentAuthorization } from "../../../src/domain/payments/vault-payment-authorization.js";

const vault = "0x1111111111111111111111111111111111111111" as const;
const authorization: VaultPaymentAuthorization = {
  paymentId: `0x${"1".repeat(64)}`,
  recipient: "0x2222222222222222222222222222222222222222",
  amount: 10_000n,
  invoiceHash: `0x${"2".repeat(64)}`,
  policyHash: `0x${"3".repeat(64)}`,
  validAfter: 1_700_000_000,
  deadline: 1_700_001_800,
  authorizer: "0x3333333333333333333333333333333333333333",
};

function reader(overrides = {}): VaultReaderPort {
  return {
    async getStatus() {
      return {
        recipientApproved: true,
        paused: false,
        vaultBalance: 1_000_000n,
        maxPaymentAmount: 100_000n,
        dailyLimit: 500_000n,
        spentToday: 0n,
        ...overrides,
      };
    },
    async isRecipientApproved() {
      return true;
    },
    async getPaymentReadiness() {
      return {
        recipientApproved: true,
        paymentAlreadyUsed: false,
        paused: false,
        vaultBalance: 1_000_000n,
        maxPaymentAmount: 100_000n,
        dailyLimit: 500_000n,
        spentToday: 0n,
        ...overrides,
      };
    },
  };
}

test("accepts a payment only when every current vault guardrail passes", async () => {
  await assert.doesNotReject(
    assertVaultCanPay(reader(), vault, authorization, 1_700_000_100),
  );
});

test("fails closed for paused, unapproved, replayed, capped, or unfunded payments", async () => {
  const cases = [
    [reader({ paused: true }), /paused/],
    [reader({ recipientApproved: false }), /not approved/],
    [reader({ paymentAlreadyUsed: true }), /already been consumed/],
    [reader({ maxPaymentAmount: 9_999n }), /per-payment/],
    [reader({ spentToday: 495_000n }), /daily limit/],
    [reader({ vaultBalance: 9_999n }), /insufficient/],
  ] as const;

  for (const [vaultReader, expectedError] of cases) {
    await assert.rejects(
      assertVaultCanPay(vaultReader, vault, authorization, 1_700_000_100),
      expectedError,
    );
  }
});
