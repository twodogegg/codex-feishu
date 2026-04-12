# App Server RPC 映射表

## 1. 目的

本文档说明：

- 飞书命令或卡片动作如何映射到 `codex app-server`
- 哪些能力可以直接调用 RPC
- 哪些能力必须由平台层自己实现

这份文档的重点不是解释产品概念，而是帮助开发阶段直接落代码。

## 2. 总体原则

### 2.1 不把 slash 命令文本直接发给模型

飞书里的 `/skills`、`/status`、`/review` 等命令，不应作为普通文本发给 `turn/start`。

正确方式是：

1. 平台识别命令
2. 将命令翻译成 `app-server RPC`
3. 再把结果渲染回飞书

### 2.2 平台命令与 Codex 命令分离

- 平台命令：由 `codex-feishu` 自己实现
- Codex 命令：尽量映射到底层 RPC

## 3. 已确认可用的底层 RPC

基于本机 `codex-cli 0.120.0` 的协议核实，当前版本至少包含这些方法：

- `initialize`
- `thread/start`
- `thread/resume`
- `thread/list`
- `thread/read`
- `thread/fork`
- `thread/name/set`
- `thread/compact/start`
- `thread/metadata/update`
- `turn/start`
- `turn/interrupt`
- `skills/list`
- `review/start`
- `model/list`
- `config/read`
- `account/read`
- `account/rateLimits/read`

## 4. 平台执行流程模板

对于大部分命令，控制面统一使用以下执行模板：

1. 解析飞书命令
2. 找到当前用户
3. 找到当前 `SessionBinding`
4. 找到当前 `Workspace`
5. 找到该 workspace 的 worker
6. 决定是否调用 `app-server`
7. 将结果转成飞书文本卡片或状态卡

## 5. 命令映射表

## 5.1 `/bind <workspace>`

类型：

- 平台命令

底层 RPC：

- 无直接 RPC

平台逻辑：

1. 根据 workspace 名称或 ID 查找用户可访问 workspace
2. 更新 `session_bindings.workspace_id`
3. 读取 `workspace.last_active_thread_id`
4. 返回状态卡

## 5.2 `/where`

类型：

- 平台命令

底层 RPC：

- 可选 `thread/read`

平台逻辑：

1. 读取当前 session 绑定关系
2. 读取当前 workspace
3. 读取当前 active thread
4. 返回状态卡

## 5.3 `/workspace`

类型：

- 平台命令

底层 RPC：

- 可选 `thread/list`

平台逻辑：

1. 查询用户所有 workspace
2. 为每个 workspace 读取最近 thread 摘要
3. 返回 workspace 列表卡

## 5.4 `/remove <workspace>`

类型：

- 平台命令

底层 RPC：

- 无

平台逻辑：

1. 校验指定 workspace 是否属于当前用户
2. 清除当前 session 对该 workspace 的绑定
3. 返回提示卡

## 5.5 `/send <相对路径>`

类型：

- 平台命令

底层 RPC：

- 无

平台逻辑：

1. 校验相对路径
2. 拼出 `workspace.root_path + relative_path`
3. 校验文件存在且在 workspace 内
4. 通过飞书文件上传 API 发送

## 5.6 `/message`

类型：

- Codex 命令

底层 RPC：

- `thread/read`

推荐参数：

```json
{
  "threadId": "thread_xxx",
  "includeTurns": true
}
```

平台逻辑：

1. 找到当前 active thread
2. 调 `thread/read`
3. 抽取最近几轮 user / agent message
4. 返回摘要卡

## 5.7 `/switch <threadId>`

类型：

- 混合命令

底层 RPC：

- `thread/list`
- `thread/resume`

平台逻辑：

1. 校验该 `threadId` 是否属于当前 workspace
2. 更新 `session_bindings.active_thread_id`
3. 调 `thread/resume`
4. 返回状态卡

## 5.8 `/new`

类型：

- Codex 命令

底层 RPC：

- `thread/start`

推荐参数：

```json
{
  "cwd": "/workspace/root/path"
}
```

平台逻辑：

1. 调 `thread/start(cwd=workspace.root_path)`
2. 保存 `codex_thread_id`
3. 更新 `active_thread_id`
4. 返回状态卡

## 5.9 `/rename <name>`

类型：

- Codex 命令

底层 RPC：

- `thread/name/set`

平台逻辑：

1. 找到当前 active thread
2. 调用 `thread/name/set`
3. 更新本地 thread 记录
4. 返回提示卡

## 5.10 `/stop`

类型：

- Codex 命令

底层 RPC：

- `turn/interrupt`

注意：

- 当前协议要求 `threadId + turnId`

平台逻辑：

1. 从运行态缓存找到当前 active run
2. 拿到 `threadId` 和 `turnId`
3. 调 `turn/interrupt`
4. 返回停止提示卡

## 5.11 `/model`

类型：

- 混合命令

底层 RPC：

- `model/list`

平台逻辑：

- `/model`
  - 展示当前 workspace 默认模型与可选模型
- `/model update`
  - 重新调用 `model/list` 并刷新缓存
- `/model <modelId>`
  - 更新 `workspaces.default_model`

## 5.12 `/effort`

类型：

- 平台配置命令

底层 RPC：

- 无独立查询方法
- 实际通过 `turn/start.effort` 体现

平台逻辑：

- `/effort`
  - 展示当前 workspace 默认 effort
- `/effort <value>`
  - 更新 `workspaces.default_effort`

## 5.13 `/status`

类型：

- 兼容命令

底层 RPC：

- `config/read`
- `account/read`
- `account/rateLimits/read`
- 可选 `thread/read`

平台逻辑：

将以下内容拼成综合状态卡：

- 当前 workspace
- 当前 thread
- 当前模型与 effort
- 当前 worker 状态
- 当前登录状态
- 当前 rate limit
- skills 数量

## 5.14 `/skills`

类型：

- Codex 命令

底层 RPC：

- `skills/list`

推荐参数：

```json
{
  "cwds": ["/workspace/root/path"],
  "forceReload": false
}
```

平台逻辑：

1. 调 `skills/list`
2. 抽取名称、描述、来源
3. 返回 skills 列表卡

## 5.15 `/review`

类型：

- Codex 命令

底层 RPC：

- `review/start`

平台逻辑：

1. 在当前 workspace 下发起 review
2. 监听 review 结果流
3. 将 findings 以卡片形式返回

## 5.16 `/compact`

类型：

- Codex 命令

底层 RPC：

- `thread/compact/start`

平台逻辑：

1. 对当前 active thread 发起 compact
2. 更新 thread 状态
3. 返回 compact 完成提示

## 5.17 `/permissions`

类型：

- 平台命令

底层 RPC：

- 可选 `config/read`

平台逻辑：

1. 展示当前 workspace policy
2. 展示 sandbox、审批、网络权限
3. 第一版不直接开放任意修改

## 5.18 `/experimental`

类型：

- 平台命令

底层 RPC：

- 可选 `experimentalFeature/list`

平台逻辑：

1. 展示平台允许启用的实验特性
2. 可做只读展示

## 5.19 `/fast`

类型：

- 平台快捷命令

底层 RPC：

- 无独立方法

平台逻辑：

本质是一个配置快捷切换：

- 调整当前 workspace 的“快速模式”配置
- 可以影响默认模型、service tier、effort

## 5.20 `/statusline`

类型：

- 平台兼容命令

底层 RPC：

- 无直接对应

平台逻辑：

- 第一版只展示“状态卡展示项配置”
- 不追求终端状态栏语义

## 5.21 `/subagents`

类型：

- 平台兼容命令

底层 RPC：

- 以 `thread/list`、`thread/read` 为主

平台逻辑：

第一版建议：

- `/subagents`
  - 列出当前主线程下的 sub-agent threads
- `/subagents switch <threadId>`
  - 切换到某个 sub-agent thread
- `/subagents back`
  - 切回主线程

说明：

- 不需要做终端 UI 的“切 tab”
- 只需要做 thread 视角的 agent 切换

## 6. 普通消息映射

用户发送非命令文本时，统一走以下底层链路：

1. 找到当前 workspace
2. 找到当前 active thread
3. 若无 thread：
   - 调 `thread/start(cwd=workspace.root_path)`
4. 若有 thread：
   - 调 `thread/resume(threadId)`
5. 调 `turn/start`

推荐 `turn/start` 参数：

```json
{
  "threadId": "thread_xxx",
  "cwd": "/workspace/root/path",
  "input": [
    {
      "type": "text",
      "text": "用户输入"
    }
  ],
  "model": "workspace default model",
  "effort": "workspace default effort"
}
```

## 7. 平台层必须额外维护的状态

为了让上述命令跑起来，平台必须额外维护：

- 当前会话 active workspace
- 当前会话 active thread
- 当前运行中的 `turnId`
- 当前回复卡 `message_id`
- 当前 workspace worker 状态

这些不是 `app-server` 自动帮你管的。

## 8. 实现建议

代码上建议做一个统一的命令执行接口：

```ts
type CommandExecutionContext = {
  userId: string;
  chatId: string;
  workspaceId: string | null;
  activeThreadId: string | null;
};

type CommandHandler = (ctx: CommandExecutionContext, args: string[]) => Promise<CommandResult>;
```

不要把命令逻辑散落在飞书事件处理器里。

## 9. 一句话结论

`codex-feishu` 的命令层本质上是“飞书命令适配器”，负责把用户命令翻译成 `app-server RPC` 或平台内部操作。
