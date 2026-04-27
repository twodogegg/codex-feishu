import type { ConversationInput } from "../types/commands.js";

export type FeishuChatType = "p2p" | "group" | "unknown";

export type FeishuSenderId = {
  open_id?: string;
  union_id?: string;
  user_id?: string;
};

export type FeishuSender = {
  sender_id?: FeishuSenderId;
  sender_type?: string;
  tenant_key?: string;
};

export type FeishuMention = {
  key?: string;
  id?: FeishuSenderId;
  name?: string;
  tenant_key?: string;
};

export type FeishuMessage = {
  message_id: string;
  root_id?: string;
  parent_id?: string;
  chat_id: string;
  thread_id?: string;
  chat_type?: string;
  message_type?: string;
  content?: string | { text?: string; image_key?: string; file_key?: string };
  mentions?: FeishuMention[];
  create_time?: string;
  update_time?: string;
};

export type FeishuTextMessageEventPayload = {
  sender: FeishuSender;
  message: FeishuMessage;
  chat_id?: string;
  chat_type?: string;
  mentions?: FeishuMention[];
};

export type FeishuEventHeader = {
  event_id?: string;
  token?: string;
  create_time?: string;
  tenant_key?: string;
  app_id?: string;
};

export type FeishuTextMessageEvent = {
  schema?: string;
  header?: FeishuEventHeader;
  event?: FeishuTextMessageEventPayload;
} & Partial<FeishuTextMessageEventPayload> &
  Partial<FeishuEventHeader>;

export type FeishuCardActionEvent = {
  schema?: string;
  header?: FeishuEventHeader;
  event?: {
    operator?: {
      open_id?: string;
      union_id?: string;
      user_id?: string;
    };
    context?: {
      open_chat_id?: string;
      open_message_id?: string;
    };
    action?: {
      value?: Record<string, unknown>;
    };
  };
  operator?: {
    open_id?: string;
    union_id?: string;
    user_id?: string;
  };
  context?: {
    open_chat_id?: string;
    open_message_id?: string;
  };
  action?: {
    value?: Record<string, unknown>;
  };
  open_id?: string;
  user_id?: string;
  tenant_key?: string;
  open_message_id?: string;
  token?: string;
};

export type FeishuNormalizationOptions = {
  botOpenId?: string;
  botUserId?: string;
  botName?: string;
  requireBotMentionInGroup?: boolean;
};

export type FeishuReplyContext = {
  chatId: string;
  messageId: string;
  rootMessageId?: string;
  parentMessageId?: string;
  threadId?: string;
  chatType?: FeishuChatType;
  replyInThread: boolean;
};

export type FeishuTextMessageContext = {
  source: "feishu";
  eventId?: string;
  messageId: string;
  rootMessageId?: string;
  parentMessageId?: string;
  chatId: string;
  chatType: FeishuChatType;
  threadId?: string;
  sender: {
    openId?: string;
    unionId?: string;
    userId?: string;
    senderType?: string;
    tenantKey?: string;
  };
  mention: {
    hasMention: boolean;
    hasLeadingMention: boolean;
    mentionsBot: boolean;
    shouldHandle: boolean;
  };
};

export type NormalizedFeishuTextInput = {
  context: FeishuTextMessageContext;
  rawText: string;
  text: string;
  input: ConversationInput;
};
