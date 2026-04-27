import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { createCommandRouter, parseUserInput } from "../domain/commanding/index.js";
import { listCommandDefinitions } from "../commands/index.js";
import type { CodexThreadSummary, CodexThreadTokenUsage } from "../codex/app-server-client.js";
import type { DatabaseContext } from "../db/index.js";
import type { ThreadRecord, WorkspaceRecord } from "../types/db.js";
import type {
  CommandHandlerMap,
  CommandRouteResult,
  ParsedUserInput
} from "../types/commands.js";
import { CodexWorkerManager } from "../workers/codex/worker-manager.js";
import type {
  CodexLastRunStats,
  CodexWorkspaceWorker
} from "../workers/codex/codex-worker.js";

export type SessionActor = {
  openId: string;
  displayName: string;
  unionId?: string;
  userId?: string;
};

export type CommandExecutionContext = {
  actor: SessionActor;
  chatId: string;
  threadKey?: string;
};

export type CommandResponse =
  | {
      kind: "message";
      title: string;
      body: string;
    }
  | {
      kind: "card";
      title: string;
      card: Record<string, unknown>;
    }
  | {
      kind: "file";
      title: string;
      body: string;
      filePath: string;
    }
  | {
      kind: "noop";
    };

export type ConversationUpdate = {
  state: "starting" | "streaming" | "completed" | "failed";
  text: string;
  turnId?: string;
  model?: string;
  effort?: string;
  errorText?: string;
  tokenUsage?: CodexThreadTokenUsage;
  contextTokensUsed?: number;
  contextTokensRemaining?: number;
  elapsedMs?: number;
};

export type CommandExecutionHooks = {
  onConversationUpdate?: (update: ConversationUpdate) => void | Promise<void>;
};

type HandlerContext = {
  db: DatabaseContext;
  workers: CodexWorkerManager;
  session: CommandExecutionContext;
  workspaceRootBasePath: string;
  codexCommand: string;
  defaultCodexModel: string;
  defaultCodexEffort: string;
  hooks?: CommandExecutionHooks;
};

type BindingState = {
  actor: ReturnType<typeof ensureUser>;
  binding: ReturnType<DatabaseContext["sessionBindings"]["getBySession"]>;
  workspace: WorkspaceRecord | null;
  thread: ThreadRecord | null;
};

export class CommandService {
  private readonly router = createCommandRouter<HandlerContext, CommandResponse>(
    {
      handlers: createHandlers()
    }
  );

  constructor(
    private readonly db: DatabaseContext,
    private readonly workers: CodexWorkerManager,
    private readonly options: {
      workspaceRootBasePath: string;
      codexCommand: string;
      defaultCodexModel: string;
      defaultCodexEffort: string;
    }
  ) {}

  async executeText(
    text: string,
    session: CommandExecutionContext,
    hooks?: CommandExecutionHooks
  ): Promise<CommandRouteResult<CommandResponse>> {
    return this.executeInput(parseUserInput(text), session, hooks);
  }

  async executeInput(
    input: ParsedUserInput,
    session: CommandExecutionContext,
    hooks?: CommandExecutionHooks
  ): Promise<CommandRouteResult<CommandResponse>> {
    const actor = ensureUser(
      this.db,
      session.actor,
      this.options.workspaceRootBasePath,
      this.options.defaultCodexModel,
      this.options.defaultCodexEffort
    );

    const context: HandlerContext = {
      db: this.db,
      workers: this.workers,
      workspaceRootBasePath: this.options.workspaceRootBasePath,
      codexCommand: this.options.codexCommand,
      defaultCodexModel: this.options.defaultCodexModel,
      defaultCodexEffort: this.options.defaultCodexEffort,
      ...(hooks ? { hooks } : {}),
      session: {
        ...session,
        actor: {
          openId: actor.feishuOpenId,
          displayName: actor.displayName,
          ...(actor.feishuUnionId ? { unionId: actor.feishuUnionId } : {}),
          ...(actor.feishuUserId ? { userId: actor.feishuUserId } : {})
        }
      }
    };

    try {
      if (input.kind === "text") {
        const result = await handleConversationInput(input.text, context);
        return {
          kind: "handled",
          commandName: "message",
          result
        };
      }

      return await this.router.route(input, context);
    } catch (error) {
      return {
        kind: "handled",
        commandName: input.kind === "command" ? input.name : "status",
        result: messageResponse(
          "执行失败",
          error instanceof Error ? error.message : String(error)
        )
      };
    }
  }
}

function createHandlers(): CommandHandlerMap<HandlerContext, CommandResponse> {
  return {
    help: (_input, context) => handleHelpCommand(context),
    bind: (input, context) => handleBindCommand(input.argText, context),
    sessions: (input, context) => handleSessionsCommand(input.argText, context),
    agents: (input, context) => handleWorkspaceCommand(input.argText, context),
    remove: (input, context) => handleRemoveCommand(input.argText, context),
    send: (input, context) => handleSendCommand(input.argText, context),
    message: (_input, context) => handleMessageCommand(context),
    switch: (input, context) => handleSwitchCommand(input.argText, context),
    new: (_input, context) => handleNewCommand(context),
    fork: (input, context) => handleForkCommand(input.argText, context),
    recall: (_input, context) => handleRecallCommand(),
    stop: (_input, context) => handleStopCommand(context),
    model: (input, context) => handleModelCommand(input.argText, context),
    effort: (input, context) => handleEffortCommand(input.argText, context),
    compact: (_input, context) => handleCompactCommand(context),
    fast: (_input, context) => handleFastCommand(context),
    permissions: (_input, context) => handlePermissionsCommand(context),
    experimental: (_input, context) => handleExperimentalCommand(context),
    status: (_input, context) => handleStatusCommand(context),
    statusline: (_input, context) => handleStatuslineCommand(context),
    skills: (_input, context) => handleSkillsCommand(context),
    review: (_input, context) => handleReviewCommand(context),
    rename: (input, context) => handleRenameCommand(input.argText, context),
    subagents: (input, context) => handleSubagentsCommand(input.argText, context)
  };
}

async function handleBindCommand(
  workspaceSelector: string,
  context: HandlerContext
): Promise<CommandResponse> {
  const selector = workspaceSelector.trim();
  if (!selector) {
    return messageResponse("参数缺失", "用法：`/bind <agent>`");
  }

  const state = getCurrentBindingState(context);
  const workspace = resolveWorkspaceBySelector(context.db, state.actor.id, selector)
    ?? ensureWorkspaceFromAbsolutePath(context, state.actor.id, selector);

  if (!workspace) {
    return messageResponse(
      "未找到 Agent",
      `找不到 agent：\`${selector}\``
    );
  }

  const binding = upsertSessionBinding(context, workspace.id);
  const worker = ensureWorkspaceWorker(context, workspace);
  await worker.ensureReady();
  await syncWorkspaceThreads(context, workspace, worker);

  return messageResponse(
    "绑定成功",
    [
      `agent: \`${workspace.name}\``,
      `slug: \`${workspace.slug}\``,
      `binding: \`${binding.id}\``,
      `worker: \`${worker.workspaceId}\``
    ].join("\n")
  );
}

async function handleSessionsCommand(
  argText: string,
  context: HandlerContext
): Promise<CommandResponse> {
  const state = getCurrentBindingState(context);
  if (!state.binding || !state.workspace) {
    return messageResponse(
      "当前未绑定",
      "当前会话还没有绑定 agent。先使用 `/bind <agent>`。"
    );
  }

  const worker = ensureWorkspaceWorker(context, state.workspace);
  await syncWorkspaceThreads(context, state.workspace, worker);
  await hydrateRecentThreadPreviews(context, state.workspace, worker);
  const nextState = getCurrentBindingState(context);

  return {
    kind: "card",
    title: "当前 Sessions",
    card: buildStatusCard(
      nextState.workspace!,
      nextState.thread,
      context,
      parseSessionsPage(argText)
    )
  };
}

async function handleWorkspaceCommand(
  argText: string,
  context: HandlerContext
): Promise<CommandResponse> {
  const normalizedArg = argText.trim();
  if (normalizedArg.length > 0) {
    const workspaceSubcommandMatch = normalizedArg.match(/^(\S+)\s+(.+)$/u);
    const subcommand = workspaceSubcommandMatch?.[1]?.trim().toLowerCase() || "";
    const selector = workspaceSubcommandMatch?.[2]?.trim() || "";

    if (!selector) {
      return messageResponse(
        "参数缺失",
        "用法：`/agents`、`/agents status <agent>`、`/agents remove <agent>`"
      );
    }

    if (subcommand === "status" || subcommand === "bind") {
      return handleWorkspaceStatusCommand(selector, context);
    }

    if (subcommand === "remove") {
      return handleRemoveCommand(selector, context);
    }

    return messageResponse(
      "不支持的 agents 子命令",
      "用法：`/agents`、`/agents status <agent>`、`/agents remove <agent>`"
    );
  }

  const actor = getCurrentBindingState(context).actor;
  const workspaces = context.db.workspaces.listByOwnerUserId(actor.id);
  if (workspaces.length === 0) {
    return messageResponse("暂无 Agent", "当前用户还没有可用 agent。");
  }

  const currentWorkspaceId = getCurrentBindingState(context).workspace?.id;
  return {
    kind: "card",
    title: "我的 Agents",
    card: buildWorkspaceListCard(workspaces, currentWorkspaceId)
  };
}

async function handleWorkspaceStatusCommand(
  workspaceSelector: string,
  context: HandlerContext
): Promise<CommandResponse> {
  const bindResult = await handleBindCommand(workspaceSelector, context);
  if (bindResult.kind === "message" && bindResult.title.includes("未找到")) {
    return bindResult;
  }

  const state = getCurrentBindingState(context);
  if (!state.workspace) {
    return bindResult;
  }

  const worker = ensureWorkspaceWorker(context, state.workspace);
  await syncWorkspaceThreads(context, state.workspace, worker);
  await hydrateRecentThreadPreviews(context, state.workspace, worker);
  const nextState = getCurrentBindingState(context);

  return {
    kind: "card",
    title: "当前 Sessions",
    card: buildStatusCard(nextState.workspace!, nextState.thread, context, 1)
  };
}

function handleRemoveCommand(
  workspaceSelector: string,
  context: HandlerContext
): CommandResponse {
  const state = getCurrentBindingState(context);
  if (!state.binding) {
    return messageResponse("无需解绑", "当前会话没有绑定 agent。");
  }

  const selector = workspaceSelector.trim();
  if (!selector) {
    return messageResponse("参数缺失", "用法：`/remove <agent>`");
  }

  if (!state.workspace || !matchesWorkspaceSelector(state.workspace, selector)) {
    return messageResponse(
      "解绑失败",
      `当前会话未绑定指定 agent：\`${selector}\``
    );
  }

  context.db.sessionBindings.upsert({
    id: state.binding.id,
    userId: state.binding.userId,
    chatId: state.binding.chatId,
    threadKey: state.binding.threadKey,
    workspaceId: null,
    activeThreadId: null
  });

  return messageResponse(
    "解绑成功",
    `已从当前会话移除 agent：\`${state.workspace.name}\``
  );
}

function handleSendCommand(
  relativePath: string,
  context: HandlerContext
): CommandResponse {
  const state = requireBoundWorkspaceState(context);
  if ("kind" in state) {
    return state;
  }

  const requestedPath = relativePath.trim();
  if (!requestedPath) {
    return messageResponse(
      "参数缺失",
      "用法：`/send <当前 agent 下的相对文件路径>`"
    );
  }

  const resolved = path.resolve(state.workspace.rootPath, requestedPath);
  const relative = path.relative(state.workspace.rootPath, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return messageResponse("路径非法", "只能发送当前 agent 内的文件。");
  }

  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    return messageResponse("文件不存在", `找不到文件：\`${requestedPath}\``);
  }

  return {
    kind: "file",
    title: "发送文件",
    body: `发送文件：\`${requestedPath}\``,
    filePath: resolved
  };
}

async function handleMessageCommand(
  context: HandlerContext
): Promise<CommandResponse> {
  const state = requireBoundWorkspaceState(context);
  if ("kind" in state) {
    return state;
  }
  if (!state.thread) {
    return messageResponse("当前线程", "当前 agent 还没有线程。");
  }

  const worker = ensureWorkspaceWorker(context, state.workspace);
  let response: {
    thread?: {
      turns?: Array<{
        items?: Array<
          | { type: "userMessage"; content?: Array<{ text?: string }> }
          | { type: "agentMessage"; text?: string }
        >;
      }>;
    };
  };
  try {
    response = (await readThreadWithAutoResume(
      worker,
      state.thread.codexThreadId
    )) as typeof response;
  } catch (error) {
    if (isThreadNotMaterializedError(error)) {
      return messageResponse(
        "当前线程消息",
        "当前线程还没有可展示的消息。先发送一条普通文本后再查看。"
      );
    }

    if (isThreadUnavailableForReadError(error)) {
      return messageResponse(
        "当前线程消息",
        "当前线程暂时无法加载历史消息。先发送一条普通文本，或切换到其他线程后再试。"
      );
    }

    throw error;
  }

  const lines: string[] = [];
  const turns = response.thread?.turns || [];
  for (const turn of turns.slice(-6)) {
    for (const item of turn.items || []) {
      if (item.type === "userMessage") {
        const text = item.content?.map((entry) => entry.text || "").join("").trim();
        if (text) {
          lines.push(`用户: ${text}`);
        }
      }
      if (item.type === "agentMessage" && item.text?.trim()) {
        lines.push(`Codex: ${item.text.trim()}`);
      }
    }
  }

  return messageResponse(
    "当前线程消息",
    lines.length > 0 ? lines.join("\n\n") : "当前线程还没有可展示的消息。"
  );
}

async function handleSwitchCommand(
  threadSelector: string,
  context: HandlerContext
): Promise<CommandResponse> {
  const state = requireBoundWorkspaceState(context);
  if ("kind" in state) {
    return state;
  }

  const selector = threadSelector.trim();
  if (!selector) {
    return handleSessionsCommand("", context);
  }

  const worker = ensureWorkspaceWorker(context, state.workspace);
  await syncWorkspaceThreads(context, state.workspace, worker);

  const candidate = context.db.threads
    .listByWorkspaceId(state.workspace.id)
    .find((thread) => thread.id === selector || thread.codexThreadId === selector);

  if (!candidate) {
    return messageResponse(
      "线程不存在",
      `当前 agent 下找不到线程：\`${selector}\``
    );
  }

  await bestEffortResumeThread(worker, candidate.codexThreadId);
  context.db.threads.setActiveThread(state.workspace.id, candidate.id);
  context.db.workspaces.setLastActiveThreadId(state.workspace.id, candidate.id);
  context.db.sessionBindings.upsert({
    id: state.binding.id,
    userId: state.binding.userId,
    chatId: state.binding.chatId,
    threadKey: state.binding.threadKey,
    workspaceId: state.workspace.id,
    activeThreadId: candidate.id
  });

  return messageResponse("切换成功", `当前线程已切换到 \`${candidate.id}\``);
}

async function handleNewCommand(context: HandlerContext): Promise<CommandResponse> {
  const state = requireBoundWorkspaceState(context);
  if ("kind" in state) {
    return state;
  }

  const worker = ensureWorkspaceWorker(context, state.workspace);
  const created = await worker.startThread();
  const thread = context.db.threads.upsert({
    id: randomUUID(),
    workspaceId: state.workspace.id,
    codexThreadId: created.id,
    name: created.name,
    kind: "main",
    status: "created",
    isActive: true
  });

  context.db.threads.setActiveThread(state.workspace.id, thread.id);
  context.db.workspaces.setLastActiveThreadId(state.workspace.id, thread.id);
  context.db.sessionBindings.upsert({
    id: state.binding.id,
    userId: state.binding.userId,
    chatId: state.binding.chatId,
    threadKey: state.binding.threadKey,
    workspaceId: state.workspace.id,
    activeThreadId: thread.id
  });

  return messageResponse(
    "新线程已创建",
    [`thread: \`${thread.id}\``, `codexThreadId: \`${thread.codexThreadId}\``].join("\n")
  );
}

async function handleForkCommand(
  threadSelector: string,
  context: HandlerContext
): Promise<CommandResponse> {
  const state = requireBoundWorkspaceState(context);
  if ("kind" in state) {
    return state;
  }

  const worker = ensureWorkspaceWorker(context, state.workspace);
  await syncWorkspaceThreads(context, state.workspace, worker);

  const selector = threadSelector.trim();
  const targetThread = selector
    ? context.db.threads
        .listByWorkspaceId(state.workspace.id)
        .find((thread) => matchesThreadSelector(thread, selector))
    : state.thread;

  if (!targetThread) {
    return messageResponse(
      "缺少可分叉线程",
      selector
        ? `当前 agent 下找不到线程：\`${selector}\``
        : "当前会话没有可分叉的 active 线程。"
    );
  }

  const forked = await worker.forkThread(targetThread.codexThreadId);
  const forkThread = context.db.threads.upsert({
    id: randomUUID(),
    workspaceId: state.workspace.id,
    codexThreadId: forked.id,
    name: forked.name,
    kind: "main",
    status: mapRemoteThreadStatus(forked.status),
    metadata: {
      updatedAt: forked.updatedAt,
      codexPath: forked.codexPath,
      cwd: forked.cwd,
      preview: normalizeThreadSummaryText(forked.preview, 160)
    },
    isActive: true
  });

  setActiveThreadForSession(context, state.binding, state.workspace, forkThread.id);

  return messageResponse(
    "分叉成功",
    [
      `from: \`${targetThread.id}\``,
      `thread: \`${forkThread.id}\``,
      `codexThreadId: \`${forkThread.codexThreadId}\``
    ].join("\n")
  );
}

function handleRecallCommand(): CommandResponse {
  return messageResponse("撤回请求", "正在撤回机器人最近发送的一条消息...");
}

async function handleStopCommand(context: HandlerContext): Promise<CommandResponse> {
  const state = requireBoundWorkspaceState(context);
  if ("kind" in state) {
    return state;
  }
  if (!state.thread?.lastTurnId) {
    return messageResponse("没有运行中的任务", "当前线程没有可中断的 turn。");
  }

  const worker = ensureWorkspaceWorker(context, state.workspace);
  await worker.interruptTurn(state.thread.codexThreadId, state.thread.lastTurnId);
  context.db.threads.updateThread(state.thread.id, {
    status: "failed"
  });

  return messageResponse("已发送中断请求", `已中断 turn \`${state.thread.lastTurnId}\``);
}

async function handleModelCommand(
  argText: string,
  context: HandlerContext
): Promise<CommandResponse> {
  const state = requireBoundWorkspaceState(context);
  if ("kind" in state) {
    return state;
  }

  const nextModel = argText.trim();
  const worker = ensureWorkspaceWorker(context, state.workspace);
  if (!nextModel) {
    const models = await worker.listModels();
    return {
      kind: "card",
      title: "模型列表",
      card: buildModelListCard(state.workspace, models)
    };
  }

  if (nextModel === "update") {
    return messageResponse(
      "命令已废弃",
      "请直接使用 `/model` 查看模型列表并点击切换。"
    );
  }

  const updated = context.db.workspaces.updateDefaults(state.workspace.id, {
    defaultModel: nextModel
  });

  return messageResponse(
    "模型已更新",
    `当前 agent 默认模型已更新为 \`${updated?.defaultModel || nextModel}\``
  );
}

function handleEffortCommand(
  argText: string,
  context: HandlerContext
): CommandResponse {
  const state = requireBoundWorkspaceState(context);
  if ("kind" in state) {
    return state;
  }

  const nextEffort = argText.trim();
  if (!nextEffort) {
    return messageResponse(
      "当前推理强度",
      `agent \`${state.workspace.name}\` 的默认 effort 是 \`${state.workspace.defaultEffort}\``
    );
  }

  const updated = context.db.workspaces.updateDefaults(state.workspace.id, {
    defaultEffort: nextEffort
  });

  return messageResponse(
    "推理强度已更新",
    `当前 agent 默认 effort 已更新为 \`${updated?.defaultEffort || nextEffort}\``
  );
}

async function handleStatusCommand(
  context: HandlerContext
): Promise<CommandResponse> {
  const state = getCurrentBindingState(context);
  if (!state.workspace) {
    return messageResponse("Session 状态", "当前未绑定 agent。");
  }

  const worker = ensureWorkspaceWorker(context, state.workspace);
  await worker.ensureReady();
  const threadCount = (await worker.listThreads()).length;
  const lastRunStats = worker.getLastRunStats();
  return messageResponse(
    "Session 状态",
    [
      buildWorkspaceStatusText(state.workspace, state.thread, context),
      "",
      `workerState: \`${worker.getState()}\``,
      `threadCount: ${threadCount}`,
      ...buildLastRunStatusLines(lastRunStats)
    ].join("\n")
  );
}

async function handleCompactCommand(
  context: HandlerContext
): Promise<CommandResponse> {
  const state = requireBoundWorkspaceState(context);
  if ("kind" in state) {
    return state;
  }
  if (!state.thread) {
    return messageResponse("无法 Compact", "当前 agent 没有 active thread。");
  }

  const worker = ensureWorkspaceWorker(context, state.workspace);
  await worker.startCompact(state.thread.codexThreadId);
  return messageResponse("Compact 已发起", "已对当前线程发起 compact。");
}

function handleFastCommand(context: HandlerContext): CommandResponse {
  const state = requireBoundWorkspaceState(context);
  if ("kind" in state) {
    return state;
  }

  const currentPolicy = state.workspace.policy;
  const currentFast = currentPolicy.fastMode === true;
  const nextPolicy = {
    ...currentPolicy,
    fastMode: !currentFast
  };

  context.db.workspaces.upsert({
    id: state.workspace.id,
    ownerUserId: state.workspace.ownerUserId,
    templateId: state.workspace.templateId,
    name: state.workspace.name,
    slug: state.workspace.slug,
    rootPath: state.workspace.rootPath,
    status: state.workspace.status,
    defaultModel: state.workspace.defaultModel,
    defaultEffort: state.workspace.defaultEffort,
    policy: nextPolicy,
    lastActiveThreadId: state.workspace.lastActiveThreadId
  });

  return messageResponse(
    "Fast Mode",
    `当前 agent 的 fastMode 已切换为 \`${!currentFast}\``
  );
}

function handlePermissionsCommand(context: HandlerContext): CommandResponse {
  const state = requireBoundWorkspaceState(context);
  if ("kind" in state) {
    return state;
  }

  return messageResponse(
    "权限策略",
    [
      `agent: \`${state.workspace.name}\``,
      `workspaceRoot: \`${state.workspace.rootPath}\``,
      `defaultModel: \`${state.workspace.defaultModel}\``,
      `defaultEffort: \`${state.workspace.defaultEffort}\``,
      "",
      "当前 policy：",
      "```json",
      JSON.stringify(state.workspace.policy, null, 2),
      "```"
    ].join("\n")
  );
}

function handleExperimentalCommand(context: HandlerContext): CommandResponse {
  const state = requireBoundWorkspaceState(context);
  if ("kind" in state) {
    return state;
  }

  return messageResponse(
    "实验特性",
    [
      "第一版未开放额外实验特性切换。",
      "当前运行模式：single-machine",
      "experimentalApi: true",
      `agent: ${state.workspace.name}`,
      "后续可在这里接入 `experimentalFeature/list`。"
    ].join("\n")
  );
}

function handleStatuslineCommand(context: HandlerContext): CommandResponse {
  const state = requireBoundWorkspaceState(context);
  if ("kind" in state) {
    return state;
  }

  const worker = ensureWorkspaceWorker(context, state.workspace);
  return messageResponse(
    "状态展示项",
    [
      `agent: ${state.workspace.name}`,
      `active thread: ${state.thread?.id || "无"}`,
      `model: ${state.workspace.defaultModel}`,
      `effort: ${state.workspace.defaultEffort}`,
      `worker state: ${worker.getState()}`
    ].join("\n")
  );
}

function handleHelpCommand(context: HandlerContext): CommandResponse {
  return {
    kind: "card",
    title: "命令帮助",
    card: buildHelpCard(listCommandDefinitions())
  };
}

async function handleSkillsCommand(
  context: HandlerContext
): Promise<CommandResponse> {
  const state = requireBoundWorkspaceState(context);
  if ("kind" in state) {
    return state;
  }

  const worker = ensureWorkspaceWorker(context, state.workspace);
  const skills = await worker.listSkills();
  return {
    kind: "card",
    title: "可用 Skills",
    card: buildSkillsCard(skills)
  };
}

async function handleReviewCommand(
  context: HandlerContext
): Promise<CommandResponse> {
  const state = requireBoundWorkspaceState(context);
  if ("kind" in state) {
    return state;
  }
  if (!state.thread) {
    return messageResponse("无法 Review", "当前 agent 还没有 active thread。");
  }

  const worker = ensureWorkspaceWorker(context, state.workspace);
  await worker.startReview(state.thread.codexThreadId);
  return messageResponse("Review 已发起", "已对当前线程发起 uncommitted changes review。");
}

async function handleRenameCommand(
  name: string,
  context: HandlerContext
): Promise<CommandResponse> {
  const state = requireBoundWorkspaceState(context);
  if ("kind" in state) {
    return state;
  }
  if (!state.thread) {
    return messageResponse("无法重命名", "当前 agent 没有 active thread。");
  }

  const nextName = name.trim();
  if (!nextName) {
    return {
      kind: "card",
      title: "重命名线程",
      card: buildRenameThreadCard(state.thread)
    };
  }

  const worker = ensureWorkspaceWorker(context, state.workspace);
  await worker.setThreadName(state.thread.codexThreadId, nextName);
  context.db.threads.updateThread(state.thread.id, { name: nextName });

  return messageResponse("线程已重命名", `当前线程已重命名为 \`${nextName}\``);
}

async function handleSubagentsCommand(
  argText: string,
  context: HandlerContext
): Promise<CommandResponse> {
  const state = requireBoundWorkspaceState(context);
  if ("kind" in state) {
    return state;
  }
  if (!state.thread) {
    return messageResponse("暂无 Sub-agents", "当前还没有主线程。");
  }

  await syncWorkspaceThreads(
    context,
    state.workspace,
    ensureWorkspaceWorker(context, state.workspace)
  );

  const mainThread = resolveSubagentMainThread(context, state.workspace.id, state.thread);
  if (!mainThread) {
    return messageResponse("切换失败", "当前没有可定位的主线程。");
  }

  const allWorkspaceThreads = context.db.threads.listByWorkspaceId(state.workspace.id);
  const subagentThreads = allWorkspaceThreads.filter(
    (thread) =>
      thread.kind === "subagent" &&
      thread.parentThreadId === mainThread.id
  );

  const normalizedArg = argText.trim();
  if (normalizedArg.length > 0) {
    if (normalizedArg === "back") {
      if (state.thread.kind !== "subagent" || !state.thread.parentThreadId) {
        return messageResponse("已在主线程", `当前 active thread 已是主线程 \`${mainThread.id}\``);
      }

      const worker = ensureWorkspaceWorker(context, state.workspace);
      await bestEffortResumeThread(worker, mainThread.codexThreadId);
      setActiveThreadForSession(context, state.binding, state.workspace, mainThread.id);

      return messageResponse("已返回主线程", `当前 active thread 已切回 \`${mainThread.id}\``);
    }

    if (normalizedArg === "switch") {
      return messageResponse(
        "参数缺失",
        "用法：`/subagents switch <threadId>`"
      );
    }

    const switchMatch = normalizedArg.match(/^switch\s+(.+)$/u);
    if (switchMatch) {
      const target = switchMatch[1]?.trim();
      if (!target) {
        return messageResponse(
          "参数缺失",
          "用法：`/subagents switch <threadId>`"
        );
      }

      const candidate = subagentThreads.find(
        (thread) => matchesThreadSelector(thread, target)
      );
      if (!candidate) {
        return messageResponse(
          "切换失败",
          `当前主线程下找不到 sub-agent 线程：\`${target}\``
        );
      }

      const worker = ensureWorkspaceWorker(context, state.workspace);
      await bestEffortResumeThread(worker, candidate.codexThreadId);
      setActiveThreadForSession(context, state.binding, state.workspace, candidate.id);

      return messageResponse(
        "已切换 Sub-agent",
        [`mainThread: \`${mainThread.id}\``, `activeSubagent: \`${candidate.id}\``].join("\n")
      );
    }

    return messageResponse(
      "不支持的子命令",
      "用法：`/subagents`、`/subagents switch <threadId>`、`/subagents back`"
    );
  }

  return messageResponse(
    "Sub-agent Threads",
    subagentThreads.length > 0
      ? subagentThreads
          .map((thread) => {
            const currentMarker =
              state.thread && thread.id === state.thread.id ? " 当前" : "";
            return `- ${thread.name || thread.id} (\`${thread.id}\`)${currentMarker}`;
          })
          .join("\n")
      : "当前主线程下还没有 sub-agent 线程。"
  );
}

async function handleConversationInput(
  text: string,
  context: HandlerContext
): Promise<CommandResponse> {
  const state = requireBoundWorkspaceState(context);
  if ("kind" in state) {
    return state;
  }

  const worker = ensureWorkspaceWorker(context, state.workspace);
  await worker.ensureReady();
  await syncWorkspaceThreads(context, state.workspace, worker);

  const workspace = state.workspace;
  const activeThread = state.thread ?? (await ensureWorkspaceThread(context, workspace));
  const model = workspace.defaultModel;
  const effort = workspace.defaultEffort;
  let lastStreamEmitAt = 0;
  let latestText = "";
  let sawStreamEvent = false;
  const emitConversationUpdate = (update: ConversationUpdate) => {
    void context.hooks?.onConversationUpdate?.(update);
  };

  try {
    const runResult = await runConversationTurn(activeThread);

    context.db.threads.updateThread(activeThread.id, {
      status: "completed",
      lastTurnId: runResult.turnId,
      isActive: true
    });
    context.db.workspaces.setLastActiveThreadId(workspace.id, activeThread.id);
    if (state.binding) {
      context.db.sessionBindings.upsert({
        id: state.binding.id,
        userId: state.binding.userId,
        chatId: state.binding.chatId,
        threadKey: state.binding.threadKey,
        workspaceId: workspace.id,
        activeThreadId: activeThread.id
      });
    }

    if (context.hooks?.onConversationUpdate) {
      emitConversationUpdate({
        state: "completed",
        text: runResult.text || latestText,
        turnId: runResult.turnId,
        model,
        effort,
        ...buildUsageUpdateFields(runResult.tokenUsage, runResult.elapsedMs)
      });
      return {
        kind: "noop"
      };
    }

    return messageResponse(
      "Codex 回复",
      runResult.text || "本次执行已完成，但没有返回正文。"
    );
  } catch (error) {
    if (state.thread && isStaleThreadExecutionError(error)) {
      context.db.threads.updateThread(state.thread.id, {
        status: "failed",
        isActive: false
      });

      const recreatedThread = await ensureWorkspaceThread(context, workspace);
      const retriedResult = await runConversationTurn(recreatedThread);

      context.db.threads.updateThread(recreatedThread.id, {
        status: "completed",
        lastTurnId: retriedResult.turnId,
        isActive: true
      });
      context.db.workspaces.setLastActiveThreadId(workspace.id, recreatedThread.id);
      if (state.binding) {
        context.db.sessionBindings.upsert({
          id: state.binding.id,
          userId: state.binding.userId,
          chatId: state.binding.chatId,
          threadKey: state.binding.threadKey,
          workspaceId: workspace.id,
          activeThreadId: recreatedThread.id
        });
      }

      if (context.hooks?.onConversationUpdate) {
        emitConversationUpdate({
          state: "completed",
          text: retriedResult.text || latestText,
          turnId: retriedResult.turnId,
          model,
          effort,
          ...buildUsageUpdateFields(retriedResult.tokenUsage, retriedResult.elapsedMs)
        });
        return {
          kind: "noop"
        };
      }

      return messageResponse(
        "Codex 回复",
        retriedResult.text || "本次执行已完成，但没有返回正文。"
      );
    }

    context.db.threads.updateThread(activeThread.id, {
      status: "failed",
      isActive: true
    });
    if (context.hooks?.onConversationUpdate) {
      emitConversationUpdate({
        state: "failed",
        text: latestText,
        errorText: error instanceof Error ? error.message : String(error),
        model,
        effort
      });
      return {
        kind: "noop"
      };
    }

    if (!sawStreamEvent) {
      throw error;
    }

    return messageResponse(
      "执行失败",
      formatConversationFailure(error)
    );
  }

  async function runConversationTurn(thread: ThreadRecord) {
    return worker.runTurn(thread.codexThreadId, text, {
      model,
      effort,
      onStarted: ({ turnId }) => {
        context.db.threads.updateThread(thread.id, {
          status: "running",
          lastTurnId: turnId,
          isActive: true
        });
        emitConversationUpdate({
          state: "starting",
          text: "",
          turnId,
          model,
          effort
        });
      },
      onDelta: ({ turnId, text: aggregatedText }) => {
        latestText = aggregatedText;
        const now = Date.now();
        if (now - lastStreamEmitAt < 300 && latestText.length > 0) {
          return;
        }

        sawStreamEvent = true;
        lastStreamEmitAt = now;
        emitConversationUpdate({
          state: "streaming",
          text: latestText,
          turnId,
          model,
          effort
        });
      }
    });
  }
}

function formatConversationFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("stream disconnected before completion")) {
    return [
      "本次流式回复中途断开了。",
      "这通常是上游模型服务或网络连接瞬时中断，不是你的消息格式问题。",
      "可以直接重试一次；如果持续出现，我会继续把它做成自动重试。"
    ].join("\n");
  }

  return message;
}

function buildUsageUpdateFields(
  tokenUsage: CodexThreadTokenUsage | undefined,
  elapsedMs: number | undefined
): Pick<
  ConversationUpdate,
  "tokenUsage" | "contextTokensUsed" | "contextTokensRemaining" | "elapsedMs"
> {
  const contextTokensUsed = tokenUsage?.total.totalTokens;
  const contextWindow = tokenUsage?.modelContextWindow;
  const contextTokensRemaining =
    typeof contextTokensUsed === "number" && typeof contextWindow === "number"
      ? Math.max(contextWindow - contextTokensUsed, 0)
      : undefined;

  return {
    ...(tokenUsage ? { tokenUsage } : {}),
    ...(typeof contextTokensUsed === "number" ? { contextTokensUsed } : {}),
    ...(typeof contextTokensRemaining === "number"
      ? { contextTokensRemaining }
      : {}),
    ...(typeof elapsedMs === "number" ? { elapsedMs } : {})
  };
}

function buildLastRunStatusLines(lastRunStats: CodexLastRunStats | null): string[] {
  if (!lastRunStats) {
    return ["lastRun: 暂无最近一次生成指标"];
  }

  const lines = [
    `lastTurn: \`${lastRunStats.turnId}\``,
    `elapsed: \`${formatElapsedSeconds(lastRunStats.elapsedMs)}\``
  ];
  const tokenUsage = lastRunStats.tokenUsage;
  if (tokenUsage) {
    lines.push(
      `tokens: \`${tokenUsage.total.totalTokens} total / ${tokenUsage.total.inputTokens} in / ${tokenUsage.total.outputTokens} out\``
    );

    if (typeof tokenUsage.modelContextWindow === "number") {
      const remaining = Math.max(
        tokenUsage.modelContextWindow - tokenUsage.total.totalTokens,
        0
      );
      lines.push(
        `context: \`${tokenUsage.total.totalTokens} / ${tokenUsage.modelContextWindow} used, ${remaining} left\``
      );
    }
  }

  return lines;
}

function formatElapsedSeconds(elapsedMs: number): string {
  return `${(elapsedMs / 1000).toFixed(1)}s`;
}

function ensureUser(
  db: DatabaseContext,
  actor: SessionActor,
  workspaceRootBasePath: string,
  defaultCodexModel = "gpt-5.4",
  defaultCodexEffort = "high"
) {
  const existing = db.users.getByFeishuOpenId(actor.openId);
  if (existing) {
    return db.users.upsert({
      id: existing.id,
      feishuOpenId: actor.openId,
      feishuUnionId: actor.unionId ?? null,
      feishuUserId: actor.userId ?? null,
      displayName: actor.displayName
    });
  }

  const user = db.users.upsert({
    id: randomUUID(),
    feishuOpenId: actor.openId,
    feishuUnionId: actor.unionId ?? null,
    feishuUserId: actor.userId ?? null,
    displayName: actor.displayName
  });

  const rootPath = path.join(workspaceRootBasePath, user.id, "default");
  fs.mkdirSync(rootPath, { recursive: true });

  db.workspaces.upsert({
    id: randomUUID(),
    ownerUserId: user.id,
    name: "Default Agent",
    slug: "default",
    rootPath,
    status: "ready",
    defaultModel: defaultCodexModel,
    defaultEffort: defaultCodexEffort
  });

  return user;
}

function getCurrentBindingState(context: HandlerContext): BindingState {
  const actor = context.db.users.getByFeishuOpenId(context.session.actor.openId);
  if (!actor) {
    throw new Error("Actor record must exist before command execution");
  }

  const threadKey = context.session.threadKey ?? null;
  let binding = context.db.sessionBindings.getBySession(
    actor.id,
    context.session.chatId,
    threadKey
  );
  if (!binding && threadKey) {
    const chatBinding = context.db.sessionBindings.getBySession(
      actor.id,
      context.session.chatId,
      null
    );
    if (chatBinding) {
      // 话题会话默认继承同 chat 主会话绑定的 agent 与 active thread。
      binding = context.db.sessionBindings.upsert({
        id: randomUUID(),
        userId: actor.id,
        chatId: context.session.chatId,
        threadKey,
        workspaceId: chatBinding.workspaceId,
        activeThreadId: chatBinding.activeThreadId
      });
    }
  }

  const workspace = binding?.workspaceId
    ? context.db.workspaces.getById(binding.workspaceId)
    : null;
  const thread = binding?.activeThreadId
    ? context.db.threads.getById(binding.activeThreadId)
    : workspace?.lastActiveThreadId
      ? context.db.threads.getById(workspace.lastActiveThreadId)
      : null;

  return { actor, binding, workspace, thread };
}

function requireBoundWorkspaceState(
  context: HandlerContext
):
  | {
      actor: BindingState["actor"];
      binding: NonNullable<BindingState["binding"]>;
      workspace: WorkspaceRecord;
      thread: ThreadRecord | null;
    }
  | CommandResponse {
  const state = getCurrentBindingState(context);
  if (!state.binding || !state.workspace) {
    return messageResponse(
      "当前未绑定",
      "当前会话还没有绑定 agent。先使用 `/bind <agent>`。"
    );
  }

  return {
    actor: state.actor,
    binding: state.binding,
    workspace: state.workspace,
    thread: state.thread
  };
}

function resolveWorkspaceBySelector(
  db: DatabaseContext,
  ownerUserId: string,
  selector: string
): WorkspaceRecord | null {
  return (
    db.workspaces.getByOwnerAndSlug(ownerUserId, selector) ||
    db.workspaces
      .listByOwnerUserId(ownerUserId)
      .find(
        (workspace) =>
          workspace.id === selector ||
          workspace.name === selector ||
          workspace.slug === selector
      ) ||
    null
  );
}

function ensureWorkspaceFromAbsolutePath(
  context: HandlerContext,
  ownerUserId: string,
  selector: string
): WorkspaceRecord | null {
  if (!path.isAbsolute(selector)) {
    return null;
  }

  const normalizedPath = path.resolve(selector);
  let stats: fs.Stats;
  try {
    stats = fs.statSync(normalizedPath);
  } catch {
    return null;
  }

  if (!stats.isDirectory()) {
    return null;
  }

  const existing = context.db.workspaces
    .listByOwnerUserId(ownerUserId)
    .find((workspace) => workspace.rootPath === normalizedPath);
  if (existing) {
    return existing;
  }

  const baseName = path.basename(normalizedPath) || "workspace";
  const slug = buildWorkspaceSlug(
    context.db.workspaces.listByOwnerUserId(ownerUserId).map((workspace) => workspace.slug),
    baseName
  );

  const workspace = context.db.workspaces.upsert({
    id: randomUUID(),
    ownerUserId,
    name: baseName,
    slug,
    rootPath: normalizedPath,
    status: "ready",
    defaultModel: context.defaultCodexModel,
    defaultEffort: context.defaultCodexEffort
  });
  return workspace;
}

function buildWorkspaceSlug(existingSlugs: string[], rawName: string): string {
  const base = rawName.trim() || "workspace";
  if (!existingSlugs.includes(base)) {
    return base;
  }

  let counter = 2;
  while (existingSlugs.includes(`${base}-${counter}`)) {
    counter += 1;
  }
  return `${base}-${counter}`;
}

function matchesWorkspaceSelector(
  workspace: WorkspaceRecord,
  selector: string
): boolean {
  return (
    workspace.id === selector ||
    workspace.slug === selector ||
    workspace.name === selector
  );
}

function upsertSessionBinding(
  context: HandlerContext,
  workspaceId: string
) {
  const state = getCurrentBindingState(context);
  return context.db.sessionBindings.upsert({
    id: state.binding?.id ?? randomUUID(),
    userId: state.actor.id,
    chatId: context.session.chatId,
    threadKey: context.session.threadKey ?? null,
    workspaceId,
    activeThreadId: state.binding?.activeThreadId ?? null
  });
}

function ensureWorkspaceWorker(
  context: HandlerContext,
  workspace: WorkspaceRecord
): CodexWorkspaceWorker {
  return context.workers.ensureWorker(
    workspace.id,
    workspace.rootPath,
    context.codexCommand
  );
}

async function syncWorkspaceThreads(
  context: HandlerContext,
  workspace: WorkspaceRecord,
  worker: CodexWorkspaceWorker
): Promise<void> {
  const remoteThreads = (await worker.listThreads()).filter((thread) =>
    pathMatchesWorkspaceRoot(thread.cwd, workspace.rootPath)
  );
  const visibleCodexThreadIds = remoteThreads.map((thread) => thread.id);
  if (visibleCodexThreadIds.length > 0) {
    context.db.threads.deleteMainThreadsNotInCodexIds(
      workspace.id,
      visibleCodexThreadIds,
      workspace.lastActiveThreadId
    );
  }

  for (const remoteThread of remoteThreads) {
    const existing = context.db.threads.getByCodexThreadId(remoteThread.id);
    const normalizedPreview = normalizeThreadSummaryText(remoteThread.preview, 160);
    context.db.threads.upsert({
      id: existing?.id ?? randomUUID(),
      workspaceId: workspace.id,
      codexThreadId: remoteThread.id,
      name: remoteThread.name,
      kind: "main",
      status: mapRemoteThreadStatus(remoteThread.status),
      metadata: {
        updatedAt: remoteThread.updatedAt,
        codexPath: remoteThread.codexPath,
        cwd: remoteThread.cwd,
        preview: normalizedPreview
      },
      isActive:
        workspace.lastActiveThreadId != null &&
        existing?.id === workspace.lastActiveThreadId
    });
  }
}

function pathMatchesWorkspaceRoot(candidatePath: string, workspaceRoot: string): boolean {
  const normalizedCandidate = normalizeWorkspacePath(candidatePath);
  const normalizedWorkspaceRoot = normalizeWorkspacePath(workspaceRoot);
  if (!normalizedCandidate || !normalizedWorkspaceRoot) {
    return false;
  }

  const compareCandidate = normalizeComparableWorkspacePath(normalizedCandidate);
  const compareWorkspaceRoot = normalizeComparableWorkspacePath(normalizedWorkspaceRoot);
  if (compareCandidate === compareWorkspaceRoot) {
    return true;
  }

  return compareCandidate.startsWith(`${compareWorkspaceRoot}/`);
}

function normalizeWorkspacePath(value: string): string {
  const normalized = String(value || "").trim().replace(/\\/g, "/");
  if (!normalized) {
    return "";
  }

  const normalizedDrivePrefix = /^\/[A-Za-z]:\//.test(normalized)
    ? normalized.slice(1)
    : normalized;
  return normalizedDrivePrefix.replace(/\/+$/g, "");
}

function normalizeComparableWorkspacePath(pathValue: string): string {
  return /^[A-Za-z]:\//.test(pathValue) ? pathValue.toLowerCase() : pathValue;
}

async function ensureWorkspaceThread(
  context: HandlerContext,
  workspace: WorkspaceRecord
): Promise<ThreadRecord> {
  const worker = ensureWorkspaceWorker(context, workspace);
  const created = await worker.startThread();
  const thread = context.db.threads.upsert({
    id: randomUUID(),
    workspaceId: workspace.id,
    codexThreadId: created.id,
    name: created.name,
    kind: "main",
    status: "created",
    metadata: {
      updatedAt: created.updatedAt,
      codexPath: created.codexPath,
      cwd: created.cwd,
      preview: normalizeThreadSummaryText(created.preview, 160)
    },
    isActive: true
  });
  context.db.threads.setActiveThread(workspace.id, thread.id);
  context.db.workspaces.setLastActiveThreadId(workspace.id, thread.id);
  return thread;
}

async function hydrateRecentThreadPreviews(
  context: HandlerContext,
  workspace: WorkspaceRecord,
  worker: CodexWorkspaceWorker
): Promise<void> {
  const recentThreads = context.db.threads
    .listByWorkspaceId(workspace.id)
    .filter((thread) => thread.kind === "main")
    .sort(compareThreadsForDisplay)
    .slice(0, 6);

  for (const thread of recentThreads) {
    const existingPreview =
      typeof thread.metadata.preview === "string" ? thread.metadata.preview.trim() : "";
    if (existingPreview) {
      continue;
    }

    try {
      const response = (await readThreadWithAutoResume(
        worker,
        thread.codexThreadId
      )) as {
        thread?: {
          turns?: Array<{
            items?: Array<
              | { type: "userMessage"; content?: Array<{ text?: string }> }
              | { type: "agentMessage"; text?: string }
            >;
          }>;
        };
      };
      const summary = extractThreadSummary(response);
      if (!summary.preview && !summary.lastUserText && !summary.lastAgentText) {
        continue;
      }

      context.db.threads.upsert({
        id: thread.id,
        workspaceId: thread.workspaceId,
        codexThreadId: thread.codexThreadId,
        name: thread.name,
        kind: thread.kind,
        parentThreadId: thread.parentThreadId,
        status: thread.status,
        isActive: thread.isActive,
        lastTurnId: thread.lastTurnId,
        metadata: {
          ...thread.metadata,
          ...(summary.preview ? { preview: summary.preview } : {}),
          ...(summary.lastUserText ? { lastUserText: summary.lastUserText } : {}),
          ...(summary.lastAgentText ? { lastAgentText: summary.lastAgentText } : {})
        }
      });
    } catch {
      continue;
    }
  }
}

function mapRemoteThreadStatus(status: string): ThreadRecord["status"] {
  if (status === "running") {
    return "running";
  }
  if (status === "errored" || status === "failed") {
    return "failed";
  }
  return "created";
}

function resolveSubagentMainThread(
  context: HandlerContext,
  workspaceId: string,
  activeThread: ThreadRecord
): ThreadRecord | null {
  if (activeThread.kind !== "subagent") {
    return activeThread;
  }

  if (!activeThread.parentThreadId) {
    return null;
  }

  return (
    context.db.threads.getById(activeThread.parentThreadId) ??
    context.db.threads
      .listByWorkspaceId(workspaceId)
      .find((thread) => thread.id === activeThread.parentThreadId) ??
    null
  );
}

function matchesThreadSelector(thread: ThreadRecord, selector: string): boolean {
  return (
    thread.id === selector ||
    thread.codexThreadId === selector ||
    thread.name === selector
  );
}

function setActiveThreadForSession(
  context: HandlerContext,
  binding: NonNullable<BindingState["binding"]>,
  workspace: WorkspaceRecord,
  threadId: string
): void {
  context.db.threads.setActiveThread(workspace.id, threadId);
  context.db.workspaces.setLastActiveThreadId(workspace.id, threadId);
  context.db.sessionBindings.upsert({
    id: binding.id,
    userId: binding.userId,
    chatId: binding.chatId,
    threadKey: binding.threadKey,
    workspaceId: workspace.id,
    activeThreadId: threadId
  });
}

function buildWorkspaceStatusText(
  workspace: WorkspaceRecord,
  thread: ThreadRecord | null,
  context: HandlerContext
): string {
  const worker = ensureWorkspaceWorker(context, workspace);
  return [
    `agent: \`${workspace.name}\` (\`${workspace.slug}\`)`,
    `status: \`${workspace.status}\``,
    `model: \`${workspace.defaultModel}\``,
    `effort: \`${workspace.defaultEffort}\``,
    `worker: \`${worker.getState()}\``,
    `thread: ${thread ? `\`${thread.id}\`` : "无"}`
  ].join("\n");
}

function messageResponse(title: string, body: string): CommandResponse {
  return {
    kind: "message",
    title,
    body
  };
}

function buildStatusCard(
  workspace: WorkspaceRecord,
  thread: ThreadRecord | null,
  context: HandlerContext,
  page: number
): Record<string, unknown> {
  const allThreads = context.db.threads
    .listByWorkspaceId(workspace.id)
    .filter((candidate) => candidate.kind === "main")
    .sort(compareThreadsForDisplay);
  const pageSize = 10;
  const totalPages = Math.max(1, Math.ceil(allThreads.length / pageSize));
  const safePage = Math.min(Math.max(page, 1), totalPages);
  const pageStart = (safePage - 1) * pageSize;
  const recentThreads = allThreads.slice(pageStart, pageStart + pageSize);

  return {
    schema: "2.0",
    config: {
      update_multi: true,
      width_mode: "fill"
    },
    header: {
      title: {
        tag: "plain_text",
        content: "当前状态"
      },
      template: "blue"
    },
    body: {
      elements: [
        {
          tag: "markdown",
          content: sanitizeCardMarkdown(
            buildWorkspaceStatusText(workspace, thread, context)
          )
        },
        {
          tag: "column_set",
          flex_mode: "none",
          columns: [
            buildCommandButtonColumn("新线程", "/new", "primary", {
              kind: "panel",
              action: "new_thread"
            }),
            buildCommandButtonColumn("刷新", "/sessions", undefined, {
              kind: "panel",
              action: "status"
            }),
            buildCommandButtonColumn("最近消息", "/message", undefined, {
              kind: "panel",
              action: "show_messages"
            }),
            buildCommandButtonColumn("Subagents", "/subagents", undefined, {
              kind: "panel",
              action: "open_threads"
            })
          ]
        },
        {
          tag: "hr"
        },
        {
          tag: "markdown",
          content: `**会话列表**（第 ${safePage}/${totalPages} 页，共 ${allThreads.length} 条）`
        },
        ...buildThreadRows(recentThreads, thread),
        {
          tag: "hr"
        },
        {
          tag: "column_set",
          flex_mode: "none",
          columns: [
            buildCommandButtonColumn(
              "上一页",
              `/sessions ${Math.max(1, safePage - 1)}`,
              undefined,
              {
                kind: "panel",
                action: "sessions_prev"
              }
            ),
            buildCommandButtonColumn(
              "下一页",
              `/sessions ${Math.min(totalPages, safePage + 1)}`,
              undefined,
              {
                kind: "panel",
                action: "sessions_next"
              }
            )
          ]
        }
      ]
    }
  };
}

function parseSessionsPage(argText: string): number {
  const raw = argText.trim();
  if (!raw) {
    return 1;
  }

  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value < 1) {
    return 1;
  }

  return value;
}

function buildThreadRows(
  threads: ThreadRecord[],
  activeThread: ThreadRecord | null
): Array<Record<string, unknown>> {
  if (threads.length === 0) {
    return [
      {
        tag: "markdown",
        content: "暂无历史线程。"
      }
    ];
  }

  return threads.flatMap((thread, index) => {
    const isCurrent = activeThread?.id === thread.id;
    const rows: Array<Record<string, unknown>> = [
      {
        tag: "column_set",
        flex_mode: "none",
        columns: [
          {
            tag: "column",
            width: "weighted",
            weight: 5,
            elements: [
              {
                tag: "markdown",
                content: [
                  `${isCurrent ? "🟢 当前会话" : "⚪ 历史会话"} · **${sanitizeCardMarkdown(resolveSessionDisplayTitle(thread))}**`,
                  `状态: \`${thread.status}\`${formatThreadUpdatedAt(thread)}`,
                  formatThreadPreview(thread)
                ].join("\n")
              }
            ]
          },
          {
            tag: "column",
            width: "auto",
            elements: isCurrent
              ? [
                  {
                    tag: "button",
                    text: {
                      tag: "plain_text",
                      content: "最近消息"
                    },
                    type: "primary",
                    value: {
                      kind: "thread",
                      action: "messages",
                      command: "/message"
                    }
                  }
                ]
              : [
                  {
                    tag: "button",
                    text: {
                      tag: "plain_text",
                      content: "切换"
                    },
                    type: "primary",
                    value: {
                      kind: "thread",
                      action: "switch",
                      local_thread_id: thread.id,
                      command: `/switch ${thread.id}`
                    }
                  }
                ]
          }
        ]
      }
    ];

    if (index < threads.length - 1) {
      rows.push({ tag: "hr" });
    }
    return rows;
  });
}

function compareThreadsForDisplay(left: ThreadRecord, right: ThreadRecord): number {
  const leftUpdatedAt = Number(left.metadata.updatedAt || 0);
  const rightUpdatedAt = Number(right.metadata.updatedAt || 0);
  if (leftUpdatedAt !== rightUpdatedAt) {
    return rightUpdatedAt - leftUpdatedAt;
  }

  return right.updatedAt.localeCompare(left.updatedAt);
}

function formatThreadUpdatedAt(thread: ThreadRecord): string {
  const updatedAt = Number(thread.metadata.updatedAt || 0);
  if (!Number.isFinite(updatedAt) || updatedAt <= 0) {
    return "";
  }

  return ` · updatedAt: \`${new Date(updatedAt).toISOString()}\``;
}

function formatThreadPreview(thread: ThreadRecord): string {
  const preview =
    typeof thread.metadata.preview === "string" ? thread.metadata.preview.trim() : "";
  const agentText =
    typeof thread.metadata.lastAgentText === "string"
      ? thread.metadata.lastAgentText.trim()
      : "";
  const userText =
    typeof thread.metadata.lastUserText === "string"
      ? thread.metadata.lastUserText.trim()
      : "";
  const summaryText = preview || agentText || userText;

  if (summaryText) {
    return `摘要: ${sanitizeCardMarkdown(truncateThreadLine(summaryText, 52))}`;
  }

  return "摘要: 暂无";
}

function resolveSessionDisplayTitle(thread: ThreadRecord): string {
  const preview =
    typeof thread.metadata.preview === "string" ? thread.metadata.preview.trim() : "";
  if (preview) {
    return truncateThreadLine(preview, 24);
  }

  const name = thread.name?.trim();
  if (name) {
    return truncateThreadLine(name, 24);
  }

  const agentText =
    typeof thread.metadata.lastAgentText === "string"
      ? thread.metadata.lastAgentText.trim()
      : "";
  if (agentText) {
    return truncateThreadLine(agentText, 24);
  }

  const userText =
    typeof thread.metadata.lastUserText === "string"
      ? thread.metadata.lastUserText.trim()
      : "";
  if (userText) {
    return truncateThreadLine(userText, 24);
  }

  return "未命名会话";
}

function truncateThreadLine(text: string, maxLength: number): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength).trim()}...`;
}

function extractThreadSummary(response: {
  thread?: {
    preview?: string | null;
    turns?: Array<{
      items?: Array<
        | { type: "userMessage"; content?: Array<{ text?: string }> }
        | { type: "agentMessage"; text?: string }
      >;
    }>;
  };
}): {
  preview: string;
  lastUserText: string;
  lastAgentText: string;
} {
  const turns = response.thread?.turns || [];
  let lastUserText = "";
  let lastAgentText = "";

  for (const turn of turns) {
    for (const item of turn.items || []) {
      if (item.type === "userMessage") {
        const text = item.content?.map((entry) => entry.text || "").join("").trim();
        if (text) {
          lastUserText = text;
        }
      }
      if (item.type === "agentMessage" && item.text?.trim()) {
        lastAgentText = item.text.trim();
      }
    }
  }

  const threadPreview = normalizeThreadSummaryText(response.thread?.preview, 160);
  const normalizedUserText = normalizeThreadSummaryText(lastUserText, 160);
  const normalizedAgentText = normalizeThreadSummaryText(lastAgentText, 160);

  return {
    preview: threadPreview || normalizedAgentText || normalizedUserText,
    lastUserText: normalizedUserText,
    lastAgentText: normalizedAgentText
  };
}

function normalizeThreadSummaryText(value: unknown, maxLength: number): string {
  const text = String(value || "").replace(/```[\s\S]*?```/g, " ").trim();
  return truncateThreadLine(text, maxLength);
}

function buildWorkspaceListCard(
  workspaces: WorkspaceRecord[],
  currentWorkspaceId?: string
): Record<string, unknown> {
  return {
    schema: "2.0",
    config: {
      update_multi: true,
      width_mode: "fill"
    },
    header: {
      title: {
        tag: "plain_text",
        content: "我的 Agents"
      },
      template: "turquoise"
    },
    body: {
      elements: workspaces.flatMap((workspace) => {
        const currentBadge =
          workspace.id === currentWorkspaceId ? "\n当前已绑定" : "";
        return [
          {
            tag: "markdown",
            content: `**${workspace.name}** (\`${workspace.slug}\`)${currentBadge}`
          },
          {
            tag: "column_set",
            flex_mode: "none",
            columns: [
              buildCommandButtonColumn(
                workspace.id === currentWorkspaceId ? "当前状态" : "进入",
                `/agents status ${workspace.slug}`,
                "primary",
                {
                  kind: "workspace",
                  action: "status",
                  workspace_slug: workspace.slug
                }
              ),
              buildCommandButtonColumn(
                "移除",
                `/agents remove ${workspace.slug}`,
                undefined,
                {
                  kind: "workspace",
                  action: "remove",
                  workspace_slug: workspace.slug
                }
              )
            ]
          }
        ];
      })
    }
  };
}

function buildHelpCard(
  definitions: readonly ReturnType<typeof listCommandDefinitions>[number][]
): Record<string, unknown> {
  const grouped = new Map<string, Array<ReturnType<typeof listCommandDefinitions>[number]>>();
  for (const definition of definitions) {
    const existing = grouped.get(definition.category) || [];
    existing.push(definition);
    grouped.set(definition.category, existing);
  }

  const sections: Array<Record<string, unknown>> = [];
  for (const [category, items] of grouped.entries()) {
    sections.push({
      tag: "markdown",
      content: `**${resolveHelpCategoryTitle(category)}**`
    });
    for (const item of items) {
      const primaryUsage = item.usage[0] || `/${item.name}`;
      const quickCommand = resolveHelpQuickCommand(item);
      const aliases = item.aliases.length > 0
        ? `\n别名: ${item.aliases.map((alias) => `\`${alias}\``).join("、")}`
        : "";
      sections.push({
        tag: "markdown",
        content: `${item.summary}${aliases}`
      });
      sections.push({
        tag: "column_set",
        flex_mode: "none",
        columns: [
          buildCommandButtonColumn(
            primaryUsage,
            quickCommand,
            "primary",
            {
              kind: "help",
              action: "quick_command",
              command_name: item.name,
              usage: primaryUsage
            }
          )
        ]
      });
    }
    sections.push({ tag: "hr" });
  }
  if (sections.length > 0) {
    const lastSection = sections[sections.length - 1] as { tag?: unknown };
    if (lastSection.tag === "hr") {
      sections.pop();
    }
  }

  return {
    schema: "2.0",
    config: {
      update_multi: true,
      width_mode: "fill"
    },
    header: {
      title: {
        tag: "plain_text",
        content: "命令帮助"
      },
      template: "blue"
    },
    body: {
      elements: [
        {
          tag: "markdown",
          content: "点击下方快捷指令可直接执行。"
        },
        ...sections
      ]
    }
  };
}

function resolveHelpQuickCommand(
  definition: ReturnType<typeof listCommandDefinitions>[number]
): string {
  if (definition.name === "switch") {
    return "/switch";
  }
  if (definition.name === "rename") {
    return "/rename";
  }
  return definition.usage[0] || `/${definition.name}`;
}

function buildModelListCard(
  workspace: WorkspaceRecord,
  models: Array<{ id: string; displayName: string }>
): Record<string, unknown> {
  const rows = models.flatMap((model, index) => {
    const isCurrent = model.id === workspace.defaultModel;
    const elements: Array<Record<string, unknown>> = [
      {
        tag: "column_set",
        flex_mode: "none",
        columns: [
          {
            tag: "column",
            width: "weighted",
            weight: 5,
            elements: [
              {
                tag: "markdown",
                content: `${isCurrent ? "🟢" : "⚪"} **${sanitizeCardMarkdown(model.displayName || model.id)}**\n\`${model.id}\``
              }
            ]
          },
          {
            tag: "column",
            width: "auto",
            elements: isCurrent
              ? [
                  {
                    tag: "button",
                    text: {
                      tag: "plain_text",
                      content: "当前模型"
                    },
                    disabled: true
                  }
                ]
              : [
                  {
                    tag: "button",
                    text: {
                      tag: "plain_text",
                      content: "切换"
                    },
                    type: "primary",
                    value: {
                      kind: "callback",
                      command: `/model ${model.id}`,
                      model_id: model.id
                    }
                  }
                ]
          }
        ]
      }
    ];
    if (index < models.length - 1) {
      elements.push({ tag: "hr" });
    }
    return elements;
  });

  return {
    schema: "2.0",
    config: {
      update_multi: true,
      width_mode: "fill"
    },
    header: {
      title: {
        tag: "plain_text",
        content: "模型列表"
      },
      template: "indigo"
    },
    body: {
      elements: [
        {
          tag: "markdown",
          content: `当前 agent: **${sanitizeCardMarkdown(workspace.name)}**\n当前模型: \`${workspace.defaultModel}\``
        },
        ...(rows.length > 0
          ? rows
          : [
              {
                tag: "markdown",
                content: "暂无可用模型。"
              }
            ])
      ]
    }
  };
}

function buildSkillsCard(
  skills: Array<{ name: string; description: string }>
): Record<string, unknown> {
  const sorted = [...skills].sort((a, b) => a.name.localeCompare(b.name));
  return {
    schema: "2.0",
    config: {
      update_multi: true,
      width_mode: "fill"
    },
    header: {
      title: {
        tag: "plain_text",
        content: `可用 Skills (${sorted.length})`
      },
      template: "wathet"
    },
    body: {
      elements:
        sorted.length > 0
          ? sorted.flatMap((skill, index) => {
              const rows: Array<Record<string, unknown>> = [
                {
                  tag: "markdown",
                  content: `**${sanitizeCardMarkdown(skill.name)}**\n${sanitizeCardMarkdown(skill.description || "无描述")}`
                }
              ];
              if (index < sorted.length - 1) {
                rows.push({ tag: "hr" });
              }
              return rows;
            })
          : [
              {
                tag: "markdown",
                content: "当前 agent 没有可见 skills。"
              }
            ]
    }
  };
}

function buildRenameThreadCard(thread: ThreadRecord): Record<string, unknown> {
  const now = new Date();
  const timestampName = `线程-${now.toISOString().replace(/[-:]/g, "").slice(0, 13)}`;
  const preview =
    typeof thread.metadata.preview === "string" ? thread.metadata.preview.trim() : "";
  const previewName = preview ? truncateThreadLine(preview, 20) : "";

  const buttons: Array<Record<string, unknown>> = [
    buildCommandButtonColumn("自动命名", `/rename ${timestampName}`, "primary", {
      kind: "thread",
      action: "rename",
      thread_id: thread.id
    }),
    buildCommandButtonColumn("查看最近消息", "/message", undefined, {
      kind: "thread",
      action: "messages",
      thread_id: thread.id
    })
  ];

  if (previewName) {
    buttons.unshift(
      buildCommandButtonColumn("用摘要命名", `/rename ${previewName}`, "primary", {
        kind: "thread",
        action: "rename",
        thread_id: thread.id
      })
    );
  }

  return {
    schema: "2.0",
    config: {
      update_multi: true,
      width_mode: "fill"
    },
    header: {
      title: {
        tag: "plain_text",
        content: "重命名线程"
      },
      template: "orange"
    },
    body: {
      elements: [
        {
          tag: "markdown",
          content: `当前线程：**${sanitizeCardMarkdown(thread.name || thread.id)}**\n请选择一个命名方案，或直接发送 \`/rename <name>\`。`
        },
        {
          tag: "column_set",
          flex_mode: "none",
          columns: buttons
        }
      ]
    }
  };
}

function buildCommandButtonColumn(
  label: string,
  command: string,
  type?: "default" | "primary" | "danger",
  extraValue?: Record<string, unknown>
): Record<string, unknown> {
  return {
    tag: "column",
    width: "weighted",
    weight: 1,
    elements: [
      {
        tag: "button",
        text: {
          tag: "plain_text",
          content: label
        },
        ...(type ? { type } : {}),
        value: {
          kind: "callback",
          command,
          ...(extraValue ?? {})
        }
      }
    ]
  };
}

function sanitizeCardMarkdown(text: string): string {
  return String(text || "").replace(/\r\n/g, "\n").trim();
}

async function readThreadWithAutoResume(
  worker: CodexWorkspaceWorker,
  codexThreadId: string
): Promise<unknown> {
  try {
    return await worker.readThread(codexThreadId, true);
  } catch (error) {
    if (!isThreadNotLoadedError(error)) {
      throw error;
    }

    await bestEffortResumeThread(worker, codexThreadId);
    return worker.readThread(codexThreadId, true);
  }
}

async function bestEffortResumeThread(
  worker: CodexWorkspaceWorker,
  codexThreadId: string
): Promise<void> {
  try {
    await worker.resumeThread(codexThreadId);
  } catch (error) {
    if (isMissingRolloutError(error)) {
      return;
    }
    throw error;
  }
}

function isThreadNotLoadedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("thread not loaded");
}

function isMissingRolloutError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("no rollout found for thread id");
}

function isStaleThreadExecutionError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("thread not found") || message.includes("unknown thread");
}

function isThreadNotMaterializedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("is not materialized yet") &&
    message.includes("includeTurns is unavailable before first user message")
  );
}

function isThreadUnavailableForReadError(error: unknown): boolean {
  return isThreadNotLoadedError(error) || isMissingRolloutError(error);
}

function resolveHelpCategoryTitle(category: string): string {
  if (category === "workspace") {
    return "Agents";
  }
  if (category === "thread") {
    return "Thread";
  }
  return "Codex";
}
