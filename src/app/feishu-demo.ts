import type { CommandResponse, CommandService, SessionActor } from "./command-service.js";

export async function runLocalFeishuCommandDemo(
  service: CommandService,
  text: string,
  actor: SessionActor
): Promise<CommandResponse | null> {
  const result = await service.executeText(text, {
    actor,
    chatId: "local-demo-chat"
  });

  if (result.kind !== "handled") {
    return null;
  }

  return result.result;
}
