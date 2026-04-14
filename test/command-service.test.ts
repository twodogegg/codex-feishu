import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { initializeDatabase } from "../src/db/index.ts";
import { CommandService } from "../src/app/command-service.ts";
import { CodexWorkerManager } from "../src/workers/codex/worker-manager.ts";
import type { WorkspaceRecord } from "../src/types/db.ts";

type FakeThreadSummary = {
  id: string;
  name: string;
  preview?: string | null;
  status: string;
  cwd?: string;
  updatedAt?: number;
  codexPath?: string | null;
};

function createFixture(options?: {
  remoteThreads?: FakeThreadSummary[];
  streamedTextChunks?: string[];
  failRunTurnWithThreadNotFoundOnce?: boolean;
  runTurnResult?: {
    tokenUsage?: {
      total: {
        totalTokens: number;
        inputTokens: number;
        cachedInputTokens: number;
        outputTokens: number;
        reasoningOutputTokens: number;
      };
      last: {
        totalTokens: number;
        inputTokens: number;
        cachedInputTokens: number;
        outputTokens: number;
        reasoningOutputTokens: number;
      };
      modelContextWindow?: number | null;
    };
      elapsedMs?: number;
    };
  lastRunStats?: {
    threadId: string;
    turnId: string;
    tokenUsage?: {
      total: {
        totalTokens: number;
        inputTokens: number;
        cachedInputTokens: number;
        outputTokens: number;
        reasoningOutputTokens: number;
      };
      last: {
        totalTokens: number;
        inputTokens: number;
        cachedInputTokens: number;
        outputTokens: number;
        reasoningOutputTokens: number;
      };
      modelContextWindow?: number | null;
    };
    elapsedMs: number;
  };
}) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-feishu-test-"));
  const db = initializeDatabase({
    databasePath: path.join(tempDir, "app.db")
  });

  const state = {
    remoteThreads: options?.remoteThreads ?? [],
    workerState: "ready",
    closed: false,
    runTurnFailureConsumed: false,
    runTurnCalls: [] as Array<{ threadId: string; cwd?: string; text: string }>
  };

  const worker = {
    workspaceId: "",
    workspaceRoot: "",
    async ensureReady() {},
    getState() {
      return state.workerState;
    },
    getLastRunStats() {
      if (!options?.lastRunStats) {
        return null;
      }
      return {
        ...options.lastRunStats,
        ...(options.lastRunStats.tokenUsage
          ? {
              tokenUsage: {
                ...options.lastRunStats.tokenUsage,
                modelContextWindow:
                  options.lastRunStats.tokenUsage.modelContextWindow ?? null
              }
            }
          : {})
      };
    },
    async listThreads() {
      const source = options?.remoteThreads || state.remoteThreads;
      return source.map((thread) => ({
        cwd: worker.workspaceRoot,
        updatedAt: Date.now(),
        codexPath: null,
        ...thread
      }));
    },
    async startThread() {
      return {
        id: "thread_new",
        name: "New Thread",
        status: "created",
        cwd: worker.workspaceRoot,
        updatedAt: Date.now(),
        codexPath: null
      };
    },
    resumedThreadIds: [] as string[],
    async resumeThread(threadId: string) {
      this.resumedThreadIds.push(threadId);
    },
    async readThread() {
      return {
        thread: {
          turns: []
        }
      };
    },
    async setThreadName() {},
    async listModels() {
      return [];
    },
    async listSkills() {
      return [];
    },
    async startReview() {},
    async startCompact() {},
    async interruptTurn() {},
    async runTurn(
      threadId: string,
      _text: string,
      runOptions?: {
        model?: string;
        effort?: string;
        onStarted?: (payload: { turnId: string }) => void;
        onDelta?: (payload: { turnId: string; delta: string; text: string }) => void;
      }
    ) {
      state.runTurnCalls.push({
        threadId,
        text: _text
      });
      if (
        options?.failRunTurnWithThreadNotFoundOnce &&
        !state.runTurnFailureConsumed
      ) {
        state.runTurnFailureConsumed = true;
        throw new Error(`thread not found: ${threadId}`);
      }

      const turnId = "turn_1";
      runOptions?.onStarted?.({ turnId });
      const chunks = options?.streamedTextChunks ?? [];
      let text = "";
      for (const chunk of chunks) {
        text += chunk;
        runOptions?.onDelta?.({
          turnId,
          delta: chunk,
          text
        });
      }
      return {
        turnId,
        text: text || "ok",
        ...(options?.runTurnResult?.tokenUsage
          ? {
              tokenUsage: {
                ...options.runTurnResult.tokenUsage,
                modelContextWindow:
                  options.runTurnResult.tokenUsage.modelContextWindow ?? null
              }
            }
          : {}),
        ...(typeof options?.runTurnResult?.elapsedMs === "number"
          ? { elapsedMs: options.runTurnResult.elapsedMs }
          : {})
      };
    },
    close() {
      state.closed = true;
    }
  };

  const workers = {
    ensureWorker(workspaceId: string, workspaceRoot: string) {
      worker.workspaceId = workspaceId;
      worker.workspaceRoot = workspaceRoot;
      return worker;
    },
    getWorkerCount() {
      return state.closed ? 0 : 1;
    },
    getWorker() {
      return worker;
    },
    closeAll() {
      worker.close();
    }
  } as unknown as CodexWorkerManager;

  const service = new CommandService(db, workers, {
    workspaceRootBasePath: path.join(tempDir, "workspaces"),
    codexCommand: "codex",
    defaultCodexModel: "gpt-5.4",
    defaultCodexEffort: "high"
  });

  const session = {
    actor: {
      openId: "ou_test_user",
      displayName: "Test User"
    },
    chatId: "oc_test_chat"
  };

  return {
    tempDir,
    db,
    workers,
    worker,
    state,
    service,
    session,
    cleanup() {
      workers.closeAll();
      db.close();
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  };
}

async function bindDefaultWorkspace(fixture: ReturnType<typeof createFixture>) {
  const result = await fixture.service.executeText("/bind default", fixture.session);
  assert.equal(result.kind, "handled");
  if (result.kind === "handled") {
    assert.equal(result.commandName, "bind");
  }

  const user = fixture.db.users.getByFeishuOpenId(fixture.session.actor.openId);
  assert.ok(user);

  const workspace = fixture.db.workspaces.getByOwnerAndSlug(user.id, "default");
  assert.ok(workspace);

  return {
    user,
    workspace
  };
}

function updateWorkspacePolicy(
  fixture: ReturnType<typeof createFixture>,
  workspace: WorkspaceRecord,
  policy: Record<string, unknown>
) {
  fixture.db.workspaces.upsert({
    id: workspace.id,
    ownerUserId: workspace.ownerUserId,
    templateId: workspace.templateId,
    name: workspace.name,
    slug: workspace.slug,
    rootPath: workspace.rootPath,
    status: workspace.status,
    defaultModel: workspace.defaultModel,
    defaultEffort: workspace.defaultEffort,
    policy,
    lastActiveThreadId: workspace.lastActiveThreadId
  });
}

function seedThreadState(
  fixture: ReturnType<typeof createFixture>,
  workspace: WorkspaceRecord,
  options?: {
    activeThread?: "main" | "subagent";
  }
) {
  const mainThread = fixture.db.threads.upsert({
    id: "thread-main-local",
    workspaceId: workspace.id,
    codexThreadId: "codex-main-1",
    name: "Main Thread",
    kind: "main",
    status: "completed",
    isActive: options?.activeThread !== "subagent"
  });
  const subagentThread = fixture.db.threads.upsert({
    id: "thread-sub-local",
    workspaceId: workspace.id,
    codexThreadId: "codex-sub-1",
    name: "Subagent Thread",
    kind: "subagent",
    parentThreadId: mainThread.id,
    status: "completed",
    isActive: options?.activeThread === "subagent"
  });

  const activeThreadId =
    options?.activeThread === "subagent" ? subagentThread.id : mainThread.id;

  fixture.db.threads.setActiveThread(workspace.id, activeThreadId);
  fixture.db.workspaces.setLastActiveThreadId(workspace.id, activeThreadId);

  const user = fixture.db.users.getByFeishuOpenId(fixture.session.actor.openId);
  assert.ok(user);
  const binding = fixture.db.sessionBindings.getBySession(
    user.id,
    fixture.session.chatId,
    null
  );
  assert.ok(binding);

  fixture.db.sessionBindings.upsert({
    id: binding.id,
    userId: binding.userId,
    chatId: binding.chatId,
    threadKey: binding.threadKey,
    workspaceId: workspace.id,
    activeThreadId
  });

  return {
    mainThread,
    subagentThread
  };
}

test("bind 会为用户建立默认 workspace 并绑定会话", async () => {
  const fixture = createFixture();

  try {
    const result = await fixture.service.executeText("/bind default", fixture.session);

    assert.equal(result.kind, "handled");
    if (result.kind === "handled") {
      assert.equal(result.commandName, "bind");
      assert.equal(result.result.kind, "message");
      assert.match(result.result.body, /Default Agent/);
    }
  } finally {
    fixture.cleanup();
  }
});

test("/bind /绝对路径 会自动登记并绑定本机目录 workspace", async () => {
  const fixture = createFixture();

  try {
    const externalWorkspacePath = path.join(fixture.tempDir, "agents", "爱马仕");
    fs.mkdirSync(externalWorkspacePath, { recursive: true });

    const result = await fixture.service.executeText(
      `/bind ${externalWorkspacePath}`,
      fixture.session
    );

    assert.equal(result.kind, "handled");
    if (result.kind === "handled") {
      assert.equal(result.commandName, "bind");
      assert.equal(result.result.kind, "message");
      assert.match(result.result.body, /爱马仕/);
    }

    const user = fixture.db.users.getByFeishuOpenId(fixture.session.actor.openId);
    assert.ok(user);
    const workspace = fixture.db.workspaces
      .listByOwnerUserId(user.id)
      .find((item) => item.rootPath === externalWorkspacePath);
    assert.ok(workspace);
    assert.equal(workspace.name, "爱马仕");

    const binding = fixture.db.sessionBindings.getBySession(
      user.id,
      fixture.session.chatId,
      fixture.session.threadKey ?? null
    );
    assert.ok(binding);
    assert.equal(binding.workspaceId, workspace.id);
  } finally {
    fixture.cleanup();
  }
});

test("/send 会返回当前 workspace 内的文件", async () => {
  const fixture = createFixture();

  try {
    const { workspace } = await bindDefaultWorkspace(fixture);
    const relativePath = "notes/todo.txt";
    const filePath = path.join(workspace.rootPath, relativePath);

    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, "hello from test");

    const result = await fixture.service.executeText(
      `/send ${relativePath}`,
      fixture.session
    );

    assert.equal(result.kind, "handled");
    if (result.kind === "handled") {
      assert.equal(result.commandName, "send");
      assert.equal(result.result.kind, "file");
      assert.equal(result.result.filePath, filePath);
      assert.match(result.result.body, /notes\/todo\.txt/);
    }
  } finally {
    fixture.cleanup();
  }
});

test("/permissions 会返回当前 workspace policy", async () => {
  const fixture = createFixture();

  try {
    const { workspace } = await bindDefaultWorkspace(fixture);
    updateWorkspacePolicy(fixture, workspace, {
      fastMode: true,
      sandbox: "workspace-write"
    });

    const result = await fixture.service.executeText("/permissions", fixture.session);

    assert.equal(result.kind, "handled");
    if (result.kind === "handled") {
      assert.equal(result.commandName, "permissions");
      assert.equal(result.result.kind, "message");
      assert.match(result.result.body, /"fastMode": true/);
      assert.match(result.result.body, /"sandbox": "workspace-write"/);
    }
  } finally {
    fixture.cleanup();
  }
});

test("/model 和 /effort 会更新当前 workspace 默认配置", async () => {
  const fixture = createFixture();

  try {
    const { workspace } = await bindDefaultWorkspace(fixture);

    const modelResult = await fixture.service.executeText(
      "/model gpt-5.4-mini",
      fixture.session
    );
    assert.equal(modelResult.kind, "handled");

    const effortResult = await fixture.service.executeText(
      "/effort medium",
      fixture.session
    );
    assert.equal(effortResult.kind, "handled");

    const updatedWorkspace = fixture.db.workspaces.getById(workspace.id);
    assert.ok(updatedWorkspace);
    assert.equal(updatedWorkspace.defaultModel, "gpt-5.4-mini");
    assert.equal(updatedWorkspace.defaultEffort, "medium");
  } finally {
    fixture.cleanup();
  }
});

test("/fast 会切换并持久化 workspace fastMode", async () => {
  const fixture = createFixture();

  try {
    const { workspace } = await bindDefaultWorkspace(fixture);

    const result = await fixture.service.executeText("/fast", fixture.session);

    assert.equal(result.kind, "handled");
    if (result.kind === "handled") {
      assert.equal(result.commandName, "fast");
      assert.equal(result.result.kind, "message");
      assert.match(result.result.body, /fastMode 已切换为 `true`/);
    }

    const updatedWorkspace = fixture.db.workspaces.getById(workspace.id);
    assert.ok(updatedWorkspace);
    assert.equal(updatedWorkspace.policy.fastMode, true);
  } finally {
    fixture.cleanup();
  }
});

test("/experimental 会返回实验特性提示", async () => {
  const fixture = createFixture();

  try {
    await bindDefaultWorkspace(fixture);

    const result = await fixture.service.executeText(
      "/experimental",
      fixture.session
    );

    assert.equal(result.kind, "handled");
    if (result.kind === "handled") {
      assert.equal(result.commandName, "experimental");
      assert.equal(result.result.kind, "message");
      assert.match(result.result.body, /experimentalFeature\/list/);
    }
  } finally {
    fixture.cleanup();
  }
});

test("/statusline 会返回状态卡展示项说明", async () => {
  const fixture = createFixture();

  try {
    await bindDefaultWorkspace(fixture);

    const result = await fixture.service.executeText("/statusline", fixture.session);

    assert.equal(result.kind, "handled");
    if (result.kind === "handled") {
      assert.equal(result.commandName, "statusline");
      assert.equal(result.result.kind, "message");
      assert.match(result.result.body, /agent: Default Agent/);
      assert.match(result.result.body, /worker state: ready/);
    }
  } finally {
    fixture.cleanup();
  }
});

test("/status 会返回最近一次生成的 token、上下文和耗时", async () => {
  const fixture = createFixture({
    lastRunStats: {
      threadId: "codex-main-1",
      turnId: "turn_1",
      tokenUsage: {
        total: {
          totalTokens: 1200,
          inputTokens: 700,
          cachedInputTokens: 100,
          outputTokens: 500,
          reasoningOutputTokens: 80
        },
        last: {
          totalTokens: 300,
          inputTokens: 180,
          cachedInputTokens: 20,
          outputTokens: 120,
          reasoningOutputTokens: 10
        },
        modelContextWindow: 4000
      },
      elapsedMs: 12345
    }
  });

  try {
    await bindDefaultWorkspace(fixture);

    const result = await fixture.service.executeText("/status", fixture.session);

    assert.equal(result.kind, "handled");
    if (result.kind === "handled") {
      assert.equal(result.commandName, "status");
      assert.equal(result.result.kind, "message");
      assert.match(result.result.body, /tokens: `1200 total \/ 700 in \/ 500 out`/);
      assert.match(result.result.body, /context: `1200 \/ 4000 used, 2800 left`/);
      assert.match(result.result.body, /elapsed: `12\.3s`/);
    }
  } finally {
    fixture.cleanup();
  }
});

test("/help 会返回命令帮助", async () => {
  const fixture = createFixture();

  try {
    const result = await fixture.service.executeText("/help", fixture.session);

    assert.equal(result.kind, "handled");
    if (result.kind === "handled") {
      assert.equal(result.commandName, "help");
      assert.equal(result.result.kind, "card");
      const cardJson = JSON.stringify(result.result.card);
      assert.match(cardJson, /命令帮助/);
      assert.match(cardJson, /\/bind <agent>/);
      assert.match(cardJson, /\/agents/);
      assert.match(cardJson, /\/subagents/);
    }
  } finally {
    fixture.cleanup();
  }
});

test("/model 会返回可点击切换的模型卡片", async () => {
  const fixture = createFixture();
  const worker = fixture.workers.getWorker("") as unknown as {
    listModels: () => Promise<Array<{ id: string; displayName: string }>>;
  };

  try {
    await bindDefaultWorkspace(fixture);
    worker.listModels = async () => [
      { id: "gpt-5.4", displayName: "GPT-5.4" },
      { id: "gpt-5.4-mini", displayName: "GPT-5.4 Mini" }
    ];

    const result = await fixture.service.executeText("/model", fixture.session);

    assert.equal(result.kind, "handled");
    if (result.kind === "handled") {
      assert.equal(result.commandName, "model");
      assert.equal(result.result.kind, "card");
      const cardJson = JSON.stringify(result.result.card);
      assert.match(cardJson, /模型列表/);
      assert.match(cardJson, /\/model gpt-5.4-mini/);
      assert.match(cardJson, /当前模型/);
    }
  } finally {
    fixture.cleanup();
  }
});

test("/model update 已废弃并提示使用 /model", async () => {
  const fixture = createFixture();

  try {
    await bindDefaultWorkspace(fixture);
    const result = await fixture.service.executeText("/model update", fixture.session);

    assert.equal(result.kind, "handled");
    if (result.kind === "handled") {
      assert.equal(result.commandName, "model");
      assert.equal(result.result.kind, "message");
      assert.match(result.result.body, /请直接使用 `\/model`/);
    }
  } finally {
    fixture.cleanup();
  }
});

test("/skills 会返回更易读的技能卡片", async () => {
  const fixture = createFixture();
  const worker = fixture.workers.getWorker("") as unknown as {
    listSkills: () => Promise<Array<{ name: string; description: string }>>;
  };

  try {
    await bindDefaultWorkspace(fixture);
    worker.listSkills = async () => [
      { name: "zeta", description: "Zeta skill" },
      { name: "alpha", description: "Alpha skill" }
    ];

    const result = await fixture.service.executeText("/skills", fixture.session);

    assert.equal(result.kind, "handled");
    if (result.kind === "handled") {
      assert.equal(result.commandName, "skills");
      assert.equal(result.result.kind, "card");
      const cardJson = JSON.stringify(result.result.card);
      assert.match(cardJson, /可用 Skills \(2\)/);
      assert.match(cardJson, /\*\*alpha\*\*/);
      assert.match(cardJson, /\*\*zeta\*\*/);
    }
  } finally {
    fixture.cleanup();
  }
});

test("/switch 无参数会打开会话面板", async () => {
  const fixture = createFixture();

  try {
    await bindDefaultWorkspace(fixture);
    const result = await fixture.service.executeText("/switch", fixture.session);

    assert.equal(result.kind, "handled");
    if (result.kind === "handled") {
      assert.equal(result.commandName, "switch");
      assert.equal(result.result.kind, "card");
      const cardJson = JSON.stringify(result.result.card);
      assert.match(cardJson, /会话列表/);
    }
  } finally {
    fixture.cleanup();
  }
});

test("/rename 无参数会打开重命名面板", async () => {
  const fixture = createFixture();

  try {
    const { workspace } = await bindDefaultWorkspace(fixture);
    seedThreadState(fixture, workspace);
    const result = await fixture.service.executeText("/rename", fixture.session);

    assert.equal(result.kind, "handled");
    if (result.kind === "handled") {
      assert.equal(result.commandName, "rename");
      assert.equal(result.result.kind, "card");
      const cardJson = JSON.stringify(result.result.card);
      assert.match(cardJson, /重命名线程/);
      assert.match(cardJson, /\/rename /);
    }
  } finally {
    fixture.cleanup();
  }
});

test("普通文本在提供流式 hook 时会输出 streaming 更新", async () => {
  const fixture = createFixture({
    streamedTextChunks: ["你好", "，世界"]
  });

  try {
    await bindDefaultWorkspace(fixture);
    const updates: Array<{
      state: string;
      text: string;
      turnId?: string;
    }> = [];

    const result = await fixture.service.executeText("你好", fixture.session, {
      onConversationUpdate(update) {
        updates.push({
          state: update.state,
          text: update.text,
          ...(update.turnId ? { turnId: update.turnId } : {})
        });
      }
    });

    assert.equal(result.kind, "handled");
    if (result.kind === "handled") {
      assert.equal(result.commandName, "message");
      assert.equal(result.result.kind, "noop");
    }

    assert.equal(updates[0]?.state, "starting");
    assert.equal(updates[1]?.state, "streaming");
    assert.equal(updates[1]?.text, "你好");
    assert.equal(updates.at(-1)?.state, "completed");
    assert.equal(updates.at(-1)?.text, "你好，世界");
  } finally {
    fixture.cleanup();
  }
});

test("普通文本完成后会输出 token、上下文余量和生成用时", async () => {
  const fixture = createFixture({
    streamedTextChunks: ["你好", "，世界"],
    runTurnResult: {
      tokenUsage: {
        total: {
          totalTokens: 1200,
          inputTokens: 700,
          cachedInputTokens: 100,
          outputTokens: 500,
          reasoningOutputTokens: 80
        },
        last: {
          totalTokens: 300,
          inputTokens: 180,
          cachedInputTokens: 20,
          outputTokens: 120,
          reasoningOutputTokens: 10
        },
        modelContextWindow: 4000
      },
      elapsedMs: 12345
    }
  });

  try {
    await bindDefaultWorkspace(fixture);
    const updates: Array<Record<string, unknown>> = [];

    const result = await fixture.service.executeText("你好", fixture.session, {
      onConversationUpdate(update) {
        updates.push(update as unknown as Record<string, unknown>);
      }
    });

    assert.equal(result.kind, "handled");
    if (result.kind === "handled") {
      assert.equal(result.commandName, "message");
      assert.equal(result.result.kind, "noop");
    }

    const completed = updates.at(-1);
    assert.equal(completed?.state, "completed");
    assert.deepEqual(completed?.tokenUsage, {
      total: {
        totalTokens: 1200,
        inputTokens: 700,
        cachedInputTokens: 100,
        outputTokens: 500,
        reasoningOutputTokens: 80
      },
      last: {
        totalTokens: 300,
        inputTokens: 180,
        cachedInputTokens: 20,
        outputTokens: 120,
        reasoningOutputTokens: 10
      },
      modelContextWindow: 4000
    });
    assert.equal(completed?.contextTokensUsed, 1200);
    assert.equal(completed?.contextTokensRemaining, 2800);
    assert.equal(completed?.elapsedMs, 12345);
  } finally {
    fixture.cleanup();
  }
});

test("只会同步属于当前 workspace 的线程到当前视图", async () => {
  const fixture = createFixture();

  try {
    const { workspace } = await bindDefaultWorkspace(fixture);
    fixture.db.threads.upsert({
      id: "thread-stale-other",
      workspaceId: workspace.id,
      codexThreadId: "codex-stale-other",
      name: "Stale Other Thread",
      kind: "main",
      status: "completed",
      metadata: {
        cwd: "/tmp/another-repo",
        preview: "stale"
      }
    });
    fixture.state.remoteThreads = [
      {
        id: "codex-workspace-1",
        name: "Workspace Thread",
        preview: "from workspace",
        status: "completed",
        cwd: workspace.rootPath,
        updatedAt: 200
      },
      {
        id: "codex-other-1",
        name: "Other Thread",
        preview: "from other repo",
        status: "completed",
        cwd: "/tmp/another-repo",
        updatedAt: 300
      }
    ];

    const result = await fixture.service.executeText("/sessions", fixture.session);

    assert.equal(result.kind, "handled");
    if (result.kind === "handled") {
      assert.equal(result.commandName, "sessions");
      assert.equal(result.result.kind, "card");
      assert.match(JSON.stringify(result.result.card), /Workspace Thread/);
      assert.doesNotMatch(JSON.stringify(result.result.card), /Other Thread/);
    }

    const importedWorkspaceThread = fixture.db.threads.getByCodexThreadId("codex-workspace-1");
    const importedOtherThread = fixture.db.threads.getByCodexThreadId("codex-other-1");
    const staleOtherThread = fixture.db.threads.getByCodexThreadId("codex-stale-other");
    assert.ok(importedWorkspaceThread);
    assert.equal(importedOtherThread, null);
    assert.equal(staleOtherThread, null);
  } finally {
    fixture.cleanup();
  }
});

test("/agents status <slug> 会切换到目标 workspace 并返回状态卡", async () => {
  const fixture = createFixture();

  try {
    await bindDefaultWorkspace(fixture);
    const user = fixture.db.users.getByFeishuOpenId(fixture.session.actor.openId);
    assert.ok(user);

    const secondWorkspace = fixture.db.workspaces.upsert({
      id: "workspace_second",
      ownerUserId: user.id,
      name: "Second Workspace",
      slug: "second",
      rootPath: path.join(fixture.tempDir, "workspaces", "second"),
      status: "ready",
      defaultModel: "gpt-5.4",
      defaultEffort: "high"
    });

    const result = await fixture.service.executeText(
      `/agents status ${secondWorkspace.slug}`,
      fixture.session
    );

    assert.equal(result.kind, "handled");
    if (result.kind === "handled") {
      assert.equal(result.commandName, "agents");
      assert.equal(result.result.kind, "card");
    }

    const bindingUser = fixture.db.users.getByFeishuOpenId(fixture.session.actor.openId);
    assert.ok(bindingUser);
    const binding = fixture.db.sessionBindings.getBySession(
      bindingUser.id,
      fixture.session.chatId,
      null
    );
    assert.ok(binding);
    assert.equal(binding.workspaceId, secondWorkspace.id);
  } finally {
    fixture.cleanup();
  }
});

test("普通文本在 active thread 已失效时会重建线程并重试", async () => {
  const fixture = createFixture({
    failRunTurnWithThreadNotFoundOnce: true
  });

  try {
    const { workspace } = await bindDefaultWorkspace(fixture);
    const { mainThread } = seedThreadState(fixture, workspace);

    const result = await fixture.service.executeText("继续执行", fixture.session);

    assert.equal(result.kind, "handled");
    if (result.kind === "handled") {
      assert.equal(result.result.kind, "message");
      assert.match(result.result.body, /ok/);
    }

    const user = fixture.db.users.getByFeishuOpenId(fixture.session.actor.openId);
    assert.ok(user);
    const binding = fixture.db.sessionBindings.getBySession(
      user.id,
      fixture.session.chatId,
      null
    );
    assert.ok(binding);
    assert.notEqual(binding.activeThreadId, mainThread.id);

    const reboundThread = binding.activeThreadId
      ? fixture.db.threads.getById(binding.activeThreadId)
      : null;
    assert.ok(reboundThread);
    assert.equal(reboundThread?.codexThreadId, "thread_new");
  } finally {
    fixture.cleanup();
  }
});

test("重启后会保留 session 绑定和 active thread", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-feishu-restart-"));

  const createFixtureFromDir = () => {
    const db = initializeDatabase({
      databasePath: path.join(tempDir, "app.db")
    });

    const worker = {
      workspaceId: "",
      workspaceRoot: "",
      async ensureReady() {},
      getState() {
        return "ready";
      },
      async listThreads() {
        return [];
      },
      async listThreadsForCwd() {
        return [];
      },
      async startThread() {
        return {
          id: "thread_new",
          name: "New Thread",
          status: "created"
        };
      },
      async resumeThread() {},
      async readThread() {
        return { thread: { turns: [] } };
      },
      async setThreadName() {},
      async listModels() {
        return [];
      },
      async listSkills() {
        return [];
      },
      async startReview() {},
      async startCompact() {},
      async interruptTurn() {},
      async runTurn() {
        return { turnId: "turn_1", text: "ok" };
      },
      close() {}
    };

    const workers = {
      ensureWorker(workspaceId: string, workspaceRoot: string) {
        worker.workspaceId = workspaceId;
        worker.workspaceRoot = workspaceRoot;
        return worker;
      },
      getWorkerCount() {
        return 1;
      },
      getWorker() {
        return worker;
      },
      closeAll() {}
    } as unknown as CodexWorkerManager;

    return {
      db,
      service: new CommandService(db, workers, {
        workspaceRootBasePath: path.join(tempDir, "workspaces"),
        codexCommand: "codex",
        defaultCodexModel: "gpt-5.4",
        defaultCodexEffort: "high"
      }),
      session: {
        actor: {
          openId: "ou_restart_user",
          displayName: "Restart User"
        },
        chatId: "oc_restart_chat"
      },
      close() {
        db.close();
      }
    };
  };

  try {
    const first = createFixtureFromDir();
    const bindResult = await first.service.executeText("/bind default", first.session);
    assert.equal(bindResult.kind, "handled");
    const newResult = await first.service.executeText("/new", first.session);
    assert.equal(newResult.kind, "handled");

    const user = first.db.users.getByFeishuOpenId(first.session.actor.openId);
    assert.ok(user);
    const beforeBinding = first.db.sessionBindings.getBySession(
      user.id,
      first.session.chatId,
      null
    );
    assert.ok(beforeBinding);
    const activeThreadId = beforeBinding.activeThreadId;
    assert.ok(activeThreadId);
    first.close();

    const second = createFixtureFromDir();
    const whereResult = await second.service.executeText("/sessions", second.session);

    assert.equal(whereResult.kind, "handled");
    if (whereResult.kind === "handled") {
      assert.equal(whereResult.commandName, "sessions");
      assert.equal(whereResult.result.kind, "card");
      assert.match(JSON.stringify(whereResult.result.card), /当前会话/);
    }

    const secondUser = second.db.users.getByFeishuOpenId(second.session.actor.openId);
    assert.ok(secondUser);
    const secondBinding = second.db.sessionBindings.getBySession(
      secondUser.id,
      second.session.chatId,
      null
    );
    assert.ok(secondBinding);
    assert.equal(secondBinding.activeThreadId, activeThreadId);

    second.close();
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("/sessions 状态卡会展示最近线程并提供切换按钮", async () => {
  const fixture = createFixture({
    remoteThreads: [
      {
        id: "codex-thread-2",
        name: "第二条对话",
        preview: "请帮我修复 workspace 卡片交互",
        status: "created",
        updatedAt: 200
      },
      {
        id: "codex-thread-1",
        name: "第一条对话",
        preview: "先帮我看一下当前线程状态",
        status: "created",
        updatedAt: 100
      }
    ]
  });

  try {
    await bindDefaultWorkspace(fixture);

    const user = fixture.db.users.getByFeishuOpenId(fixture.session.actor.openId);
    assert.ok(user);
    const binding = fixture.db.sessionBindings.getBySession(user.id, fixture.session.chatId, null);
    assert.ok(binding);

    const activeRemote = fixture.db.threads.getByCodexThreadId("codex-thread-1");
    assert.ok(activeRemote);
    fixture.db.sessionBindings.upsert({
      id: binding.id,
      userId: binding.userId,
      chatId: binding.chatId,
      threadKey: binding.threadKey,
      workspaceId: binding.workspaceId,
      activeThreadId: activeRemote.id
    });
    fixture.db.workspaces.setLastActiveThreadId(binding.workspaceId!, activeRemote.id);
    fixture.db.threads.setActiveThread(binding.workspaceId!, activeRemote.id);

    const result = await fixture.service.executeText("/sessions", fixture.session);

    assert.equal(result.kind, "handled");
    if (result.kind === "handled") {
      assert.equal(result.commandName, "sessions");
      assert.equal(result.result.kind, "card");
      const cardJson = JSON.stringify(result.result.card);
      assert.match(cardJson, /会话列表/);
      assert.match(cardJson, /第二条对话/);
      assert.match(cardJson, /第一条对话/);
      assert.match(cardJson, /workspace 卡片交互/);
      assert.doesNotMatch(cardJson, /codex-thread-2/);
      assert.doesNotMatch(cardJson, /codex-thread-1/);
      assert.doesNotMatch(cardJson, /codex:/);
      assert.doesNotMatch(cardJson, /id: `/);
      assert.match(cardJson, /\/switch/);
    }
  } finally {
    fixture.cleanup();
  }
});

test("群聊话题新会话会继承主会话已绑定的 agent", async () => {
  const fixture = createFixture();

  try {
    await bindDefaultWorkspace(fixture);
    const topicSession = {
      ...fixture.session,
      threadKey: "ot_topic_1"
    };
    const result = await fixture.service.executeText("/status", topicSession);

    assert.equal(result.kind, "handled");
    if (result.kind === "handled") {
      assert.equal(result.commandName, "status");
      assert.equal(result.result.kind, "message");
      assert.doesNotMatch(result.result.body, /当前未绑定 agent/);
    }

    const user = fixture.db.users.getByFeishuOpenId(fixture.session.actor.openId);
    assert.ok(user);
    const chatBinding = fixture.db.sessionBindings.getBySession(
      user.id,
      fixture.session.chatId,
      null
    );
    assert.ok(chatBinding);
    const topicBinding = fixture.db.sessionBindings.getBySession(
      user.id,
      fixture.session.chatId,
      "ot_topic_1"
    );
    assert.ok(topicBinding);
    assert.equal(topicBinding.workspaceId, chatBinding.workspaceId);
    assert.equal(topicBinding.activeThreadId, chatBinding.activeThreadId);
  } finally {
    fixture.cleanup();
  }
});

test("/where 不再兼容，会返回未知命令", async () => {
  const fixture = createFixture();

  try {
    await bindDefaultWorkspace(fixture);
    const result = await fixture.service.executeText("/where", fixture.session);

    assert.equal(result.kind, "unknown-command");
  } finally {
    fixture.cleanup();
  }
});

test("/sessions 2 会返回第二页线程列表", async () => {
  const fixture = createFixture({
    remoteThreads: Array.from({ length: 12 }, (_, index) => ({
      id: `codex-thread-${index + 1}`,
      name: `线程 ${index + 1}`,
      preview: `预览 ${index + 1}`,
      status: "created",
      updatedAt: 1200 - index
    }))
  });

  try {
    await bindDefaultWorkspace(fixture);
    const result = await fixture.service.executeText("/sessions 2", fixture.session);

    assert.equal(result.kind, "handled");
    if (result.kind === "handled" && result.result.kind === "card") {
      const cardJson = JSON.stringify(result.result.card);
      assert.match(cardJson, /第 2\/2 页，共 12 条/);
      assert.match(cardJson, /线程 11/);
      assert.match(cardJson, /线程 12/);
      assert.doesNotMatch(cardJson, /线程 1(?!\d)/);
    }
  } finally {
    fixture.cleanup();
  }
});

test("/message 在 thread 未加载时会先 resume 再读取消息", async () => {
  const fixture = createFixture();

  try {
    const { workspace } = await bindDefaultWorkspace(fixture);
    const { mainThread } = seedThreadState(fixture, workspace);

    let resumed = false;
    const worker = fixture.workers.getWorker(workspace.id) as unknown as {
      readThread: (threadId: string, includeTurns?: boolean) => Promise<unknown>;
      resumeThread: (threadId: string) => Promise<void>;
    };

    worker.resumeThread = async () => {
      resumed = true;
    };
    worker.readThread = async () => {
      if (!resumed) {
        throw new Error(`thread not loaded: ${mainThread.codexThreadId}`);
      }

      return {
        thread: {
          turns: [
            {
              items: [
                {
                  type: "agentMessage",
                  text: "恢复后可读取"
                }
              ]
            }
          ]
        }
      };
    };

    const result = await fixture.service.executeText("/message", fixture.session);

    assert.equal(result.kind, "handled");
    if (result.kind === "handled") {
      assert.equal(result.commandName, "message");
      assert.equal(result.result.kind, "message");
      assert.match(result.result.body, /恢复后可读取/);
    }
  } finally {
    fixture.cleanup();
  }
});

test("/message 在新线程尚无首条消息时返回友好提示", async () => {
  const fixture = createFixture();

  try {
    const { workspace } = await bindDefaultWorkspace(fixture);
    const { mainThread } = seedThreadState(fixture, workspace);

    const worker = fixture.workers.getWorker(workspace.id) as unknown as {
      readThread: (threadId: string, includeTurns?: boolean) => Promise<unknown>;
    };

    worker.readThread = async () => {
      throw new Error(
        `thread ${mainThread.codexThreadId} is not materialized yet; includeTurns is unavailable before first user message`
      );
    };

    const result = await fixture.service.executeText("/message", fixture.session);

    assert.equal(result.kind, "handled");
    if (result.kind === "handled") {
      assert.equal(result.commandName, "message");
      assert.equal(result.result.kind, "message");
      assert.match(result.result.body, /当前线程还没有可展示的消息/);
    }
  } finally {
    fixture.cleanup();
  }
});

test("/message 在 thread 无法加载时返回可恢复提示而不是执行失败", async () => {
  const fixture = createFixture();

  try {
    const { workspace } = await bindDefaultWorkspace(fixture);
    const { mainThread } = seedThreadState(fixture, workspace);

    const worker = fixture.workers.getWorker(workspace.id) as unknown as {
      readThread: (threadId: string, includeTurns?: boolean) => Promise<unknown>;
      resumeThread: (threadId: string) => Promise<void>;
    };

    worker.resumeThread = async () => {
      throw new Error(`no rollout found for thread id ${mainThread.codexThreadId}`);
    };
    worker.readThread = async () => {
      throw new Error(`thread not loaded: ${mainThread.codexThreadId}`);
    };

    const result = await fixture.service.executeText("/message", fixture.session);

    assert.equal(result.kind, "handled");
    if (result.kind === "handled") {
      assert.equal(result.commandName, "message");
      assert.equal(result.result.kind, "message");
      assert.match(result.result.body, /暂时无法加载历史消息/);
    }
  } finally {
    fixture.cleanup();
  }
});

test("/subagents switch 会切到指定 sub-agent 线程", async () => {
  const fixture = createFixture();

  try {
    const { workspace } = await bindDefaultWorkspace(fixture);
    const { subagentThread } = seedThreadState(fixture, workspace);

    const result = await fixture.service.executeText(
      `/subagents switch ${subagentThread.id}`,
      fixture.session
    );

    assert.equal(result.kind, "handled");
    if (result.kind === "handled") {
      assert.equal(result.commandName, "subagents");
      assert.equal(result.result.kind, "message");
      assert.match(result.result.body, new RegExp(subagentThread.id));
    }

    const user = fixture.db.users.getByFeishuOpenId(fixture.session.actor.openId);
    assert.ok(user);
    const binding = fixture.db.sessionBindings.getBySession(
      user.id,
      fixture.session.chatId,
      null
    );
    assert.ok(binding);
    assert.equal(binding.activeThreadId, subagentThread.id);
  } finally {
    fixture.cleanup();
  }
});

test("/subagents back 会从当前 sub-agent 返回主线程", async () => {
  const fixture = createFixture();

  try {
    const { workspace } = await bindDefaultWorkspace(fixture);
    const { mainThread } = seedThreadState(fixture, workspace, {
      activeThread: "subagent"
    });

    const result = await fixture.service.executeText("/subagents back", fixture.session);

    assert.equal(result.kind, "handled");
    if (result.kind === "handled") {
      assert.equal(result.commandName, "subagents");
      assert.equal(result.result.kind, "message");
      assert.match(result.result.body, new RegExp(mainThread.id));
    }

    const user = fixture.db.users.getByFeishuOpenId(fixture.session.actor.openId);
    assert.ok(user);
    const binding = fixture.db.sessionBindings.getBySession(
      user.id,
      fixture.session.chatId,
      null
    );
    assert.ok(binding);
    assert.equal(binding.activeThreadId, mainThread.id);
  } finally {
    fixture.cleanup();
  }
});
