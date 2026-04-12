import { CodexWorkspaceWorker } from "./codex-worker.js";

export class CodexWorkerManager {
  private readonly workersByWorkspaceId = new Map<string, CodexWorkspaceWorker>();

  getWorkerCount(): number {
    return this.workersByWorkspaceId.size;
  }

  getWorker(workspaceId: string): CodexWorkspaceWorker | null {
    return this.workersByWorkspaceId.get(workspaceId) || null;
  }

  ensureWorker(
    workspaceId: string,
    workspaceRoot: string,
    codexCommand: string
  ): CodexWorkspaceWorker {
    const existing = this.getWorker(workspaceId);
    if (existing) {
      return existing;
    }

    const worker = new CodexWorkspaceWorker(
      workspaceId,
      workspaceRoot,
      codexCommand
    );
    this.workersByWorkspaceId.set(workspaceId, worker);
    return worker;
  }

  closeAll(): void {
    for (const worker of this.workersByWorkspaceId.values()) {
      worker.close();
    }
    this.workersByWorkspaceId.clear();
  }
}
