import type { CommandResponse } from "../app/command-service.js";
import type { FeishuReplyContext } from "./types.js";

export type FeishuSdkShape = {
  im?: {
    v1?: {
      message?: {
        reply?: (payload: unknown) => Promise<unknown>;
        create?: (payload: unknown) => Promise<unknown>;
        patch?: (payload: unknown) => Promise<unknown>;
      };
      file?: {
        create?: (payload: unknown) => Promise<unknown>;
      };
    };
  };
};

export class FeishuClient {
  constructor(private readonly client: FeishuSdkShape) {}

  async createCard(chatId: string, card: unknown): Promise<string | undefined> {
    const create = this.client.im?.v1?.message?.create;
    if (!create) {
      throw new Error("Feishu SDK missing message.create");
    }

    const response = await create({
      params: {
        receive_id_type: "chat_id"
      },
      data: {
        receive_id: chatId,
        msg_type: "interactive",
        content: JSON.stringify(card)
      }
    });

    return extractMessageId(response);
  }

  async patchCard(messageId: string, card: unknown): Promise<void> {
    const patch = this.client.im?.v1?.message?.patch;
    if (!patch) {
      throw new Error("Feishu SDK missing message.patch");
    }

    await patch({
      path: {
        message_id: messageId
      },
      data: {
        content: JSON.stringify(card)
      }
    });
  }

  async sendReplyCard(
    replyContext: FeishuReplyContext,
    card: unknown
  ): Promise<string | undefined> {
    const reply = this.client.im?.v1?.message?.reply;
    if (!reply) {
      throw new Error("Feishu SDK missing message.reply");
    }

    const response = await reply({
      path: {
        message_id: replyContext.messageId
      },
      data: withReplyOptions(
        {
          msg_type: "interactive",
          content: JSON.stringify(card)
        },
        replyContext
      )
    });

    return extractMessageId(response);
  }

  async sendCommandResponse(
    replyContext: FeishuReplyContext,
    response: CommandResponse
  ): Promise<void> {
    if (response.kind === "noop") {
      return;
    }

    if (response.kind === "card") {
      await this.replyCard(replyContext, withCardActionContext(response.card, replyContext));
      return;
    }

    if (response.kind === "file") {
      await this.sendFileReply(replyContext, response.filePath, response.body);
      return;
    }

    await this.replyCard(replyContext, withCardActionContext({
      schema: "2.0",
      config: {
        update_multi: true,
        width_mode: "fill"
      },
      header: {
        title: {
          tag: "plain_text",
          content: response.title
        },
        template: resolveCardTemplate(response.title)
      },
      body: {
        elements: [
          {
            tag: "markdown",
            content: sanitizeCardMarkdown(response.body)
          }
        ]
      }
    }, replyContext));
  }

  async replyText(replyContext: FeishuReplyContext, text: string): Promise<void>;
  async replyText(messageId: string, text: string): Promise<void>;
  async replyText(
    replyContextOrMessageId: FeishuReplyContext | string,
    text: string
  ): Promise<void> {
    const reply = this.client.im?.v1?.message?.reply;
    if (!reply) {
      throw new Error("Feishu SDK missing message.reply");
    }
    const replyContext = normalizeReplyContext(replyContextOrMessageId);

    await reply({
      path: {
        message_id: replyContext.messageId
      },
      data: withReplyOptions(
        {
          msg_type: "text",
          content: JSON.stringify({ text })
        },
        replyContext
      )
    });
  }

  async replyCard(replyContext: FeishuReplyContext, card: unknown): Promise<void>;
  async replyCard(messageId: string, card: unknown): Promise<void>;
  async replyCard(
    replyContextOrMessageId: FeishuReplyContext | string,
    card: unknown
  ): Promise<void> {
    const replyContext = normalizeReplyContext(replyContextOrMessageId);
    await this.sendReplyCard(replyContext, card);
  }

  async sendFileReply(
    replyContext: FeishuReplyContext,
    filePath: string,
    caption: string
  ): Promise<void>;
  async sendFileReply(
    chatId: string,
    messageId: string,
    filePath: string,
    caption: string
  ): Promise<void>;
  async sendFileReply(
    arg1: FeishuReplyContext | string,
    arg2: string,
    arg3: string,
    arg4?: string
  ): Promise<void> {
    const createFile = this.client.im?.v1?.file?.create;
    const reply = this.client.im?.v1?.message?.reply;
    if (!createFile || !reply) {
      throw new Error("Feishu SDK missing file/message methods");
    }
    const replyContext =
      typeof arg1 === "string"
        ? {
            chatId: arg1,
            messageId: arg2,
            replyInThread: false
          }
        : arg1;
    const filePath = typeof arg1 === "string" ? arg3 : arg2;
    const caption = typeof arg1 === "string" ? arg4 || "" : arg3;

    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const fileBuffer = await fs.readFile(filePath);
    const uploadResult = (await createFile({
      data: {
        file_type: "stream",
        file_name: path.basename(filePath),
        file: fileBuffer
      }
    })) as { data?: { file_key?: string } };
    const fileKey = uploadResult.data?.file_key;
    if (!fileKey) {
      throw new Error("Feishu file upload missing file_key");
    }

    await reply({
      path: {
        message_id: replyContext.messageId
      },
      data: withReplyOptions(
        {
          msg_type: "text",
          content: JSON.stringify({ text: caption })
        },
        replyContext
      )
    });

    await reply({
      path: {
        message_id: replyContext.messageId
      },
      data: withReplyOptions(
        {
          msg_type: "file",
        content: JSON.stringify({
          file_key: fileKey
        })
        },
        replyContext
      )
    });
  }
}

function withReplyOptions(
  data: {
    msg_type: string;
    content: string;
  },
  replyContext: FeishuReplyContext
): {
  msg_type: string;
  content: string;
  reply_in_thread?: boolean;
} {
  return {
    ...data,
    ...(replyContext.replyInThread ? { reply_in_thread: true } : {})
  };
}

function normalizeReplyContext(
  value: FeishuReplyContext | string
): FeishuReplyContext {
  if (typeof value === "string") {
    return {
      chatId: "",
      messageId: value,
      replyInThread: false
    };
  }

  return value;
}

function resolveCardTemplate(title: string): string {
  if (title.includes("失败")) {
    return "red";
  }
  if (title.includes("成功") || title.includes("已")) {
    return "green";
  }
  if (title.includes("状态")) {
    return "blue";
  }
  return "turquoise";
}

function sanitizeCardMarkdown(text: string): string {
  return String(text || "").replace(/\r\n/g, "\n").trim();
}

function extractMessageId(response: unknown): string | undefined {
  if (!response || typeof response !== "object") {
    return undefined;
  }

  const candidate = response as {
    message_id?: unknown;
    data?: {
      message_id?: unknown;
    };
  };
  if (typeof candidate.message_id === "string" && candidate.message_id.trim()) {
    return candidate.message_id.trim();
  }
  if (
    typeof candidate.data?.message_id === "string" &&
    candidate.data.message_id.trim()
  ) {
    return candidate.data.message_id.trim();
  }
  return undefined;
}

function withCardActionContext(
  card: unknown,
  replyContext: FeishuReplyContext
): unknown {
  if (Array.isArray(card)) {
    return card.map((item) => withCardActionContext(item, replyContext));
  }

  if (!card || typeof card !== "object") {
    return card;
  }

  const record = card as Record<string, unknown>;
  const nextRecord: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (key === "value" && isCardActionValue(value)) {
      nextRecord[key] = {
        ...value,
        ...(replyContext.chatId && value.chat_id == null
          ? { chat_id: replyContext.chatId }
          : {}),
        ...(replyContext.threadId && value.thread_id == null
          ? { thread_id: replyContext.threadId }
          : {}),
        ...(replyContext.rootMessageId && value.root_id == null
          ? { root_id: replyContext.rootMessageId }
          : {}),
        ...(replyContext.parentMessageId && value.parent_id == null
          ? { parent_id: replyContext.parentMessageId }
          : {}),
        ...(value.reply_in_thread == null
          ? { reply_in_thread: replyContext.replyInThread }
          : {})
      };
      continue;
    }

    nextRecord[key] = withCardActionContext(value, replyContext);
  }

  return nextRecord;
}

function isCardActionValue(value: unknown): value is Record<string, unknown> {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      ("command" in value || "kind" in value || "action" in value)
  );
}
