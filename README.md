# codex-feishu

在飞书里直接驱动 Codex 的单机控制平面。

`codex-feishu` 让你在飞书会话中完成 workspace 绑定、线程切换、模型配置、代码审查与多代理线程管理，并将执行状态通过消息/卡片实时回传。

## 系统能力

- 飞书消息驱动：支持文本命令与卡片按钮回调（`im.message.receive_v1`、`card.action.trigger`）。
- 会话绑定：按 `用户 + chat + threadKey` 维护 session 绑定，支持一个用户在不同会话独立绑定 workspace。
- Workspace-first 工作流：以 workspace 作为核心资源，自动维护 active thread。
- Codex 线程编排：支持新建、切换、重命名、停止线程，以及普通文本直连当前线程继续对话。
- 流式回复卡片：执行中持续更新状态（starting/streaming/completed/failed），并附带快捷按钮。
- 模型与推理强度治理：按 workspace 持久化默认 `model` 和 `effort`，支持动态调整。
- Sub-agent 线程管理：查看、切换、返回主线程。
- 本地持久化：使用 SQLite 存储 users/workspaces/threads/session bindings/runs/card 消息映射。

## 菜单命令（飞书内输入 `/`）

以下命令均可在飞书对话中直接使用。

### Agents 命令

| 命令 | 说明 | 备注 |
| --- | --- | --- |
| `/help` | 查看命令帮助 | - |
| `/bind <agent>` | 绑定当前会话到指定 agent | 支持 slug/名称/路径选择 |
| `/sessions` | 查看当前会话绑定与线程卡片 | 支持分页 |
| `/sessions <page>` | 查看指定页会话状态 | 例：`/sessions 2` |
| `/agents` | 列出可见 agents | - |
| `/agents status <agent>` | 绑定并查看该 agent 状态 | `status` 与 `bind` 语义等价 |
| `/agents remove <agent>` | 从当前会话解绑该 agent | 等价 remove 子命令 |
| `/remove <agent>` | 解绑当前会话中的 agent | 别名：`/unbind` |
| `/send <relative-path>` | 发送 agent 内文件到飞书 | 仅允许 agent 相对路径 |

### Thread 命令

| 命令 | 说明 | 备注 |
| --- | --- | --- |
| `/message` | 查看当前线程最近消息 | 别名：`/messages` |
| `/switch <threadId>` | 切换 active thread | 支持本地 threadId / codexThreadId |
| `/new` | 新建线程并切换 | - |
| `/rename <name>` | 重命名当前线程 | - |
| `/stop` | 中断当前执行中的 turn | - |
| `/subagents` | 列出当前主线程下的 sub-agent 线程 | 别名：`/subagent` |
| `/subagents switch <threadId>` | 切换到指定 sub-agent 线程 | - |
| `/subagents back` | 返回主线程 | - |

### Codex 命令

| 命令 | 说明 | 备注 |
| --- | --- | --- |
| `/model` | 查看默认模型 | - |
| `/model update` | 拉取可用模型列表 | - |
| `/model <modelId>` | 设置默认模型 | 持久化到 workspace |
| `/effort` | 查看默认推理强度 | - |
| `/effort <low\|medium\|high\|xhigh>` | 设置默认推理强度 | 持久化到 workspace |
| `/status` | 查看会话综合状态 | worker/thread/run 信息 |
| `/statusline` | 查看状态展示项 | 兼容命令 |
| `/skills` | 查看当前可用 skills | 别名：`/skill` |
| `/review` | 对当前线程发起 code review | - |
| `/compact` | 对当前线程发起 compact | - |
| `/permissions` | 查看当前权限策略 | 输出 policy JSON |
| `/experimental` | 查看实验特性状态 | 当前为平台占位能力 |
| `/fast` | 切换 workspace fastMode | 开关型命令 |

## 对话模式

- 以 `/` 开头：按命令路由执行。
- 非 `/` 文本：作为普通对话输入，直接续写当前 agent 的 active thread。

## 飞书话题使用

- 在群聊或私聊中创建新话题后，机器人会把该话题视为独立会话（`threadKey`）。
- 话题会话若尚未绑定 agent，会自动继承同一 chat 主会话的 agent 与 active thread。
- 在话题内可直接使用 `/status`、`/sessions`、`/new` 等命令，无需再次 `/bind`。
- `/sessions` 会话列表优先显示会话摘要（用户最近一句/Codex 最近一句/preview），不再主展示线程 ID。

## 快速开始

### 1. 环境要求

- Node.js `>= 20`
- npm
- 可用的 `codex` 命令行
- 飞书自建应用（开启机器人收发消息与事件订阅）

### 2. 安装依赖

```bash
npm install
```

### 3. 配置环境变量

复制并填写：

```bash
cp .env.example .env
```

最少需要：

- `FEISHU_APP_ID`
- `FEISHU_APP_SECRET`
- `CODEX_FEISHU_BOT_OPEN_ID`

常用可选项：

- `CODEX_FEISHU_CODEX_COMMAND`（默认 `codex`）
- `CODEX_FEISHU_DATA_DIR`（默认 `~/.codex-feishu`）
- `CODEX_FEISHU_DATABASE_PATH`（默认 `<dataDir>/app.db`）

### 4. 启动

开发模式：

```bash
npm run dev
```

生产构建与启动：

```bash
npm run build
npm run start
```

## 开发检查

```bash
npm run check
npm test
```

## 项目结构

- `src/app/`：启动、运行时、命令服务、飞书消息入口
- `src/commands/`：命令目录（定义、别名、帮助元数据）
- `src/domain/commanding/`：命令解析与路由
- `src/feishu/`：飞书客户端与事件标准化
- `src/codex/`：Codex app-server 客户端与 workspace 配置同步
- `src/workers/`：workspace worker 生命周期管理
- `src/db/`：SQLite schema 与 repository
- `test/`：单测
- `docs/`：设计与交接文档

## 文档索引

详细设计请看 [docs/README.md](/Users/goudan/Github/codex-feishu/docs/README.md)。
