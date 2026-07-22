import type { PaymentAuthorizationSignerPort } from "../ports/payment-authorization-signer.port.js";
import type {
  PaymentWorkflow,
  PaymentWorkflowAuditEvent,
  PaymentWorkflowRepositoryPort,
} from "../ports/payment-workflow.repository.port.js";
import type {
  SettlementVerifierPort,
  VaultPaymentSettlementEvidence,
  VerifyVaultPaymentSettlement,
} from "../ports/settlement-verifier.port.js";
import type { TreasuryPaymentPort } from "../ports/treasury-payment.port.js";
import type { VaultReaderPort } from "../ports/vault-reader.port.js";
import {
  assertTrustedPaymentDeploymentContext,
  type TrustedPaymentDeploymentContext,
} from "../trusted-payment-deployment-context.js";
import {
  generateAuthorizationReceiptHash,
  generateAuthorizationReplayKey,
} from "../../domain/payments/canonical-authorization-receipt.js";
import { transitionPaymentLifecycle } from "../../domain/payments/payment-lifecycle.js";
import { formatUsdcAmount } from "../../domain/payments/usdc-amount.js";
import type { VaultPaymentAuthorization } from "../../domain/payments/vault-payment-authorization.js";
import { requireCanonicalInstant } from "../../domain/shared/canonical-record.js";
import { ARC_MEMO_ADDRESS } from "../../infrastructure/arc/arc-memo.js";
import { prepareArcVaultPayment } from "../../infrastructure/arc/attestpay-vault.js";
import { createVaultPaymentAuthorizationFromReceipt } from "../../infrastructure/arc/create-vault-payment-authorization-from-receipt.js";
import { canonicalEvmAddressesEqual } from "../../shared/validation/evm.js";
import { assertVaultCanPay } from "./assert-vault-can-pay.js";
import { requireWorkflow } from "./manage-payment-workflow.js";
import { submitArcContractCall } from "./submit-arc-contract-call.js";

const RECONCILIATION_ERROR =
  "Settlement reconciliation could not be completed; workflow remains SUBMITTED for retry.";

function audit(
  workflow: PaymentWorkflow,
  eventType: string,
  occurredAt: string,
  payload: Readonly<Record<string, string | boolean | null>> = {},
): PaymentWorkflowAuditEvent {
  return {
    workflowId: workflow.id,
    sequence: workflow.version,
    eventType,
    occurredAt,
    payload,
  };
}

function update(
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

async function saveOrConflict(
  repository: PaymentWorkflowRepositoryPort,
  previous: PaymentWorkflow,
  next: PaymentWorkflow,
  event: PaymentWorkflowAuditEvent,
): Promise<void> {
  if (!(await repository.save(next, previous.version, event))) {
    throw new Error("Payment workflow changed during execution or reconciliation.");
  }
}

function sameHex(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function vaultAuthorizationsEqual(
  left: VaultPaymentAuthorization,
  right: VaultPaymentAuthorization,
): boolean {
  return (
    sameHex(left.paymentId, right.paymentId) &&
    canonicalEvmAddressesEqual(left.recipient, right.recipient) &&
    left.amount === right.amount &&
    sameHex(left.invoiceHash, right.invoiceHash) &&
    sameHex(left.policyHash, right.policyHash) &&
    left.validAfter === right.validAfter &&
    left.deadline === right.deadline &&
    canonicalEvmAddressesEqual(left.authorizer, right.authorizer)
  );
}

function assertPersistedAuthorizationEvidence(
  workflow: PaymentWorkflow,
  trustedDeployment: TrustedPaymentDeploymentContext,
): VaultPaymentAuthorization {
  assertTrustedPaymentDeploymentContext(workflow, trustedDeployment);
  if (
    !workflow.receipt ||
    !workflow.receiptSignature ||
    !workflow.receiptHash ||
    !workflow.replayKey
  ) {
    throw new Error("Workflow is missing persisted authorization evidence.");
  }
  assertTrustedPaymentDeploymentContext(workflow.receipt, trustedDeployment);
  if (
    generateAuthorizationReceiptHash(workflow.receipt) !== workflow.receiptHash ||
    generateAuthorizationReplayKey(workflow.receipt) !== workflow.replayKey
  ) {
    throw new Error("Persisted receipt hash or replay key does not match the receipt.");
  }

  const receipt = workflow.receipt;
  const expectedOutcome =
    workflow.decision === "AUTO_APPROVED" ? "AUTO_APPROVED" : "HUMAN_APPROVED";
  if (
    receipt.decisionHash !== workflow.decisionHash ||
    receipt.policyDefinitionHash !== workflow.policyDefinitionHash ||
    receipt.policyInputHash !== workflow.policyInputHash ||
    receipt.authorizationOutcome !== expectedOutcome ||
    !canonicalEvmAddressesEqual(receipt.authorizer, workflow.authorizer) ||
    !canonicalEvmAddressesEqual(receipt.recipientAddress, workflow.recipientAddress) ||
    receipt.amountBaseUnits !== workflow.amountBaseUnits ||
    receipt.paymentReference !== workflow.paymentReference ||
    receipt.nonce !== workflow.nonce ||
    receipt.issuedAt !== workflow.issuedAt ||
    receipt.expiresAt !== workflow.expiresAt ||
    (receipt.authorizationOutcome === "HUMAN_APPROVED" &&
      workflow.approval?.decision !== "APPROVED")
  ) {
    throw new Error("Persisted authorization receipt does not match the workflow.");
  }

  const expectedAuthorization = createVaultPaymentAuthorizationFromReceipt(receipt);
  if (
    workflow.vaultAuthorization &&
    !vaultAuthorizationsEqual(workflow.vaultAuthorization, expectedAuthorization)
  ) {
    throw new Error("Persisted vault authorization does not match the receipt.");
  }
  return workflow.vaultAuthorization ?? expectedAuthorization;
}

function requireSubmittedEvidence(
  workflow: PaymentWorkflow,
  trustedDeployment: TrustedPaymentDeploymentContext,
  executorAddress: `0x${string}`,
): {
  authorization: VaultPaymentAuthorization;
  expectedSettlement: VerifyVaultPaymentSettlement;
} {
  const authorization = assertPersistedAuthorizationEvidence(
    workflow,
    trustedDeployment,
  );
  if (
    !workflow.vaultAuthorization ||
    !workflow.vaultSignature ||
    !workflow.preparedCall ||
    !workflow.submission?.transactionId ||
    !workflow.submission.transactionHash
  ) {
    throw new Error("SUBMITTED workflow is missing required persisted evidence.");
  }
  if (!sameHex(workflow.preparedCall.contractAddress, ARC_MEMO_ADDRESS)) {
    throw new Error("Persisted prepared call does not target the Arc memo contract.");
  }

  return {
    authorization,
    expectedSettlement: {
      transactionHash: workflow.submission.transactionHash,
      recipientAddress: workflow.recipientAddress,
      amount: formatUsdcAmount(workflow.amountBaseUnits),
      memoId: workflow.preparedCall.memoId,
      memoData: workflow.preparedCall.memoData,
      transferCallDataHash: workflow.preparedCall.vaultCallDataHash,
      vaultAddress: trustedDeployment.vaultAddress,
      executorAddress,
      authorizerAddress: workflow.authorizer,
      paymentId: authorization.paymentId,
      invoiceHash: authorization.invoiceHash,
      policyHash: authorization.policyHash,
    },
  };
}

function assertReturnedSettlementEvidence(
  evidence: VaultPaymentSettlementEvidence,
  expected: VerifyVaultPaymentSettlement,
): void {
  if (
    !sameHex(evidence.transactionHash, expected.transactionHash) ||
    !canonicalEvmAddressesEqual(evidence.senderAddress, expected.vaultAddress) ||
    !canonicalEvmAddressesEqual(
      evidence.recipientAddress,
      expected.recipientAddress,
    ) ||
    evidence.amount !== expected.amount ||
    !sameHex(evidence.memoId, expected.memoId) ||
    !sameHex(evidence.paymentId, expected.paymentId)
  ) {
    throw new Error("Settlement verifier returned evidence for a different payment.");
  }
}

async function verifyAndSettle(
  repository: PaymentWorkflowRepositoryPort,
  settlementVerifier: SettlementVerifierPort,
  workflow: PaymentWorkflow,
  trustedDeployment: TrustedPaymentDeploymentContext,
  executorAddress: `0x${string}`,
  occurredAt: string,
): Promise<PaymentWorkflow> {
  const { expectedSettlement } = requireSubmittedEvidence(
    workflow,
    trustedDeployment,
    executorAddress,
  );

  let evidence: VaultPaymentSettlementEvidence;
  try {
    evidence = await settlementVerifier.verifyVaultPaymentSettlement(
      expectedSettlement,
    );
    assertReturnedSettlementEvidence(evidence, expectedSettlement);
  } catch {
    throw new Error(RECONCILIATION_ERROR);
  }

  const settled = update(
    workflow,
    {
      state: transitionPaymentLifecycle(workflow.state, "CONFIRM_SETTLEMENT"),
      settlement: evidence,
      failureReason: null,
    },
    occurredAt,
  );
  await saveOrConflict(
    repository,
    workflow,
    settled,
    audit(settled, "SETTLEMENT_VERIFIED", occurredAt, {
      transactionHash: evidence.transactionHash,
      paymentId: evidence.paymentId,
      blockNumber: evidence.blockNumber,
    }),
  );
  return settled;
}

export async function executeAuthorizedPayment(input: {
  workflowId: string;
  repository: PaymentWorkflowRepositoryPort;
  trustedDeployment: TrustedPaymentDeploymentContext;
  vaultReader: VaultReaderPort;
  vaultSigner: PaymentAuthorizationSignerPort;
  payments: TreasuryPaymentPort;
  settlementVerifier: SettlementVerifierPort;
  executorAddress: `0x${string}`;
  occurredAt: string;
  waitSignal: AbortSignal;
}): Promise<PaymentWorkflow> {
  const occurredAt = requireCanonicalInstant(input.occurredAt, "Execution time");
  let workflow = await requireWorkflow(input.repository, input.workflowId);

  if (workflow.state === "SUBMITTED") {
    return verifyAndSettle(
      input.repository,
      input.settlementVerifier,
      workflow,
      input.trustedDeployment,
      input.executorAddress,
      occurredAt,
    );
  }
  if (workflow.state !== "AUTHORIZED") {
    throw new Error("Only AUTHORIZED or SUBMITTED workflows can execute.");
  }

  assertPersistedAuthorizationEvidence(workflow, input.trustedDeployment);
  assertTrustedPaymentDeploymentContext(workflow, input.trustedDeployment);
  assertTrustedPaymentDeploymentContext(
    workflow.receipt!,
    input.trustedDeployment,
  );
  const authorization = createVaultPaymentAuthorizationFromReceipt(
    workflow.receipt!,
  );
  await assertVaultCanPay(
    input.vaultReader,
    input.trustedDeployment.vaultAddress,
    authorization,
    Math.floor(Date.parse(occurredAt) / 1_000),
  );

  assertTrustedPaymentDeploymentContext(workflow, input.trustedDeployment);
  assertTrustedPaymentDeploymentContext(
    workflow.receipt!,
    input.trustedDeployment,
  );
  const vaultSignature = await input.vaultSigner.signVaultPaymentAuthorization({
    vaultAddress: input.trustedDeployment.vaultAddress,
    authorization,
    explanation: `AttestPay authorized payment ${workflow.paymentReference}`,
  });

  assertTrustedPaymentDeploymentContext(workflow, input.trustedDeployment);
  assertTrustedPaymentDeploymentContext(
    workflow.receipt!,
    input.trustedDeployment,
  );
  const prepared = prepareArcVaultPayment({
    vaultAddress: input.trustedDeployment.vaultAddress,
    authorization,
    signature: vaultSignature,
    authorizationReference: workflow.paymentReference,
  });
  const preparedWorkflow = update(
    workflow,
    {
      vaultAuthorization: authorization,
      vaultSignature,
      preparedCall: {
        contractAddress: ARC_MEMO_ADDRESS,
        contractCallData: prepared.contractCallData,
        memoId: prepared.memoId,
        memoData: prepared.memoData,
        vaultCallDataHash: prepared.vaultCallDataHash,
      },
    },
    occurredAt,
  );
  await saveOrConflict(
    input.repository,
    workflow,
    preparedWorkflow,
    audit(preparedWorkflow, "PAYMENT_PREPARED", occurredAt, {
      paymentId: authorization.paymentId,
      receiptHash: workflow.receiptHash,
    }),
  );
  workflow = preparedWorkflow;

  assertPersistedAuthorizationEvidence(workflow, input.trustedDeployment);
  assertTrustedPaymentDeploymentContext(workflow, input.trustedDeployment);
  const submission = await submitArcContractCall(input.payments, {
    idempotencyKey: workflow.idempotencyKey,
    contractAddress: workflow.preparedCall!.contractAddress,
    callData: workflow.preparedCall!.contractCallData,
    reference: `attestpay:workflow:${workflow.id}`,
  });
  const status = await input.payments.waitForTransactionHash(
    submission.transactionId,
    input.waitSignal,
  );
  const submitted = update(
    workflow,
    {
      state: transitionPaymentLifecycle(workflow.state, "SUBMIT_PAYMENT"),
      submission: status,
    },
    occurredAt,
  );
  await saveOrConflict(
    input.repository,
    workflow,
    submitted,
    audit(submitted, "PAYMENT_SUBMITTED", occurredAt, {
      transactionId: status.transactionId,
      transactionHash: status.transactionHash,
      providerState: status.state,
    }),
  );
  workflow = submitted;

  if (!status.transactionHash) {
    return failWorkflow(input.repository, workflow, occurredAt);
  }
  return verifyAndSettle(
    input.repository,
    input.settlementVerifier,
    workflow,
    input.trustedDeployment,
    input.executorAddress,
    occurredAt,
  );
}

async function failWorkflow(
  repository: PaymentWorkflowRepositoryPort,
  workflow: PaymentWorkflow,
  occurredAt: string,
): Promise<PaymentWorkflow> {
  const failed = update(
    workflow,
    {
      state: transitionPaymentLifecycle(workflow.state, "FAIL_PAYMENT"),
      failureReason: "Payment provider returned no transaction hash.",
    },
    occurredAt,
  );
  await saveOrConflict(
    repository,
    workflow,
    failed,
    audit(failed, "PAYMENT_FAILED", occurredAt, { reason: failed.failureReason }),
  );
  return failed;
}
