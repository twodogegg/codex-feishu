import fs from "node:fs";
import path from "node:path";

import type { EnvironmentConfig } from "../config/environment.js";
import { createApplicationContainer } from "./container.js";
import { runLocalFeishuCommandDemo } from "./feishu-demo.js";
import { FeishuBotRuntime } from "./feishu-bot-runtime.js";

export type ApplicationRuntime = {
  start: () => Promise<void>;
};

export function createApplicationRuntime(
  config: EnvironmentConfig
): ApplicationRuntime {
  const container = createApplicationContainer(config);
  const botRuntime = new FeishuBotRuntime(container, config);
  let keepAliveTimer: NodeJS.Timeout | null = null;

  return {
    async start() {
      ensureDataDirectories(config);
      console.log("[codex-feishu] bootstrap complete");
      console.log(`[codex-feishu] mode=single-machine db=${config.databasePath}`);
      console.log(
        `[codex-feishu] workers=${container.workers.getWorkerCount()} dataDir=${config.dataDir}`
      );

      const demo = await runLocalFeishuCommandDemo(container.commands, "/agents", {
        openId: "local-demo-user",
        displayName: "Local Demo User"
      });

      if (demo && "title" in demo) {
        console.log(`[codex-feishu] demo=${demo.title}`);
      }

      await botRuntime.start();
      if (!keepAliveTimer) {
        // Keep the single-process bot alive even when the Feishu SDK does not
        // retain an active event-loop handle after startup.
        keepAliveTimer = setInterval(() => {
          // no-op
        }, 60_000);
      }
    }
  };
}

function ensureDataDirectories(config: EnvironmentConfig): void {
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.mkdirSync(path.join(config.dataDir, "workspaces"), { recursive: true });
  fs.mkdirSync(path.join(config.dataDir, "logs"), { recursive: true });
}
