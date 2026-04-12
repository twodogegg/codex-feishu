# MVP 开发计划

## 1. 目标

在第一版实现一个可真实使用的单机服务，满足下面能力：

- 飞书作为唯一入口
- 每个用户自动获得自己的持久 workspace
- 可以在飞书里继续对话、切线程、查看状态
- 可以停止运行、查看最近消息、切模型和 effort
- 可以通过卡片进行基础交互

## 2. MVP 范围

### 2.1 必做

- 用户识别
- workspace 自动创建
- workspace 预创建接口
- 会话绑定
- 当前 thread 恢复
- 普通消息执行
- 流式回复卡
- `/bind`
- `/where`
- `/workspace`
- `/message`
- `/switch`
- `/new`
- `/stop`
- `/model`
- `/effort`

### 2.2 次优先级

- `/status`
- `/skills`
- `/review`
- `/rename`
- `/subagents`

### 2.3 后置

- `/permissions`
- `/experimental`
- `/fast`
- `/statusline`
- 更复杂的管理员后台

## 3. 里程碑

## 里程碑一：骨架跑通

目标：

- 建立服务基础骨架
- 接通飞书事件
- 接通单个 `codex app-server`

交付：

- Feishu Gateway
- 基础配置加载
- Worker Manager 初版
- 单 workspace 调试链路

验收：

- 用户发一句话，飞书能收到回复

## 里程碑二：Workspace First

目标：

- 完成 workspace 生命周期
- 完成会话绑定

交付：

- `users / workspaces / session_bindings`
- 自动创建 workspace
- `/bind /where /workspace`

验收：

- 不同用户进入后拿到不同 workspace
- 同一用户再次进入能恢复原 workspace

## 里程碑三：Thread 能力

目标：

- 完成 thread 恢复和切换

交付：

- `threads`
- `/message /switch /new /stop`
- 当前 thread 记忆

验收：

- 用户可查看最近消息
- 可创建新 thread
- 可切换历史 thread
- 可停止执行中任务

## 里程碑四：配置能力

目标：

- 完成模型和推理强度管理

交付：

- `/model`
- `/model update`
- `/effort`

验收：

- 可查看模型列表
- 可设置 workspace 默认模型
- 可设置 workspace 默认 effort

## 里程碑五：兼容命令和卡片增强

目标：

- 提高可用性

交付：

- `/status`
- `/skills`
- `/review`
- `/rename`
- `/subagents`
- 状态卡、workspace 卡

验收：

- 用户能通过卡片和命令完成主要操作

## 4. 服务拆分建议

MVP 阶段保持单机单实例服务，但模块边界要先划清：

- `gateway/feishu`
- `services/workspace`
- `services/session`
- `services/thread`
- `services/run`
- `workers/codex`
- `presentation/cards`

## 5. 联调优先顺序

建议按这条顺序联调：

1. 飞书事件接入
2. 单个固定 workspace 的普通对话
3. thread 创建 / 恢复 / 切换
4. 卡片流式更新
5. workspace 自动创建
6. 模型 / effort 设置
7. review / skills / subagents

## 6. 测试策略

### 6.1 单元测试

覆盖：

- 命令解析
- workspace 状态机
- session 绑定逻辑
- thread 选择逻辑
- 卡片 payload 生成

### 6.2 集成测试

覆盖：

- 飞书事件 -> 命令处理
- 飞书事件 -> 普通消息 -> worker -> 回复卡
- thread 切换与恢复

### 6.3 手工回归

必须覆盖：

- 新用户首次进入
- 老用户恢复会话
- `/bind`
- `/where`
- `/workspace`
- `/switch`
- `/new`
- `/stop`
- `/model`
- `/effort`
- 卡片按钮切换

## 7. 验收标准

MVP 完成的最低标准：

- 两个不同飞书用户进入后，各自获得独立 workspace
- 同一个用户第二次进入能恢复自己的 workspace 和当前 thread
- 用户可以发送普通消息并得到流式回复
- 用户可以切换 thread、查看最近消息、停止运行
- 用户可以切换模型与 effort

## 8. 风险

### 8.1 Worker 泄漏

风险：

- 活跃 workspace 多了之后，worker 长驻过多

应对：

- 做空闲超时回收

### 8.2 SQLite 写锁竞争

风险：

- 多个运行态同时落库时可能出现锁等待

应对：

- 高频运行态优先放内存
- 数据库只保存低频长期状态
- 重要写入尽量合并

### 8.3 飞书卡片更新频率

风险：

- 高频 patch 卡片容易带来体验和性能问题

应对：

- 做 300ms 左右批量刷新

### 8.4 权限与审批不清晰

风险：

- 团队环境下危险操作不可控

应对：

- 第一版默认 workspace 级审批策略

## 9. 下一阶段方向

MVP 稳定后可以继续做：

- 管理员后台
- 更细粒度权限模型
- workspace 模板市场
- 审计搜索
- 任务回放
- 更丰富的 sub-agent 管理
- PostgreSQL / Redis 迁移

## 10. 一句话结论

MVP 的关键不是功能堆满，而是先把：

`飞书入口 + 持久 workspace + thread 恢复 + 流式卡片回复`

这条主链路做稳。
