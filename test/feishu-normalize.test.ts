import test from "node:test";
import assert from "node:assert/strict";

import { normalizeFeishuTextEvent } from "../src/feishu/index.ts";

test("群聊里 @ 机器人后命令会被保留", () => {
  const result = normalizeFeishuTextEvent(
    {
      header: { event_id: "evt_1" },
      event: {
        sender: {
          sender_id: {
            open_id: "ou_user"
          },
          sender_type: "user"
        },
        message: {
          message_id: "om_1",
          chat_id: "oc_1",
          chat_type: "group",
          content: JSON.stringify({
            text: '<at user_id="ou_bot">bot</at> /bind default'
          }),
          mentions: [
            {
              id: {
                open_id: "ou_bot"
              },
              name: "bot"
            }
          ]
        }
      }
    },
    {
      botOpenId: "ou_bot",
      requireBotMentionInGroup: true
    }
  );

  assert.equal(result.context.mention.shouldHandle, true);
  assert.equal(result.text, "/bind default");
  assert.equal(result.input.kind, "command");
});

test("未 @ 机器人时群聊 shouldHandle 为 false", () => {
  const result = normalizeFeishuTextEvent(
    {
      event: {
        sender: {
          sender_id: {
            open_id: "ou_user"
          }
        },
        message: {
          message_id: "om_1",
          chat_id: "oc_1",
          chat_type: "group",
          content: JSON.stringify({
            text: "hello"
          }),
          mentions: []
        }
      }
    },
    {
      botOpenId: "ou_bot",
      requireBotMentionInGroup: true
    }
  );

  assert.equal(result.context.mention.shouldHandle, false);
});

test("群聊话题消息会保留 root_id parent_id thread_id", () => {
  const result = normalizeFeishuTextEvent(
    {
      header: { event_id: "evt_topic_1" },
      event: {
        sender: {
          sender_id: {
            open_id: "ou_user"
          },
          sender_type: "user"
        },
        message: {
          message_id: "om_topic_1",
          root_id: "om_root_1",
          parent_id: "om_parent_1",
          thread_id: "ot_topic_1",
          chat_id: "oc_1",
          chat_type: "group",
          content: JSON.stringify({
            text: '<at user_id="ou_bot">bot</at> /status'
          }),
          mentions: [
            {
              id: {
                open_id: "ou_bot"
              },
              name: "bot"
            }
          ]
        }
      }
    },
    {
      botOpenId: "ou_bot",
      requireBotMentionInGroup: true
    }
  );

  assert.equal(result.context.eventId, "evt_topic_1");
  assert.equal(result.context.rootMessageId, "om_root_1");
  assert.equal(result.context.parentMessageId, "om_parent_1");
  assert.equal(result.context.threadId, "ot_topic_1");
  assert.equal(result.context.mention.shouldHandle, true);
  assert.equal(result.input.kind, "command");
  assert.equal(result.text, "/status");
});

test("会保留飞书话题上下文", () => {
  const result = normalizeFeishuTextEvent(
    {
      event: {
        sender: {
          sender_id: {
            open_id: "ou_user"
          }
        },
        message: {
          message_id: "om_1",
          chat_id: "oc_1",
          chat_type: "group",
          root_id: "om_root",
          parent_id: "om_parent",
          thread_id: "omt_topic",
          content: JSON.stringify({
            text: '<at user_id="ou_bot">bot</at> /where'
          }),
          mentions: [
            {
              id: {
                open_id: "ou_bot"
              },
              name: "bot"
            }
          ]
        }
      }
    },
    {
      botOpenId: "ou_bot",
      requireBotMentionInGroup: true
    }
  );

  assert.equal(result.context.rootMessageId, "om_root");
  assert.equal(result.context.parentMessageId, "om_parent");
  assert.equal(result.context.threadId, "omt_topic");
});
