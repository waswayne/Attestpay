import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { isHex } from "viem";
import { z } from "zod";
import type {
  TreasuryPaymentStatus,
  TreasuryPaymentSubmission,
} from "../../application/ports/treasury-payment.port.js";
import type {
  VaultPaymentSettlementEvidence,
  VaultRecipientApprovalEvidence,
} from "../../application/ports/settlement-verifier.port.js";
import { AUTHORIZATION_REFERENCE_PATTERN } from "../../domain/payments/authorization-reference.js";
import {
  createVaultPaymentAuthorization,
  type VaultPaymentAuthorization,
} from "../../domain/payments/vault-payment-authorization.js";
import { evmAddressSchema, transactionHashSchema } from "../../shared/validation/evm.js";

const stateDirectory = new URL("../../../local-state/vault-operations/", import.meta.url);
const operationIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/);
const referenceSchema = z.string().regex(AUTHORIZATION_REFERENCE_PATTERN);
const hexBytesSchema = z
  .string()
  .refine(isHex)
  .transform((value) => value as `0x${string}`);

const baseSchema = z.object({
  operationId: operationIdSchema,
  idempotencyKey: z.string().uuid(),
  vaultAddress: evmAddressSchema,
  transactionId: z.string().uuid().optional(),
  state: z.string().optional(),
  transactionHash: transactionHashSchema.optional(),
  settlementBlockNumber: z.string().regex(/^\d+$/).optional(),
  memoId: transactionHashSchema.optional(),
  memoData: hexBytesSchema.optional(),
  vaultCallDataHash: transactionHashSchema.optional(),
  memoIndex: z.string().regex(/^\d+$/).optional(),
  memoLogIndex: z.number().int().nonnegative().optional(),
});

const approvalAttemptSchema = baseSchema.extend({
  kind: z.literal("RECIPIENT_APPROVAL"),
  recipientAddress: evmAddressSchema,
  approved: z.boolean(),
  authorizationReference: referenceSchema,
  memoId: transactionHashSchema,
  memoData: hexBytesSchema,
  vaultCallDataHash: transactionHashSchema,
  approvalLogIndex: z.number().int().nonnegative().optional(),
});

const paymentAttemptSchema = baseSchema.extend({
  kind: z.literal("PAYMENT"),
  recipientAddress: evmAddressSchema,
  authorizerAddress: evmAddressSchema,
  amount: z.string(),
  invoiceReference: referenceSchema,
  policyReference: referenceSchema,
  authorizationReference: referenceSchema,
  paymentId: transactionHashSchema,
  authorizationAmount: z.string().regex(/^\d+$/),
  invoiceHash: transactionHashSchema,
  policyHash: transactionHashSchema,
  validAfter: z.number().int().positive(),
  deadline: z.number().int().positive(),
  signature: hexBytesSchema.optional(),
  transferLogIndex: z.number().int().nonnegative().optional(),
  paymentEventLogIndex: z.number().int().nonnegative().optional(),
});

const attemptSchema = z.discriminatedUnion("kind", [
  approvalAttemptSchema,
  paymentAttemptSchema,
]);

export type VaultApprovalAttempt = Readonly<z.infer<typeof approvalAttemptSchema>>;
export type VaultPaymentAttempt = Readonly<z.infer<typeof paymentAttemptSchema>>;
export type VaultOperationAttempt = VaultApprovalAttempt | VaultPaymentAttempt;

function attemptFile(operationId: string): URL {
  return new URL(`${operationIdSchema.parse(operationId)}.json`, stateDirectory);
}

async function saveAttempt(attempt: VaultOperationAttempt): Promise<void> {
  await writeFile(
    attemptFile(attempt.operationId),
    `${JSON.stringify(attempt, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
}

async function createOrRead(
  proposed: VaultOperationAttempt,
): Promise<VaultOperationAttempt> {
  await mkdir(stateDirectory, { recursive: true });
  try {
    await writeFile(
      attemptFile(proposed.operationId),
      `${JSON.stringify(proposed, null, 2)}\n`,
      { encoding: "utf8", mode: 0o600, flag: "wx" },
    );
    return Object.freeze(proposed);
  } catch (error: unknown) {
    if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) {
      throw error;
    }
  }

  const stored = JSON.parse(await readFile(attemptFile(proposed.operationId), "utf8"));
  return Object.freeze(attemptSchema.parse(stored));
}

export async function loadOrCreateVaultApprovalAttempt(input: {
  operationId: string;
  vaultAddress: `0x${string}`;
  recipientAddress: `0x${string}`;
  approved: boolean;
  authorizationReference: string;
  memoId: `0x${string}`;
  memoData: `0x${string}`;
  vaultCallDataHash: `0x${string}`;
}): Promise<VaultApprovalAttempt> {
  const proposed = approvalAttemptSchema.parse({
    ...input,
    kind: "RECIPIENT_APPROVAL",
    idempotencyKey: randomUUID(),
  });
  const existing = await createOrRead(proposed);
  if (
    existing.kind !== "RECIPIENT_APPROVAL" ||
    existing.vaultAddress.toLowerCase() !== input.vaultAddress.toLowerCase() ||
    existing.recipientAddress.toLowerCase() !==
      input.recipientAddress.toLowerCase() ||
    existing.approved !== input.approved ||
    existing.authorizationReference !== input.authorizationReference ||
    existing.vaultCallDataHash.toLowerCase() !==
      input.vaultCallDataHash.toLowerCase()
  ) {
    throw new Error("This operation ID is bound to a different vault operation.");
  }
  return existing;
}

export async function loadOrCreateVaultPaymentAttempt(input: {
  operationId: string;
  vaultAddress: `0x${string}`;
  recipientAddress: `0x${string}`;
  authorizerAddress: `0x${string}`;
  amount: string;
  amountAtomic: bigint;
  invoiceReference: string;
  policyReference: string;
  authorizationReference: string;
}): Promise<VaultPaymentAttempt> {
  const authorization = createVaultPaymentAuthorization({
    vaultAddress: input.vaultAddress,
    operationId: input.operationId,
    recipient: input.recipientAddress,
    amount: input.amountAtomic,
    invoiceReference: input.invoiceReference,
    policyReference: input.policyReference,
    authorizer: input.authorizerAddress,
    issuedAt: Math.floor(Date.now() / 1_000),
  });
  const proposed = paymentAttemptSchema.parse({
    ...input,
    kind: "PAYMENT",
    idempotencyKey: randomUUID(),
    paymentId: authorization.paymentId,
    authorizationAmount: authorization.amount.toString(),
    invoiceHash: authorization.invoiceHash,
    policyHash: authorization.policyHash,
    validAfter: authorization.validAfter,
    deadline: authorization.deadline,
  });
  const existing = await createOrRead(proposed);
  if (
    existing.kind !== "PAYMENT" ||
    existing.vaultAddress.toLowerCase() !== input.vaultAddress.toLowerCase() ||
    existing.recipientAddress.toLowerCase() !==
      input.recipientAddress.toLowerCase() ||
    existing.authorizerAddress.toLowerCase() !==
      input.authorizerAddress.toLowerCase() ||
    existing.amount !== input.amount ||
    existing.invoiceReference !== input.invoiceReference ||
    existing.policyReference !== input.policyReference ||
    existing.authorizationReference !== input.authorizationReference
  ) {
    throw new Error("This operation ID is bound to a different vault payment.");
  }
  return existing;
}

export function authorizationFromAttempt(
  attempt: VaultPaymentAttempt,
): VaultPaymentAuthorization {
  return Object.freeze({
    paymentId: attempt.paymentId,
    recipient: attempt.recipientAddress,
    amount: BigInt(attempt.authorizationAmount),
    invoiceHash: attempt.invoiceHash,
    policyHash: attempt.policyHash,
    validAfter: attempt.validAfter,
    deadline: attempt.deadline,
    authorizer: attempt.authorizerAddress,
  });
}

export async function recordVaultPaymentSignature(
  attempt: VaultPaymentAttempt,
  signature: `0x${string}`,
  memo: {
    memoId: `0x${string}`;
    memoData: `0x${string}`;
    vaultCallDataHash: `0x${string}`;
  },
): Promise<VaultPaymentAttempt> {
  const updated = paymentAttemptSchema.parse({ ...attempt, ...memo, signature });
  await saveAttempt(updated);
  return Object.freeze(updated);
}

export async function recordVaultOperationSubmission<T extends VaultOperationAttempt>(
  attempt: T,
  submission: TreasuryPaymentSubmission,
): Promise<T> {
  const updated = attemptSchema.parse({
    ...attempt,
    transactionId: submission.transactionId,
    state: submission.state,
  }) as T;
  await saveAttempt(updated);
  return Object.freeze(updated);
}

export async function recordVaultOperationStatus<T extends VaultOperationAttempt>(
  attempt: T,
  status: TreasuryPaymentStatus,
): Promise<T> {
  const updated = attemptSchema.parse({
    ...attempt,
    transactionId: status.transactionId,
    state: status.state,
    ...(status.transactionHash ? { transactionHash: status.transactionHash } : {}),
  }) as T;
  await saveAttempt(updated);
  return Object.freeze(updated);
}

export async function recordVaultApprovalSettlement(
  attempt: VaultApprovalAttempt,
  evidence: VaultRecipientApprovalEvidence,
): Promise<VaultApprovalAttempt> {
  const updated = approvalAttemptSchema.parse({
    ...attempt,
    transactionHash: evidence.transactionHash,
    settlementBlockNumber: evidence.blockNumber,
    approvalLogIndex: evidence.approvalLogIndex,
    memoIndex: evidence.memoIndex,
    memoLogIndex: evidence.memoLogIndex,
  });
  await saveAttempt(updated);
  return Object.freeze(updated);
}

export async function recordVaultPaymentSettlement(
  attempt: VaultPaymentAttempt,
  evidence: VaultPaymentSettlementEvidence,
): Promise<VaultPaymentAttempt> {
  const updated = paymentAttemptSchema.parse({
    ...attempt,
    transactionHash: evidence.transactionHash,
    settlementBlockNumber: evidence.blockNumber,
    transferLogIndex: evidence.logIndex,
    paymentEventLogIndex: evidence.paymentEventLogIndex,
    memoIndex: evidence.memoIndex,
    memoLogIndex: evidence.memoLogIndex,
  });
  await saveAttempt(updated);
  return Object.freeze(updated);
}
