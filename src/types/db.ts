export type TimestampString = string;

export type UserStatus = "active" | "disabled";

export type WorkspaceStatus =
  | "created"
  | "ready"
  | "active"
  | "idle"
  | "disabled"
  | "error";

export type ThreadKind = "main" | "subagent" | "review" | "compact";

export type ThreadStatus =
  | "created"
  | "running"
  | "waiting_approval"
  | "completed"
  | "failed"
  | "archived";

export type RunState =
  | "queued"
  | "running"
  | "waiting_approval"
  | "completed"
  | "failed"
  | "cancelled";

export type ApprovalRuleType = "command_prefix" | "sandbox" | "custom";

export type ApprovalScope = "once" | "workspace";

export type CardType = "info" | "status" | "workspace" | "reply" | "approval";

export type WorkspacePolicy = Record<string, unknown>;
export type ThreadMetadata = Record<string, unknown>;
export type RunMetrics = Record<string, unknown>;

export interface UserRecord {
  id: string;
  feishuOpenId: string;
  feishuUnionId: string | null;
  feishuUserId: string | null;
  displayName: string;
  status: UserStatus;
  createdAt: TimestampString;
  updatedAt: TimestampString;
}

export interface WorkspaceTemplateRecord {
  id: string;
  name: string;
  description: string;
  defaultModel: string;
  defaultEffort: string;
  policy: WorkspacePolicy;
  createdAt: TimestampString;
  updatedAt: TimestampString;
}

export interface WorkspaceRecord {
  id: string;
  ownerUserId: string;
  templateId: string | null;
  name: string;
  slug: string;
  rootPath: string;
  status: WorkspaceStatus;
  defaultModel: string;
  defaultEffort: string;
  policy: WorkspacePolicy;
  lastActiveThreadId: string | null;
  createdAt: TimestampString;
  updatedAt: TimestampString;
}

export interface ThreadRecord {
  id: string;
  workspaceId: string;
  codexThreadId: string;
  name: string | null;
  kind: ThreadKind;
  parentThreadId: string | null;
  status: ThreadStatus;
  isActive: boolean;
  lastTurnId: string | null;
  metadata: ThreadMetadata;
  createdAt: TimestampString;
  updatedAt: TimestampString;
}

export interface SessionBindingRecord {
  id: string;
  userId: string;
  chatId: string;
  threadKey: string | null;
  workspaceId: string | null;
  activeThreadId: string | null;
  createdAt: TimestampString;
  updatedAt: TimestampString;
}

export interface RunRecord {
  id: string;
  workspaceId: string;
  threadId: string;
  turnId: string | null;
  state: RunState;
  replyMessageId: string | null;
  startedAt: TimestampString | null;
  firstTokenAt: TimestampString | null;
  endedAt: TimestampString | null;
  errorText: string | null;
  metrics: RunMetrics;
}

export interface ApprovalRuleRecord {
  id: string;
  workspaceId: string;
  ruleType: ApprovalRuleType;
  commandPrefix: string | null;
  scope: ApprovalScope;
  enabled: boolean;
  createdBy: string;
  createdAt: TimestampString;
  updatedAt: TimestampString;
}

export interface CardMessageRecord {
  id: string;
  chatId: string;
  messageId: string;
  workspaceId: string | null;
  threadId: string | null;
  runId: string | null;
  cardType: CardType;
  createdAt: TimestampString;
  updatedAt: TimestampString;
}

export interface UpsertUserInput {
  id: string;
  feishuOpenId: string;
  feishuUnionId?: string | null;
  feishuUserId?: string | null;
  displayName: string;
  status?: UserStatus;
}

export interface UpsertWorkspaceInput {
  id: string;
  ownerUserId: string;
  templateId?: string | null;
  name: string;
  slug: string;
  rootPath: string;
  status?: WorkspaceStatus;
  defaultModel: string;
  defaultEffort: string;
  policy?: WorkspacePolicy;
  lastActiveThreadId?: string | null;
}

export interface UpsertThreadInput {
  id: string;
  workspaceId: string;
  codexThreadId: string;
  name?: string | null;
  kind?: ThreadKind;
  parentThreadId?: string | null;
  status?: ThreadStatus;
  isActive?: boolean;
  lastTurnId?: string | null;
  metadata?: ThreadMetadata;
}

export interface UpsertSessionBindingInput {
  id: string;
  userId: string;
  chatId: string;
  threadKey?: string | null;
  workspaceId?: string | null;
  activeThreadId?: string | null;
}

export interface DatabaseInitOptions {
  databasePath: string;
}
