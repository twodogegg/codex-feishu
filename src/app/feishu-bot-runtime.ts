import { FeishuClient } from "../feishu/client.js";
import type { EnvironmentConfig } from "../config/environment.js";
import type { ApplicationContainer } from "./container.js";
import type { ConversationUpdate } from "./command-service.js";
import type { FeishuReplyContext } from "../feishu/types.js";

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
  private readonly recentBotMessageIds = new Map<string, string[]>();
  private readonly latestBotMessageByChat = new Map<string, string>();
  private readonly latestInboundMessageByChat = new Map<string, string>();

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
        let updateQueue = Promise.resolve();
        const dispatch = await this.container.feishu.handleTextEvent(data as never, {
          onConversationUpdate: (replyContext, update) => {
            updateQueue = updateQueue
              .then(async () => {
                const card = buildAssistantReplyCard(replyContext, update);
                if (!streamMessageId) {
                  streamMessageId = await feishuClient.sendReplyCard(replyContext, card);
                  if (streamMessageId) {
                    this.rememberBotMessage(replyContext, streamMessageId);
                  }
                  return;
                }

                await feishuClient.patchCard(streamMessageId, card);
                if (
                  update.state === "completed" &&
                  replyContext.chatType === "p2p"
                ) {
                  if (!streamMessageId) {
                    return;
                  }
                  const latestInbound = this.latestInboundMessageByChat.get(replyContext.chatId);
                  if (latestInbound && latestInbound !== replyContext.messageId) {
                    return;
                  }
                  const latestBot = this.latestBotMessageByChat.get(replyContext.chatId);
                  if (latestBot && latestBot !== streamMessageId) {
                    return;
                  }
                  await pushFollowUpWithFallback(
                    feishuClient,
                    [streamMessageId],
                    [
                      { content: "我不是这个意思" },
                      { content: "继续" },
                      { content: "重做" }
                    ]
                  );
                }
              })
              .catch((error) => {
                console.error(
                  `[codex-feishu] conversation update failed: ${
                    error instanceof Error ? error.message : String(error)
                  }`
                );
              });
            return updateQueue;
          }
        });
        if (!dispatch) {
          return;
        }

        const { routeResult: result, replyContext, actorOpenId } = dispatch;
        this.latestInboundMessageByChat.set(replyContext.chatId, replyContext.messageId);

        if (result.kind === "handled") {
          if (result.result.kind === "noop") {
            return;
          }
          if (
            result.result.kind === "card" &&
            replyContext.chatType === "group" &&
            shouldUseEphemeralCard(result.commandName)
          ) {
            await feishuClient
              .sendEphemeralCard(
                replyContext.chatId,
                actorOpenId,
                attachCardActionContext(replyContext, result.result.card)
              )
              .catch(async () => {
                await feishuClient.sendCommandResponse(replyContext, result.result);
              });
            return;
          }
          if (result.commandName === "recall") {
            await this.handleRecallCommand(feishuClient, replyContext);
            return;
          }
          const sentIds = await feishuClient.sendCommandResponseWithMessageIds(
            replyContext,
            result.result
          );
          this.rememberBotMessages(replyContext, sentIds);
          return;
        }

        if (result.kind === "unknown-command") {
          const messageId = await feishuClient.replyText(
            replyContext,
            `未知命令：/${result.commandName}\n可发送 \`/help\` 查看支持的命令。`
          );
          if (messageId) {
            this.rememberBotMessage(replyContext, messageId);
          }
          return;
        }

        if (result.kind === "unhandled") {
          const messageId = await feishuClient.replyText(
            replyContext,
            `当前命令尚未接入：/${result.commandName}\n可发送 \`/help\` 查看支持的命令。`
          );
          if (messageId) {
            this.rememberBotMessage(replyContext, messageId);
          }
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
    const callbackToken = extractCardCallbackToken(data);
    const shouldDeleteSourceMessage = shouldDeleteHelpCardSourceMessage(data);
    const sourceMessageId = extractCardActionMessageId(data);

    if (result.kind === "handled") {
      if (
        !shouldDeleteSourceMessage &&
        callbackToken &&
        result.result.kind === "card"
      ) {
        await feishuClient
          .delayUpdateCard(
            callbackToken,
            attachCardActionContext(replyContext, result.result.card)
          )
          .catch(async () => {
            await feishuClient.sendCommandResponse(replyContext, result.result);
          });
        return;
      }
      if (result.commandName === "recall") {
        await this.handleRecallCommand(feishuClient, replyContext);
        return;
      }
      const sentIds = await feishuClient.sendCommandResponseWithMessageIds(
        replyContext,
        result.result
      );
      this.rememberBotMessages(replyContext, sentIds);
      if (shouldDeleteSourceMessage && sourceMessageId) {
        await feishuClient.deleteMessage(sourceMessageId).catch(() => undefined);
      }
      return;
    }

    if (result.kind === "unknown-command") {
      const messageId = await feishuClient.replyText(
        replyContext,
        `未知命令：/${result.commandName}\n可发送 \`/help\` 查看支持的命令。`
      );
      if (messageId) {
        this.rememberBotMessage(replyContext, messageId);
      }
      return;
    }

    if (result.kind === "unhandled") {
      const messageId = await feishuClient.replyText(
        replyContext,
        `当前命令尚未接入：/${result.commandName}\n可发送 \`/help\` 查看支持的命令。`
      );
      if (messageId) {
        this.rememberBotMessage(replyContext, messageId);
      }
    }
  }

  private async handleRecallCommand(
    feishuClient: FeishuClient,
    replyContext: FeishuReplyContext
  ): Promise<void> {
    const messageId = this.popRecentBotMessage(replyContext);
    if (!messageId) {
      const noticeId = await feishuClient.replyText(
        replyContext,
        "当前会话还没有可撤回的机器人消息。"
      );
      if (noticeId) {
        this.rememberBotMessage(replyContext, noticeId);
      }
      return;
    }

    await feishuClient.deleteMessage(messageId).catch(async () => {
      const failedNoticeId = await feishuClient.replyText(
        replyContext,
        "撤回失败，请稍后再试。"
      );
      if (failedNoticeId) {
        this.rememberBotMessage(replyContext, failedNoticeId);
      }
    });
  }

  private rememberBotMessages(
    replyContext: FeishuReplyContext,
    messageIds: string[]
  ): void {
    for (const messageId of messageIds) {
      this.rememberBotMessage(replyContext, messageId);
    }
  }

  private rememberBotMessage(
    replyContext: FeishuReplyContext,
    messageId: string
  ): void {
    const key = buildRecentMessageKey(replyContext);
    const queue = this.recentBotMessageIds.get(key) || [];
    queue.push(messageId);
    while (queue.length > 30) {
      queue.shift();
    }
    this.recentBotMessageIds.set(key, queue);
    this.latestBotMessageByChat.set(replyContext.chatId, messageId);
  }

  private popRecentBotMessage(
    replyContext: FeishuReplyContext
  ): string | undefined {
    const key = buildRecentMessageKey(replyContext);
    const queue = this.recentBotMessageIds.get(key);
    if (!queue || queue.length === 0) {
      return undefined;
    }

    const messageId = queue.pop();
    if (queue.length === 0) {
      this.recentBotMessageIds.delete(key);
    } else {
      this.recentBotMessageIds.set(key, queue);
    }
    return messageId;
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

export type StreamingSentenceState = {
  lastAggregatedText: string;
  pendingBuffer: string;
};

export function collectSentencesForStreaming(
  update: ConversationUpdate,
  state: StreamingSentenceState
): string[] {
  if (update.state !== "streaming" && update.state !== "completed") {
    return [];
  }

  const aggregated = String(update.text || "");
  const delta = aggregated.startsWith(state.lastAggregatedText)
    ? aggregated.slice(state.lastAggregatedText.length)
    : aggregated;
  state.lastAggregatedText = aggregated;

  if (!delta) {
    if (update.state === "completed" && state.pendingBuffer.trim()) {
      const tail = state.pendingBuffer.trim();
      state.pendingBuffer = "";
      return [tail];
    }
    return [];
  }

  state.pendingBuffer += delta;
  const sentences = splitCompleteSentences(state.pendingBuffer);
  state.pendingBuffer = sentences.rest;

  const finalized = sentences.items
    .map((item) => item.trim())
    .filter((item) => Boolean(item));
  if (update.state === "completed" && state.pendingBuffer.trim()) {
    finalized.push(state.pendingBuffer.trim());
    state.pendingBuffer = "";
  }
  return finalized;
}

function splitCompleteSentences(buffer: string): {
  items: string[];
  rest: string;
} {
  if (!buffer) {
    return { items: [], rest: "" };
  }

  const items: string[] = [];
  let cursor = 0;
  for (let index = 0; index < buffer.length; index += 1) {
    const char = buffer[index];
    if (!char || !isSentenceBoundary(char)) {
      continue;
    }
    const item = buffer.slice(cursor, index + 1);
    if (item.trim()) {
      items.push(item);
    }
    cursor = index + 1;
  }

  return {
    items,
    rest: buffer.slice(cursor)
  };
}

function isSentenceBoundary(char: string): boolean {
  return (
    char === "\n" ||
    char === "。" ||
    char === "！" ||
    char === "？" ||
    char === "!" ||
    char === "?" ||
    char === ";" ||
    char === "；"
  );
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

function shouldUseEphemeralCard(commandName: string): boolean {
  return commandName === "help" || commandName === "model" || commandName === "skills";
}

function attachCardActionContext(
  replyContext: {
    chatId: string;
    threadId?: string;
    rootMessageId?: string;
    parentMessageId?: string;
    replyInThread: boolean;
  },
  card: unknown
): unknown {
  if (Array.isArray(card)) {
    return card.map((item) => attachCardActionContext(replyContext, item));
  }
  if (!card || typeof card !== "object") {
    return card;
  }

  const record = card as Record<string, unknown>;
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (key === "value" && value && typeof value === "object" && !Array.isArray(value)) {
      const actionValue = value as Record<string, unknown>;
      next[key] = {
        ...actionValue,
        ...(replyContext.chatId && actionValue.chat_id == null
          ? { chat_id: replyContext.chatId }
          : {}),
        ...(replyContext.threadId && actionValue.thread_id == null
          ? { thread_id: replyContext.threadId }
          : {}),
        ...(replyContext.rootMessageId && actionValue.root_id == null
          ? { root_id: replyContext.rootMessageId }
          : {}),
        ...(replyContext.parentMessageId && actionValue.parent_id == null
          ? { parent_id: replyContext.parentMessageId }
          : {}),
        ...(actionValue.reply_in_thread == null
          ? { reply_in_thread: replyContext.replyInThread }
          : {})
      };
      continue;
    }
    next[key] = attachCardActionContext(replyContext, value);
  }
  return next;
}

function extractCardCallbackToken(data: unknown): string | undefined {
  if (!data || typeof data !== "object") {
    return undefined;
  }

  const payload = data as {
    token?: unknown;
    event?: {
      token?: unknown;
    };
  };
  if (typeof payload.event?.token === "string" && payload.event.token.trim()) {
    return payload.event.token.trim();
  }
  if (typeof payload.token === "string" && payload.token.trim()) {
    return payload.token.trim();
  }
  return undefined;
}

function extractCardActionMessageId(data: unknown): string | undefined {
  if (!data || typeof data !== "object") {
    return undefined;
  }

  const payload = data as {
    open_message_id?: unknown;
    context?: {
      open_message_id?: unknown;
    };
    event?: {
      context?: {
        open_message_id?: unknown;
      };
    };
  };

  const eventMessageId = payload.event?.context?.open_message_id;
  if (typeof eventMessageId === "string" && eventMessageId.trim()) {
    return eventMessageId.trim();
  }
  const contextMessageId = payload.context?.open_message_id;
  if (typeof contextMessageId === "string" && contextMessageId.trim()) {
    return contextMessageId.trim();
  }
  if (
    typeof payload.open_message_id === "string" &&
    payload.open_message_id.trim()
  ) {
    return payload.open_message_id.trim();
  }
  return undefined;
}

function buildRecentMessageKey(replyContext: FeishuReplyContext): string {
  return [
    replyContext.chatId,
    replyContext.threadId || "",
    replyContext.rootMessageId || "",
    replyContext.parentMessageId || "",
    replyContext.replyInThread ? "1" : "0"
  ].join("|");
}

async function pushFollowUpWithFallback(
  feishuClient: FeishuClient,
  candidateMessageIds: Array<string | undefined>,
  followUps: Array<{ content: string }>
): Promise<void> {
  const tried = new Set<string>();
  for (const candidateId of candidateMessageIds) {
    const messageId = String(candidateId || "").trim();
    if (!messageId || tried.has(messageId)) {
      continue;
    }
    tried.add(messageId);
    try {
      await sendFollowUpsWithDegrade(feishuClient, messageId, followUps);
      return;
    } catch (error) {
      if (isOnlySupportLatestMessageError(error)) {
        return;
      }
      console.warn(
        `[codex-feishu] push follow-up failed on message ${messageId}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      const violations = extractFieldViolations(error);
      if (violations.length > 0) {
        console.warn(
          `[codex-feishu] follow-up field violations: ${violations.join("; ")}`
        );
      }
      continue;
    }
  }
}

async function sendFollowUpsWithDegrade(
  feishuClient: FeishuClient,
  messageId: string,
  followUps: Array<{ content: string }>
): Promise<void> {
  if (followUps.length === 0) {
    return;
  }

  const candidates: Array<Array<{ content: string }>> = [
    followUps,
    followUps.slice(0, 3),
    followUps.slice(0, 2),
    followUps.slice(0, 1)
  ].filter((item, index, array) => {
    if (item.length === 0) {
      return false;
    }
    return (
      array.findIndex(
        (candidate) =>
          candidate.length === item.length &&
          candidate.every((entry, pos) => entry.content === item[pos]?.content)
      ) === index
    );
  });

  let lastError: unknown;
  for (const candidate of candidates) {
    try {
      await feishuClient.pushFollowUp(messageId, candidate);
      return;
    } catch (error) {
      lastError = error;
      if (isFollowUpAlreadyExistsError(error)) {
        // 说明该消息已挂载过跟随气泡，视为可接受状态，避免重复报错。
        return;
      }
      if (!isFieldValidationError(error)) {
        throw error;
      }
    }
  }

  if (lastError) {
    throw lastError;
  }
}

function extractFieldViolations(error: unknown): string[] {
  const candidate = findFeishuErrorPayload(error);
  if (!candidate) {
    return [];
  }
  const violations = candidate.field_violations || [];
  return violations
    .map((item) =>
      [item.field, item.description].filter((part) => Boolean(part)).join(": ")
    )
    .filter(Boolean);
}

function isFollowUpAlreadyExistsError(error: unknown): boolean {
  const code = extractFeishuErrorCode(error);
  return code === 230008;
}

function isFieldValidationError(error: unknown): boolean {
  const code = extractFeishuErrorCode(error);
  return code === 99992402 || code === 230001;
}

function isOnlySupportLatestMessageError(error: unknown): boolean {
  const code = extractFeishuErrorCode(error);
  return code === 230006;
}

function extractFeishuErrorCode(error: unknown): number | null {
  const candidate = findFeishuErrorPayload(error);
  if (!candidate) {
    return null;
  }
  const codeValue = candidate.code;
  const code =
    typeof codeValue === "number"
      ? codeValue
      : typeof codeValue === "string"
        ? Number.parseInt(codeValue, 10)
        : Number.NaN;
  return Number.isFinite(code) ? code : null;
}

function findFeishuErrorPayload(error: unknown): {
  code?: unknown;
  field_violations?: Array<{
    field?: string;
    description?: string;
  }>;
} | null {
  if (!error) {
    return null;
  }

  const queue: unknown[] = [error];
  const visited = new Set<unknown>();
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || visited.has(current)) {
      continue;
    }
    visited.add(current);

    if (Array.isArray(current)) {
      for (const item of current) {
        queue.push(item);
      }
      continue;
    }
    if (typeof current !== "object") {
      continue;
    }

    const obj = current as Record<string, unknown>;
    if ("code" in obj || "field_violations" in obj) {
      return obj as {
        code?: unknown;
        field_violations?: Array<{
          field?: string;
          description?: string;
        }>;
      };
    }
    if (obj.response && typeof obj.response === "object") {
      queue.push((obj.response as Record<string, unknown>).data);
    }
    for (const value of Object.values(obj)) {
      if (value && (typeof value === "object" || Array.isArray(value))) {
        queue.push(value);
      }
    }
  }
  return null;
}

export function shouldDeleteHelpCardSourceMessage(data: unknown): boolean {
  if (!data || typeof data !== "object") {
    return false;
  }

  const payload = data as {
    action?: {
      value?: unknown;
    };
    event?: {
      action?: {
        value?: unknown;
      };
    };
  };

  const actionValue =
    payload.event?.action?.value && typeof payload.event.action.value === "object"
      ? (payload.event.action.value as Record<string, unknown>)
      : payload.action?.value && typeof payload.action.value === "object"
        ? (payload.action.value as Record<string, unknown>)
        : undefined;

  if (!actionValue) {
    return false;
  }

  const kindValue = actionValue.kind;
  return typeof kindValue === "string" && kindValue.toLowerCase() === "help";
}
