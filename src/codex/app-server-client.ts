import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

type JsonRpcMessage = {
  id?: string | number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: {
    message?: string;
  };
};

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

export type CodexThreadSummary = {
  id: string;
  cwd: string;
  name: string | null;
  preview: string | null;
  status: string;
  updatedAt: number;
  codexPath: string | null;
};

export type CodexTurnRunResult = {
  turnId: string;
  text: string;
  status: string;
};

export type CodexTurnRunHooks = {
  onStarted?: (payload: { turnId: string }) => void;
  onDelta?: (payload: { turnId: string; delta: string; text: string }) => void;
};

export class CodexAppServerClient {
  private child: ChildProcessWithoutNullStreams | null = null;
  private stdoutBuffer = "";
  private readonly pending = new Map<string, PendingRequest>();
  private readonly listeners = new Set<(message: JsonRpcMessage) => void>();
  private initialized = false;

  constructor(private readonly codexCommand: string) {}

  async connect(): Promise<void> {
    if (this.child) {
      return;
    }

    this.child = spawn(this.codexCommand, ["app-server"], {
      env: { ...process.env },
      stdio: ["pipe", "pipe", "pipe"],
      shell: false
    });

    this.child.stdout.on("data", (chunk: Buffer) => {
      this.stdoutBuffer += chunk.toString("utf8");
      const lines = this.stdoutBuffer.split("\n");
      this.stdoutBuffer = lines.pop() || "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
          continue;
        }
        this.handleMessage(trimmed);
      }
    });

    this.child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8").trim();
      if (text) {
        console.error(`[codex-feishu] codex stderr: ${text}`);
      }
    });

    this.child.on("close", (code) => {
      console.error(`[codex-feishu] codex app-server exited code=${code ?? -1}`);
      this.child = null;
      this.initialized = false;
    });

    await this.initialize();
  }

  onMessage(listener: (message: JsonRpcMessage) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    await this.sendRequest("initialize", {
      clientInfo: {
        name: "codex-feishu",
        title: "Codex Feishu",
        version: "0.1.0"
      },
      capabilities: {
        experimentalApi: true
      }
    });
    await this.sendNotification("initialized", null);
    this.initialized = true;
  }

  async startThread(cwd: string): Promise<CodexThreadSummary> {
    const response = (await this.sendRequest("thread/start", {
      cwd,
      approvalPolicy: "never",
      sandbox: "danger-full-access",
      personality: "pragmatic"
    })) as {
      thread: {
        id: string;
        cwd: string;
        name: string | null;
        preview?: string | null;
        status: string;
        updatedAt: number;
        path: string | null;
      };
    };

    return mapThreadSummary(response.thread);
  }

  async resumeThread(threadId: string): Promise<unknown> {
    return this.sendRequest("thread/resume", {
      threadId,
      approvalPolicy: "never",
      sandbox: "danger-full-access"
    });
  }

  async listThreads(cwd: string): Promise<CodexThreadSummary[]> {
    const response = (await this.sendRequest("thread/list", {
      cwd,
      limit: 100,
      sortKey: "updated_at"
    })) as {
      data: Array<{
        id: string;
        cwd: string;
        name: string | null;
        preview?: string | null;
        status: string;
        updatedAt: number;
        path: string | null;
      }>;
    };

    return response.data.map(mapThreadSummary);
  }

  async readThread(
    threadId: string,
    includeTurns = true
  ): Promise<unknown> {
    try {
      return await this.sendRequest("thread/read", {
        threadId,
        includeTurns
      });
    } catch (error) {
      if (!isUnknownMethodError(error, "thread/read")) {
        throw error;
      }

      return this.resumeThread(threadId);
    }
  }

  async setThreadName(threadId: string, name: string): Promise<void> {
    try {
      await this.sendRequest("thread/name/set", {
        threadId,
        name
      });
    } catch (error) {
      if (!isUnknownMethodError(error, "thread/name/set")) {
        throw error;
      }
    }
  }

  async listModels(): Promise<Array<{ id: string; displayName: string }>> {
    const response = (await this.sendRequest("model/list", {})) as {
      data: Array<{ id: string; displayName: string }>;
    };
    return response.data;
  }

  async listSkills(cwd: string): Promise<Array<{ name: string; description: string }>> {
    const response = (await this.sendRequest("skills/list", {
      cwds: [cwd],
      forceReload: false
    })) as {
      data: Array<{
        skills: Array<{ name: string; description: string }>;
      }>;
    };

    return response.data.flatMap((entry) => entry.skills || []);
  }

  async startReview(threadId: string): Promise<void> {
    await this.sendRequest("review/start", {
      threadId,
      target: {
        type: "uncommittedChanges"
      },
      delivery: "inline"
    });
  }

  async startCompact(threadId: string): Promise<void> {
    try {
      await this.sendRequest("thread/compact/start", {
        threadId
      });
    } catch (error) {
      if (!isUnknownMethodError(error, "thread/compact/start")) {
        throw error;
      }
      throw new Error("当前 codex app-server 版本不支持 /compact");
    }
  }

  async interruptTurn(threadId: string, turnId: string): Promise<void> {
    await this.sendRequest("turn/interrupt", {
      threadId,
      turnId
    });
  }

  async runTurn(
    threadId: string,
    cwd: string,
    text: string,
    options: {
      model?: string;
      effort?: string;
    } & CodexTurnRunHooks
  ): Promise<CodexTurnRunResult> {
    const turnStart = (await this.sendRequest("turn/start", {
      threadId,
      cwd,
      input: [
        {
          type: "text",
          text
        }
      ],
      ...(options.model ? { model: options.model } : {}),
      ...(options.effort ? { effort: options.effort } : {})
    })) as {
      turn: {
        id: string;
      };
    };

    const turnId = turnStart.turn.id;
    options.onStarted?.({ turnId });

    return new Promise<CodexTurnRunResult>((resolve, reject) => {
      let aggregatedText = "";
      const unsubscribe = this.onMessage((message) => {
        if (message.method === "item/agentMessage/delta") {
          const params = message.params as
            | { threadId: string; turnId: string; delta: string }
            | undefined;
          if (
            params?.threadId === threadId &&
            params.turnId === turnId &&
            typeof params.delta === "string"
          ) {
            aggregatedText += params.delta;
            options.onDelta?.({
              turnId,
              delta: params.delta,
              text: aggregatedText
            });
          }
          return;
        }

        if (message.method === "turn/completed") {
          const params = message.params as
            | {
                threadId: string;
                turn: {
                  id: string;
                  status: string;
                  error?: { message?: string } | null;
                };
              }
            | undefined;
          if (params?.threadId !== threadId || params.turn.id !== turnId) {
            return;
          }

          unsubscribe();
          if (params.turn.status === "failed") {
            reject(
              new Error(params.turn.error?.message || "Codex turn failed")
            );
            return;
          }

          resolve({
            turnId,
            text: aggregatedText.trim(),
            status: params.turn.status
          });
        }
      });
    });
  }

  close(): void {
    if (!this.child) {
      return;
    }

    this.child.kill();
    this.child = null;
    this.initialized = false;
  }

  private async sendRequest(method: string, params: unknown): Promise<unknown> {
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const payload = JSON.stringify({
      id,
      method,
      params
    });

    const promise = new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });

    this.sendRaw(payload);
    return promise;
  }

  private async sendNotification(
    method: string,
    params: unknown
  ): Promise<void> {
    const payload = JSON.stringify({
      method,
      params
    });
    this.sendRaw(payload);
  }

  private sendRaw(payload: string): void {
    if (!this.child?.stdin.writable) {
      throw new Error("codex app-server stdin is not writable");
    }
    this.child.stdin.write(`${payload}\n`);
  }

  private handleMessage(raw: string): void {
    let parsed: JsonRpcMessage;
    try {
      parsed = JSON.parse(raw) as JsonRpcMessage;
    } catch {
      console.warn(`[codex-feishu] invalid codex json: ${raw.slice(0, 200)}`);
      return;
    }

    if (parsed.id != null) {
      const key = String(parsed.id);
      const pending = this.pending.get(key);
      if (!pending) {
        return;
      }
      this.pending.delete(key);
      if (parsed.error) {
        pending.reject(
          new Error(parsed.error.message || `Codex RPC failed: ${key}`)
        );
        return;
      }
      pending.resolve(parsed.result);
      return;
    }

    for (const listener of this.listeners) {
      listener(parsed);
    }
  }
}

function mapThreadSummary(thread: {
  id: string;
  cwd: string;
  name: string | null;
  preview?: string | null;
  status: string;
  updatedAt: number;
  path: string | null;
}): CodexThreadSummary {
  return {
    id: thread.id,
    cwd: thread.cwd,
    name: thread.name || thread.preview || null,
    preview: thread.preview || null,
    status: thread.status,
    updatedAt: normalizeTimestamp(thread.updatedAt),
    codexPath: thread.path
  };
}

function normalizeTimestamp(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }

  return value < 1_000_000_000_000 ? value * 1000 : value;
}

function isUnknownMethodError(error: unknown, methodName: string): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("unknown variant") &&
    message.includes(`\`${methodName}\``)
  );
}
