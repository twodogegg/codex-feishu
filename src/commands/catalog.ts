import type { CommandDefinition, CommandName } from "../types/commands.js";

const COMMAND_DEFINITIONS: readonly CommandDefinition[] = [
  {
    name: "help",
    category: "workspace",
    summary: "查看当前支持的命令与用法。",
    usage: ["/help"],
    aliases: []
  },
  {
    name: "bind",
    category: "workspace",
    summary: "绑定当前会话到指定 agent。",
    usage: ["/bind <agent>"],
    aliases: []
  },
  {
    name: "sessions",
    category: "workspace",
    summary: "查看当前会话绑定的 agent 与会话列表。",
    usage: ["/sessions", "/sessions <page>"],
    aliases: []
  },
  {
    name: "agents",
    category: "workspace",
    summary: "列出当前用户可见的 agents。",
    usage: ["/agents"],
    aliases: []
  },
  {
    name: "remove",
    category: "workspace",
    summary: "移除当前会话对某个 agent 的绑定。",
    usage: ["/remove <agent>"],
    aliases: ["unbind"]
  },
  {
    name: "send",
    category: "workspace",
    summary: "将当前 agent 工作目录内的文件发送到飞书会话。",
    usage: ["/send <relative-path>"],
    aliases: []
  },
  {
    name: "message",
    category: "thread",
    summary: "查看当前线程最近消息。",
    usage: ["/message"],
    aliases: ["messages"]
  },
  {
    name: "switch",
    category: "thread",
    summary: "切换到指定线程。",
    usage: ["/switch <threadId>"],
    aliases: []
  },
  {
    name: "new",
    category: "thread",
    summary: "新建线程并切换。",
    usage: ["/new"],
    aliases: []
  },
  {
    name: "stop",
    category: "thread",
    summary: "中断当前线程正在执行的任务。",
    usage: ["/stop"],
    aliases: []
  },
  {
    name: "model",
    category: "codex",
    summary: "查看或设置当前 agent 默认模型。",
    usage: ["/model", "/model update", "/model <modelId>"],
    aliases: []
  },
  {
    name: "effort",
    category: "codex",
    summary: "查看或设置当前 agent 默认推理强度。",
    usage: ["/effort", "/effort <low|medium|high|xhigh>"],
    aliases: []
  },
  {
    name: "compact",
    category: "codex",
    summary: "对当前线程发起 compact。",
    usage: ["/compact"],
    aliases: []
  },
  {
    name: "fast",
    category: "codex",
    summary: "切换当前 agent 的快模式。",
    usage: ["/fast"],
    aliases: []
  },
  {
    name: "permissions",
    category: "codex",
    summary: "查看当前 agent 的权限策略。",
    usage: ["/permissions"],
    aliases: []
  },
  {
    name: "experimental",
    category: "codex",
    summary: "查看当前平台允许的实验特性。",
    usage: ["/experimental"],
    aliases: []
  },
  {
    name: "status",
    category: "codex",
    summary: "查看当前 session 综合状态。",
    usage: ["/status"],
    aliases: []
  },
  {
    name: "statusline",
    category: "codex",
    summary: "查看飞书状态卡的展示项配置。",
    usage: ["/statusline"],
    aliases: []
  },
  {
    name: "skills",
    category: "codex",
    summary: "查看当前可用 skills。",
    usage: ["/skills"],
    aliases: ["skill"]
  },
  {
    name: "review",
    category: "codex",
    summary: "对当前 agent 发起 code review。",
    usage: ["/review"],
    aliases: []
  },
  {
    name: "rename",
    category: "thread",
    summary: "重命名当前线程。",
    usage: ["/rename <name>"],
    aliases: []
  },
  {
    name: "subagents",
    category: "thread",
    summary: "列出或切换当前线程的 sub-agent 线程。",
    usage: [
      "/subagents",
      "/subagents switch <threadId>",
      "/subagents back"
    ],
    aliases: ["subagent"]
  }
] as const;

const COMMAND_DEFINITION_MAP = new Map<string, CommandDefinition>();

for (const definition of COMMAND_DEFINITIONS) {
  COMMAND_DEFINITION_MAP.set(definition.name, definition);
  for (const alias of definition.aliases) {
    COMMAND_DEFINITION_MAP.set(alias, definition);
  }
}

export function listCommandDefinitions(): readonly CommandDefinition[] {
  return COMMAND_DEFINITIONS;
}

export function getCommandDefinition(
  commandName: CommandName
): CommandDefinition {
  const definition = COMMAND_DEFINITION_MAP.get(commandName);

  if (!definition) {
    throw new Error(`Unknown command definition: ${commandName}`);
  }

  return definition;
}

export function findCommandDefinition(
  commandToken: string
): CommandDefinition | undefined {
  const normalizedToken = commandToken.trim().toLowerCase();
  return COMMAND_DEFINITION_MAP.get(normalizedToken);
}
