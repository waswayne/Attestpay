import assert from "node:assert/strict";
import test from "node:test";
import { privateKeyToAccount } from "viem/accounts";
import type { PaymentWorkflow } from "../../../src/application/ports/payment-workflow.repository.port.js";
import type {
  VaultPaymentSettlementEvidence,
  VerifyVaultPaymentSettlement,
} from "../../../src/application/ports/settlement-verifier.port.js";
import { executeAuthorizedPayment } from "../../../src/application/use-cases/execute-authorized-payment.js";
import {
  authorizePaymentWorkflow,
  buildAuthorizationReceiptForWorkflow,
  createPaymentWorkflow,
} from "../../../src/application/use-cases/manage-payment-workflow.js";
import type { TrustedPaymentDeploymentContext } from "../../../src/application/trusted-payment-deployment-context.js";
import { getVaultPaymentTypedData } from "../../../src/infrastructure/arc/attestpay-vault.js";
import { signCanonicalAuthorizationReceipt } from "../../../src/infrastructure/arc/authorization-receipt-signature.js";
import { SqlitePaymentWorkflowRepository } from "../../../src/infrastructure/persistence/sqlite-payment-workflow.repository.js";
import { parseCanonicalEvmAddress } from "../../../src/shared/validation/evm.js";

const account = privateKeyToAccount(
  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
);
const transactionHash = `0x${"9".repeat(64)}` as const;
const executorAddress = "0x3333333333333333333333333333333333333333" as const;
const trustedDeployment: TrustedPaymentDeploymentContext = Object.freeze({
  chainId: 5_042_002n,
  vaultAddress: parseCanonicalEvmAddress(
    "0x1111111111111111111111111111111111111111",
  ),
  usdcTokenAddress: parseCanonicalEvmAddress(
    "0x3600000000000000000000000000000000000000",
  ),
});

async function createAuthorizedWorkflow(
  repository: SqlitePaymentWorkflowRepository,
): Promise<PaymentWorkflow> {
  const created = await createPaymentWorkflow(repository, {
    id: "workflow-auto-001",
    idempotencyKey: "11111111-1111-4111-8111-111111111111",
    decision: "AUTO_APPROVED",
    decisionHash: `sha256:${"1".repeat(64)}`,
    policyDefinitionHash: `sha256:${"2".repeat(64)}`,
    policyInputHash: `sha256:${"3".repeat(64)}`,
    authorizer: parseCanonicalEvmAddress(account.address),
    chainId: trustedDeployment.chainId,
    vaultAddress: trustedDeployment.vaultAddress,
    recipientAddress: parseCanonicalEvmAddress(
      "0x2222222222222222222222222222222222222222",
    ),
    usdcTokenAddress: trustedDeployment.usdcTokenAddress,
    amountBaseUnits: 25_000_000n,
    paymentReference: "payment-auto-001",
    nonce: "nonce-auto-001",
    issuedAt: "2026-07-21T12:00:00Z",
    expiresAt: "2026-07-21T12:30:00Z",
    createdAt: "2026-07-21T11:59:00Z",
  });
  const receipt = buildAuthorizationReceiptForWorkflow(created);
  const receiptSignature = await signCanonicalAuthorizationReceipt(receipt, account);
  const authorization = await authorizePaymentWorkflow(
    repository,
    trustedDeployment,
    {
      workflowId: created.id,
      receipt,
      signature: receiptSignature,
      verifiedAt: "2026-07-21T12:01:00Z",
    },
  );
  assert.equal(authorization.code, "VALID");
  const authorized = await repository.get(created.id);
  if (!authorized) throw new Error("Authorized test workflow was not persisted.");
  return authorized;
}

function settlementEvidence(
  expected: VerifyVaultPaymentSettlement,
): VaultPaymentSettlementEvidence {
  return {
    transactionHash: expected.transactionHash,
    blockNumber: "12345",
    logIndex: 1,
    senderAddress: expected.vaultAddress,
    recipientAddress: expected.recipientAddress,
    amount: expected.amount,
    memoId: expected.memoId,
    memoIndex: "7",
    memoLogIndex: 3,
    paymentEventLogIndex: 2,
    paymentId: expected.paymentId,
  };
}

function createHarness(
  verify: (
    expected: VerifyVaultPaymentSettlement,
  ) => Promise<VaultPaymentSettlementEvidence> = async (expected) =>
    settlementEvidence(expected),
) {
  const calls = { signer: 0, submission: 0, wait: 0, verification: 0 };
  return {
    calls,
    vaultReader: {
      async getStatus() {
        throw new Error("not used");
      },
      async isRecipientApproved() {
        return true;
      },
      async getPaymentReadiness() {
        return {
          recipientApproved: true,
          paymentAlreadyUsed: false,
          paused: false,
          vaultBalance: 100_000_000n,
          maxPaymentAmount: 100_000_000n,
          dailyLimit: 500_000_000n,
          spentToday: 0n,
        };
      },
    },
    vaultSigner: {
      async signVaultPaymentAuthorization(input: Parameters<
        typeof getVaultPaymentTypedData
      > extends never
        ? never
        : {
            vaultAddress: `0x${string}`;
            authorization: Parameters<typeof getVaultPaymentTypedData>[1];
          }) {
        calls.signer += 1;
        return account.signTypedData(
          getVaultPaymentTypedData(input.vaultAddress, input.authorization),
        );
      },
    },
    payments: {
      async submitUsdcTransfer() {
        throw new Error("not used");
      },
      async submitMemoUsdcTransfer() {
        throw new Error("not used");
      },
      async submitArcContractCall() {
        calls.submission += 1;
        return { transactionId: "provider-transaction-001", state: "INITIATED" as const };
      },
      async waitForTransactionHash() {
        calls.wait += 1;
        return {
          transactionId: "provider-transaction-001",
          state: "COMPLETE" as const,
          transactionHash,
          errorReason: null,
        };
      },
    },
    settlementVerifier: {
      async verifyUsdcSettlement() {
        throw new Error("not used");
      },
      async verifyMemoUsdcSettlement() {
        throw new Error("not used");
      },
      async verifyVaultRecipientApproval() {
        throw new Error("not used");
      },
      async verifyVaultPaymentSettlement(expected: VerifyVaultPaymentSettlement) {
        calls.verification += 1;
        return verify(expected);
      },
    },
  };
}

function execute(
  repository: SqlitePaymentWorkflowRepository,
  harness: ReturnType<typeof createHarness>,
  occurredAt: string,
  deployment: TrustedPaymentDeploymentContext = trustedDeployment,
) {
  return executeAuthorizedPayment({
    workflowId: "workflow-auto-001",
    repository,
    trustedDeployment: deployment,
    vaultReader: harness.vaultReader,
    vaultSigner: harness.vaultSigner,
    payments: harness.payments,
    settlementVerifier: harness.settlementVerifier,
    executorAddress,
    occurredAt,
    waitSignal: AbortSignal.timeout(1_000),
  });
}

test("executes an authorized workflow and links the complete receipt through settlement", async () => {
  const repository = new SqlitePaymentWorkflowRepository(":memory:");
  try {
    await createAuthorizedWorkflow(repository);
    let settlementExpectation: VerifyVaultPaymentSettlement | undefined;
    const harness = createHarness(async (expected) => {
      settlementExpectation = expected;
      return settlementEvidence(expected);
    });
    const workflow = await execute(
      repository,
      harness,
      "2026-07-21T12:02:00Z",
    );

    assert.equal(workflow.state, "SETTLED");
    assert.equal(workflow.settlement?.transactionHash, transactionHash);
    assert.equal(
      settlementExpectation?.policyHash,
      `0x${workflow.receiptHash?.slice("sha256:".length)}`,
    );
    assert.equal(settlementExpectation?.invoiceHash, `0x${"3".repeat(64)}`);
    assert.deepEqual(harness.calls, {
      signer: 1,
      submission: 1,
      wait: 1,
      verification: 1,
    });
    assert.deepEqual(
      (await repository.listAuditEvents(workflow.id)).map((item) => item.eventType),
      [
        "WORKFLOW_CREATED",
        "AUTHORIZATION_VERIFIED",
        "PAYMENT_PREPARED",
        "PAYMENT_SUBMITTED",
        "SETTLEMENT_VERIFIED",
      ],
    );
  } finally {
    repository.close();
  }
});

test("reconciles a SUBMITTED workflow after an RPC outage without signing or submitting again", async () => {
  const repository = new SqlitePaymentWorkflowRepository(":memory:");
  let outage = true;
  const harness = createHarness(async (expected) => {
    if (outage) {
      throw new Error("rpc outage at https://secret.example/?apiKey=do-not-store");
    }
    return settlementEvidence(expected);
  });
  try {
    await createAuthorizedWorkflow(repository);
    await assert.rejects(
      execute(repository, harness, "2026-07-21T12:02:00Z"),
      /workflow remains SUBMITTED for retry/,
    );
    const submitted = await repository.get("workflow-auto-001");
    assert.equal(submitted?.state, "SUBMITTED");
    assert.equal(submitted?.submission?.transactionHash, transactionHash);
    assert.equal(submitted?.failureReason, null);
    assert.deepEqual(harness.calls, {
      signer: 1,
      submission: 1,
      wait: 1,
      verification: 1,
    });

    const wrongDeployment = Object.freeze({
      ...trustedDeployment,
      chainId: trustedDeployment.chainId + 1n,
    });
    await assert.rejects(
      execute(
        repository,
        harness,
        "2026-07-21T12:02:30Z",
        wrongDeployment,
      ),
      /Trusted deployment chain mismatch/,
    );
    assert.equal(harness.calls.verification, 1);

    outage = false;
    const settled = await execute(
      repository,
      harness,
      "2026-07-21T12:03:00Z",
    );
    assert.equal(settled.state, "SETTLED");
    assert.equal(settled.submission?.transactionHash, transactionHash);
    assert.deepEqual(harness.calls, {
      signer: 1,
      submission: 1,
      wait: 1,
      verification: 2,
    });
    const events = await repository.listAuditEvents(settled.id);
    assert.deepEqual(
      events.map((item) => item.eventType),
      [
        "WORKFLOW_CREATED",
        "AUTHORIZATION_VERIFIED",
        "PAYMENT_PREPARED",
        "PAYMENT_SUBMITTED",
        "SETTLEMENT_VERIFIED",
      ],
    );
    assert.ok(
      !JSON.stringify(events).includes("secret.example"),
      "raw verifier errors must not enter audit state",
    );

    await assert.rejects(
      execute(repository, harness, "2026-07-21T12:04:00Z"),
      /Only AUTHORIZED or SUBMITTED workflows can execute/,
    );
    assert.equal((await repository.listAuditEvents(settled.id)).length, 5);
  } finally {
    repository.close();
  }
});

test("fails closed when SUBMITTED evidence is incomplete", async () => {
  const repository = new SqlitePaymentWorkflowRepository(":memory:");
  const harness = createHarness();
  try {
    const authorized = await createAuthorizedWorkflow(repository);
    const incomplete = Object.freeze({
      ...authorized,
      version: authorized.version + 1,
      state: "SUBMITTED" as const,
      updatedAt: "2026-07-21T12:02:00.000Z",
    });
    assert.equal(
      await repository.save(incomplete, authorized.version, {
        workflowId: incomplete.id,
        sequence: incomplete.version,
        eventType: "TEST_INCOMPLETE_SUBMISSION",
        occurredAt: incomplete.updatedAt,
        payload: {},
      }),
      true,
    );
    await assert.rejects(
      execute(repository, harness, "2026-07-21T12:03:00Z"),
      /missing required persisted evidence/,
    );
    assert.deepEqual(harness.calls, {
      signer: 0,
      submission: 0,
      wait: 0,
      verification: 0,
    });
  } finally {
    repository.close();
  }
});

test("rejects trusted-context tampering before signing, submission, or reconciliation", async () => {
  const repository = new SqlitePaymentWorkflowRepository(":memory:");
  const harness = createHarness();
  try {
    const authorized = await createAuthorizedWorkflow(repository);
    const tampered = Object.freeze({
      ...authorized,
      version: authorized.version + 1,
      usdcTokenAddress: parseCanonicalEvmAddress(
        "0x4444444444444444444444444444444444444444",
      ),
      updatedAt: "2026-07-21T12:02:00.000Z",
    });
    await repository.save(tampered, authorized.version, {
      workflowId: tampered.id,
      sequence: tampered.version,
      eventType: "TEST_TAMPER",
      occurredAt: tampered.updatedAt,
      payload: {},
    });
    await assert.rejects(
      execute(repository, harness, "2026-07-21T12:03:00Z"),
      /Trusted deployment USDC token mismatch/,
    );
    assert.deepEqual(harness.calls, {
      signer: 0,
      submission: 0,
      wait: 0,
      verification: 0,
    });
  } finally {
    repository.close();
  }
});

test("rejects wrong returned settlement evidence and leaves SUBMITTED retryable", async () => {
  const repository = new SqlitePaymentWorkflowRepository(":memory:");
  const harness = createHarness(async (expected) => ({
    ...settlementEvidence(expected),
    recipientAddress: "0x4444444444444444444444444444444444444444",
  }));
  try {
    await createAuthorizedWorkflow(repository);
    await assert.rejects(
      execute(repository, harness, "2026-07-21T12:02:00Z"),
      /workflow remains SUBMITTED for retry/,
    );
    assert.equal((await repository.get("workflow-auto-001"))?.state, "SUBMITTED");
    assert.equal(harness.calls.submission, 1);
  } finally {
    repository.close();
  }
});

test("concurrent reconciliation creates only one settlement transition and audit event", async () => {
  const repository = new SqlitePaymentWorkflowRepository(":memory:");
  let mode: "outage" | "concurrent" = "outage";
  let concurrentCalls = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const harness = createHarness(async (expected) => {
    if (mode === "outage") throw new Error("temporary outage");
    concurrentCalls += 1;
    if (concurrentCalls === 2) release();
    await gate;
    return settlementEvidence(expected);
  });
  try {
    await createAuthorizedWorkflow(repository);
    await assert.rejects(
      execute(repository, harness, "2026-07-21T12:02:00Z"),
      /workflow remains SUBMITTED for retry/,
    );
    mode = "concurrent";
    const results = await Promise.allSettled([
      execute(repository, harness, "2026-07-21T12:03:00Z"),
      execute(repository, harness, "2026-07-21T12:03:01Z"),
    ]);
    assert.equal(results.filter((item) => item.status === "fulfilled").length, 1);
    assert.equal(results.filter((item) => item.status === "rejected").length, 1);
    const events = await repository.listAuditEvents("workflow-auto-001");
    assert.equal(
      events.filter((item) => item.eventType === "SETTLEMENT_VERIFIED").length,
      1,
    );
    assert.equal((await repository.get("workflow-auto-001"))?.state, "SETTLED");
    assert.equal(harness.calls.submission, 1);
    assert.equal(harness.calls.signer, 1);
  } finally {
    repository.close();
  }
});
