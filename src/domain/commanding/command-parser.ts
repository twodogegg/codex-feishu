import type {
  ParsedCommandInput,
  ParsedUserInput,
  TextInput,
  UnknownCommandInput,
  KnownCommandInput
} from "../../types/commands.js";
import { findCommandDefinition } from "../../commands/index.js";

export function isCommandText(text: string): boolean {
  return text.trimStart().startsWith("/");
}

export function parseUserInput(text: string): ParsedUserInput {
  const rawText = text;
  const normalizedText = normalizeWhitespace(rawText);

  const commandInput = parseCommandText(rawText);

  if (!commandInput) {
    return createTextInput(rawText, normalizedText);
  }

  return commandInput;
}

export function parseCommandText(text: string): ParsedCommandInput | null {
  const rawText = text;
  const normalizedText = normalizeWhitespace(rawText);

  if (normalizedText.length === 0 || !isCommandText(normalizedText)) {
    return null;
  }

  const segments = tokenizeCommand(normalizedText);
  const [head, ...args] = segments;

  if (!head) {
    return null;
  }

  const rawName = head.slice(1);
  const commandToken = rawName.toLowerCase();
  const commandText = normalizedText.slice(1).trim();
  const argText = commandText.slice(rawName.length).trim();
  const definition = findCommandDefinition(commandToken);

  if (!definition) {
    return createUnknownCommandInput(
      rawText,
      normalizedText,
      commandText,
      commandToken,
      args,
      argText,
      rawName,
      segments
    );
  }

  return createKnownCommandInput(
    rawText,
    normalizedText,
    commandText,
    commandToken,
    args,
    argText,
    rawName,
    segments,
    definition
  );
}

function createTextInput(rawText: string, normalizedText: string): TextInput {
  return {
    kind: "text",
    rawText,
    text: normalizedText,
    normalizedText
  };
}

function createKnownCommandInput(
  rawText: string,
  normalizedText: string,
  commandText: string,
  commandToken: string,
  args: readonly string[],
  argText: string,
  rawName: string,
  segments: readonly string[],
  definition: KnownCommandInput["definition"]
): KnownCommandInput {
  return {
    kind: "command",
    rawText,
    normalizedText,
    rawName,
    commandText,
    commandToken,
    name: definition.name,
    definition,
    args,
    argText,
    segments,
    ...(args[0] ? { subcommand: args[0] } : {})
  };
}

function createUnknownCommandInput(
  rawText: string,
  normalizedText: string,
  commandText: string,
  commandToken: string,
  args: readonly string[],
  argText: string,
  rawName: string,
  segments: readonly string[]
): UnknownCommandInput {
  return {
    kind: "unknown-command",
    rawText,
    normalizedText,
    rawName,
    commandText,
    commandToken,
    name: commandToken.toLowerCase(),
    args,
    argText,
    segments,
    ...(args[0] ? { subcommand: args[0] } : {})
  };
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\r\n/g, "\n").trim();
}

function tokenizeCommand(value: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let escaping = false;

  for (const char of value) {
    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }

    if (char === "\\") {
      escaping = true;
      continue;
    }

    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (/\s/u.test(char)) {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (current.length > 0) {
    tokens.push(current);
  }

  return tokens;
}
