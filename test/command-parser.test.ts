import test from "node:test";
import assert from "node:assert/strict";

import {
  parseCommandText,
  parseUserInput
} from "../src/domain/commanding/index.ts";

test("普通文本不会被解析成命令", () => {
  const result = parseUserInput("hello");
  assert.equal(result.kind, "text");
  if (result.kind === "text") {
    assert.equal(result.text, "hello");
  }
});

test("已知命令会被正确解析", () => {
  const result = parseCommandText("/bind default");
  assert.ok(result);
  assert.equal(result?.kind, "command");
  if (result?.kind === "command") {
    assert.equal(result.name, "bind");
    assert.deepEqual(result.args, ["default"]);
  }
});

test("带引号参数的 rename 能被解析", () => {
  const result = parseCommandText('/rename "hello world"');
  assert.ok(result);
  assert.equal(result?.kind, "command");
  if (result?.kind === "command") {
    assert.equal(result.name, "rename");
    assert.deepEqual(result.args, ["hello world"]);
  }
});

test("未知命令会落到 unknown-command", () => {
  const result = parseCommandText("/not-a-command");
  assert.ok(result);
  assert.equal(result?.kind, "unknown-command");
});

test("/subagents switch 会保留子命令和目标线程参数", () => {
  const result = parseCommandText('/subagents switch "sub-thread-1"');
  assert.ok(result);
  assert.equal(result?.kind, "command");
  if (result?.kind === "command") {
    assert.equal(result.name, "subagents");
    assert.equal(result.subcommand, "switch");
    assert.deepEqual(result.args, ["switch", "sub-thread-1"]);
    assert.equal(result.argText, 'switch "sub-thread-1"');
  }
});

test("/subagents back 能作为卡片命令字符串直接解析", () => {
  const result = parseUserInput("/subagents back");
  assert.equal(result.kind, "command");
  if (result.kind === "command") {
    assert.equal(result.name, "subagents");
    assert.equal(result.subcommand, "back");
    assert.deepEqual(result.args, ["back"]);
  }
});

test("卡片 callback 里的 command 字符串能直接走 parseUserInput", () => {
  const result = parseUserInput("/message");
  assert.equal(result.kind, "command");
  if (result.kind === "command") {
    assert.equal(result.name, "message");
    assert.deepEqual(result.args, []);
    assert.equal(result.commandText, "message");
  }
});
