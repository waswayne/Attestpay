import assert from "node:assert/strict";
import test from "node:test";
import { loadCircleTreasuryConfig } from "../../../src/config/circle-treasury.config.js";

const validEnvironment: NodeJS.ProcessEnv = {
  CIRCLE_API_KEY: "TEST_API_KEY:example-id:example-secret",
  CIRCLE_ENTITY_SECRET: "a".repeat(64),
  CIRCLE_WALLET_ID: "11111111-1111-4111-8111-111111111111",
  CIRCLE_WALLET_ADDRESS: "0x1111111111111111111111111111111111111111",
};

test("loads validated Circle treasury configuration", () => {
  const config = loadCircleTreasuryConfig(validEnvironment);

  assert.equal(config.walletId, validEnvironment.CIRCLE_WALLET_ID);
  assert.equal(config.walletAddress, validEnvironment.CIRCLE_WALLET_ADDRESS);
  assert.equal(Object.isFrozen(config), true);
});

test("reports invalid field names without exposing their values", () => {
  const invalidSecret = "do-not-print-this-value";

  assert.throws(
    () =>
      loadCircleTreasuryConfig({
        ...validEnvironment,
        CIRCLE_ENTITY_SECRET: invalidSecret,
      }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /CIRCLE_ENTITY_SECRET/);
      assert.doesNotMatch(error.message, new RegExp(invalidSecret));
      return true;
    },
  );
});
