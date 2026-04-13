import { FeishuClient } from "../feishu/client.js";
import type { EnvironmentConfig } from "../config/environment.js";
import type { ApplicationContainer } from "./container.js";
import type { ConversationUpdate } from "./command-service.js";

type LarkModule = {
  AppType: { SelfBuild: string };
  Domain: { Feishu: string };
  LoggerLevel: { info: string };
  Client: new (config: Record<string, unknown>) => unknown;
  WSClient: new (config: Record<string, unknown>) => {
    start: (config: { eventDispatcher: unknown }) => void;
  };
  EventDispatcher: new (config: Record<string, unknown>) => {
    register: (
      handlers: Record<string, (data: unknown) => Promise<unknown> | unknown>
    ) => unknown;
  };
};

export class FeishuBotRuntime {
  constructor(
    private readonly container: ApplicationContainer,
    private readonly config: EnvironmentConfig
  ) {}

  async start(): Promise<void> {
    if (!this.config.feishuAppId || !this.config.feishuAppSecret) {
      console.log("[codex-feishu] Feishu credentials missing, skip bot runtime");
      return;
    }

    const lark = (await import("@larksuiteoapi/node-sdk")) as unknown as LarkModule;
    const client = new lark.Client({
      appId: this.config.feishuAppId,
      appSecret: this.config.feishuAppSecret,
      appType: lark.AppType.SelfBuild,
      domain: lark.Domain.Feishu,
      loggerLevel: lark.LoggerLevel.info
    });
    const wsClient = new lark.WSClient({
      appId: this.config.feishuAppId,
      appSecret: this.config.feishuAppSecret,
      appType: lark.AppType.SelfBuild,
      domain: lark.Domain.Feishu,
      loggerLevel: lark.LoggerLevel.info,
      wsConfig: {
        PingInterval: 30,
        PingTimeout: 5
      }
    });
    patchWsClientForCardCallbacks(wsClient as {
      handleEventData?: (data: unknown) => unknown;
    });

    const feishuClient = new FeishuClient(client as never);
    const eventDispatcher = new lark.EventDispatcher({}).register({
      "im.message.receive_v1": async (data) => {
        console.log("[codex-feishu] received im.message.receive_v1");
        let streamMessageId: string | undefined;
        const dispatch = await this.container.feishu.handleTextEvent(data as never, {
          onConversationUpdate: async (replyContext, update) => {
            const card = buildAssistantReplyCard(replyContext, update);
            if (!streamMessageId) {
              streamMessageId = await feishuClient.sendReplyCard(replyContext, card);
              return;
            }

            await feishuClient.patchCard(streamMessageId, card);
          }
        });
        if (!dispatch) {
          return;
        }

        const { routeResult: result, replyContext } = dispatch;

        if (result.kind === "handled") {
          if (result.result.kind === "noop") {
            return;
          }
          await feishuClient.sendCommandResponse(replyContext, result.result);
          return;
        }

        if (result.kind === "unknown-command") {
          await feishuClient.replyText(
            replyContext,
            `未知命令：/${result.commandName}\n可发送 \`/help\` 查看支持的命令。`
          );
          return;
        }

        if (result.kind === "unhandled") {
          await feishuClient.replyText(
            replyContext,
            `当前命令尚未接入：/${result.commandName}\n可发送 \`/help\` 查看支持的命令。`
          );
        }
      },
      "card.action.trigger": async (data) => {
        void this.handleCardActionAsync(feishuClient, data).catch((error) => {
          console.error(
            `[codex-feishu] failed to process card action: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        });
        return buildCardCallbackResponse("处理中...");
      }
    });

    wsClient.start({ eventDispatcher });
    console.log("[codex-feishu] Feishu bot runtime started");
  }

  private async handleCardActionAsync(
    feishuClient: FeishuClient,
    data: unknown
  ): Promise<void> {
    console.log("[codex-feishu] received card.action.trigger");
    const dispatch = await this.container.feishu.handleCardAction(data as never);
    if (!dispatch) {
      console.warn("[codex-feishu] card action ignored: missing command/context");
      return;
    }

    const { routeResult: result, replyContext } = dispatch;

    if (result.kind === "handled") {
      await feishuClient.sendCommandResponse(replyContext, result.result);
      return;
    }

    if (result.kind === "unknown-command") {
      await feishuClient.replyText(
        replyContext,
        `未知命令：/${result.commandName}\n可发送 \`/help\` 查看支持的命令。`
      );
      return;
    }

    if (result.kind === "unhandled") {
      await feishuClient.replyText(
        replyContext,
        `当前命令尚未接入：/${result.commandName}\n可发送 \`/help\` 查看支持的命令。`
      );
    }
  }
}

export function buildAssistantReplyCard(
  replyContext: {
    threadId?: string;
    rootMessageId?: string;
    parentMessageId?: string;
    replyInThread: boolean;
  },
  update: ConversationUpdate
): Record<string, unknown> {
  const title = resolveAssistantCardTitle(update.state);
  const template = resolveAssistantCardTemplate(update.state);
  const content = sanitizeCardMarkdown(
    update.text ||
      update.errorText ||
      (update.state === "failed" ? "执行失败" : "处理中")
  );
  const statusText = [
    `状态：\`${update.state}\``,
    ...(update.turnId ? [`turn: \`${update.turnId}\``] : []),
    ...(update.model ? [`model: \`${update.model}\``] : []),
    ...(update.effort ? [`effort: \`${update.effort}\``] : [])
  ].join("\n");

  return {
    schema: "2.0",
    config: {
      update_multi: true,
      width_mode: "fill"
    },
    header: {
      title: {
        tag: "plain_text",
        content: title
      },
      template
    },
    body: {
      elements: [
        {
          tag: "markdown",
          content: statusText
        },
        {
          tag: "hr"
        },
        {
          tag: "markdown",
          content: content || "处理中"
        },
        {
          tag: "column_set",
          flex_mode: "none",
          columns: buildAssistantActionColumns(replyContext, update.state)
        }
      ]
    }
  };
}

function buildAssistantActionColumns(
  replyContext: {
    threadId?: string;
    rootMessageId?: string;
    parentMessageId?: string;
    replyInThread: boolean;
  },
  state: ConversationUpdate["state"]
): Array<Record<string, unknown>> {
  const sharedValue = {
    kind: "callback",
    ...(replyContext.threadId ? { thread_id: replyContext.threadId } : {}),
    ...(replyContext.rootMessageId ? { root_id: replyContext.rootMessageId } : {}),
    ...(replyContext.parentMessageId
      ? { parent_id: replyContext.parentMessageId }
      : {}),
    reply_in_thread: replyContext.replyInThread
  };

  const actions =
    state === "starting" || state === "streaming"
      ? [
          {
            label: "中断当前回复",
            command: "/stop",
            type: "danger" as const,
            kind: "panel",
            action: "stop"
          },
          {
            label: "状态",
            command: "/status",
            type: "default" as const,
            kind: "panel",
            action: "status"
          }
        ]
      : [
          {
            label: "新线程",
            command: "/new",
            type: "primary" as const,
            kind: "panel",
            action: "new_thread"
          },
          {
            label: "状态",
            command: "/status",
            type: "default" as const,
            kind: "panel",
            action: "status"
          },
          {
            label: "最近消息",
            command: "/message",
            type: "default" as const,
            kind: "panel",
            action: "show_messages"
          }
        ];

  return actions.map((action) => ({
    tag: "column",
    width: "weighted",
    weight: 1,
    elements: [
      {
        tag: "button",
        text: {
          tag: "plain_text",
          content: action.label
        },
        ...(action.type !== "default" ? { type: action.type } : {}),
        value: {
          ...sharedValue,
          kind: action.kind,
          action: action.action,
          command: action.command
        }
      }
    ]
  }));
}

function resolveAssistantCardTitle(state: ConversationUpdate["state"]): string {
  if (state === "completed") {
    return "Codex 回复";
  }
  if (state === "failed") {
    return "Codex 执行失败";
  }
  return "Codex 正在回复";
}

function resolveAssistantCardTemplate(state: ConversationUpdate["state"]): string {
  if (state === "completed") {
    return "green";
  }
  if (state === "failed") {
    return "red";
  }
  return "turquoise";
}

function sanitizeCardMarkdown(text: string): string {
  return String(text || "").replace(/\r\n/g, "\n").trim();
}

export function patchWsClientForCardCallbacks(wsClient: {
  handleEventData?: (data: unknown) => unknown;
}): void {
  if (!wsClient || typeof wsClient.handleEventData !== "function") {
    return;
  }

  const originalHandleEventData = wsClient.handleEventData.bind(wsClient);
  wsClient.handleEventData = (data: unknown) => {
    if (!data || typeof data !== "object") {
      return originalHandleEventData(data);
    }

    const frame = data as {
      headers?: Array<{ key?: string; value?: string }>;
    };
    const headers = Array.isArray(frame.headers) ? frame.headers : [];
    const messageType = headers.find((header) => header?.key === "type")?.value;
    if (messageType !== "card") {
      return originalHandleEventData(data);
    }

    console.log("[codex-feishu] patch ws frame type card -> event");

    return originalHandleEventData({
      ...frame,
      headers: headers.map((header) =>
        header?.key === "type" ? { ...header, value: "event" } : header
      )
    });
  };
}

function buildCardCallbackResponse(toast: string): Record<string, unknown> {
  return {
    toast: {
      type: "info",
      content: toast
    }
  };
}
