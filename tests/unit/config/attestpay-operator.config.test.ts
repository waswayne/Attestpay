import assert from "node:assert/strict";
import test from "node:test";
import { loadAttestPayOperatorConfig } from "../../../src/config/attestpay-operator.config.js";

test("loads a stable configured local operator identity", () => {
  assert.deepEqual(
    loadAttestPayOperatorConfig({
      ATTESTPAY_OPERATOR_ID: "local-finance-operator-001",
    }),
    { id: "local-finance-operator-001" },
  );
});

test("fails startup configuration when the local operator identity is missing or invalid", () => {
  for (const environment of [
    {},
    { ATTESTPAY_OPERATOR_ID: "" },
    { ATTESTPAY_OPERATOR_ID: "operator identity with spaces" },
  ]) {
    assert.throws(
      () => loadAttestPayOperatorConfig(environment),
      /ATTESTPAY_OPERATOR_ID/,
    );
  }
});
