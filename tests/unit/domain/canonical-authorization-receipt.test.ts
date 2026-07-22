import assert from "node:assert/strict";
import test from "node:test";
import {
  AUTHORIZATION_RECEIPT_SCHEMA_VERSION,
  createCanonicalAuthorizationReceipt,
  generateAuthorizationReceiptHash,
  serializeCanonicalAuthorizationReceipt,
  type CanonicalAuthorizationReceipt,
  type CreateCanonicalAuthorizationReceipt,
} from "../../../src/domain/payments/canonical-authorization-receipt.js";
import { parseCanonicalEvmAddress } from "../../../src/shared/validation/evm.js";

const input: CreateCanonicalAuthorizationReceipt = {
  decisionHash: `sha256:${"1".repeat(64)}`,
  policyDefinitionHash: `sha256:${"2".repeat(64)}`,
  policyInputHash: `sha256:${"3".repeat(64)}`,
  authorizationOutcome: "AUTO_APPROVED",
  authorizer: parseCanonicalEvmAddress(
    "0x1111111111111111111111111111111111111111",
  ),
  chainId: 5_042_002n,
  vaultAddress: parseCanonicalEvmAddress(
    "0x2222222222222222222222222222222222222222",
  ),
  recipientAddress: parseCanonicalEvmAddress(
    "0x3333333333333333333333333333333333333333",
  ),
  usdcTokenAddress: parseCanonicalEvmAddress(
    "0x3600000000000000000000000000000000000000",
  ),
  amountBaseUnits: 25_000_000n,
  paymentReference: "payment-001",
  nonce: "authorization-001",
  issuedAt: "2026-07-21T12:00:00Z",
  expiresAt: "2026-07-21T12:30:00Z",
};

test("identical canonical inputs generate the same receipt serialization and hash", () => {
  const first = createCanonicalAuthorizationReceipt(input);
  const second = createCanonicalAuthorizationReceipt({ ...input });

  assert.equal(first.schemaVersion, AUTHORIZATION_RECEIPT_SCHEMA_VERSION);
  assert.equal(
    serializeCanonicalAuthorizationReceipt(first),
    serializeCanonicalAuthorizationReceipt(second),
  );
  assert.equal(
    generateAuthorizationReceiptHash(first),
    generateAuthorizationReceiptHash(second),
  );
  assert.match(generateAuthorizationReceiptHash(first), /^sha256:[a-f0-9]{64}$/);
});

test("every security-critical receipt field changes the hash or invalidates the receipt", () => {
  const receipt = createCanonicalAuthorizationReceipt(input);
  const originalHash = generateAuthorizationReceiptHash(receipt);
  const changes: readonly Partial<CreateCanonicalAuthorizationReceipt>[] = [
    { decisionHash: `sha256:${"4".repeat(64)}` },
    { policyDefinitionHash: `sha256:${"5".repeat(64)}` },
    { policyInputHash: `sha256:${"6".repeat(64)}` },
    { authorizationOutcome: "HUMAN_APPROVED" },
    {
      authorizer: parseCanonicalEvmAddress(
        "0x4444444444444444444444444444444444444444",
      ),
    },
    { chainId: 5_042_003n },
    {
      vaultAddress: parseCanonicalEvmAddress(
        "0x5555555555555555555555555555555555555555",
      ),
    },
    {
      recipientAddress: parseCanonicalEvmAddress(
        "0x6666666666666666666666666666666666666666",
      ),
    },
    {
      usdcTokenAddress: parseCanonicalEvmAddress(
        "0x7777777777777777777777777777777777777777",
      ),
    },
    { amountBaseUnits: 25_000_001n },
    { paymentReference: "payment-002" },
    { nonce: "authorization-002" },
    { issuedAt: "2026-07-21T12:00:01Z" },
    { expiresAt: "2026-07-21T12:30:01Z" },
  ];

  for (const change of changes) {
    const changed = createCanonicalAuthorizationReceipt({ ...input, ...change });
    assert.notEqual(generateAuthorizationReceiptHash(changed), originalHash);
  }

  const unsupportedVersion = {
    ...receipt,
    schemaVersion: "attestpay.authorization-receipt.v2",
  } as unknown as CanonicalAuthorizationReceipt;
  assert.throws(() => generateAuthorizationReceiptHash(unsupportedVersion));
});

test("rejects non-authorizing outcomes and invalid validity windows", () => {
  assert.throws(
    () =>
      createCanonicalAuthorizationReceipt({
        ...input,
        authorizationOutcome: "BLOCKED" as "AUTO_APPROVED",
      }),
    /outcome must permit payment/,
  );
  assert.throws(
    () =>
      createCanonicalAuthorizationReceipt({
        ...input,
        expiresAt: input.issuedAt,
      }),
    /expiry must be after/,
  );
});
