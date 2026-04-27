import test from "node:test";
import assert from "node:assert/strict";

import {
  buildAssistantReplyCard,
  collectSentencesForStreaming,
  shouldDeleteHelpCardSourceMessage
} from "../src/app/feishu-bot-runtime.ts";

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

test("仅 help 卡片按钮触发源消息删除策略", () => {
  assert.equal(
    shouldDeleteHelpCardSourceMessage({
      event: {
        action: {
          value: {
            kind: "help",
            action: "quick_command",
            command: "/status"
          }
        }
      }
    }),
    true
  );

  assert.equal(
    shouldDeleteHelpCardSourceMessage({
      event: {
        action: {
          value: {
            kind: "panel",
            action: "status",
            command: "/status"
          }
        }
      }
    }),
    false
  );
});

test("streaming 更新会按句拆分，completed 时补发尾句", () => {
  const state = {
    lastAggregatedText: "",
    pendingBuffer: ""
  };

  const first = collectSentencesForStreaming(
    {
      state: "streaming",
      text: "第一句。第二句",
      turnId: "turn_1"
    },
    state
  );
  assert.deepEqual(first, ["第一句。"]);

  const second = collectSentencesForStreaming(
    {
      state: "streaming",
      text: "第一句。第二句！第三句",
      turnId: "turn_1"
    },
    state
  );
  assert.deepEqual(second, ["第二句！"]);

  const completed = collectSentencesForStreaming(
    {
      state: "completed",
      text: "第一句。第二句！第三句",
      turnId: "turn_1"
    },
    state
  );
  assert.deepEqual(completed, ["第三句"]);
});

test("当聚合文本回退时，按最新文本重置拆句游标", () => {
  const state = {
    lastAggregatedText: "旧前缀。",
    pendingBuffer: ""
  };

  const sentences = collectSentencesForStreaming(
    {
      state: "streaming",
      text: "新内容一。新内容二。",
      turnId: "turn_1"
    },
    state
  );
  assert.deepEqual(sentences, ["新内容一。", "新内容二。"]);
});
