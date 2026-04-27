import fs from "node:fs";

import {
  CodexAppServerClient,
  type CodexThreadTokenUsage,
  type CodexThreadSummary,
  type CodexTurnRunHooks,
  type CodexTurnRunResult
} from "../../codex/app-server-client.js";

export type CodexWorkerState =
  | "starting"
  | "ready"
  | "busy"
  | "idle"
  | "stopping"
  | "error";

export type CodexLastRunStats = {
  threadId: string;
  turnId: string;
  tokenUsage?: CodexThreadTokenUsage;
  elapsedMs: number;
};

export class CodexWorkspaceWorker {
  private readonly client: CodexAppServerClient;
  private state: CodexWorkerState = "starting";
  private readonly startedAt = new Date().toISOString();
  private ready = false;
  private lastRunStats: CodexLastRunStats | null = null;

  constructor(
    readonly workspaceId: string,
    readonly workspaceRoot: string,
    codexCommand: string
  ) {
    this.client = new CodexAppServerClient(codexCommand);
  }

  getState(): CodexWorkerState {
    return this.state;
  }

  getStartedAt(): string {
    return this.startedAt;
  }

  getLastRunStats(): CodexLastRunStats | null {
    return this.lastRunStats;
  }

  async ensureReady(): Promise<void> {
    if (this.ready) {
      return;
    }

    this.state = "starting";
    fs.mkdirSync(this.workspaceRoot, { recursive: true });
    await this.client.connect();
    this.state = "ready";
    this.ready = true;
  }

  async listThreads(): Promise<CodexThreadSummary[]> {
    await this.ensureReady();
    return this.client.listThreads(this.workspaceRoot);
  }

  async startThread(): Promise<CodexThreadSummary> {
    await this.ensureReady();
    return this.client.startThread(this.workspaceRoot);
  }

  async resumeThread(threadId: string): Promise<void> {
    await this.ensureReady();
    await this.client.resumeThread(threadId);
  }

  async forkThread(threadId: string): Promise<CodexThreadSummary> {
    await this.ensureReady();
    return this.client.forkThread(threadId, this.workspaceRoot);
  }

  async readThread(threadId: string, includeTurns = true): Promise<unknown> {
    await this.ensureReady();
    return this.client.readThread(threadId, includeTurns);
  }

  async setThreadName(threadId: string, name: string): Promise<void> {
    await this.ensureReady();
    await this.client.setThreadName(threadId, name);
  }

  async listModels(): Promise<Array<{ id: string; displayName: string }>> {
    await this.ensureReady();
    return this.client.listModels();
  }

  async listSkills(): Promise<Array<{ name: string; description: string }>> {
    await this.ensureReady();
    return this.client.listSkills(this.workspaceRoot);
  }

  async startReview(threadId: string): Promise<void> {
    await this.ensureReady();
    this.state = "busy";
    try {
      await this.client.startReview(threadId);
      this.state = "idle";
    } catch (error) {
      this.state = "error";
      throw error;
    }
  }

  async startCompact(threadId: string): Promise<void> {
    await this.ensureReady();
    this.state = "busy";
    try {
      await this.client.startCompact(threadId);
      this.state = "idle";
    } catch (error) {
      this.state = "error";
      throw error;
    }
  }

  async interruptTurn(threadId: string, turnId: string): Promise<void> {
    await this.ensureReady();
    await this.client.interruptTurn(threadId, turnId);
  }

  async runTurn(
    threadId: string,
    text: string,
    options: {
      model?: string;
      effort?: string;
    } & CodexTurnRunHooks
  ): Promise<CodexTurnRunResult> {
    await this.ensureReady();
    this.state = "busy";
    try {
      const result = await this.client.runTurn(
        threadId,
        this.workspaceRoot,
        text,
        options
      );
      this.lastRunStats = {
        threadId,
        turnId: result.turnId,
        ...(result.tokenUsage ? { tokenUsage: result.tokenUsage } : {}),
        elapsedMs: result.elapsedMs
      };
      this.state = "idle";
      return result;
    } catch (error) {
      this.state = "error";
      throw error;
    }
  }

  close(): void {
    this.state = "stopping";
    this.client.close();
  }
}
