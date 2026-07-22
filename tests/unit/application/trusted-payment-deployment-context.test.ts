import assert from "node:assert/strict";
import test from "node:test";
import { privateKeyToAccount } from "viem/accounts";
import {
  createPaymentWorkflow,
  signAndAuthorizePaymentWorkflow,
} from "../../../src/application/use-cases/manage-payment-workflow.js";
import type { TrustedPaymentDeploymentContext } from "../../../src/application/trusted-payment-deployment-context.js";
import { signCanonicalAuthorizationReceipt } from "../../../src/infrastructure/arc/authorization-receipt-signature.js";
import { SqlitePaymentWorkflowRepository } from "../../../src/infrastructure/persistence/sqlite-payment-workflow.repository.js";
import { parseCanonicalEvmAddress } from "../../../src/shared/validation/evm.js";

const account = privateKeyToAccount(
  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
);
const trusted: TrustedPaymentDeploymentContext = Object.freeze({
  chainId: 5_042_002n,
  vaultAddress: parseCanonicalEvmAddress(
    "0x1111111111111111111111111111111111111111",
  ),
  usdcTokenAddress: parseCanonicalEvmAddress(
    "0x3600000000000000000000000000000000000000",
  ),
});

function workflowInput(
  override: Partial<{
    chainId: bigint;
    vaultAddress: ReturnType<typeof parseCanonicalEvmAddress>;
    usdcTokenAddress: ReturnType<typeof parseCanonicalEvmAddress>;
  }> = {},
) {
  return {
    id: "trusted-context-workflow",
    idempotencyKey: "11111111-1111-4111-8111-111111111111",
    decision: "AUTO_APPROVED" as const,
    decisionHash: `sha256:${"1".repeat(64)}` as const,
    policyDefinitionHash: `sha256:${"2".repeat(64)}` as const,
    policyInputHash: `sha256:${"3".repeat(64)}` as const,
    authorizer: parseCanonicalEvmAddress(account.address),
    chainId: trusted.chainId,
    vaultAddress: trusted.vaultAddress,
    recipientAddress: parseCanonicalEvmAddress(
      "0x2222222222222222222222222222222222222222",
    ),
    usdcTokenAddress: trusted.usdcTokenAddress,
    amountBaseUnits: 25_000_000n,
    paymentReference: "trusted-context-payment",
    nonce: "trusted-context-nonce",
    issuedAt: "2026-07-21T12:00:00Z",
    expiresAt: "2026-07-21T12:30:00Z",
    createdAt: "2026-07-21T11:59:00Z",
    ...override,
  };
}

test("correct trusted Arc context passes and address casing is canonicalized", async () => {
  const repository = new SqlitePaymentWorkflowRepository(":memory:");
  let signerCalls = 0;
  try {
    const workflow = await createPaymentWorkflow(repository, workflowInput());
    const casingVariant = Object.freeze({
      ...trusted,
      vaultAddress: trusted.vaultAddress.toLowerCase() as typeof trusted.vaultAddress,
      usdcTokenAddress:
        trusted.usdcTokenAddress.toLowerCase() as typeof trusted.usdcTokenAddress,
    });
    const result = await signAndAuthorizePaymentWorkflow(
      repository,
      {
        async signAuthorizationReceipt({ receipt }) {
          signerCalls += 1;
          return signCanonicalAuthorizationReceipt(receipt, account);
        },
      },
      casingVariant,
      { workflowId: workflow.id, verifiedAt: "2026-07-21T12:01:00Z" },
    );
    assert.equal(result.code, "VALID");
    assert.equal(signerCalls, 1);
  } finally {
    repository.close();
  }
});

for (const mismatch of [
  {
    label: "chain",
    override: { chainId: trusted.chainId + 1n },
    message: /Trusted deployment chain mismatch/,
  },
  {
    label: "vault",
    override: {
      vaultAddress: parseCanonicalEvmAddress(
        "0x3333333333333333333333333333333333333333",
      ),
    },
    message: /Trusted deployment vault mismatch/,
  },
  {
    label: "USDC token",
    override: {
      usdcTokenAddress: parseCanonicalEvmAddress(
        "0x4444444444444444444444444444444444444444",
      ),
    },
    message: /Trusted deployment USDC token mismatch/,
  },
] as const) {
  test(`wrong workflow ${mismatch.label} fails before receipt signing`, async () => {
    const repository = new SqlitePaymentWorkflowRepository(":memory:");
    let signerCalls = 0;
    try {
      const workflow = await createPaymentWorkflow(
        repository,
        workflowInput(mismatch.override),
      );
      await assert.rejects(
        signAndAuthorizePaymentWorkflow(
          repository,
          {
            async signAuthorizationReceipt() {
              signerCalls += 1;
              throw new Error("signer must not be called");
            },
          },
          trusted,
          { workflowId: workflow.id, verifiedAt: "2026-07-21T12:01:00Z" },
        ),
        mismatch.message,
      );
      assert.equal(signerCalls, 0);
      assert.equal((await repository.get(workflow.id))?.state, "AUTO_APPROVED");
    } finally {
      repository.close();
    }
  });
}
