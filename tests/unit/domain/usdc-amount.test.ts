import assert from "node:assert/strict";
import test from "node:test";
import { parseUsdcAmount } from "../../../src/domain/payments/usdc-amount.js";

test("converts USDC decimals into exact atomic units", () => {
  assert.equal(parseUsdcAmount("1"), 1_000_000n);
  assert.equal(parseUsdcAmount("0.000001"), 1n);
  assert.equal(parseUsdcAmount("20.25"), 20_250_000n);
});

test("rejects unsafe, zero, or over-precise USDC amounts", () => {
  for (const amount of ["0", "01", "1e3", "-1", "1.0000001", "1."]) {
    assert.throws(() => parseUsdcAmount(amount));
  }
});
