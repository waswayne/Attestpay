import { parseUsdcAmount } from "../../domain/payments/usdc-amount.js";
import type { TreasuryWalletPort } from "../ports/treasury-wallet.port.js";

export async function assertTreasuryCanPay(
  wallet: TreasuryWalletPort,
  destinationAddress: `0x${string}`,
  amount: string,
): Promise<void> {
  const requestedAmount = parseUsdcAmount(amount);
  const [details, balances] = await Promise.all([
    wallet.getDetails(),
    wallet.listBalances(),
  ]);

  if (details.state !== "LIVE") {
    throw new Error("Treasury wallet is not live; payment submission is blocked.");
  }

  if (details.address.toLowerCase() === destinationAddress.toLowerCase()) {
    throw new Error("Treasury cannot pay its own address.");
  }

  const usdcBalance = balances.find(
    (balance) =>
      balance.symbol?.toUpperCase() === "USDC" && balance.isNative === false,
  );

  if (!usdcBalance) {
    throw new Error("Treasury has no canonical ERC-20 USDC balance.");
  }

  if (parseUsdcAmount(usdcBalance.amount) < requestedAmount) {
    throw new Error("Treasury has insufficient USDC for this payment.");
  }
}
