import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { privateKeyToAccount } from "viem/accounts";
import {
  authorizePaymentWorkflow,
  buildAuthorizationReceiptForWorkflow,
  createPaymentWorkflow,
  decideManualApproval,
} from "../../../src/application/use-cases/manage-payment-workflow.js";
import { signCanonicalAuthorizationReceipt } from "../../../src/infrastructure/arc/authorization-receipt-signature.js";
import { SqlitePaymentWorkflowRepository } from "../../../src/infrastructure/persistence/sqlite-payment-workflow.repository.js";
import { parseCanonicalEvmAddress } from "../../../src/shared/validation/evm.js";

const account = privateKeyToAccount(
  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
);
const HASHES = {
  decisionHash: `sha256:${"1".repeat(64)}` as const,
  policyDefinitionHash: `sha256:${"2".repeat(64)}` as const,
  policyInputHash: `sha256:${"3".repeat(64)}` as const,
};
const trustedDeployment = Object.freeze({
  chainId: 5_042_002n,
  vaultAddress: parseCanonicalEvmAddress(
    "0x1111111111111111111111111111111111111111",
  ),
  usdcTokenAddress: parseCanonicalEvmAddress(
    "0x3600000000000000000000000000000000000000",
  ),
});

function workflowInput(id: string, paymentReference: string) {
  return {
    id,
    idempotencyKey: id === "workflow-001"
      ? "11111111-1111-4111-8111-111111111111"
      : "22222222-2222-4222-8222-222222222222",
    decision: "NEEDS_REVIEW" as const,
    ...HASHES,
    authorizer: parseCanonicalEvmAddress(account.address),
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
    paymentReference,
    nonce: "shared-nonce-001",
    issuedAt: "2026-07-21T12:00:00Z",
    expiresAt: "2026-07-21T12:30:00Z",
    createdAt: "2026-07-21T11:59:00Z",
  };
}

test("persists approval, atomic replay consumption, audit history, and restart state", async () => {
  const directory = await mkdtemp(join(tmpdir(), "attestpay-workflow-"));
  const databasePath = join(directory, "attestpay.sqlite");
  let repository = new SqlitePaymentWorkflowRepository(databasePath);
  try {
    let first = await createPaymentWorkflow(
      repository,
      workflowInput("workflow-001", "payment-001"),
    );
    assert.equal(first.state, "AWAITING_HUMAN_APPROVAL");
    first = await decideManualApproval(repository, {
      workflowId: first.id,
      operatorId: "finance-operator-001",
      approverAddress: parseCanonicalEvmAddress(account.address),
      decision: "APPROVED",
      decidedAt: "2026-07-21T12:01:00Z",
    });
    const receipt = buildAuthorizationReceiptForWorkflow(first);
    const signature = await signCanonicalAuthorizationReceipt(receipt, account);
    const verified = await authorizePaymentWorkflow(repository, trustedDeployment, {
      workflowId: first.id,
      receipt,
      signature,
      verifiedAt: "2026-07-21T12:02:00Z",
    });
    assert.equal(verified.code, "VALID");
    assert.equal((await repository.get(first.id))?.state, "AUTHORIZED");

    let second = await createPaymentWorkflow(
      repository,
      workflowInput("workflow-002", "payment-002"),
    );
    second = await decideManualApproval(repository, {
      workflowId: second.id,
      operatorId: "finance-operator-001",
      approverAddress: parseCanonicalEvmAddress(account.address),
      decision: "APPROVED",
      decidedAt: "2026-07-21T12:03:00Z",
    });
    const replayReceipt = buildAuthorizationReceiptForWorkflow(second);
    const replaySignature = await signCanonicalAuthorizationReceipt(
      replayReceipt,
      account,
    );
    const replayed = await authorizePaymentWorkflow(repository, trustedDeployment, {
      workflowId: second.id,
      receipt: replayReceipt,
      signature: replaySignature,
      verifiedAt: "2026-07-21T12:04:00Z",
    });
    assert.equal(replayed.code, "REPLAYED");
    assert.equal((await repository.get(second.id))?.state, "HUMAN_APPROVED");

    const events = await repository.listAuditEvents(first.id);
    assert.deepEqual(
      events.map((item) => item.eventType),
      ["WORKFLOW_CREATED", "MANUAL_APPROVED", "AUTHORIZATION_VERIFIED"],
    );

    repository.close();
    repository = new SqlitePaymentWorkflowRepository(databasePath);
    const restored = await repository.get(first.id);
    assert.equal(restored?.state, "AUTHORIZED");
    assert.equal(restored?.amountBaseUnits, 25_000_000n);
    assert.equal(restored?.receiptSignature, signature);
  } finally {
    repository.close();
    await rm(directory, { recursive: true, force: true });
  }
});
