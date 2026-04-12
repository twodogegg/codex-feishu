import { bootstrapApplication } from "./app/bootstrap.js";

bootstrapApplication().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[codex-feishu] startup failed: ${message}`);
  process.exitCode = 1;
});

