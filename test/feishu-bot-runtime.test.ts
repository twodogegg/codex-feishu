import test from "node:test";
import assert from "node:assert/strict";

import { patchWsClientForCardCallbacks } from "../src/app/feishu-bot-runtime.ts";

test("patchWsClientForCardCallbacks 会把 card 类型回调改写为 event", () => {
  const calls: unknown[] = [];
  const client = {
    handleEventData(data: unknown) {
      calls.push(data);
    }
  };

  patchWsClientForCardCallbacks(client);

  client.handleEventData({
    headers: [
      { key: "type", value: "card" },
      { key: "message_id", value: "msg_1" }
    ],
    payload: new Uint8Array()
  });

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    headers: [
      { key: "type", value: "event" },
      { key: "message_id", value: "msg_1" }
    ],
    payload: new Uint8Array()
  });
});
