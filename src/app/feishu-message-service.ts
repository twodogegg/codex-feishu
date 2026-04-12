import { normalizeFeishuTextEvent } from "../feishu/index.js";
import type {
  FeishuCardActionEvent,
  FeishuNormalizationOptions,
  FeishuReplyContext,
  FeishuTextMessageContext,
  FeishuTextMessageEvent
} from "../feishu/index.js";
import type { CommandRouteResult } from "../types/commands.js";
import {
  type CommandExecutionHooks,
  type ConversationUpdate,
  type CommandExecutionContext,
  type CommandResponse,
  CommandService
} from "./command-service.js";

export type FeishuCommandDispatchResult = {
  routeResult: CommandRouteResult<CommandResponse>;
  replyContext: FeishuReplyContext;
};

export type FeishuMessageExecutionHooks = {
  onConversationUpdate?: (
    replyContext: FeishuReplyContext,
    update: ConversationUpdate
  ) => void | Promise<void>;
};

export class FeishuMessageService {
  private readonly seenEventKeys = new Map<string, number>();

  constructor(
    private readonly commands: CommandService,
    private readonly options: FeishuNormalizationOptions
  ) {}

  async handleTextEvent(
    event: FeishuTextMessageEvent,
    hooks?: FeishuMessageExecutionHooks
  ): Promise<FeishuCommandDispatchResult | null> {
    const normalized = normalizeFeishuTextEvent(event, this.options);
    if (this.shouldSkipTextEvent(normalized.context)) {
      return null;
    }
    if (!normalized.context.mention.shouldHandle) {
      return null;
    }

    const threadKey = resolveConversationThreadKey(normalized.context);
    const session: CommandExecutionContext = {
      actor: {
        openId: normalized.context.sender.openId || "unknown-open-id",
        displayName:
          normalized.context.sender.openId ||
          normalized.context.sender.userId ||
          "unknown-user",
        ...(normalized.context.sender.unionId
          ? { unionId: normalized.context.sender.unionId }
          : {}),
        ...(normalized.context.sender.userId
          ? { userId: normalized.context.sender.userId }
          : {})
      },
      chatId: normalized.context.chatId,
      ...(threadKey ? { threadKey } : {})
    };
    const replyContext = createReplyContextFromText(normalized.context);
    const commandHooks: CommandExecutionHooks | undefined = hooks?.onConversationUpdate
      ? {
          onConversationUpdate: (update) =>
            hooks.onConversationUpdate?.(replyContext, update)
        }
      : undefined;

    return {
      routeResult: await this.commands.executeInput(normalized.input, session, commandHooks),
      replyContext
    };
  }

  async handleCardAction(
    event: FeishuCardActionEvent
  ): Promise<FeishuCommandDispatchResult | null> {
    const action = event.event?.action ?? event.action;
    const context = event.event?.context ?? event.context;
    const operator = event.event?.operator ?? event.operator;
    const flatOperator =
      event.open_id || event.user_id
        ? {
            open_id: event.open_id,
            user_id: event.user_id
          }
        : undefined;
    const actionValue = action?.value ?? {};
    const command = typeof action?.value?.command === "string"
      ? action.value.command.trim()
      : "";
    const actionChatId = pickString(actionValue.chat_id, actionValue.chatId);
    const effectiveContext = context ?? (
      event.open_message_id
        ? {
            open_chat_id: actionChatId ?? "",
            open_message_id: event.open_message_id
          }
        : undefined
    );
    const effectiveOperator = operator ?? flatOperator;

    if (
      !command ||
      !effectiveContext?.open_message_id ||
      !effectiveOperator?.open_id
    ) {
      return null;
    }

    const threadKey = resolveCardActionThreadKey(actionValue);
    const session: CommandExecutionContext = {
      actor: {
        openId: effectiveOperator.open_id,
        displayName: effectiveOperator.open_id,
        ...("union_id" in effectiveOperator && effectiveOperator.union_id
          ? { unionId: effectiveOperator.union_id }
          : {}),
        ...(effectiveOperator.user_id ? { userId: effectiveOperator.user_id } : {})
      },
      chatId: effectiveContext.open_chat_id ?? actionChatId ?? "",
      ...(threadKey ? { threadKey } : {})
    };

    return {
      routeResult: await this.commands.executeText(command, session),
      replyContext: createReplyContextFromCardAction(effectiveContext, actionValue)
    };
  }

  private shouldSkipTextEvent(context: FeishuTextMessageContext): boolean {
    if (isMessageFromCurrentBot(context, this.options)) {
      return true;
    }

    const eventKey = context.eventId || context.messageId;
    if (!eventKey) {
      return false;
    }

    this.pruneSeenEventKeys();
    if (this.seenEventKeys.has(eventKey)) {
      return true;
    }

    this.seenEventKeys.set(eventKey, Date.now());
    return false;
  }

  private pruneSeenEventKeys(): void {
    const now = Date.now();
    for (const [key, timestamp] of this.seenEventKeys) {
      if (now - timestamp > EVENT_DEDUP_TTL_MS) {
        this.seenEventKeys.delete(key);
      }
    }
  }
}

const EVENT_DEDUP_TTL_MS = 5 * 60 * 1000;

function createReplyContextFromText(
  context: FeishuTextMessageContext
): FeishuReplyContext {
  return {
    chatId: context.chatId,
    messageId: context.messageId,
    ...(context.rootMessageId ? { rootMessageId: context.rootMessageId } : {}),
    ...(context.parentMessageId
      ? { parentMessageId: context.parentMessageId }
      : {}),
    ...(context.threadId ? { threadId: context.threadId } : {}),
    replyInThread: shouldReplyInThread(
      context.chatType,
      context.threadId,
      context.rootMessageId,
      context.parentMessageId
    )
  };
}

function createReplyContextFromCardAction(
  context:
    | NonNullable<NonNullable<FeishuCardActionEvent["event"]>["context"]>
    | NonNullable<FeishuCardActionEvent["context"]>,
  actionValue: Record<string, unknown>
): FeishuReplyContext {
  const threadId = pickString(actionValue.thread_id, actionValue.threadId);
  const rootMessageId = pickString(actionValue.root_id, actionValue.rootMessageId);
  const parentMessageId = pickString(
    actionValue.parent_id,
    actionValue.parentMessageId
  );
  const explicitReplyInThread = pickBoolean(
    actionValue.reply_in_thread,
    actionValue.replyInThread
  );

  return {
    chatId:
      context.open_chat_id ??
      pickString(actionValue.chat_id, actionValue.chatId) ??
      "",
    messageId: context.open_message_id ?? "",
    ...(rootMessageId ? { rootMessageId } : {}),
    ...(parentMessageId ? { parentMessageId } : {}),
    ...(threadId ? { threadId } : {}),
    replyInThread:
      explicitReplyInThread ??
      Boolean(threadId || rootMessageId || parentMessageId)
  };
}

function resolveConversationThreadKey(
  context: FeishuTextMessageContext
): string | undefined {
  return context.threadId ?? context.rootMessageId ?? context.parentMessageId;
}

function resolveCardActionThreadKey(
  actionValue: Record<string, unknown>
): string | undefined {
  return (
    pickString(actionValue.thread_id, actionValue.threadId) ??
    pickString(actionValue.root_id, actionValue.rootMessageId) ??
    pickString(actionValue.parent_id, actionValue.parentMessageId)
  );
}

function shouldReplyInThread(
  chatType: string,
  threadId?: string,
  rootMessageId?: string,
  parentMessageId?: string
): boolean {
  return chatType === "group" && Boolean(threadId || rootMessageId || parentMessageId);
}

function pickString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return undefined;
}

function pickBoolean(...values: unknown[]): boolean | undefined {
  for (const value of values) {
    if (typeof value === "boolean") {
      return value;
    }
  }

  return undefined;
}

function isMessageFromCurrentBot(
  context: FeishuTextMessageContext,
  options: FeishuNormalizationOptions
): boolean {
  if (context.sender.senderType === "bot") {
    return true;
  }

  if (options.botOpenId && context.sender.openId === options.botOpenId) {
    return true;
  }

  if (options.botUserId && context.sender.userId === options.botUserId) {
    return true;
  }

  return false;
}
