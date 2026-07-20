import type {
  TreasuryAssetBalance,
  TreasuryWalletDetails,
  TreasuryWalletPort,
} from "../ports/treasury-wallet.port.js";

export type TreasurySnapshot = Readonly<{
  wallet: TreasuryWalletDetails;
  balances: readonly TreasuryAssetBalance[];
}>;

export class TreasuryWalletUnavailableError extends Error {
  constructor(state: TreasuryWalletDetails["state"]) {
    super(`Treasury wallet is unavailable in state ${state}.`);
    this.name = "TreasuryWalletUnavailableError";
  }
}

export class GetTreasurySnapshot {
  constructor(private readonly treasuryWallet: TreasuryWalletPort) {}

  async execute(): Promise<TreasurySnapshot> {
    const wallet = await this.treasuryWallet.getDetails();

    if (wallet.state !== "LIVE") {
      throw new TreasuryWalletUnavailableError(wallet.state);
    }

    const balances = await this.treasuryWallet.listBalances();

    const sortedBalances = [...balances].sort((left, right) => {
      const leftKey = left.symbol ?? left.tokenId;
      const rightKey = right.symbol ?? right.tokenId;
      return leftKey.localeCompare(rightKey);
    });

    return Object.freeze({
      wallet,
      balances: Object.freeze(sortedBalances),
    });
  }
}
