import assert from "node:assert/strict";
import test from "node:test";
import type { CircleTreasuryConfig } from "../../../src/config/circle-treasury.config.js";
import { ARC_TESTNET_USDC_ADDRESS } from "../../../src/infrastructure/arc/arc-testnet.constants.js";
import { ARC_MEMO_ADDRESS } from "../../../src/infrastructure/arc/arc-memo.js";
import {
  CircleTreasuryPaymentAdapter,
  type CircleTreasuryPaymentClient,
} from "../../../src/infrastructure/circle/circle-treasury-payment.adapter.js";

const config: CircleTreasuryConfig = {
  apiKey: "TEST_API_KEY:example-id:example-secret",
  entitySecret: "a".repeat(64),
  walletId: "11111111-1111-4111-8111-111111111111",
  walletAddress: "0x1111111111111111111111111111111111111111",
};

test("maps an application USDC transfer to the Circle SDK request", async () => {
  let request: Record<string, unknown> | undefined;
  const client = {
    async createTransaction(input: Record<string, unknown>) {
      request = input;
      return {
        data: {
          id: "22222222-2222-4222-8222-222222222222",
          state: "INITIATED",
        },
      };
    },
    async getTransaction() {
      throw new Error("not used");
    },
  } as unknown as CircleTreasuryPaymentClient;

  const adapter = new CircleTreasuryPaymentAdapter(config, client);
  const result = await adapter.submitUsdcTransfer({
    idempotencyKey: "33333333-3333-4333-8333-333333333333",
    destinationAddress: "0x2222222222222222222222222222222222222222",
    amount: "0.01",
    reference: "attestpay:test:first-transfer",
  });

  assert.equal(result.state, "INITIATED");
  assert.equal(request?.walletId, undefined);
  assert.equal(request?.walletAddress, config.walletAddress);
  assert.equal(request?.blockchain, "ARC-TESTNET");
  assert.equal(request?.tokenAddress, ARC_TESTNET_USDC_ADDRESS);
  assert.deepEqual(request?.amount, ["0.01"]);
  assert.equal(
    request?.destinationAddress,
    "0x2222222222222222222222222222222222222222",
  );
});

test("waits for and validates the Arc transaction hash", async () => {
  const transactionId = "22222222-2222-4222-8222-222222222222";
  const transactionHash = `0x${"a".repeat(64)}`;
  let waitForTxHash: unknown;

  const client = {
    async createTransaction() {
      throw new Error("not used");
    },
    async getTransaction(input: Record<string, unknown>) {
      waitForTxHash = input.waitForTxHash;
      return {
        data: {
          transaction: {
            id: transactionId,
            state: "SENT",
            blockchain: "ARC-TESTNET",
            txHash: transactionHash,
          },
        },
      };
    },
  } as unknown as CircleTreasuryPaymentClient;

  const adapter = new CircleTreasuryPaymentAdapter(config, client);
  const result = await adapter.waitForTransactionHash(
    transactionId,
    AbortSignal.timeout(1_000),
  );

  assert.equal(waitForTxHash, true);
  assert.equal(result.transactionHash, transactionHash);
  assert.equal(result.state, "SENT");
});

test("submits an Arc memo as a Circle contract execution", async () => {
  let request: Record<string, unknown> | undefined;
  const client = {
    async createContractExecutionTransaction(input: Record<string, unknown>) {
      request = input;
      return {
        data: {
          id: "44444444-4444-4444-8444-444444444444",
          state: "INITIATED",
        },
      };
    },
    async createTransaction() {
      throw new Error("not used");
    },
    async getTransaction() {
      throw new Error("not used");
    },
  } as unknown as CircleTreasuryPaymentClient;

  const adapter = new CircleTreasuryPaymentAdapter(config, client);
  const result = await adapter.submitMemoUsdcTransfer({
    idempotencyKey: "55555555-5555-4555-8555-555555555555",
    destinationAddress: "0x2222222222222222222222222222222222222222",
    amount: "0.01",
    reference: "attestpay:memo:memo-transfer-001",
    authorizationReference: "auth-001",
  });

  assert.equal(result.state, "INITIATED");
  assert.equal(request?.walletAddress, config.walletAddress);
  assert.equal(request?.blockchain, "ARC-TESTNET");
  assert.equal(request?.contractAddress, ARC_MEMO_ADDRESS);
  assert.equal(typeof request?.callData, "string");
  assert.equal(request?.abiFunctionSignature, undefined);
});
