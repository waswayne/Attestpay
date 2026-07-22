import assert from "node:assert/strict";
import test from "node:test";
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  createCanonicalAuthorizationReceipt,
  type CanonicalAuthorizationReceipt,
  type CreateCanonicalAuthorizationReceipt,
} from "../../../src/domain/payments/canonical-authorization-receipt.js";
import {
  getAuthorizationReceiptTypedData,
  signCanonicalAuthorizationReceipt,
  verifyCanonicalAuthorizationReceipt,
  type AuthorizationReceiptVerificationContext,
} from "../../../src/infrastructure/arc/authorization-receipt-signature.js";
import { InMemoryAuthorizationReplayProtection } from "../../../src/infrastructure/local/in-memory-authorization-replay-protection.js";
import { CircleAuthorizationReceiptSignerAdapter } from "../../../src/infrastructure/circle/circle-authorization-receipt-signer.adapter.js";
import { parseCanonicalEvmAddress } from "../../../src/shared/validation/evm.js";

const authorizer = privateKeyToAccount(
  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
);
const wrongSigner = privateKeyToAccount(
  "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
);

const baseInput: CreateCanonicalAuthorizationReceipt = {
  decisionHash: `sha256:${"1".repeat(64)}`,
  policyDefinitionHash: `sha256:${"2".repeat(64)}`,
  policyInputHash: `sha256:${"3".repeat(64)}`,
  authorizationOutcome: "AUTO_APPROVED",
  authorizer: parseCanonicalEvmAddress(authorizer.address),
  chainId: 5_042_002n,
  vaultAddress: parseCanonicalEvmAddress(
    "0x1111111111111111111111111111111111111111",
  ),
  recipientAddress: parseCanonicalEvmAddress(
    "0x2222222222222222222222222222222222222222",
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

function receipt(
  changes: Partial<CreateCanonicalAuthorizationReceipt> = {},
): CanonicalAuthorizationReceipt {
  return createCanonicalAuthorizationReceipt({ ...baseInput, ...changes });
}

function expected(
  value: CanonicalAuthorizationReceipt,
): AuthorizationReceiptVerificationContext {
  return {
    decisionHash: value.decisionHash,
    policyDefinitionHash: value.policyDefinitionHash,
    policyInputHash: value.policyInputHash,
    authorizationOutcome: value.authorizationOutcome,
    expectedAuthorizer: value.authorizer,
    chainId: value.chainId,
    vaultAddress: value.vaultAddress,
    recipientAddress: value.recipientAddress,
    usdcTokenAddress: value.usdcTokenAddress,
    amountBaseUnits: value.amountBaseUnits,
    paymentReference: value.paymentReference,
    nonce: value.nonce,
  };
}

async function verify(input: {
  value: CanonicalAuthorizationReceipt;
  signature: string;
  context?: AuthorizationReceiptVerificationContext;
  verifiedAt?: string;
  replayProtection?: InMemoryAuthorizationReplayProtection;
}) {
  return verifyCanonicalAuthorizationReceipt({
    receipt: input.value,
    signature: input.signature,
    expected: input.context ?? expected(input.value),
    verifiedAt: input.verifiedAt ?? "2026-07-21T12:15:00Z",
    replayProtection:
      input.replayProtection ?? new InMemoryAuthorizationReplayProtection(),
  });
}

test("a valid local EVM signature recovers and verifies the expected signer", async () => {
  const value = receipt();
  const signature = await signCanonicalAuthorizationReceipt(value, authorizer);
  const result = await verify({ value, signature });

  assert.equal(result.valid, true);
  assert.equal(result.code, "VALID");
  if (result.valid) {
    assert.equal(result.recoveredSigner, authorizer.address);
    assert.match(result.receiptHash, /^sha256:[a-f0-9]{64}$/);
    assert.match(result.payloadHash, /^0x[a-f0-9]{64}$/);
  }
});

test("Circle receipt signing serializes and verifies the same canonical EIP-712 payload", async () => {
  const value = receipt();
  const signature = await authorizer.signTypedData(
    getAuthorizationReceiptTypedData(value),
  );
  let serialized = "";
  const signer = new CircleAuthorizationReceiptSignerAdapter(
    {
      apiKey: "TEST_API_KEY:test",
      entitySecret: "a".repeat(64),
      walletId: "11111111-1111-4111-8111-111111111111",
      walletAddress: authorizer.address,
    },
    {
      async signTypedData(input) {
        serialized = input.data;
        return { data: { signature } };
      },
    },
  );

  assert.equal(
    await signer.signAuthorizationReceipt({
      receipt: value,
      explanation: "Authorize payment-001",
    }),
    signature,
  );
  const parsed = JSON.parse(serialized);
  assert.equal(parsed.primaryType, "AuthorizationReceipt");
  assert.equal(parsed.message.receiptHash.startsWith("sha256:"), true);
  assert.equal(parsed.message.amountBaseUnits, value.amountBaseUnits.toString());
});

test("a signature from the wrong signer fails after local recovery", async () => {
  const value = receipt();
  const signature = await wrongSigner.signTypedData(
    getAuthorizationReceiptTypedData(value),
  );
  const result = await verify({ value, signature });

  assert.equal(result.valid, false);
  assert.equal(result.code, "SIGNER_MISMATCH");
  if (!result.valid) assert.equal(result.recoveredSigner, wrongSigner.address);
});

test("a malformed signature fails safely without consuming replay state", async () => {
  const value = receipt();
  const replayProtection = new InMemoryAuthorizationReplayProtection();
  const malformed = await verify({
    value,
    signature: "0x1234",
    replayProtection,
  });
  assert.equal(malformed.valid, false);
  assert.equal(malformed.code, "MALFORMED_SIGNATURE");

  const signature = await signCanonicalAuthorizationReceipt(value, authorizer);
  const valid = await verify({ value, signature, replayProtection });
  assert.equal(valid.code, "VALID");
});

test("an expired receipt fails without consuming replay state", async () => {
  const value = receipt();
  const signature = await signCanonicalAuthorizationReceipt(value, authorizer);
  const replayProtection = new InMemoryAuthorizationReplayProtection();
  const expired = await verify({
    value,
    signature,
    verifiedAt: value.expiresAt,
    replayProtection,
  });
  assert.equal(expired.valid, false);
  assert.equal(expired.code, "EXPIRED");

  const valid = await verify({ value, signature, replayProtection });
  assert.equal(valid.code, "VALID");
});

test("mutating a signed receipt invalidates every required replay boundary", async () => {
  const original = receipt();
  const signature = await signCanonicalAuthorizationReceipt(original, authorizer);
  const mutations: readonly [string, CanonicalAuthorizationReceipt][] = [
    ["decisionHash", receipt({ decisionHash: `sha256:${"4".repeat(64)}` })],
    [
      "policyDefinitionHash",
      receipt({ policyDefinitionHash: `sha256:${"5".repeat(64)}` }),
    ],
    ["policyInputHash", receipt({ policyInputHash: `sha256:${"6".repeat(64)}` })],
    ["authorizationOutcome", receipt({ authorizationOutcome: "HUMAN_APPROVED" })],
    [
      "authorizer",
      receipt({ authorizer: parseCanonicalEvmAddress(wrongSigner.address) }),
    ],
    ["chainId", receipt({ chainId: baseInput.chainId + 1n })],
    [
      "vaultAddress",
      receipt({
        vaultAddress: parseCanonicalEvmAddress(
          "0x3333333333333333333333333333333333333333",
        ),
      }),
    ],
    [
      "usdcTokenAddress",
      receipt({
        usdcTokenAddress: parseCanonicalEvmAddress(
          "0x4444444444444444444444444444444444444444",
        ),
      }),
    ],
    [
      "recipientAddress",
      receipt({
        recipientAddress: parseCanonicalEvmAddress(
          "0x5555555555555555555555555555555555555555",
        ),
      }),
    ],
    ["amountBaseUnits", receipt({ amountBaseUnits: baseInput.amountBaseUnits + 1n })],
    ["paymentReference", receipt({ paymentReference: "payment-002" })],
    ["nonce", receipt({ nonce: "authorization-002" })],
    ["issuedAt", receipt({ issuedAt: "2026-07-21T12:00:01Z" })],
    ["expiresAt", receipt({ expiresAt: "2026-07-21T12:30:01Z" })],
  ];

  for (const [field, mutated] of mutations) {
    const result = await verify({
      value: mutated,
      signature,
      context: expected(mutated),
    });
    assert.equal(result.valid, false, field);
    assert.equal(result.code, "SIGNER_MISMATCH", field);
  }

  const unsupportedSchema = {
    ...original,
    schemaVersion: "attestpay.authorization-receipt.v2",
  } as unknown as CanonicalAuthorizationReceipt;
  const invalidSchema = await verify({
    value: unsupportedSchema,
    signature,
    context: expected(original),
  });
  assert.equal(invalidSchema.code, "INVALID_RECEIPT");
});

test("expected context prevents cross-chain, vault, token, recipient, amount, nonce, and decision replay", async () => {
  const value = receipt();
  const signature = await signCanonicalAuthorizationReceipt(value, authorizer);
  const mutations: readonly [keyof AuthorizationReceiptVerificationContext, unknown][] = [
    ["chainId", value.chainId + 1n],
    ["vaultAddress", "0x3333333333333333333333333333333333333333"],
    ["usdcTokenAddress", "0x4444444444444444444444444444444444444444"],
    ["recipientAddress", "0x5555555555555555555555555555555555555555"],
    ["amountBaseUnits", value.amountBaseUnits + 1n],
    ["nonce", "authorization-002"],
    ["decisionHash", `sha256:${"4".repeat(64)}`],
  ];

  for (const [field, changed] of mutations) {
    const context = { ...expected(value), [field]: changed } as AuthorizationReceiptVerificationContext;
    const result = await verify({ value, signature, context });
    assert.equal(result.valid, false, field);
    assert.equal(result.code, "CONTEXT_MISMATCH", field);
    if (!result.valid) assert.equal(result.field, field);
  }
});

test("address casing cannot create inconsistent identity comparisons", async () => {
  const value = receipt();
  const signature = await signCanonicalAuthorizationReceipt(value, authorizer);
  const context = expected(value);
  const result = await verify({
    value,
    signature,
    context: {
      ...context,
      expectedAuthorizer: context.expectedAuthorizer.toLowerCase(),
      vaultAddress: context.vaultAddress.toLowerCase(),
      recipientAddress: context.recipientAddress.toUpperCase().replace("0X", "0x"),
      usdcTokenAddress: context.usdcTokenAddress.toLowerCase(),
    },
  });

  assert.equal(result.code, "VALID");
});

test("the replay key is consumed once and nonce reuse is rejected", async () => {
  const value = receipt();
  const signature = await signCanonicalAuthorizationReceipt(value, authorizer);
  const replayProtection = new InMemoryAuthorizationReplayProtection();

  const first = await verify({ value, signature, replayProtection });
  const second = await verify({ value, signature, replayProtection });
  assert.equal(first.code, "VALID");
  assert.equal(second.code, "REPLAYED");

  const sameNonceDifferentPayment = receipt({ paymentReference: "payment-002" });
  const secondSignature = await signCanonicalAuthorizationReceipt(
    sameNonceDifferentPayment,
    authorizer,
  );
  const nonceReuse = await verify({
    value: sameNonceDifferentPayment,
    signature: secondSignature,
    replayProtection,
  });
  assert.equal(nonceReuse.code, "REPLAYED");
});

test("a replay-store failure fails closed with an explicit result", async () => {
  const value = receipt();
  const signature = await signCanonicalAuthorizationReceipt(value, authorizer);
  const result = await verifyCanonicalAuthorizationReceipt({
    receipt: value,
    signature: signature as Hex,
    expected: expected(value),
    verifiedAt: "2026-07-21T12:15:00Z",
    replayProtection: {
      async consume() {
        throw new Error("storage unavailable");
      },
    },
  });

  assert.equal(result.valid, false);
  assert.equal(result.code, "REPLAY_CHECK_FAILED");
});
