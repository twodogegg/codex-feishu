import { loadEnvironmentConfig } from "../config/environment.js";
import { createApplicationRuntime } from "./runtime.js";

export async function bootstrapApplication(): Promise<void> {
  const config = loadEnvironmentConfig();
  const runtime = createApplicationRuntime(config);

  await runtime.start();
}
