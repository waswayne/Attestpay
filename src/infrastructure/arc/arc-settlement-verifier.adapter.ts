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
  VaultPaymentSettlementEvidence,
  VaultRecipientApprovalEvidence,
  VerifyMemoUsdcSettlement,
  VerifyUsdcSettlement,
  VerifyVaultPaymentSettlement,
  VerifyVaultRecipientApproval,
} from "../../application/ports/settlement-verifier.port.js";
import { parseUsdcAmount } from "../../domain/payments/usdc-amount.js";
import {
  ARC_TESTNET_CHAIN,
  ARC_TESTNET_RPC_URLS,
  ARC_TESTNET_USDC_ADDRESS,
} from "./arc-testnet.constants.js";
import { ARC_MEMO_ABI, ARC_MEMO_ADDRESS } from "./arc-memo.js";
import { ATTESTPAY_VAULT_ABI } from "./attestpay-vault.js";

type ArcPublicClient = Pick<
  ReturnType<typeof createPublicClient>,
  "waitForTransactionReceipt"
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

  async verifyVaultRecipientApproval(
    expected: VerifyVaultRecipientApproval,
  ): Promise<VaultRecipientApprovalEvidence> {
    try {
      const receipt = await this.getSuccessfulReceipt(expected.transactionHash);
      const vaultEvents = parseEventLogs({
        abi: ATTESTPAY_VAULT_ABI,
        eventName: "RecipientApprovalChanged",
        logs: receipt.logs.filter(
          (log) => log.address.toLowerCase() === expected.vaultAddress.toLowerCase(),
        ),
        strict: true,
      });
      const approval = vaultEvents.find(
        (event) =>
          event.args.recipient.toLowerCase() ===
            expected.recipientAddress.toLowerCase() &&
          event.args.approved === expected.approved &&
          event.args.changedBy.toLowerCase() ===
            expected.administratorAddress.toLowerCase(),
      );
      const memo = this.findMemoEvidence(receipt.logs, {
        senderAddress: expected.administratorAddress,
        targetAddress: expected.vaultAddress,
        memoId: expected.memoId,
        memoData: expected.memoData,
        targetCallDataHash: expected.vaultCallDataHash,
      });

      if (
        !approval ||
        !(memo.beforeLogIndex < approval.logIndex) ||
        !(approval.logIndex < memo.memoLogIndex)
      ) {
        throw new Error("Arc receipt does not contain the ordered recipient approval.");
      }

      return Object.freeze({
        transactionHash: receipt.transactionHash,
        blockNumber: receipt.blockNumber.toString(),
        approvalLogIndex: approval.logIndex,
        memoIndex: memo.memoIndex,
        memoLogIndex: memo.memoLogIndex,
      });
    } catch (error: unknown) {
      throw new ArcSettlementVerificationError(
        "Arc vault recipient-approval verification failed.",
        { cause: error },
      );
    }
  }

  async verifyVaultPaymentSettlement(
    expected: VerifyVaultPaymentSettlement,
  ): Promise<VaultPaymentSettlementEvidence> {
    try {
      const { receipt, transfer } = await this.getVerifiedUsdcTransfer({
        ...expected,
        senderAddress: expected.vaultAddress,
      });
      const paymentEvents = parseEventLogs({
        abi: ATTESTPAY_VAULT_ABI,
        eventName: "PaymentExecuted",
        logs: receipt.logs.filter(
          (log) => log.address.toLowerCase() === expected.vaultAddress.toLowerCase(),
        ),
        strict: true,
      });
      const amount = parseUsdcAmount(expected.amount);
      const payment = paymentEvents.find(
        (event) =>
          event.args.paymentId.toLowerCase() === expected.paymentId.toLowerCase() &&
          event.args.recipient.toLowerCase() ===
            expected.recipientAddress.toLowerCase() &&
          event.args.authorizer.toLowerCase() ===
            expected.authorizerAddress.toLowerCase() &&
          event.args.amount === amount &&
          event.args.invoiceHash.toLowerCase() ===
            expected.invoiceHash.toLowerCase() &&
          event.args.policyHash.toLowerCase() ===
            expected.policyHash.toLowerCase() &&
          event.args.executor.toLowerCase() ===
            expected.executorAddress.toLowerCase(),
      );
      const memo = this.findMemoEvidence(receipt.logs, {
        senderAddress: expected.executorAddress,
        targetAddress: expected.vaultAddress,
        memoId: expected.memoId,
        memoData: expected.memoData,
        targetCallDataHash: expected.transferCallDataHash,
      });

      if (
        !payment ||
        !(memo.beforeLogIndex < transfer.logIndex) ||
        !(transfer.logIndex < payment.logIndex) ||
        !(payment.logIndex < memo.memoLogIndex)
      ) {
        throw new Error("Arc receipt does not contain the ordered vault payment evidence.");
      }

      return Object.freeze({
        transactionHash: receipt.transactionHash,
        blockNumber: receipt.blockNumber.toString(),
        logIndex: transfer.logIndex,
        senderAddress: transfer.args.from,
        recipientAddress: transfer.args.to,
        amount: expected.amount,
        memoId: expected.memoId,
        memoIndex: memo.memoIndex,
        memoLogIndex: memo.memoLogIndex,
        paymentEventLogIndex: payment.logIndex,
        paymentId: payment.args.paymentId,
      });
    } catch (error: unknown) {
      throw new ArcSettlementVerificationError(
        "Arc vault payment verification failed.",
        { cause: error },
      );
    }
  }

  private async getVerifiedUsdcTransfer(expected: VerifyUsdcSettlement) {
    const receipt = await this.getSuccessfulReceipt(expected.transactionHash);

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

  private async getSuccessfulReceipt(transactionHash: `0x${string}`) {
    const receipt = await this.client.waitForTransactionReceipt({
      hash: transactionHash,
      confirmations: 1,
      pollingInterval: 1_000,
      timeout: 180_000,
    });
    if (
      receipt.status !== "success" ||
      receipt.transactionHash.toLowerCase() !== transactionHash.toLowerCase()
    ) {
      throw new Error("Arc transaction did not execute successfully.");
    }
    return receipt;
  }

  private findMemoEvidence(
    logs: Awaited<ReturnType<ArcPublicClient["waitForTransactionReceipt"]>>["logs"],
    expected: {
      senderAddress: `0x${string}`;
      targetAddress: `0x${string}`;
      memoId: `0x${string}`;
      memoData: `0x${string}`;
      targetCallDataHash: `0x${string}`;
    },
  ) {
    const events = parseEventLogs({
      abi: ARC_MEMO_ABI,
      logs: logs.filter(
        (log) => log.address.toLowerCase() === ARC_MEMO_ADDRESS.toLowerCase(),
      ),
      strict: true,
    });
    const beforeEvents = events.filter((event) => event.eventName === "BeforeMemo");
    const memoEvent = events.find(
      (event) =>
        event.eventName === "Memo" &&
        event.args.sender.toLowerCase() === expected.senderAddress.toLowerCase() &&
        event.args.target.toLowerCase() === expected.targetAddress.toLowerCase() &&
        event.args.callDataHash.toLowerCase() ===
          expected.targetCallDataHash.toLowerCase() &&
        event.args.memoId.toLowerCase() === expected.memoId.toLowerCase() &&
        event.args.memo.toLowerCase() === expected.memoData.toLowerCase(),
    );
    const beforeEvent = memoEvent
      ? beforeEvents.find(
          (event) => event.args.memoIndex === memoEvent.args.memoIndex,
        )
      : undefined;
    if (!memoEvent || !beforeEvent) {
      throw new Error("Arc receipt does not contain the expected memo evidence.");
    }

    return {
      beforeLogIndex: beforeEvent.logIndex,
      memoIndex: memoEvent.args.memoIndex.toString(),
      memoLogIndex: memoEvent.logIndex,
    };
  }
}
