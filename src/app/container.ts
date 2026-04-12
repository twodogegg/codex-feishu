import path from "node:path";

import { initializeDatabase } from "../db/index.js";
import type { EnvironmentConfig } from "../config/environment.js";
import { CodexWorkerManager } from "../workers/codex/worker-manager.js";
import { CommandService } from "./command-service.js";
import { FeishuMessageService } from "./feishu-message-service.js";

export type ApplicationContainer = {
  db: ReturnType<typeof initializeDatabase>;
  workers: CodexWorkerManager;
  commands: CommandService;
  feishu: FeishuMessageService;
};

export function createApplicationContainer(
  config: EnvironmentConfig
): ApplicationContainer {
  const db = initializeDatabase({
    databasePath: config.databasePath
  });
  const workers = new CodexWorkerManager();
  const commands = new CommandService(db, workers, {
    workspaceRootBasePath: path.join(config.dataDir, "workspaces"),
    codexCommand: config.codexCommand,
    defaultCodexModel: config.defaultCodexModel,
    defaultCodexEffort: config.defaultCodexEffort
  });
  const feishu = new FeishuMessageService(commands, {
    botOpenId: config.feishuBotOpenId,
    botName: config.feishuBotName,
    requireBotMentionInGroup: true
  });

  return {
    db,
    workers,
    commands,
    feishu
  };
}
