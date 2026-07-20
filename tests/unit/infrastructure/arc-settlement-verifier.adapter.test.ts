import assert from "node:assert/strict";
import test from "node:test";
import {
  encodeAbiParameters,
  encodeEventTopics,
  erc20Abi,
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

const transactionHash = `0x${"a".repeat(64)}` as Hash;
const sender = "0x1111111111111111111111111111111111111111" as Address;
const recipient = "0x2222222222222222222222222222222222222222" as Address;

function createReceiptClient() {
  return {
    async getTransactionReceipt() {
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
    async getTransactionReceipt() {
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
