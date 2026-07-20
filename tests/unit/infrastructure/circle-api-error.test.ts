import assert from "node:assert/strict";
import test from "node:test";
import { circleApiErrorDetail } from "../../../src/infrastructure/circle/circle-api-error.js";

test("reports Circle field errors without echoing rejected values", () => {
  const detail = circleApiErrorDetail({
    message: "API parameter invalid",
    error: {
      response: {
        data: {
          errors: [
            {
              location: "callData",
              message: "'callData' field is invalid (was sensitive-payload)",
            },
          ],
        },
      },
    },
  });

  assert.equal(detail, "callData: 'callData' field is invalid");
  assert.doesNotMatch(detail, /sensitive-payload/);
});
