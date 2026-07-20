export type VerifyUsdcSettlement = Readonly<{
  transactionHash: `0x${string}`;
  senderAddress: `0x${string}`;
  recipientAddress: `0x${string}`;
  amount: string;
}>;

export type UsdcSettlementEvidence = Readonly<{
  transactionHash: `0x${string}`;
  blockNumber: string;
  logIndex: number;
  senderAddress: `0x${string}`;
  recipientAddress: `0x${string}`;
  amount: string;
}>;

export interface SettlementVerifierPort {
  verifyUsdcSettlement(
    expected: VerifyUsdcSettlement,
  ): Promise<UsdcSettlementEvidence>;
}
