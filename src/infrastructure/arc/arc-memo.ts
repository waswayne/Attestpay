import {
  encodeFunctionData,
  erc20Abi,
  keccak256,
  stringToHex,
  type Address,
  type Hash,
  type Hex,
} from "viem";
import { parseUsdcAmount } from "../../domain/payments/usdc-amount.js";
import { ARC_TESTNET_USDC_ADDRESS } from "./arc-testnet.constants.js";

export const ARC_MEMO_ADDRESS =
  "0x5294E9927c3306DcBaDb03fe70b92e01cCede505" as const;

export const ATTESTPAY_MEMO_FORMAT = "attestpay:authorization:v1";

export const ARC_MEMO_ABI = [
  {
    type: "function",
    name: "memo",
    stateMutability: "nonpayable",
    inputs: [
      { name: "target", type: "address" },
      { name: "data", type: "bytes" },
      { name: "memoId", type: "bytes32" },
      { name: "memoData", type: "bytes" },
    ],
    outputs: [],
  },
  {
    type: "event",
    name: "BeforeMemo",
    anonymous: false,
    inputs: [{ name: "memoIndex", type: "uint256", indexed: true }],
  },
  {
    type: "event",
    name: "Memo",
    anonymous: false,
    inputs: [
      { name: "sender", type: "address", indexed: true },
      { name: "target", type: "address", indexed: true },
      { name: "callDataHash", type: "bytes32", indexed: false },
      { name: "memoId", type: "bytes32", indexed: true },
      { name: "memo", type: "bytes", indexed: false },
      { name: "memoIndex", type: "uint256", indexed: false },
    ],
  },
] as const;

export type PreparedArcMemoTransfer = Readonly<{
  contractCallData: Hex;
  transferCallDataHash: Hash;
  memoId: Hash;
  memoData: Hex;
}>;

export function prepareArcMemoTransfer(input: {
  recipientAddress: Address;
  amount: string;
  authorizationReference: string;
}): PreparedArcMemoTransfer {
  const transferCallData = encodeFunctionData({
    abi: erc20Abi,
    functionName: "transfer",
    args: [input.recipientAddress, parseUsdcAmount(input.amount)],
  });
  const transferCallDataHash = keccak256(transferCallData);
  const memoId = keccak256(
    stringToHex(`${ATTESTPAY_MEMO_FORMAT}:${input.authorizationReference}`),
  );
  const memoData = stringToHex(ATTESTPAY_MEMO_FORMAT);
  const contractCallData = encodeFunctionData({
    abi: ARC_MEMO_ABI,
    functionName: "memo",
    args: [
      ARC_TESTNET_USDC_ADDRESS,
      transferCallData,
      memoId,
      memoData,
    ],
  });

  return Object.freeze({
    contractCallData,
    transferCallDataHash,
    memoId,
    memoData,
  });
}
