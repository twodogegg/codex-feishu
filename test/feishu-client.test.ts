import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { FeishuClient } from "../src/feishu/client.ts";

function createRecordingSdk() {
  const calls: Array<{ method: string; payload: unknown }> = [];

  return {
    calls,
    sdk: {
      im: {
        v1: {
          message: {
            reply: async (payload: unknown) => {
              calls.push({ method: "reply", payload });
              return {};
            },
            create: async (payload: unknown) => {
              calls.push({ method: "create", payload });
              return {};
            },
            patch: async (payload: unknown) => {
              calls.push({ method: "patch", payload });
              return {};
            }
          },
          file: {
            create: async (payload: unknown) => {
              calls.push({ method: "file.create", payload });
              return {
                data: {
                  file_key: "file_key_1"
                }
              };
            }
          }
        }
      }
    }
  } as const;
}

test("replyText 在话题回复模式下会带 reply_in_thread", async () => {
  const { calls, sdk } = createRecordingSdk();
  const client = new FeishuClient(sdk);

  await client.replyText(
    {
      chatId: "oc_chat_1",
      messageId: "om_reply_1",
      threadId: "ot_topic_1",
      replyInThread: true
    },
    "hello"
  );

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    method: "reply",
    payload: {
      path: {
        message_id: "om_reply_1"
      },
      data: {
        msg_type: "text",
        content: JSON.stringify({ text: "hello" }),
        reply_in_thread: true
      }
    }
  });
});

test("replyCard 在话题回复模式下会带 reply_in_thread", async () => {
  const { calls, sdk } = createRecordingSdk();
  const client = new FeishuClient(sdk);

  await client.replyCard(
    {
      chatId: "oc_chat_1",
      messageId: "om_reply_2",
      rootMessageId: "om_root_1",
      parentMessageId: "om_parent_1",
      threadId: "ot_topic_1",
      replyInThread: true
    },
    {
      schema: "2.0",
      config: {
        update_multi: true,
        width_mode: "fill"
      },
      header: {
        title: {
          tag: "plain_text",
          content: "状态"
        },
        template: "blue"
      },
      body: {
        elements: []
      }
    }
  );

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    method: "reply",
    payload: {
      path: {
        message_id: "om_reply_2"
      },
      data: {
        msg_type: "interactive",
        content: JSON.stringify({
          schema: "2.0",
          config: {
            update_multi: true,
            width_mode: "fill"
          },
          header: {
            title: {
              tag: "plain_text",
              content: "状态"
            },
            template: "blue"
          },
          body: {
            elements: []
          }
        }),
        reply_in_thread: true
      }
    }
  });
});

test("sendFileReply 在话题回复模式下会保留话题回复标志", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-feishu-client-"));
  const filePath = path.join(tempDir, "report.txt");
  fs.writeFileSync(filePath, "hello world", "utf8");

  const { calls, sdk } = createRecordingSdk();
  const client = new FeishuClient(sdk);

  await client.sendFileReply(
    {
      chatId: "oc_chat_1",
      messageId: "om_reply_3",
      threadId: "ot_topic_1",
      replyInThread: true
    },
    filePath,
    "附件已发送"
  );

  assert.equal(calls.length, 3);
  assert.deepEqual(calls[0], {
    method: "file.create",
    payload: {
      data: {
        file_type: "stream",
        file_name: "report.txt",
        file: Buffer.from("hello world", "utf8")
      }
    }
  });
  assert.deepEqual(calls[1], {
    method: "reply",
    payload: {
      path: {
        message_id: "om_reply_3"
      },
      data: {
        msg_type: "text",
        content: JSON.stringify({ text: "附件已发送" }),
        reply_in_thread: true
      }
    }
  });
  assert.deepEqual(calls[2], {
    method: "reply",
    payload: {
      path: {
        message_id: "om_reply_3"
      },
      data: {
        msg_type: "file",
        reply_in_thread: true,
        content: JSON.stringify({
          file_key: "file_key_1"
        })
      }
    }
  });
});

test("createCard 会创建新的 interactive 消息", async () => {
  const { calls, sdk } = createRecordingSdk();
  const client = new FeishuClient(sdk);

  await client.createCard("oc_chat_2", {
    schema: "2.0",
    body: {
      elements: []
    }
  });

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    method: "create",
    payload: {
      params: {
        receive_id_type: "chat_id"
      },
      data: {
        receive_id: "oc_chat_2",
        msg_type: "interactive",
        content: JSON.stringify({
          schema: "2.0",
          body: {
            elements: []
          }
        })
      }
    }
  });
});

test("patchCard 会原地更新 interactive 消息", async () => {
  const { calls, sdk } = createRecordingSdk();
  const client = new FeishuClient(sdk);

  await client.patchCard("om_patch_1", {
    schema: "2.0",
    body: {
      elements: [
        {
          tag: "markdown",
          content: "updated"
        }
      ]
    }
  });

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    method: "patch",
    payload: {
      path: {
        message_id: "om_patch_1"
      },
      data: {
        content: JSON.stringify({
          schema: "2.0",
          body: {
            elements: [
              {
                tag: "markdown",
                content: "updated"
              }
            ]
          }
        })
      }
    }
  });
});

test("sendCommandResponse 会把话题上下文注入卡片按钮 payload", async () => {
  const { calls, sdk } = createRecordingSdk();
  const client = new FeishuClient(sdk);

  await client.sendCommandResponse(
    {
      chatId: "oc_chat_ctx",
      messageId: "om_reply_ctx",
      threadId: "ot_ctx_1",
      rootMessageId: "om_root_ctx",
      parentMessageId: "om_parent_ctx",
      replyInThread: true
    },
    {
      kind: "card",
      title: "我的 Workspaces",
      card: {
        schema: "2.0",
        body: {
          elements: [
            {
              tag: "button",
              text: {
                tag: "plain_text",
                content: "进入"
              },
              value: {
                kind: "callback",
                command: "/workspace status default"
              }
            }
          ]
        }
      }
    }
  );

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    method: "reply",
    payload: {
      path: {
        message_id: "om_reply_ctx"
      },
      data: {
        msg_type: "interactive",
        content: JSON.stringify({
          schema: "2.0",
          body: {
            elements: [
              {
                tag: "button",
                text: {
                  tag: "plain_text",
                  content: "进入"
                },
                value: {
                  kind: "callback",
                  command: "/workspace status default",
                  chat_id: "oc_chat_ctx",
                  thread_id: "ot_ctx_1",
                  root_id: "om_root_ctx",
                  parent_id: "om_parent_ctx",
                  reply_in_thread: true
                }
              }
            ]
          }
        }),
        reply_in_thread: true
      }
    }
  });
});
