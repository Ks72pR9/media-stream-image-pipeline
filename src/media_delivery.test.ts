import test from "node:test";
import assert from "node:assert/strict";
import { shouldResize } from "./media_delivery.ts";

test("the streaming profile accepts a 1280x720 creator asset", () => {
  assert.equal(shouldResize({ width: 1280, height: 720 }), true);
});

test("the service rejects dimensions above the delivery profile", () => {
  assert.equal(shouldResize({ width: 2560, height: 1440 }), false);
});
