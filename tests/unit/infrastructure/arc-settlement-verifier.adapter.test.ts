import assert from "node:assert/strict";
import test from "node:test";
import {
  encodeAbiParameters,
  encodeEventTopics,
  erc20Abi,
  keccak256,
  stringToHex,
  type Address,
  type Hash,
} from "viem";
import {
  ARC_MEMO_ABI,
  ARC_MEMO_ADDRESS,
  prepareArcMemoTransfer,
} from "../../../src/infrastructure/arc/arc-memo.js";
import { ARC_TESTNET_USDC_ADDRESS } from "../../../src/infrastructure/arc/arc-testnet.constants.js";
import { ArcSettlementVerifierAdapter } from "../../../src/infrastructure/arc/arc-settlement-verifier.adapter.js";
import {
  ATTESTPAY_VAULT_ABI,
  prepareArcVaultPayment,
  prepareArcVaultRecipientApproval,
} from "../../../src/infrastructure/arc/attestpay-vault.js";

const transactionHash = `0x${"a".repeat(64)}` as Hash;
const sender = "0x1111111111111111111111111111111111111111" as Address;
const recipient = "0x2222222222222222222222222222222222222222" as Address;

function createReceiptClient() {
  return {
    async waitForTransactionReceipt() {
      return {
        status: "success",
        transactionHash,
        blockNumber: 123n,
        logs: [
          {
            address: ARC_TESTNET_USDC_ADDRESS,
            topics: encodeEventTopics({
              abi: erc20Abi,
              eventName: "Transfer",
              args: { from: sender, to: recipient },
            }),
            data: encodeAbiParameters([{ type: "uint256" }], [10_000n]),
            logIndex: 2,
          },
        ],
      };
    },
  } as unknown as ConstructorParameters<typeof ArcSettlementVerifierAdapter>[0];
}

test("verifies the exact USDC transfer event in a successful Arc receipt", async () => {
  const adapter = new ArcSettlementVerifierAdapter(createReceiptClient());

  const evidence = await adapter.verifyUsdcSettlement({
    transactionHash,
    senderAddress: sender,
    recipientAddress: recipient,
    amount: "0.01",
  });

  assert.equal(evidence.blockNumber, "123");
  assert.equal(evidence.logIndex, 2);
  assert.equal(evidence.amount, "0.01");
});

test("rejects a successful transaction that paid the wrong recipient", async () => {
  const adapter = new ArcSettlementVerifierAdapter(createReceiptClient());

  await assert.rejects(
    adapter.verifyUsdcSettlement({
      transactionHash,
      senderAddress: sender,
      recipientAddress: "0x3333333333333333333333333333333333333333",
      amount: "0.01",
    }),
    /settlement verification failed/,
  );
});

test("verifies the ordered Memo and USDC events as one settlement", async () => {
  const prepared = prepareArcMemoTransfer({
    recipientAddress: recipient,
    amount: "0.01",
    authorizationReference: "auth-001",
  });
  const memoIndex = 7n;
  const client = {
    async waitForTransactionReceipt() {
      return {
        status: "success",
        transactionHash,
        blockNumber: 456n,
        logs: [
          {
            address: ARC_MEMO_ADDRESS,
            topics: encodeEventTopics({
              abi: ARC_MEMO_ABI,
              eventName: "BeforeMemo",
              args: { memoIndex },
            }),
            data: "0x",
            logIndex: 1,
          },
          {
            address: ARC_TESTNET_USDC_ADDRESS,
            topics: encodeEventTopics({
              abi: erc20Abi,
              eventName: "Transfer",
              args: { from: sender, to: recipient },
            }),
            data: encodeAbiParameters([{ type: "uint256" }], [10_000n]),
            logIndex: 3,
          },
          {
            address: ARC_MEMO_ADDRESS,
            topics: encodeEventTopics({
              abi: ARC_MEMO_ABI,
              eventName: "Memo",
              args: {
                sender,
                target: ARC_TESTNET_USDC_ADDRESS,
                memoId: prepared.memoId,
              },
            }),
            data: encodeAbiParameters(
              [
                { type: "bytes32" },
                { type: "bytes" },
                { type: "uint256" },
              ],
              [prepared.transferCallDataHash, prepared.memoData, memoIndex],
            ),
            logIndex: 4,
          },
        ],
      };
    },
  } as unknown as ConstructorParameters<typeof ArcSettlementVerifierAdapter>[0];

  const adapter = new ArcSettlementVerifierAdapter(client);
  const evidence = await adapter.verifyMemoUsdcSettlement({
    transactionHash,
    senderAddress: sender,
    recipientAddress: recipient,
    amount: "0.01",
    memoId: prepared.memoId,
    memoData: prepared.memoData,
    transferCallDataHash: prepared.transferCallDataHash,
  });

  assert.equal(evidence.blockNumber, "456");
  assert.equal(evidence.logIndex, 3);
  assert.equal(evidence.memoLogIndex, 4);
  assert.equal(evidence.memoIndex, "7");
});

test("verifies an ordered memo-wrapped vault recipient approval", async () => {
  const vault = "0x4444444444444444444444444444444444444444" as Address;
  const prepared = prepareArcVaultRecipientApproval({
    vaultAddress: vault,
    recipientAddress: recipient,
    approved: true,
    authorizationReference: "recipient-approval-001",
  });
  const memoIndex = 8n;
  const client = {
    async waitForTransactionReceipt() {
      return {
        status: "success",
        transactionHash,
        blockNumber: 500n,
        logs: [
          {
            address: ARC_MEMO_ADDRESS,
            topics: encodeEventTopics({
              abi: ARC_MEMO_ABI,
              eventName: "BeforeMemo",
              args: { memoIndex },
            }),
            data: "0x",
            logIndex: 1,
          },
          {
            address: vault,
            topics: encodeEventTopics({
              abi: ATTESTPAY_VAULT_ABI,
              eventName: "RecipientApprovalChanged",
              args: { recipient, changedBy: sender },
            }),
            data: encodeAbiParameters([{ type: "bool" }], [true]),
            logIndex: 2,
          },
          {
            address: ARC_MEMO_ADDRESS,
            topics: encodeEventTopics({
              abi: ARC_MEMO_ABI,
              eventName: "Memo",
              args: { sender, target: vault, memoId: prepared.memoId },
            }),
            data: encodeAbiParameters(
              [{ type: "bytes32" }, { type: "bytes" }, { type: "uint256" }],
              [prepared.vaultCallDataHash, prepared.memoData, memoIndex],
            ),
            logIndex: 3,
          },
        ],
      };
    },
  } as unknown as ConstructorParameters<typeof ArcSettlementVerifierAdapter>[0];

  const evidence = await new ArcSettlementVerifierAdapter(
    client,
  ).verifyVaultRecipientApproval({
    transactionHash,
    vaultAddress: vault,
    administratorAddress: sender,
    recipientAddress: recipient,
    approved: true,
    memoId: prepared.memoId,
    memoData: prepared.memoData,
    vaultCallDataHash: prepared.vaultCallDataHash,
  });

  assert.equal(evidence.approvalLogIndex, 2);
  assert.equal(evidence.memoLogIndex, 3);
});

test("verifies Transfer, PaymentExecuted, and Memo as one vault settlement", async () => {
  const vault = "0x4444444444444444444444444444444444444444" as Address;
  const authorizer = "0x5555555555555555555555555555555555555555" as Address;
  const authorization = {
    paymentId: keccak256(stringToHex("payment-001")),
    recipient,
    amount: 10_000n,
    invoiceHash: keccak256(stringToHex("invoice-001")),
    policyHash: keccak256(stringToHex("policy-v1")),
    validAfter: 1_700_000_000,
    deadline: 1_700_001_800,
    authorizer,
  };
  const prepared = prepareArcVaultPayment({
    vaultAddress: vault,
    authorization,
    signature: `0x${"11".repeat(65)}`,
    authorizationReference: "vault-payment-001",
  });
  const memoIndex = 9n;
  const client = {
    async waitForTransactionReceipt() {
      return {
        status: "success",
        transactionHash,
        blockNumber: 600n,
        logs: [
          {
            address: ARC_MEMO_ADDRESS,
            topics: encodeEventTopics({
              abi: ARC_MEMO_ABI,
              eventName: "BeforeMemo",
              args: { memoIndex },
            }),
            data: "0x",
            logIndex: 1,
          },
          {
            address: ARC_TESTNET_USDC_ADDRESS,
            topics: encodeEventTopics({
              abi: erc20Abi,
              eventName: "Transfer",
              args: { from: vault, to: recipient },
            }),
            data: encodeAbiParameters([{ type: "uint256" }], [10_000n]),
            logIndex: 2,
          },
          {
            address: vault,
            topics: encodeEventTopics({
              abi: ATTESTPAY_VAULT_ABI,
              eventName: "PaymentExecuted",
              args: {
                paymentId: authorization.paymentId,
                recipient,
                authorizer,
              },
            }),
            data: encodeAbiParameters(
              [
                { type: "uint256" },
                { type: "bytes32" },
                { type: "bytes32" },
                { type: "address" },
                { type: "uint256" },
                { type: "uint256" },
              ],
              [
                authorization.amount,
                authorization.invoiceHash,
                authorization.policyHash,
                sender,
                19_675n,
                authorization.amount,
              ],
            ),
            logIndex: 3,
          },
          {
            address: ARC_MEMO_ADDRESS,
            topics: encodeEventTopics({
              abi: ARC_MEMO_ABI,
              eventName: "Memo",
              args: { sender, target: vault, memoId: prepared.memoId },
            }),
            data: encodeAbiParameters(
              [{ type: "bytes32" }, { type: "bytes" }, { type: "uint256" }],
              [prepared.vaultCallDataHash, prepared.memoData, memoIndex],
            ),
            logIndex: 4,
          },
        ],
      };
    },
  } as unknown as ConstructorParameters<typeof ArcSettlementVerifierAdapter>[0];

  const evidence = await new ArcSettlementVerifierAdapter(
    client,
  ).verifyVaultPaymentSettlement({
    transactionHash,
    recipientAddress: recipient,
    amount: "0.01",
    memoId: prepared.memoId,
    memoData: prepared.memoData,
    transferCallDataHash: prepared.vaultCallDataHash,
    vaultAddress: vault,
    executorAddress: sender,
    authorizerAddress: authorizer,
    paymentId: authorization.paymentId,
    invoiceHash: authorization.invoiceHash,
    policyHash: authorization.policyHash,
  });

  assert.equal(evidence.logIndex, 2);
  assert.equal(evidence.paymentEventLogIndex, 3);
  assert.equal(evidence.memoLogIndex, 4);
});
