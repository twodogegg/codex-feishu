import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import dotenv from "dotenv";
import { z } from "zod";

const environmentSchema = z.object({
  PORT: z.string().optional(),
  CODEX_FEISHU_DATA_DIR: z.string().optional(),
  CODEX_FEISHU_DATABASE_PATH: z.string().optional(),
  CODEX_FEISHU_CODEX_COMMAND: z.string().optional(),
  CODEX_IM_CODEX_COMMAND: z.string().optional(),
  CODEX_IM_DEFAULT_CODEX_MODEL: z.string().optional(),
  CODEX_IM_DEFAULT_CODEX_EFFORT: z.string().optional(),
  FEISHU_APP_ID: z.string().optional(),
  FEISHU_APP_SECRET: z.string().optional(),
  CODEX_FEISHU_BOT_OPEN_ID: z.string().optional(),
  CODEX_FEISHU_BOT_NAME: z.string().optional(),
  CODEX_IM_FEISHU_BOT_OPEN_ID: z.string().optional()
});

export type EnvironmentConfig = {
  port: number;
  dataDir: string;
  databasePath: string;
  codexCommand: string;
  defaultCodexModel: string;
  defaultCodexEffort: string;
  feishuAppId: string;
  feishuAppSecret: string;
  feishuBotOpenId: string;
  feishuBotName: string;
};

export function loadEnvironmentConfig(
  env: NodeJS.ProcessEnv = process.env
): EnvironmentConfig {
  loadDotenvCandidates();
  const effectiveEnv = env === process.env ? process.env : { ...process.env, ...env };
  const parsed = environmentSchema.parse(effectiveEnv);
  const dataDir = parsed.CODEX_FEISHU_DATA_DIR
    ? path.resolve(parsed.CODEX_FEISHU_DATA_DIR)
    : path.join(os.homedir(), ".codex-feishu");

  return {
    port: Number(parsed.PORT || 8787),
    dataDir,
    databasePath: parsed.CODEX_FEISHU_DATABASE_PATH
      ? path.resolve(parsed.CODEX_FEISHU_DATABASE_PATH)
      : path.join(dataDir, "app.db"),
    codexCommand:
      parsed.CODEX_FEISHU_CODEX_COMMAND ||
      parsed.CODEX_IM_CODEX_COMMAND ||
      "codex",
    defaultCodexModel:
      parsed.CODEX_IM_DEFAULT_CODEX_MODEL?.trim() || "gpt-5.4",
    defaultCodexEffort:
      parsed.CODEX_IM_DEFAULT_CODEX_EFFORT?.trim() || "high",
    feishuAppId: parsed.FEISHU_APP_ID || "",
    feishuAppSecret: parsed.FEISHU_APP_SECRET || "",
    feishuBotOpenId:
      parsed.CODEX_FEISHU_BOT_OPEN_ID || parsed.CODEX_IM_FEISHU_BOT_OPEN_ID || "",
    feishuBotName: parsed.CODEX_FEISHU_BOT_NAME || ""
  };
}

function loadDotenvCandidates(): void {
  const codexImEnvPath = path.join(os.homedir(), ".codex-im", ".env");
  if (fs.existsSync(codexImEnvPath)) {
    dotenv.config({ path: codexImEnvPath, override: false });
  }

  const repoEnvPath = path.resolve(".env");
  if (fs.existsSync(repoEnvPath)) {
    dotenv.config({ path: repoEnvPath, override: true });
    return;
  }

  dotenv.config({ override: true });
}
