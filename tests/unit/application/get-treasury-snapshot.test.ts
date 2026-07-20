import assert from "node:assert/strict";
import test from "node:test";
import type { TreasuryWalletPort } from "../../../src/application/ports/treasury-wallet.port.js";
import {
  GetTreasurySnapshot,
  TreasuryWalletUnavailableError,
} from "../../../src/application/use-cases/get-treasury-snapshot.js";

const liveWallet = {
  id: "11111111-1111-4111-8111-111111111111",
  address: "0x1111111111111111111111111111111111111111" as const,
  network: "ARC-TESTNET" as const,
  accountType: "EOA" as const,
  state: "LIVE" as const,
};

test("returns a deterministic snapshot without mutating adapter balances", async () => {
  const adapterBalances = [
    {
      tokenId: "22222222-2222-4222-8222-222222222222",
      amount: "5.00",
      symbol: "USDC",
      name: "USD Coin",
      decimals: 6,
      isNative: false,
      tokenAddress: "0x3600000000000000000000000000000000000000" as const,
    },
    {
      tokenId: "11111111-1111-4111-8111-111111111111",
      amount: "0.10",
      symbol: "ARC",
      name: "Arc",
      decimals: 18,
      isNative: true,
      tokenAddress: null,
    },
  ] as const;

  const treasuryWallet: TreasuryWalletPort = {
    async getDetails() {
      return liveWallet;
    },
    async listBalances() {
      return adapterBalances;
    },
  };

  const snapshot = await new GetTreasurySnapshot(treasuryWallet).execute();

  assert.deepEqual(
    snapshot.balances.map((balance) => balance.symbol),
    ["ARC", "USDC"],
  );
  assert.equal(adapterBalances[0].symbol, "USDC");
});

test("fails closed and skips balance lookup when the wallet is frozen", async () => {
  let balanceLookupCalled = false;

  const treasuryWallet: TreasuryWalletPort = {
    async getDetails() {
      return { ...liveWallet, state: "FROZEN" };
    },
    async listBalances() {
      balanceLookupCalled = true;
      return [];
    },
  };

  await assert.rejects(
    () => new GetTreasurySnapshot(treasuryWallet).execute(),
    TreasuryWalletUnavailableError,
  );
  assert.equal(balanceLookupCalled, false);
});
