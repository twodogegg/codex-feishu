import type { PlainTextInput } from "../types/commands.js";
import { parseCommandText } from "./command-parser.js";
import type {
  FeishuChatType,
  FeishuMention,
  FeishuNormalizationOptions,
  FeishuTextMessageEvent,
  FeishuTextMessageEventPayload,
  NormalizedFeishuTextInput
} from "./types.js";

const DEFAULT_OPTIONS: Required<Pick<FeishuNormalizationOptions, "requireBotMentionInGroup">> =
  {
    requireBotMentionInGroup: true
  };

const LEADING_AT_TAG_PATTERN =
  /^(\s*<at\b[^>]*>.*?<\/at>\s*)+/isu;
const LEADING_PLAIN_AT_PATTERN = /^(\s*@[^\s/@]+\s*)+/u;
const LEADING_TRIM_PATTERN = /^[\s\u200B\u200C\u200D\u2060\uFEFF]+/u;
const AT_TAG_PATTERN = /<at\b(?<attrs>[^>]*)>(?<label>.*?)<\/at>/giu;
const COMMAND_PREFIX_PATTERN = /^[\p{P}\p{Z}\p{Cf}]+$/u;

export function normalizeFeishuTextEvent(
  event: FeishuTextMessageEvent,
  options: FeishuNormalizationOptions = {}
): NormalizedFeishuTextInput {
  const mergedOptions = {
    ...DEFAULT_OPTIONS,
    ...options
  };
  const payload = resolveEventPayload(event);
  const message = payload.message;
  const senderPayload = payload.sender;
  const chatType = normalizeChatType(message.chat_type ?? payload.chat_type);
  const rawText = extractTextFromMessageContent(message.content);
  const text = normalizeIncomingText(rawText);
  const leadingMentionSlice = extractLeadingMentionSlice(text);
  const textWithoutLeadingMentions = normalizePostMentionText(
    stripLeadingMentions(text)
  );
  const normalizedCommandCandidate = normalizeCommandCandidate(
    textWithoutLeadingMentions
  );
  const messageMentions = collectMessageMentions(event);
  const mentionsBot = detectBotMention(
    messageMentions,
    leadingMentionSlice,
    mergedOptions
  );
  const hasLeadingMention = leadingMentionSlice.length > 0;
  const shouldHandle =
    chatType !== "group" ||
    !mergedOptions.requireBotMentionInGroup ||
    mentionsBot;
  const input =
    parseCommandText(normalizedCommandCandidate) ??
    createPlainTextInput(rawText, textWithoutLeadingMentions);
  const sender = senderPayload.sender_id;

  return {
    context: {
      source: "feishu",
      ...(resolveEventId(event) != null ? { eventId: resolveEventId(event)! } : {}),
      messageId: message.message_id,
      ...(message.root_id ? { rootMessageId: message.root_id } : {}),
      ...(message.parent_id ? { parentMessageId: message.parent_id } : {}),
      chatId: message.chat_id ?? payload.chat_id ?? "",
      chatType,
      ...(message.thread_id ? { threadId: message.thread_id } : {}),
      sender: {
        ...(sender?.open_id ? { openId: sender.open_id } : {}),
        ...(sender?.union_id ? { unionId: sender.union_id } : {}),
        ...(sender?.user_id ? { userId: sender.user_id } : {}),
        ...(senderPayload.sender_type
          ? { senderType: senderPayload.sender_type }
          : {}),
        ...(senderPayload.tenant_key
          ? { tenantKey: senderPayload.tenant_key }
          : {})
      },
      mention: {
        hasMention: messageMentions.length > 0,
        hasLeadingMention,
        mentionsBot,
        shouldHandle
      }
    },
    rawText,
    text: textWithoutLeadingMentions,
    input
  };
}

function createPlainTextInput(rawText: string, text: string): PlainTextInput {
  return {
    kind: "text",
    rawText,
    normalizedText: text,
    text
  };
}

function extractTextFromMessageContent(
  content: string | { text?: string } | undefined
): string {
  if (!content) {
    return "";
  }

  if (typeof content !== "string") {
    return typeof content.text === "string" ? content.text : "";
  }

  const trimmed = content.trim();
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as { text?: unknown };
      if (typeof parsed.text === "string") {
        return parsed.text;
      }
    } catch {
      return content;
    }
  }

  return content;
}

function normalizeIncomingText(text: string): string {
  return text.replace(/\r\n/g, "\n").trim();
}

function stripLeadingMentions(text: string): string {
  return text
    .replace(LEADING_AT_TAG_PATTERN, "")
    .replace(LEADING_PLAIN_AT_PATTERN, "")
    .trim();
}

function extractLeadingMentionSlice(text: string): string {
  const match = text.match(LEADING_AT_TAG_PATTERN);
  if (match?.[0]) {
    return match[0];
  }

  const plainMatch = text.match(LEADING_PLAIN_AT_PATTERN);
  return plainMatch?.[0] ?? "";
}

function normalizePostMentionText(text: string): string {
  return text.replace(LEADING_TRIM_PATTERN, "").trim();
}

function normalizeCommandCandidate(text: string): string {
  const normalized = normalizePostMentionText(text);
  if (normalized.startsWith("/")) {
    return normalized;
  }

  if (normalized.startsWith("／")) {
    return `/${normalized.slice(1)}`;
  }

  const slashIndex = normalized.search(/[\/／]/u);
  if (slashIndex <= 0) {
    return normalized;
  }

  const prefix = normalized.slice(0, slashIndex).trim();
  if (!prefix || !COMMAND_PREFIX_PATTERN.test(prefix)) {
    return normalized;
  }

  const commandText = normalized.slice(slashIndex);
  if (commandText.startsWith("／")) {
    return `/${commandText.slice(1)}`;
  }

  return commandText;
}

function collectMessageMentions(event: FeishuTextMessageEvent): FeishuMention[] {
  const payload = resolveEventPayload(event);
  const messageMentions = payload.message.mentions ?? [];
  const eventMentions = payload.mentions ?? [];

  return [...messageMentions, ...eventMentions];
}

function resolveEventPayload(event: FeishuTextMessageEvent): FeishuTextMessageEventPayload {
  if (event.event?.message && event.event.sender) {
    return event.event;
  }

  if (event.message && event.sender) {
    return {
      sender: event.sender,
      message: event.message,
      ...(event.chat_id ? { chat_id: event.chat_id } : {}),
      ...(event.chat_type ? { chat_type: event.chat_type } : {}),
      ...(event.mentions ? { mentions: event.mentions } : {})
    };
  }

  throw new TypeError("Invalid Feishu text event payload: missing sender/message");
}

function resolveEventId(event: FeishuTextMessageEvent): string | undefined {
  return event.header?.event_id ?? event.event_id;
}

function detectBotMention(
  mentions: FeishuMention[],
  leadingMentionSlice: string,
  options: FeishuNormalizationOptions
): boolean {
  if (lacksBotIdentityHints(options)) {
    return mentions.length > 0 || leadingMentionSlice.length > 0;
  }

  if (mentions.some((mention) => mentionTargetsBot(mention, options))) {
    return true;
  }

  if (leadingMentionSlice.length === 0) {
    return false;
  }

  for (const match of leadingMentionSlice.matchAll(AT_TAG_PATTERN)) {
    const attrs = match.groups?.attrs ?? "";
    const label = (match.groups?.label ?? "").trim();

    if (attributeMatchesBot(attrs, options) || labelMatchesBot(label, options)) {
      return true;
    }
  }

  return false;
}

function lacksBotIdentityHints(options: FeishuNormalizationOptions): boolean {
  return !options.botOpenId && !options.botUserId && !options.botName;
}

function mentionTargetsBot(
  mention: FeishuMention,
  options: FeishuNormalizationOptions
): boolean {
  if (mention.key) {
    if (options.botOpenId && mention.key === options.botOpenId) {
      return true;
    }
    if (options.botUserId && mention.key === options.botUserId) {
      return true;
    }
  }

  if (mention.id?.open_id && options.botOpenId === mention.id.open_id) {
    return true;
  }

  if (mention.id?.user_id && options.botUserId === mention.id.user_id) {
    return true;
  }

  if (mention.name && labelMatchesBot(mention.name, options)) {
    return true;
  }

  return false;
}

function attributeMatchesBot(
  attrs: string,
  options: FeishuNormalizationOptions
): boolean {
  const candidateValues = attrs
    .split(/\s+/u)
    .map((part) => part.split("=")[1] ?? "")
    .map((part) => part.replace(/^['"]|['"]$/g, ""))
    .filter((part) => part.length > 0);

  if (options.botOpenId && candidateValues.includes(options.botOpenId)) {
    return true;
  }

  if (options.botUserId && candidateValues.includes(options.botUserId)) {
    return true;
  }

  return false;
}

function labelMatchesBot(
  label: string,
  options: FeishuNormalizationOptions
): boolean {
  if (!options.botName) {
    return false;
  }

  return label === options.botName;
}

function normalizeChatType(value: string | undefined): FeishuChatType {
  if (value === "p2p" || value === "group") {
    return value;
  }

  return "unknown";
}
