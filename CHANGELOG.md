# Changelog

## [Unreleased]

### Added

- 新增 `/help` 命令，基于命令注册表输出当前支持的飞书命令与用法。
- 新增飞书 reply card 流式更新链路，支持首卡发送、后续 patch，以及完成/失败状态收敛。
- 新增卡片按钮上下文注入，自动携带 `thread_id`、`root_id`、`parent_id` 和 `reply_in_thread`。

### Changed

- `/agents` 卡片改为行级动作，支持 `/agents status <slug>` 和 `/agents remove <slug>`。
- 普通对话和 `/message` 的线程恢复策略调整，避免无条件 `resumeThread()` 导致 `no rollout found`。

### Fixed

- 修复飞书重复回复问题：增加入站事件去重，并忽略机器人自身发出的消息。
- 修复服务重启后 `/message` 读取历史线程时的 `thread not loaded` 问题。
- 修复多实例 `npm run dev` 并存导致的回调和状态错乱风险。
