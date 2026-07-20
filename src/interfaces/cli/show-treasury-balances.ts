import { GetTreasurySnapshot } from "../../application/use-cases/get-treasury-snapshot.js";
import { loadCircleTreasuryConfig } from "../../config/circle-treasury.config.js";
import { CircleTreasuryWalletAdapter } from "../../infrastructure/circle/circle-treasury-wallet.adapter.js";

async function main(): Promise<void> {
  // Composition root: this is where abstract application code receives a concrete adapter.
  const config = loadCircleTreasuryConfig();
  const treasuryWallet = new CircleTreasuryWalletAdapter(config);
  const getTreasurySnapshot = new GetTreasurySnapshot(treasuryWallet);

  const snapshot = await getTreasurySnapshot.execute();

  console.log("AttestPay treasury");
  console.log(`  Address: ${snapshot.wallet.address}`);
  console.log(`  Network: ${snapshot.wallet.network}`);
  console.log(`  State: ${snapshot.wallet.state}`);

  if (snapshot.balances.length === 0) {
    console.log("  Balances: no indexed assets found");
    return;
  }

  console.table(
    snapshot.balances.map((balance) => ({
      symbol: balance.symbol ?? "UNKNOWN",
      amount: balance.amount,
      native: balance.isNative,
      tokenAddress: balance.tokenAddress ?? "native",
    })),
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  console.error(message);
  process.exitCode = 1;
});
