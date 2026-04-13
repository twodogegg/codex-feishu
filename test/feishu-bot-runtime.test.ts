import test from "node:test";
import assert from "node:assert/strict";

import { buildAssistantReplyCard } from "../src/app/feishu-bot-runtime.ts";

test("助手回复卡片不展示 token、上下文和生成用时", () => {
  const card = buildAssistantReplyCard(
    {
      replyInThread: true,
      threadId: "ot_1"
    },
    {
      state: "completed",
      text: "done",
      turnId: "turn_1",
      model: "gpt-5.4",
      effort: "high",
      tokenUsage: {
        total: {
          totalTokens: 1200,
          inputTokens: 700,
          cachedInputTokens: 100,
          outputTokens: 500,
          reasoningOutputTokens: 80
        },
        last: {
          totalTokens: 300,
          inputTokens: 180,
          cachedInputTokens: 20,
          outputTokens: 120,
          reasoningOutputTokens: 10
        },
        modelContextWindow: 4000
      },
      contextTokensUsed: 1200,
      contextTokensRemaining: 2800,
      elapsedMs: 12345
    }
  ) as {
    body?: {
      elements?: Array<{ content?: string }>;
    };
  };

  const statusMarkdown = card.body?.elements?.[0]?.content ?? "";
  assert.doesNotMatch(statusMarkdown, /tokens:/);
  assert.doesNotMatch(statusMarkdown, /context:/);
  assert.doesNotMatch(statusMarkdown, /elapsed:/);
  assert.match(statusMarkdown, /状态：`completed`/);
  assert.match(statusMarkdown, /turn: `turn_1`/);
});
