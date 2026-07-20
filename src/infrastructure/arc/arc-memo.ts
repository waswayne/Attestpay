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

export type PreparedArcMemoCall = Readonly<{
  contractCallData: Hex;
  targetCallDataHash: Hash;
  memoId: Hash;
  memoData: Hex;
}>;

export function prepareArcMemoCall(input: {
  targetAddress: Address;
  targetCallData: Hex;
  authorizationReference: string;
}): PreparedArcMemoCall {
  const targetCallDataHash = keccak256(input.targetCallData);
  const memoId = keccak256(
    stringToHex(`${ATTESTPAY_MEMO_FORMAT}:${input.authorizationReference}`),
  );
  const memoData = stringToHex(ATTESTPAY_MEMO_FORMAT);
  const contractCallData = encodeFunctionData({
    abi: ARC_MEMO_ABI,
    functionName: "memo",
    args: [input.targetAddress, input.targetCallData, memoId, memoData],
  });

  return Object.freeze({
    contractCallData,
    targetCallDataHash,
    memoId,
    memoData,
  });
}

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
  const memo = prepareArcMemoCall({
    targetAddress: ARC_TESTNET_USDC_ADDRESS,
    targetCallData: transferCallData,
    authorizationReference: input.authorizationReference,
  });

  return Object.freeze({
    contractCallData: memo.contractCallData,
    transferCallDataHash: memo.targetCallDataHash,
    memoId: memo.memoId,
    memoData: memo.memoData,
  });
}
