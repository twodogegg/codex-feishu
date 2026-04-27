import type { CommandResponse } from "../app/command-service.js";
import type { FeishuReplyContext } from "./types.js";

export type FeishuSdkShape = {
  im?: {
    v1?: {
      message?: {
        reply?: (payload: unknown) => Promise<unknown>;
        create?: (payload: unknown) => Promise<unknown>;
        patch?: (payload: unknown) => Promise<unknown>;
        delete?: (payload: unknown) => Promise<unknown>;
        pushFollowUp?: (payload: unknown) => Promise<unknown>;
        readUsers?: (payload: unknown) => Promise<unknown>;
      };
      pin?: {
        create?: (payload: unknown) => Promise<unknown>;
      };
      reaction?: {
        create?: (payload: unknown) => Promise<unknown>;
      };
      file?: {
        create?: (payload: unknown) => Promise<unknown>;
      };
      image?: {
        create?: (payload: unknown) => Promise<unknown>;
      };
    };
  };
  interactive?: {
    v1?: {
      card?: {
        update?: (payload: unknown) => Promise<unknown>;
      };
    };
  };
  ephemeral?: {
    v1?: {
      send?: (payload: unknown) => Promise<unknown>;
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

  async deleteMessage(messageId: string): Promise<void> {
    const remove = this.client.im?.v1?.message?.delete;
    if (!remove) {
      throw new Error("Feishu SDK missing message.delete");
    }

    await remove({
      path: {
        message_id: messageId
      }
    });
  }

  async delayUpdateCard(updateToken: string, card: unknown): Promise<void> {
    const update = this.client.interactive?.v1?.card?.update;
    if (!update) {
      throw new Error("Feishu SDK missing interactive.v1.card.update");
    }

    await update({
      data: {
        token: updateToken,
        card
      }
    });
  }

  async sendEphemeralCard(
    chatId: string,
    openId: string,
    card: unknown
  ): Promise<string | undefined> {
    const send = this.client.ephemeral?.v1?.send;
    if (!send) {
      throw new Error("Feishu SDK missing ephemeral.v1.send");
    }

    const response = await send({
      data: {
        open_id: openId,
        chat_id: chatId,
        msg_type: "interactive",
        card
      }
    });

    return extractMessageId(response);
  }

  async pushFollowUp(
    messageId: string,
    followUps: Array<{ content: string }>
  ): Promise<void> {
    const pushFollowUp = this.client.im?.v1?.message?.pushFollowUp;
    if (!pushFollowUp) {
      throw new Error("Feishu SDK missing message.pushFollowUp");
    }

    await pushFollowUp({
      path: {
        message_id: messageId
      },
      data: {
        follow_ups: followUps
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
    await this.sendCommandResponseWithMessageIds(replyContext, response);
  }

  async sendCommandResponseWithMessageIds(
    replyContext: FeishuReplyContext,
    response: CommandResponse
  ): Promise<string[]> {
    if (response.kind === "noop") {
      return [];
    }

    if (response.kind === "card") {
      const messageId = await this.replyCard(
        replyContext,
        withCardActionContext(response.card, replyContext)
      );
      return messageId ? [messageId] : [];
    }

    if (response.kind === "file") {
      if (isImagePath(response.filePath)) {
        return this.sendImageReply(replyContext, response.filePath, response.body);
      }
      return this.sendFileReply(replyContext, response.filePath, response.body);
    }

    const messageId = await this.replyCard(replyContext, withCardActionContext({
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
    return messageId ? [messageId] : [];
  }

  async replyText(replyContext: FeishuReplyContext, text: string): Promise<string | undefined>;
  async replyText(messageId: string, text: string): Promise<string | undefined>;
  async replyText(
    replyContextOrMessageId: FeishuReplyContext | string,
    text: string
  ): Promise<string | undefined> {
    const reply = this.client.im?.v1?.message?.reply;
    if (!reply) {
      throw new Error("Feishu SDK missing message.reply");
    }
    const replyContext = normalizeReplyContext(replyContextOrMessageId);

    const response = await reply({
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
    return extractMessageId(response);
  }

  async replyCard(replyContext: FeishuReplyContext, card: unknown): Promise<string | undefined>;
  async replyCard(messageId: string, card: unknown): Promise<string | undefined>;
  async replyCard(
    replyContextOrMessageId: FeishuReplyContext | string,
    card: unknown
  ): Promise<string | undefined> {
    const replyContext = normalizeReplyContext(replyContextOrMessageId);
    return this.sendReplyCard(replyContext, card);
  }

  async sendFileReply(
    replyContext: FeishuReplyContext,
    filePath: string,
    caption: string
  ): Promise<string[]>;
  async sendFileReply(
    chatId: string,
    messageId: string,
    filePath: string,
    caption: string
  ): Promise<string[]>;
  async sendFileReply(
    arg1: FeishuReplyContext | string,
    arg2: string,
    arg3: string,
    arg4?: string
  ): Promise<string[]> {
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

    const captionResponse = await reply({
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

    const fileResponse = await reply({
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

    const sentIds = [
      extractMessageId(captionResponse),
      extractMessageId(fileResponse)
    ].filter((item): item is string => Boolean(item));
    return sentIds;
  }

  async sendImageReply(
    replyContext: FeishuReplyContext,
    filePath: string,
    caption: string
  ): Promise<string[]> {
    const createImage = this.client.im?.v1?.image?.create;
    const reply = this.client.im?.v1?.message?.reply;
    if (!createImage || !reply) {
      throw new Error("Feishu SDK missing image/message methods");
    }

    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const imageBuffer = await fs.readFile(filePath);
    const uploadResult = (await createImage({
      data: {
        image_type: "message",
        image_name: path.basename(filePath),
        image: imageBuffer
      }
    })) as { data?: { image_key?: string } };
    const imageKey = uploadResult.data?.image_key;
    if (!imageKey) {
      throw new Error("Feishu image upload missing image_key");
    }

    const sentIds: Array<string | undefined> = [];
    if (caption.trim()) {
      const captionResponse = await reply({
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
      sentIds.push(extractMessageId(captionResponse));
    }

    const imageResponse = await reply({
      path: {
        message_id: replyContext.messageId
      },
      data: withReplyOptions(
        {
          msg_type: "image",
          content: JSON.stringify({
            image_key: imageKey
          })
        },
        replyContext
      )
    });
    sentIds.push(extractMessageId(imageResponse));
    return sentIds.filter((item): item is string => Boolean(item));
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

function isImagePath(filePath: string): boolean {
  const lowerPath = filePath.toLowerCase();
  return (
    lowerPath.endsWith(".png") ||
    lowerPath.endsWith(".jpg") ||
    lowerPath.endsWith(".jpeg") ||
    lowerPath.endsWith(".gif") ||
    lowerPath.endsWith(".bmp") ||
    lowerPath.endsWith(".webp") ||
    lowerPath.endsWith(".heic")
  );
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
