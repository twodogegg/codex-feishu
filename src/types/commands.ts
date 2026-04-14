export const SUPPORTED_COMMAND_NAMES = [
  "help",
  "bind",
  "sessions",
  "agents",
  "remove",
  "send",
  "message",
  "switch",
  "new",
  "stop",
  "model",
  "effort",
  "compact",
  "fast",
  "permissions",
  "experimental",
  "status",
  "statusline",
  "skills",
  "review",
  "rename",
  "subagents"
] as const;

export type CommandName = (typeof SUPPORTED_COMMAND_NAMES)[number];

export type CommandCategory = "workspace" | "thread" | "codex";

export type CommandDefinition = {
  name: CommandName;
  category: CommandCategory;
  summary: string;
  usage: readonly string[];
  aliases: readonly string[];
};

export type TextInput = {
  kind: "text";
  rawText: string;
  text: string;
  normalizedText?: string;
};

export type PlainTextInput = TextInput;

type CommandInputBase = {
  rawText: string;
  commandText: string;
  commandToken: string;
  args: readonly string[];
  argText: string;
  subcommand?: string;
};

export type KnownCommandInput = CommandInputBase & {
  kind: "command";
  name: CommandName;
  definition: CommandDefinition;
  normalizedText?: string;
  rawName?: string;
  segments?: readonly string[];
};

export type UnknownCommandInput = CommandInputBase & {
  kind: "unknown-command";
  name: string;
  normalizedText?: string;
  rawName?: string;
  segments?: readonly string[];
};

export type CommandInput = KnownCommandInput;

export type ParsedCommandInput = KnownCommandInput | UnknownCommandInput;

export type ParsedUserInput = TextInput | ParsedCommandInput;

export type ConversationInput = ParsedUserInput;

export type CommandHandler<TContext, TResult> = (
  input: KnownCommandInput,
  context: TContext
) => Promise<TResult> | TResult;

export type CommandHandlerMap<TContext, TResult> = Partial<
  Record<CommandName, CommandHandler<TContext, TResult>>
>;

export type CommandRouteResult<TResult> =
  | {
      kind: "not-command";
      input: TextInput;
    }
  | {
      kind: "unknown-command";
      commandName: string;
      input: UnknownCommandInput;
    }
  | {
      kind: "unhandled";
      commandName: CommandName;
      input: KnownCommandInput;
    }
  | {
      kind: "handled";
      commandName: CommandName;
      result: TResult;
    };

export type CommandRouter<TContext, TResult> = {
  route: (
    input: ParsedUserInput,
    context: TContext
  ) => Promise<CommandRouteResult<TResult>>;
};
