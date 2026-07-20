export type TreasuryNetwork = "ARC-TESTNET";

export type TreasuryWalletDetails = Readonly<{
  id: string;
  address: `0x${string}`;
  network: TreasuryNetwork;
  accountType: "EOA";
  state: "LIVE" | "FROZEN";
}>;

export type TreasuryAssetBalance = Readonly<{
  tokenId: string;

  // Keep financial values as strings to avoid floating-point precision loss.
  amount: string;

  symbol: string | null;
  name: string | null;
  decimals: number | null;
  isNative: boolean;
  tokenAddress: `0x${string}` | null;
}>;

export interface TreasuryWalletPort {
  getDetails(): Promise<TreasuryWalletDetails>;
  listBalances(): Promise<readonly TreasuryAssetBalance[]>;
}
