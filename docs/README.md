# codex-feishu 文档目录

这套文档描述 `codex-feishu` 的第一版产品与技术方案。

## 阅读顺序

### 先看全局

1. [01-总体方案.md](/Users/goudan/Github/codex-feishu/docs/01-总体方案.md)
2. [02-命令与交互设计.md](/Users/goudan/Github/codex-feishu/docs/02-命令与交互设计.md)
3. [03-数据模型与状态流.md](/Users/goudan/Github/codex-feishu/docs/03-数据模型与状态流.md)
4. [04-MVP开发计划.md](/Users/goudan/Github/codex-feishu/docs/04-MVP开发计划.md)

### 再看落地细节

5. [05-App-Server-RPC映射表.md](/Users/goudan/Github/codex-feishu/docs/05-App-Server-RPC映射表.md)
6. [06-飞书卡片与消息设计.md](/Users/goudan/Github/codex-feishu/docs/06-飞书卡片与消息设计.md)
7. [07-部署与运维设计.md](/Users/goudan/Github/codex-feishu/docs/07-部署与运维设计.md)
8. [08-数据库表设计.md](/Users/goudan/Github/codex-feishu/docs/08-数据库表设计.md)

### 现在最该看的

9. [09-当前实现状态与待办.md](/Users/goudan/Github/codex-feishu/docs/09-当前实现状态与待办.md)
10. [10-交接说明.md](/Users/goudan/Github/codex-feishu/docs/10-交接说明.md)

## 这套文档解决什么问题

- `codex-feishu` 到底是什么
- 为什么核心资源是 workspace，而不是 repo
- 团队共享服务怎么和每个用户的私有 workspace 兼容
- 哪些飞书命令保留，哪些改语义
- `codex app-server` 到底能承接哪些能力
- 数据库和 worker 应该怎么设计

## 当前阶段

当前文档针对第一版 MVP 设计。

如果是继续开发，不要只看早期方案文档，优先看：

- `09-当前实现状态与待办`
- `10-交接说明`
