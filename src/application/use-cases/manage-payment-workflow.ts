import type {
  PaymentWorkflow,
  PaymentWorkflowAuditEvent,
  PaymentWorkflowRepositoryPort,
} from "../ports/payment-workflow.repository.port.js";
import type { AuthorizationReceiptSignerPort } from "../ports/authorization-receipt-signer.port.js";
import {
  createCanonicalAuthorizationReceipt,
  generateAuthorizationReceiptHash,
  generateAuthorizationReplayKey,
  type CanonicalAuthorizationReceipt,
} from "../../domain/payments/canonical-authorization-receipt.js";
import {
  createManualApproval,
  generateManualApprovalHash,
  type ManualApprovalDecision,
} from "../../domain/payments/manual-approval.js";
import {
  initialPaymentLifecycleState,
  transitionPaymentLifecycle,
} from "../../domain/payments/payment-lifecycle.js";
import type { PaymentDecision } from "../../domain/policies/payment-policy.js";
import type { CanonicalEvmAddress } from "../../domain/shared/canonical-evm-address.js";
import {
  requireCanonicalInstant,
  requireSha256Hash,
  requireStableIdentifier,
  sha256CanonicalRecord,
  type Sha256Hash,
} from "../../domain/shared/canonical-record.js";
import {
  verifyCanonicalAuthorizationReceipt,
  type AuthorizationReceiptVerificationResult,
} from "../../infrastructure/arc/authorization-receipt-signature.js";
import { canonicalEvmAddressesEqual } from "../../shared/validation/evm.js";
import {
  assertTrustedPaymentDeploymentContext,
  type TrustedPaymentDeploymentContext,
} from "../trusted-payment-deployment-context.js";

export type CreatePaymentWorkflowInput = Readonly<{
  id: string;
  idempotencyKey: string;
  decision: PaymentDecision;
  decisionHash: Sha256Hash;
  policyDefinitionHash: Sha256Hash;
  policyInputHash: Sha256Hash;
  authorizer: CanonicalEvmAddress;
  chainId: bigint;
  vaultAddress: CanonicalEvmAddress;
  recipientAddress: CanonicalEvmAddress;
  usdcTokenAddress: CanonicalEvmAddress;
  amountBaseUnits: bigint;
  paymentReference: string;
  nonce: string;
  issuedAt: string;
  expiresAt: string;
  createdAt: string;
}>;

function event(
  workflow: PaymentWorkflow,
  eventType: string,
  occurredAt: string,
  payload: Readonly<Record<string, string | boolean | null>> = {},
): PaymentWorkflowAuditEvent {
  return Object.freeze({
    workflowId: workflow.id,
    sequence: workflow.version,
    eventType,
    occurredAt,
    payload: Object.freeze(payload),
  });
}

function nextVersion(
  workflow: PaymentWorkflow,
  changes: Partial<PaymentWorkflow>,
  updatedAt: string,
): PaymentWorkflow {
  return Object.freeze({
    ...workflow,
    ...changes,
    version: workflow.version + 1,
    updatedAt,
  });
}

export async function createPaymentWorkflow(
  repository: PaymentWorkflowRepositoryPort,
  input: CreatePaymentWorkflowInput,
): Promise<PaymentWorkflow> {
  const createdAt = requireCanonicalInstant(input.createdAt, "Workflow creation time");
  const issuedAt = requireCanonicalInstant(input.issuedAt, "Authorization issue time");
  const expiresAt = requireCanonicalInstant(input.expiresAt, "Authorization expiry time");
  if (input.chainId <= 0n || input.amountBaseUnits <= 0n) {
    throw new Error("Workflow chain and amount must be positive.");
  }
  if (Date.parse(expiresAt) <= Date.parse(issuedAt)) {
    throw new Error("Workflow authorization expiry must follow its issue time.");
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.idempotencyKey)) {
    throw new Error("Workflow idempotency key must be a UUID.");
  }
  const workflow: PaymentWorkflow = Object.freeze({
    id: requireStableIdentifier(input.id, "Workflow ID"),
    idempotencyKey: input.idempotencyKey,
    version: 1,
    state: initialPaymentLifecycleState(input.decision),
    decision: input.decision,
    decisionHash: requireSha256Hash(input.decisionHash, "Decision hash"),
    policyDefinitionHash: requireSha256Hash(
      input.policyDefinitionHash,
      "Policy-definition hash",
    ),
    policyInputHash: requireSha256Hash(input.policyInputHash, "Policy-input hash"),
    authorizer: input.authorizer,
    chainId: input.chainId,
    vaultAddress: input.vaultAddress,
    recipientAddress: input.recipientAddress,
    usdcTokenAddress: input.usdcTokenAddress,
    amountBaseUnits: input.amountBaseUnits,
    paymentReference: requireStableIdentifier(
      input.paymentReference,
      "Payment reference",
    ),
    nonce: requireStableIdentifier(input.nonce, "Authorization nonce"),
    issuedAt,
    expiresAt,
    approval: null,
    receipt: null,
    receiptSignature: null,
    receiptHash: null,
    replayKey: null,
    vaultAuthorization: null,
    vaultSignature: null,
    preparedCall: null,
    submission: null,
    settlement: null,
    failureReason: null,
    createdAt,
    updatedAt: createdAt,
  });

  await repository.create(
    workflow,
    event(workflow, "WORKFLOW_CREATED", createdAt, {
      decision: workflow.decision,
      state: workflow.state,
    }),
  );
  return workflow;
}

export async function decideManualApproval(
  repository: PaymentWorkflowRepositoryPort,
  input: {
    workflowId: string;
    operatorId: string;
    approverAddress: CanonicalEvmAddress;
    decision: ManualApprovalDecision;
    decidedAt: string;
  },
): Promise<PaymentWorkflow> {
  const workflow = await requireWorkflow(repository, input.workflowId);
  if (!canonicalEvmAddressesEqual(input.approverAddress, workflow.authorizer)) {
    throw new Error("The approver must be the canonical payment authorizer.");
  }
  const decidedAt = requireCanonicalInstant(input.decidedAt, "Approval time");
  const operatorId = requireStableIdentifier(
    input.operatorId,
    "Configured local operator ID",
  );
  const approval = createManualApproval({
    approvalId: sha256CanonicalRecord("attestpay.manual-approval-id.v1", [
      ["workflowId", workflow.id],
      ["workflowVersion", workflow.version.toString(10)],
      ["operatorId", operatorId],
      ["decision", input.decision],
    ]),
    paymentReference: workflow.paymentReference,
    decisionHash: workflow.decisionHash,
    approverId: operatorId,
    approverAddress: input.approverAddress,
    decision: input.decision,
    chainId: workflow.chainId,
    vaultAddress: workflow.vaultAddress,
    recipientAddress: workflow.recipientAddress,
    usdcTokenAddress: workflow.usdcTokenAddress,
    amountBaseUnits: workflow.amountBaseUnits,
    decidedAt,
  });
  const lifecycleEvent = input.decision === "APPROVED" ? "HUMAN_APPROVE" : "HUMAN_REJECT";
  const updated = nextVersion(
    workflow,
    {
      state: transitionPaymentLifecycle(workflow.state, lifecycleEvent),
      approval,
    },
    decidedAt,
  );
  const saved = await repository.save(
    updated,
    workflow.version,
    event(updated, `MANUAL_${input.decision}`, decidedAt, {
      approvalHash: generateManualApprovalHash(approval),
      approverId: approval.approverId,
    }),
  );
  if (!saved) throw new Error("Payment workflow changed during manual approval.");
  return updated;
}

export function buildAuthorizationReceiptForWorkflow(
  workflow: PaymentWorkflow,
): CanonicalAuthorizationReceipt {
  if (workflow.state !== "AUTO_APPROVED" && workflow.state !== "HUMAN_APPROVED") {
    throw new Error(`Workflow ${workflow.id} is not eligible for authorization.`);
  }
  return createCanonicalAuthorizationReceipt({
    decisionHash: workflow.decisionHash,
    policyDefinitionHash: workflow.policyDefinitionHash,
    policyInputHash: workflow.policyInputHash,
    authorizationOutcome:
      workflow.state === "AUTO_APPROVED" ? "AUTO_APPROVED" : "HUMAN_APPROVED",
    authorizer: workflow.authorizer,
    chainId: workflow.chainId,
    vaultAddress: workflow.vaultAddress,
    recipientAddress: workflow.recipientAddress,
    usdcTokenAddress: workflow.usdcTokenAddress,
    amountBaseUnits: workflow.amountBaseUnits,
    paymentReference: workflow.paymentReference,
    nonce: workflow.nonce,
    issuedAt: workflow.issuedAt,
    expiresAt: workflow.expiresAt,
  });
}

export async function authorizePaymentWorkflow(
  repository: PaymentWorkflowRepositoryPort,
  trustedDeployment: TrustedPaymentDeploymentContext,
  input: {
    workflowId: string;
    receipt: CanonicalAuthorizationReceipt;
    signature: string;
    verifiedAt: string;
  },
): Promise<AuthorizationReceiptVerificationResult> {
  const workflow = await requireWorkflow(repository, input.workflowId);
  assertTrustedPaymentDeploymentContext(workflow, trustedDeployment);
  assertTrustedPaymentDeploymentContext(input.receipt, trustedDeployment);
  const expectedReceipt = buildAuthorizationReceiptForWorkflow(workflow);
  if (
    generateAuthorizationReceiptHash(input.receipt) !==
    generateAuthorizationReceiptHash(expectedReceipt)
  ) {
    return { valid: false, code: "CONTEXT_MISMATCH", field: "decisionHash" };
  }
  const receiptHash = generateAuthorizationReceiptHash(input.receipt);
  const replayKey = generateAuthorizationReplayKey(input.receipt);
  const occurredAt = requireCanonicalInstant(input.verifiedAt, "Verification time");
  const authorized = nextVersion(
    workflow,
    {
      state: transitionPaymentLifecycle(workflow.state, "VERIFY_AUTHORIZATION"),
      receipt: input.receipt,
      receiptSignature: input.signature as `0x${string}`,
      receiptHash,
      replayKey,
    },
    occurredAt,
  );

  return verifyCanonicalAuthorizationReceipt({
    receipt: input.receipt,
    signature: input.signature,
    expected: {
      decisionHash: workflow.decisionHash,
      policyDefinitionHash: workflow.policyDefinitionHash,
      policyInputHash: workflow.policyInputHash,
      authorizationOutcome: expectedReceipt.authorizationOutcome,
      expectedAuthorizer: workflow.authorizer,
      chainId: trustedDeployment.chainId,
      vaultAddress: trustedDeployment.vaultAddress,
      recipientAddress: workflow.recipientAddress,
      usdcTokenAddress: trustedDeployment.usdcTokenAddress,
      amountBaseUnits: workflow.amountBaseUnits,
      paymentReference: workflow.paymentReference,
      nonce: workflow.nonce,
    },
    verifiedAt: occurredAt,
    replayProtection: {
      consume: async (consumption) => {
        if (
          consumption.receiptHash !== receiptHash ||
          consumption.replayKey !== replayKey
        ) {
          return false;
        }
        return repository.authorizeAtomically({
          workflow: authorized,
          expectedVersion: workflow.version,
          replayKey,
          receiptHash,
          event: event(authorized, "AUTHORIZATION_VERIFIED", occurredAt, {
            receiptHash,
            replayKey,
          }),
        });
      },
    },
  });
}

export async function signAndAuthorizePaymentWorkflow(
  repository: PaymentWorkflowRepositoryPort,
  signer: AuthorizationReceiptSignerPort,
  trustedDeployment: TrustedPaymentDeploymentContext,
  input: { workflowId: string; verifiedAt: string },
): Promise<AuthorizationReceiptVerificationResult> {
  const workflow = await requireWorkflow(repository, input.workflowId);
  assertTrustedPaymentDeploymentContext(workflow, trustedDeployment);
  const receipt = buildAuthorizationReceiptForWorkflow(workflow);
  assertTrustedPaymentDeploymentContext(receipt, trustedDeployment);
  const signature = await signer.signAuthorizationReceipt({
    receipt,
    explanation: `Authorize AttestPay payment ${workflow.paymentReference}`,
  });
  return authorizePaymentWorkflow(repository, trustedDeployment, {
    workflowId: workflow.id,
    receipt,
    signature,
    verifiedAt: input.verifiedAt,
  });
}

export async function requireWorkflow(
  repository: PaymentWorkflowRepositoryPort,
  id: string,
): Promise<PaymentWorkflow> {
  const workflow = await repository.get(id);
  if (!workflow) throw new Error(`Payment workflow ${id} was not found.`);
  return workflow;
}
