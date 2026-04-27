import test from "node:test";
import assert from "node:assert/strict";

import { FeishuMessageService } from "../src/app/feishu-message-service.ts";
import type { CommandResponse } from "../src/app/command-service.ts";
import type { CommandRouteResult } from "../src/types/commands.ts";
import type { FeishuTextMessageEvent } from "../src/feishu/index.ts";

test("群聊话题消息会把 thread_id 传入命令执行上下文", async () => {
  const calls: Array<{
    input: unknown;
    session: {
      actor: {
        openId: string;
        displayName: string;
        unionId?: string;
        userId?: string;
      };
      chatId: string;
      threadKey?: string;
    };
  }> = [];

  const commands = {
    executeInput: async (
      input: unknown,
      session: {
        actor: {
          openId: string;
          displayName: string;
          unionId?: string;
          userId?: string;
        };
        chatId: string;
        threadKey?: string;
      }
    ): Promise<CommandRouteResult<CommandResponse>> => {
      calls.push({ input, session });
      return {
        kind: "handled",
        commandName: "message",
        result: {
          kind: "message",
          title: "ok",
          body: "done"
        }
      };
    }
  };

  const service = new FeishuMessageService(commands as never, {
    botOpenId: "ou_bot",
    requireBotMentionInGroup: true
  });

  const result = await service.handleTextEvent({
    header: {
      event_id: "evt_topic_1"
    },
    event: {
      sender: {
        sender_id: {
          open_id: "ou_user",
          user_id: "user_1"
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
  } as FeishuTextMessageEvent);

  assert.equal(result?.routeResult.kind, "handled");
  assert.equal(result?.replyContext.replyInThread, true);
  assert.equal(result?.replyContext.threadId, "ot_topic_1");
  assert.equal(result?.replyContext.rootMessageId, "om_root_1");
  assert.equal(result?.replyContext.parentMessageId, "om_parent_1");
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.session.chatId, "oc_1");
  assert.equal(calls[0]?.session.threadKey, "ot_topic_1");
  assert.equal(
    (calls[0]?.input as { kind?: string } | undefined)?.kind,
    "command"
  );
});

test("相同 event_id 的飞书消息只会处理一次", async () => {
  let callCount = 0;
  const commands = {
    executeInput: async (): Promise<CommandRouteResult<CommandResponse>> => {
      callCount += 1;
      return {
        kind: "handled",
        commandName: "message",
        result: {
          kind: "message",
          title: "ok",
          body: "done"
        }
      };
    }
  };

  const service = new FeishuMessageService(commands as never, {
    botOpenId: "ou_bot",
    requireBotMentionInGroup: true
  });

  const event = {
    header: {
      event_id: "evt_dup_1"
    },
    event: {
      sender: {
        sender_id: {
          open_id: "ou_user"
        },
        sender_type: "user"
      },
      message: {
        message_id: "om_dup_1",
        chat_id: "oc_1",
        chat_type: "group",
        content: JSON.stringify({
          text: '<at user_id="ou_bot">bot</at> 你是谁？'
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
  } as FeishuTextMessageEvent;

  const first = await service.handleTextEvent(event);
  const second = await service.handleTextEvent(event);

  assert.equal(first?.routeResult.kind, "handled");
  assert.equal(second, null);
  assert.equal(callCount, 1);
});

test("机器人自己发送的文本消息不会再次进入命令处理", async () => {
  let callCount = 0;
  const commands = {
    executeInput: async (): Promise<CommandRouteResult<CommandResponse>> => {
      callCount += 1;
      return {
        kind: "handled",
        commandName: "message",
        result: {
          kind: "message",
          title: "ok",
          body: "done"
        }
      };
    }
  };

  const service = new FeishuMessageService(commands as never, {
    botOpenId: "ou_bot",
    requireBotMentionInGroup: false
  });

  const result = await service.handleTextEvent({
    header: {
      event_id: "evt_self_1"
    },
    event: {
      sender: {
        sender_id: {
          open_id: "ou_bot"
        },
        sender_type: "bot"
      },
      message: {
        message_id: "om_self_1",
        chat_id: "oc_1",
        chat_type: "p2p",
        content: JSON.stringify({
          text: "我是机器人自己发的消息"
        }),
        mentions: []
      }
    }
  } as FeishuTextMessageEvent);

  assert.equal(result, null);
  assert.equal(callCount, 0);
});

test("卡片回调会优先使用 value.chat_id 恢复会话上下文", async () => {
  const calls: Array<{
    text: string;
    session: {
      actor: {
        openId: string;
        displayName: string;
        unionId?: string;
        userId?: string;
      };
      chatId: string;
      threadKey?: string;
    };
  }> = [];

  const commands = {
    executeText: async (
      text: string,
      session: {
        actor: {
          openId: string;
          displayName: string;
          unionId?: string;
          userId?: string;
        };
        chatId: string;
        threadKey?: string;
      }
    ): Promise<CommandRouteResult<CommandResponse>> => {
      calls.push({ text, session });
      return {
        kind: "handled",
        commandName: "agents",
        result: {
          kind: "message",
          title: "ok",
          body: "done"
        }
      };
    }
  };

  const service = new FeishuMessageService(commands as never, {
    botOpenId: "ou_bot",
    requireBotMentionInGroup: false
  });

  const result = await service.handleCardAction({
    open_message_id: "om_card_1",
    open_id: "ou_user",
    action: {
      value: {
        command: "/agents status default",
        chat_id: "oc_card_1",
        thread_id: "ot_card_1",
        root_id: "om_root_1",
        parent_id: "om_parent_1",
        reply_in_thread: true
      }
    }
  });

  assert.equal(result?.routeResult.kind, "handled");
  assert.equal(result?.replyContext.chatId, "oc_card_1");
  assert.equal(result?.replyContext.messageId, "om_card_1");
  assert.equal(result?.replyContext.threadId, "ot_card_1");
  assert.equal(result?.replyContext.rootMessageId, "om_root_1");
  assert.equal(result?.replyContext.parentMessageId, "om_parent_1");
  assert.equal(result?.replyContext.replyInThread, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.text, "/agents status default");
  assert.equal(calls[0]?.session.chatId, "oc_card_1");
  assert.equal(calls[0]?.session.threadKey, "ot_card_1");
});

test("图片消息会被识别并返回 image_key 回执", async () => {
  let callCount = 0;
  const commands = {
    executeInput: async (): Promise<CommandRouteResult<CommandResponse>> => {
      callCount += 1;
      return {
        kind: "handled",
        commandName: "message",
        result: {
          kind: "message",
          title: "ok",
          body: "done"
        }
      };
    }
  };

  const service = new FeishuMessageService(commands as never, {
    botOpenId: "ou_bot",
    requireBotMentionInGroup: false
  });

  const result = await service.handleTextEvent({
    header: {
      event_id: "evt_img_1"
    },
    event: {
      sender: {
        sender_id: {
          open_id: "ou_user"
        },
        sender_type: "user"
      },
      message: {
        message_id: "om_img_1",
        chat_id: "oc_1",
        chat_type: "p2p",
        message_type: "image",
        content: JSON.stringify({
          image_key: "img_v3_123"
        })
      }
    }
  } as FeishuTextMessageEvent);

  assert.equal(callCount, 0);
  assert.equal(result?.routeResult.kind, "handled");
  if (result?.routeResult.kind === "handled") {
    assert.equal(result.routeResult.commandName, "message");
    assert.equal(result.routeResult.result.kind, "message");
    assert.equal(result.routeResult.result.title, "已收到图片");
    assert.match(result.routeResult.result.body, /img_v3_123/);
  }
});
