import { randomUUID } from "node:crypto";
import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";
import { z } from "zod";
import type {
  SubmitUsdcTransfer,
  TreasuryPaymentPort,
  TreasuryPaymentStatus,
  TreasuryPaymentSubmission,
} from "../../application/ports/treasury-payment.port.js";
import type { CircleTreasuryConfig } from "../../config/circle-treasury.config.js";
import { transactionHashSchema } from "../../shared/validation/evm.js";
import { ARC_TESTNET_USDC_ADDRESS } from "../arc/arc-testnet.constants.js";

type DeveloperWalletsClient = ReturnType<
  typeof initiateDeveloperControlledWalletsClient
>;

export type CircleTreasuryPaymentClient = Pick<
  DeveloperWalletsClient,
  "createTransaction" | "getTransaction"
>;

const transactionStateSchema = z.enum([
  "INITIATED",
  "CLEARED",
  "QUEUED",
  "SENT",
  "CONFIRMED",
  "COMPLETE",
  "STUCK",
  "FAILED",
  "DENIED",
  "CANCELLED",
]);

const submissionSchema = z.object({
  id: z.string().uuid(),
  state: transactionStateSchema,
});

const transactionSchema = submissionSchema.extend({
  blockchain: z.literal("ARC-TESTNET"),
  txHash: transactionHashSchema,
  errorReason: z.string().optional(),
});

export class CircleTreasuryPaymentError extends Error {
  readonly requestId: string;

  constructor(operation: string, requestId: string, options?: ErrorOptions) {
    super(`Circle treasury ${operation} failed. Request ID: ${requestId}`, options);
    this.name = "CircleTreasuryPaymentError";
    this.requestId = requestId;
  }
}

export class CircleTreasuryPaymentAdapter implements TreasuryPaymentPort {
  private readonly client: CircleTreasuryPaymentClient;

  constructor(
    private readonly config: CircleTreasuryConfig,
    client?: CircleTreasuryPaymentClient,
  ) {
    this.client =
      client ??
      initiateDeveloperControlledWalletsClient({
        apiKey: config.apiKey,
        entitySecret: config.entitySecret,
      });
  }

  async submitUsdcTransfer(
    transfer: SubmitUsdcTransfer,
  ): Promise<TreasuryPaymentSubmission> {
    const requestId = randomUUID();

    try {
      const response = await this.client.createTransaction({
        walletAddress: this.config.walletAddress,
        blockchain: "ARC-TESTNET",
        tokenAddress: ARC_TESTNET_USDC_ADDRESS,
        amount: [transfer.amount],
        destinationAddress: transfer.destinationAddress,
        refId: transfer.reference,
        idempotencyKey: transfer.idempotencyKey,
        fee: {
          type: "level",
          config: { feeLevel: "MEDIUM" },
        },
        xRequestId: requestId,
      });

      const parsed = submissionSchema.safeParse(response.data);
      if (!parsed.success) {
        throw new Error("Circle returned an invalid transfer response.");
      }

      return Object.freeze({
        transactionId: parsed.data.id,
        state: parsed.data.state,
      });
    } catch (error: unknown) {
      throw new CircleTreasuryPaymentError("transfer submission", requestId, {
        cause: error,
      });
    }
  }

  async waitForTransactionHash(
    transactionId: string,
    signal: AbortSignal,
  ): Promise<TreasuryPaymentStatus> {
    const requestId = randomUUID();

    try {
      const response = await this.client.getTransaction({
        id: transactionId,
        waitForTxHash: true,
        pollingInterval: 1_000,
        signal,
        xRequestId: requestId,
      });

      const parsed = transactionSchema.safeParse(response.data.transaction);
      if (!parsed.success || parsed.data.id !== transactionId) {
        throw new Error("Circle returned an invalid transaction response.");
      }

      return Object.freeze({
        transactionId: parsed.data.id,
        state: parsed.data.state,
        transactionHash: parsed.data.txHash,
        errorReason: parsed.data.errorReason ?? null,
      });
    } catch (error: unknown) {
      throw new CircleTreasuryPaymentError("transaction polling", requestId, {
        cause: error,
      });
    }
  }
}
