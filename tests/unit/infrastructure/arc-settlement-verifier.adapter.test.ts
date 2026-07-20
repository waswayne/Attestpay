import assert from "node:assert/strict";
import test from "node:test";
import {
  encodeAbiParameters,
  encodeEventTopics,
  erc20Abi,
  type Address,
  type Hash,
} from "viem";
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
