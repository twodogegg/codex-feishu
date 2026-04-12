import type {
  CommandHandlerMap,
  CommandRouteResult,
  CommandRouter,
  ParsedUserInput
} from "../../types/commands.js";

export type CreateCommandRouterOptions<TContext, TResult> = {
  handlers: CommandHandlerMap<TContext, TResult>;
};

export function createCommandRouter<TContext, TResult>(
  options: CreateCommandRouterOptions<TContext, TResult>
): CommandRouter<TContext, TResult> {
  return {
    async route(
      input: ParsedUserInput,
      context: TContext
    ): Promise<CommandRouteResult<TResult>> {
      if (input.kind === "text") {
        return {
          kind: "not-command",
          input
        };
      }

      if (input.kind === "unknown-command") {
        return {
          kind: "unknown-command",
          commandName: input.name,
          input
        };
      }

      const handler = options.handlers[input.name];

      if (!handler) {
        return {
          kind: "unhandled",
          commandName: input.name,
          input
        };
      }

      const result = await handler(input, context);

      return {
        kind: "handled",
        commandName: input.name,
        result
      };
    }
  };
}
