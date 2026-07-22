import assert from "node:assert/strict";
import test from "node:test";
import type { Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createPaymentWorkflow } from "../../../src/application/use-cases/manage-payment-workflow.js";
import { signCanonicalAuthorizationReceipt } from "../../../src/infrastructure/arc/authorization-receipt-signature.js";
import { SqlitePaymentWorkflowRepository } from "../../../src/infrastructure/persistence/sqlite-payment-workflow.repository.js";
import { createPaymentWorkflowServer } from "../../../src/interfaces/http/payment-workflow.server.js";
import { parseCanonicalEvmAddress } from "../../../src/shared/validation/evm.js";

const account = privateKeyToAccount(
  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
);
const token = "local-test-operator-token-12345";
const trustedDeployment = Object.freeze({
  chainId: 5_042_002n,
  vaultAddress: parseCanonicalEvmAddress(
    "0x1111111111111111111111111111111111111111",
  ),
  usdcTokenAddress: parseCanonicalEvmAddress(
    "0x3600000000000000000000000000000000000000",
  ),
});

test("serves the operations UI and protects workflow mutations with backend authorization", async () => {
  const repository = new SqlitePaymentWorkflowRepository(":memory:");
  const now = Date.now();
  await createPaymentWorkflow(repository, {
    id: "api-workflow-001",
    idempotencyKey: "11111111-1111-4111-8111-111111111111",
    decision: "AUTO_APPROVED",
    decisionHash: `sha256:${"1".repeat(64)}`,
    policyDefinitionHash: `sha256:${"2".repeat(64)}`,
    policyInputHash: `sha256:${"3".repeat(64)}`,
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
    paymentReference: "api-payment-001",
    nonce: "api-nonce-001",
    issuedAt: new Date(now - 60_000).toISOString(),
    expiresAt: new Date(now + 30 * 60_000).toISOString(),
    createdAt: new Date(now - 120_000).toISOString(),
  });
  const server = createPaymentWorkflowServer({
    repository,
    operatorToken: token,
    operatorId: "local-finance-operator",
    approverAddress: account.address as Address,
    trustedDeployment,
    receiptSigner: {
      async signAuthorizationReceipt({ receipt }) {
        return signCanonicalAuthorizationReceipt(receipt, account);
      },
    },
    executeWorkflow: async (id) => {
      const workflow = await repository.get(id);
      if (!workflow) throw new Error("not found");
      return workflow;
    },
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No test port.");
    const origin = `http://127.0.0.1:${address.port}`;

    const page = await fetch(origin);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /AttestPay Operations/);
    assert.match(page.headers.get("content-security-policy") ?? "", /default-src 'self'/);

    const unauthorized = await fetch(`${origin}/api/v1/workflows`);
    assert.equal(unauthorized.status, 401);

    const headers = { authorization: `Bearer ${token}` };
    const list = await fetch(`${origin}/api/v1/workflows`, { headers });
    assert.equal(list.status, 200);
    const listed = (await list.json()) as { workflows: Array<{ id: string }> };
    assert.deepEqual(listed.workflows.map((item) => item.id), ["api-workflow-001"]);

    const authorized = await fetch(
      `${origin}/api/v1/workflows/api-workflow-001/authorize`,
      { method: "POST", headers },
    );
    assert.equal(authorized.status, 200);
    assert.equal((await repository.get("api-workflow-001"))?.state, "AUTHORIZED");

    const detail = await fetch(
      `${origin}/api/v1/workflows/api-workflow-001`,
      { headers },
    );
    const payload = (await detail.json()) as {
      workflow: { amountBaseUnits: string };
      auditEvents: Array<{ eventType: string }>;
    };
    assert.equal(payload.workflow.amountBaseUnits, "25000000");
    assert.deepEqual(
      payload.auditEvents.map((item) => item.eventType),
      ["WORKFLOW_CREATED", "AUTHORIZATION_VERIFIED"],
    );
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    repository.close();
  }
});

test("derives approve and reject identity from the configured local operator", async () => {
  const repository = new SqlitePaymentWorkflowRepository(":memory:");
  const now = Date.now();
  const common = {
    decision: "NEEDS_REVIEW" as const,
    decisionHash: `sha256:${"1".repeat(64)}` as const,
    policyDefinitionHash: `sha256:${"2".repeat(64)}` as const,
    policyInputHash: `sha256:${"3".repeat(64)}` as const,
    authorizer: parseCanonicalEvmAddress(account.address),
    chainId: trustedDeployment.chainId,
    vaultAddress: trustedDeployment.vaultAddress,
    recipientAddress: parseCanonicalEvmAddress(
      "0x2222222222222222222222222222222222222222",
    ),
    usdcTokenAddress: trustedDeployment.usdcTokenAddress,
    amountBaseUnits: 25_000_000n,
    issuedAt: new Date(now - 60_000).toISOString(),
    expiresAt: new Date(now + 30 * 60_000).toISOString(),
    createdAt: new Date(now - 120_000).toISOString(),
  };
  await createPaymentWorkflow(repository, {
    ...common,
    id: "api-review-approve",
    idempotencyKey: "11111111-1111-4111-8111-111111111111",
    paymentReference: "api-review-approve",
    nonce: "api-review-approve",
  });
  await createPaymentWorkflow(repository, {
    ...common,
    id: "api-review-reject",
    idempotencyKey: "22222222-2222-4222-8222-222222222222",
    paymentReference: "api-review-reject",
    nonce: "api-review-reject",
  });

  const operatorId = "configured-local-operator";
  const server = createPaymentWorkflowServer({
    repository,
    operatorToken: token,
    operatorId,
    approverAddress: account.address as Address,
    trustedDeployment,
    receiptSigner: {
      async signAuthorizationReceipt({ receipt }) {
        return signCanonicalAuthorizationReceipt(receipt, account);
      },
    },
    executeWorkflow: async (id) => {
      const workflow = await repository.get(id);
      if (!workflow) throw new Error("not found");
      return workflow;
    },
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No test port.");
    const origin = `http://127.0.0.1:${address.port}`;
    const headers = {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    };

    const unauthenticated = await fetch(
      `${origin}/api/v1/workflows/api-review-approve/approve`,
      { method: "POST", body: "{}" },
    );
    assert.equal(unauthenticated.status, 401);

    const approved = await fetch(
      `${origin}/api/v1/workflows/api-review-approve/approve`,
      { method: "POST", headers },
    );
    assert.equal(approved.status, 200);
    const approvalWorkflow = await repository.get("api-review-approve");
    assert.equal(approvalWorkflow?.state, "HUMAN_APPROVED");
    assert.equal(approvalWorkflow?.approval?.approverId, operatorId);
    assert.match(approvalWorkflow?.approval?.approvalId ?? "", /^sha256:[a-f0-9]{64}$/);

    const rejected = await fetch(
      `${origin}/api/v1/workflows/api-review-reject/reject`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          approverId: "forged-browser-user",
          approvalId: "forged-browser-approval",
        }),
      },
    );
    assert.equal(rejected.status, 200);
    const rejectionWorkflow = await repository.get("api-review-reject");
    assert.equal(rejectionWorkflow?.state, "BLOCKED");
    assert.equal(rejectionWorkflow?.approval?.approverId, operatorId);
    assert.notEqual(rejectionWorkflow?.approval?.approvalId, "forged-browser-approval");
    const events = await repository.listAuditEvents("api-review-reject");
    assert.equal(events.at(-1)?.payload.approverId, operatorId);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    repository.close();
  }
});

test("rejects an invalid configured local operator identity during server creation", () => {
  const repository = new SqlitePaymentWorkflowRepository(":memory:");
  try {
    assert.throws(
      () =>
        createPaymentWorkflowServer({
          repository,
          operatorToken: token,
          operatorId: "not a stable id with spaces",
          approverAddress: account.address as Address,
          trustedDeployment,
          receiptSigner: {
            async signAuthorizationReceipt() {
              throw new Error("not used");
            },
          },
          executeWorkflow: async () => {
            throw new Error("not used");
          },
        }),
      /Configured local operator ID/,
    );
  } finally {
    repository.close();
  }
});
