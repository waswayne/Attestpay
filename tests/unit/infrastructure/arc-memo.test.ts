import assert from "node:assert/strict";
import test from "node:test";
import {
  decodeFunctionData,
  erc20Abi,
  hexToString,
} from "viem";
import {
  ARC_MEMO_ABI,
  prepareArcMemoTransfer,
} from "../../../src/infrastructure/arc/arc-memo.js";
import { ARC_TESTNET_USDC_ADDRESS } from "../../../src/infrastructure/arc/arc-testnet.constants.js";

test("encodes an exact USDC transfer inside the Arc Memo call", () => {
  const recipient = "0x2222222222222222222222222222222222222222";
  const memo = prepareArcMemoTransfer({
    recipientAddress: recipient,
    amount: "0.01",
    authorizationReference: "auth-001",
  });

  const outer = decodeFunctionData({
    abi: ARC_MEMO_ABI,
    data: memo.contractCallData,
  });
  assert.equal(outer.functionName, "memo");
  assert.equal(outer.args[0], ARC_TESTNET_USDC_ADDRESS);
  assert.equal(outer.args[2], memo.memoId);
  assert.equal(hexToString(outer.args[3]), "attestpay:authorization:v1");

  const inner = decodeFunctionData({
    abi: erc20Abi,
    data: outer.args[1],
  });
  assert.equal(inner.functionName, "transfer");
  assert.equal(inner.args[0], recipient);
  assert.equal(inner.args[1], 10_000n);
});

test("derives stable but domain-separated memo identifiers", () => {
  const input = {
    recipientAddress: "0x2222222222222222222222222222222222222222",
    amount: "0.01",
    authorizationReference: "auth-001",
  } as const;

  const first = prepareArcMemoTransfer(input);
  const retry = prepareArcMemoTransfer(input);
  const different = prepareArcMemoTransfer({
    ...input,
    authorizationReference: "auth-002",
  });

  assert.equal(first.memoId, retry.memoId);
  assert.notEqual(first.memoId, different.memoId);
});
