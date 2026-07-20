import assert from "node:assert/strict";
import test from "node:test";
import type { CircleTreasuryConfig } from "../../../src/config/circle-treasury.config.js";
import { ARC_TESTNET_USDC_ADDRESS } from "../../../src/infrastructure/arc/arc-testnet.constants.js";
import {
  CircleTreasuryWalletAdapter,
  type CircleTreasuryWalletClient,
} from "../../../src/infrastructure/circle/circle-treasury-wallet.adapter.js";

const config: CircleTreasuryConfig = {
  apiKey: "TEST_API_KEY:example-id:example-secret",
  entitySecret: "a".repeat(64),
  walletId: "11111111-1111-4111-8111-111111111111",
  walletAddress: "0x1111111111111111111111111111111111111111",
};

function createFakeClient(): CircleTreasuryWalletClient {
  return {
    async getWallet() {
      return {
        data: {
          wallet: {
            id: config.walletId,
            address: config.walletAddress,
            blockchain: "ARC-TESTNET",
            accountType: "EOA",
            state: "LIVE",
          },
        },
      };
    },
    async getWalletTokenBalance() {
      return {
        data: {
          tokenBalances: [
            {
              amount: "20",
              token: {
                id: "11111111-1111-4111-8111-111111111111",
                blockchain: "ARC-TESTNET",
                isNative: true,
                symbol: "USDC",
                name: "USDC",
                decimals: 18,
              },
            },
            {
              amount: "20",
              token: {
                id: "22222222-2222-4222-8222-222222222222",
                blockchain: "ARC-TESTNET",
                isNative: false,
                symbol: "USDC",
                name: "USDC",
                decimals: 6,
                tokenAddress: ARC_TESTNET_USDC_ADDRESS,
              },
            },
          ],
        },
      };
    },
  } as unknown as CircleTreasuryWalletClient;
}

test("maps the configured live Arc EOA", async () => {
  const adapter = new CircleTreasuryWalletAdapter(config, createFakeClient());

  const wallet = await adapter.getDetails();

  assert.deepEqual(wallet, {
    id: config.walletId,
    address: config.walletAddress,
    network: "ARC-TESTNET",
    accountType: "EOA",
    state: "LIVE",
  });
});

test("returns one canonical USDC balance when Circle exposes both Arc interfaces", async () => {
  const adapter = new CircleTreasuryWalletAdapter(config, createFakeClient());

  const balances = await adapter.listBalances();

  assert.equal(balances.length, 1);
  assert.equal(balances[0]?.symbol, "USDC");
  assert.equal(balances[0]?.amount, "20");
  assert.equal(balances[0]?.isNative, false);
  assert.equal(balances[0]?.tokenAddress, ARC_TESTNET_USDC_ADDRESS);
});
