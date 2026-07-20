import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { z } from "zod";
import type {
  TreasuryPaymentStatus,
  TreasuryPaymentSubmission,
} from "../../application/ports/treasury-payment.port.js";
import type { UsdcSettlementEvidence } from "../../application/ports/settlement-verifier.port.js";
import {
  evmAddressSchema,
  transactionHashSchema,
} from "../../shared/validation/evm.js";

const stateDirectory = new URL("../../../local-state/transfers/", import.meta.url);

const attemptSchema = z.object({
  operationId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
  idempotencyKey: z.string().uuid(),
  amount: z.string(),
  destinationAddress: evmAddressSchema,
  transactionId: z.string().uuid().optional(),
  state: z.string().optional(),
  transactionHash: transactionHashSchema.optional(),
  settlementBlockNumber: z.string().regex(/^\d+$/).optional(),
  settlementLogIndex: z.number().int().nonnegative().optional(),
});

export type TestTransferAttempt = Readonly<z.infer<typeof attemptSchema>>;

function attemptFile(operationId: string): URL {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(operationId)) {
    throw new Error(
      "Operation ID must contain lowercase letters, numbers, or hyphens.",
    );
  }

  return new URL(`${operationId}.json`, stateDirectory);
}

async function readAttempt(operationId: string): Promise<TestTransferAttempt> {
  const contents = await readFile(attemptFile(operationId), "utf8");
  return Object.freeze(attemptSchema.parse(JSON.parse(contents)));
}

async function saveAttempt(attempt: TestTransferAttempt): Promise<void> {
  await writeFile(
    attemptFile(attempt.operationId),
    `${JSON.stringify(attempt, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
}

export async function loadOrCreateTestTransferAttempt(input: {
  operationId: string;
  amount: string;
  destinationAddress: `0x${string}`;
}): Promise<TestTransferAttempt> {
  await mkdir(stateDirectory, { recursive: true });

  const proposed = attemptSchema.parse({
    ...input,
    idempotencyKey: randomUUID(),
  });

  try {
    await writeFile(
      attemptFile(input.operationId),
      `${JSON.stringify(proposed, null, 2)}\n`,
      { encoding: "utf8", mode: 0o600, flag: "wx" },
    );
    return Object.freeze(proposed);
  } catch (error: unknown) {
    if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) {
      throw error;
    }
  }

  const existing = await readAttempt(input.operationId);
  if (
    existing.amount !== input.amount ||
    existing.destinationAddress.toLowerCase() !==
      input.destinationAddress.toLowerCase()
  ) {
    throw new Error(
      "This operation ID is already bound to a different transfer payload.",
    );
  }

  return existing;
}

export async function recordTestTransferSubmission(
  attempt: TestTransferAttempt,
  submission: TreasuryPaymentSubmission,
): Promise<TestTransferAttempt> {
  const updated = attemptSchema.parse({
    ...attempt,
    transactionId: submission.transactionId,
    state: submission.state,
  });
  await saveAttempt(updated);
  return Object.freeze(updated);
}

export async function recordTestTransferStatus(
  attempt: TestTransferAttempt,
  status: TreasuryPaymentStatus,
): Promise<TestTransferAttempt> {
  const updated = attemptSchema.parse({
    ...attempt,
    transactionId: status.transactionId,
    state: status.state,
    ...(status.transactionHash
      ? { transactionHash: status.transactionHash }
      : {}),
  });
  await saveAttempt(updated);
  return Object.freeze(updated);
}

export async function recordTestTransferSettlement(
  attempt: TestTransferAttempt,
  evidence: UsdcSettlementEvidence,
): Promise<TestTransferAttempt> {
  const updated = attemptSchema.parse({
    ...attempt,
    transactionHash: evidence.transactionHash,
    settlementBlockNumber: evidence.blockNumber,
    settlementLogIndex: evidence.logIndex,
  });
  await saveAttempt(updated);
  return Object.freeze(updated);
}
