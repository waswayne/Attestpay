import {
  createPublicClient,
  erc20Abi,
  fallback,
  http,
  parseEventLogs,
} from "viem";
import type {
  SettlementVerifierPort,
  MemoUsdcSettlementEvidence,
  UsdcSettlementEvidence,
  VerifyMemoUsdcSettlement,
  VerifyUsdcSettlement,
} from "../../application/ports/settlement-verifier.port.js";
import { parseUsdcAmount } from "../../domain/payments/usdc-amount.js";
import {
  ARC_TESTNET_CHAIN,
  ARC_TESTNET_RPC_URLS,
  ARC_TESTNET_USDC_ADDRESS,
} from "./arc-testnet.constants.js";
import { ARC_MEMO_ABI, ARC_MEMO_ADDRESS } from "./arc-memo.js";

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
      const { receipt, transfer } = await this.getVerifiedUsdcTransfer(expected);

      return Object.freeze({
        transactionHash: receipt.transactionHash,
        blockNumber: receipt.blockNumber.toString(),
        logIndex: transfer.logIndex,
        senderAddress: transfer.args.from,
        recipientAddress: transfer.args.to,
        amount: expected.amount,
      });
    } catch (error: unknown) {
      throw new ArcSettlementVerificationError(
        "Arc USDC settlement verification failed.",
        { cause: error },
      );
    }
  }

  async verifyMemoUsdcSettlement(
    expected: VerifyMemoUsdcSettlement,
  ): Promise<MemoUsdcSettlementEvidence> {
    try {
      const { receipt, transfer } = await this.getVerifiedUsdcTransfer(expected);
      const memoLogs = receipt.logs.filter(
        (log) => log.address.toLowerCase() === ARC_MEMO_ADDRESS.toLowerCase(),
      );
      const events = parseEventLogs({
        abi: ARC_MEMO_ABI,
        logs: memoLogs,
        strict: true,
      });
      const beforeEvents = events.filter(
        (event) => event.eventName === "BeforeMemo",
      );
      const memoEvents = events.filter((event) => event.eventName === "Memo");
      const memoEvent = memoEvents.find(
        (event) =>
          event.args.sender.toLowerCase() === expected.senderAddress.toLowerCase() &&
          event.args.target.toLowerCase() ===
            ARC_TESTNET_USDC_ADDRESS.toLowerCase() &&
          event.args.callDataHash.toLowerCase() ===
            expected.transferCallDataHash.toLowerCase() &&
          event.args.memoId.toLowerCase() === expected.memoId.toLowerCase() &&
          event.args.memo.toLowerCase() === expected.memoData.toLowerCase(),
      );
      const beforeEvent = memoEvent
        ? beforeEvents.find(
            (event) => event.args.memoIndex === memoEvent.args.memoIndex,
          )
        : undefined;

      if (
        !memoEvent ||
        !beforeEvent ||
        !(beforeEvent.logIndex < transfer.logIndex) ||
        !(transfer.logIndex < memoEvent.logIndex)
      ) {
        throw new Error("Arc receipt does not contain the expected ordered memo audit trail.");
      }

      return Object.freeze({
        transactionHash: receipt.transactionHash,
        blockNumber: receipt.blockNumber.toString(),
        logIndex: transfer.logIndex,
        senderAddress: transfer.args.from,
        recipientAddress: transfer.args.to,
        amount: expected.amount,
        memoId: memoEvent.args.memoId,
        memoIndex: memoEvent.args.memoIndex.toString(),
        memoLogIndex: memoEvent.logIndex,
      });
    } catch (error: unknown) {
      throw new ArcSettlementVerificationError(
        "Arc memo USDC settlement verification failed.",
        { cause: error },
      );
    }
  }

  private async getVerifiedUsdcTransfer(expected: VerifyUsdcSettlement) {
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
    const transfer = transfers.find(
      (event) =>
        event.args.from.toLowerCase() === expected.senderAddress.toLowerCase() &&
        event.args.to.toLowerCase() === expected.recipientAddress.toLowerCase() &&
        event.args.value === expectedAmount,
    );

    if (!transfer) {
      throw new Error("Arc receipt does not contain the expected USDC transfer.");
    }

    return { receipt, transfer };
  }
}
