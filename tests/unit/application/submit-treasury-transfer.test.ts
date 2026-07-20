import assert from "node:assert/strict";
import test from "node:test";
import type {
  SubmitUsdcTransfer,
  TreasuryPaymentPort,
} from "../../../src/application/ports/treasury-payment.port.js";
import type { TreasuryWalletPort } from "../../../src/application/ports/treasury-wallet.port.js";
import { submitTreasuryTransfer } from "../../../src/application/use-cases/submit-treasury-transfer.js";

const transfer: SubmitUsdcTransfer = {
  idempotencyKey: "11111111-1111-4111-8111-111111111111",
  destinationAddress: "0x2222222222222222222222222222222222222222",
  amount: "1.25",
  reference: "payment:test-001",
};

function createWallet(options?: {
  state?: "LIVE" | "FROZEN";
  balance?: string;
}): TreasuryWalletPort {
  return {
    async getDetails() {
      return {
        id: "11111111-1111-4111-8111-111111111111",
        address: "0x1111111111111111111111111111111111111111",
        network: "ARC-TESTNET",
        accountType: "EOA",
        state: options?.state ?? "LIVE",
      };
    },
    async listBalances() {
      return [
        {
          tokenId: "22222222-2222-4222-8222-222222222222",
          amount: options?.balance ?? "20",
          symbol: "USDC",
          name: "USD Coin",
          decimals: 6,
          isNative: false,
          tokenAddress: "0x3600000000000000000000000000000000000000",
        },
      ];
    },
  };
}

function createPayments(onSubmit: (input: SubmitUsdcTransfer) => void): TreasuryPaymentPort {
  return {
    async submitUsdcTransfer(input) {
      onSubmit(input);
      return {
        transactionId: "33333333-3333-4333-8333-333333333333",
        state: "INITIATED",
      };
    },
    async waitForTransactionHash() {
      throw new Error("not used by this use case");
    },
  };
}

test("submits an exact transfer when treasury invariants pass", async () => {
  let submitted: SubmitUsdcTransfer | undefined;
  const result = await submitTreasuryTransfer(
    createWallet(),
    createPayments((input) => {
      submitted = input;
    }),
    transfer,
  );

  assert.deepEqual(submitted, transfer);
  assert.equal(result.state, "INITIATED");
});

test("fails closed before provider submission when the wallet is frozen", async () => {
  let submissions = 0;

  await assert.rejects(
    submitTreasuryTransfer(
      createWallet({ state: "FROZEN" }),
      createPayments(() => {
        submissions += 1;
      }),
      transfer,
    ),
    /not live/,
  );

  assert.equal(submissions, 0);
});

test("fails closed before provider submission when funds are insufficient", async () => {
  let submissions = 0;

  await assert.rejects(
    submitTreasuryTransfer(
      createWallet({ balance: "1.249999" }),
      createPayments(() => {
        submissions += 1;
      }),
      transfer,
    ),
    /insufficient/,
  );

  assert.equal(submissions, 0);
});
