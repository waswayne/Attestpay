import {
  createPublicClient,
  erc20Abi,
  fallback,
  http,
  parseEventLogs,
} from "viem";
import type {
  SettlementVerifierPort,
  UsdcSettlementEvidence,
  VerifyUsdcSettlement,
} from "../../application/ports/settlement-verifier.port.js";
import { parseUsdcAmount } from "../../domain/payments/usdc-amount.js";
import {
  ARC_TESTNET_CHAIN,
  ARC_TESTNET_RPC_URLS,
  ARC_TESTNET_USDC_ADDRESS,
} from "./arc-testnet.constants.js";

type ArcPublicClient = Pick<
  ReturnType<typeof createPublicClient>,
  "getTransactionReceipt"
>;

export class ArcSettlementVerificationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ArcSettlementVerificationError";
  }
}

export class ArcSettlementVerifierAdapter implements SettlementVerifierPort {
  private readonly client: ArcPublicClient;

  constructor(client?: ArcPublicClient) {
    this.client =
      client ??
      createPublicClient({
        chain: ARC_TESTNET_CHAIN,
        transport: fallback(
          ARC_TESTNET_RPC_URLS.map((url) =>
            http(url, { retryCount: 1, timeout: 10_000 }),
          ),
        ),
      });
  }

  async verifyUsdcSettlement(
    expected: VerifyUsdcSettlement,
  ): Promise<UsdcSettlementEvidence> {
    try {
      const receipt = await this.client.getTransactionReceipt({
        hash: expected.transactionHash,
      });

      if (
        receipt.status !== "success" ||
        receipt.transactionHash.toLowerCase() !==
          expected.transactionHash.toLowerCase()
      ) {
        throw new Error("Arc transaction did not execute successfully.");
      }

      const usdcLogs = receipt.logs.filter(
        (log) =>
          log.address.toLowerCase() === ARC_TESTNET_USDC_ADDRESS.toLowerCase(),
      );
      const transfers = parseEventLogs({
        abi: erc20Abi,
        eventName: "Transfer",
        logs: usdcLogs,
        strict: true,
      });
      const expectedAmount = parseUsdcAmount(expected.amount);
      const matchingTransfer = transfers.find(
        (event) =>
          event.args.from.toLowerCase() === expected.senderAddress.toLowerCase() &&
          event.args.to.toLowerCase() === expected.recipientAddress.toLowerCase() &&
          event.args.value === expectedAmount,
      );

      if (!matchingTransfer) {
        throw new Error("Arc receipt does not contain the expected USDC transfer.");
      }

      return Object.freeze({
        transactionHash: receipt.transactionHash,
        blockNumber: receipt.blockNumber.toString(),
        logIndex: matchingTransfer.logIndex,
        senderAddress: matchingTransfer.args.from,
        recipientAddress: matchingTransfer.args.to,
        amount: expected.amount,
      });
    } catch (error: unknown) {
      throw new ArcSettlementVerificationError(
        "Arc USDC settlement verification failed.",
        { cause: error },
      );
    }
  }
}
