import type { SqliteDatabase } from "../../shared/sqlite.js";
import type {
  SessionBindingRecord,
  UpsertSessionBindingInput
} from "../../types/db.js";
import { getNowTimestamp } from "../utils.js";

type SessionBindingRow = {
  id: string;
  user_id: string;
  chat_id: string;
  thread_key: string | null;
  workspace_id: string | null;
  active_thread_id: string | null;
  created_at: string;
  updated_at: string;
};

export class SessionBindingsRepository {
  constructor(private readonly db: SqliteDatabase) {}

  getById(id: string): SessionBindingRecord | null {
    const statement = this.db.prepare(`
      SELECT
        id,
        user_id,
        chat_id,
        thread_key,
        workspace_id,
        active_thread_id,
        created_at,
        updated_at
      FROM session_bindings
      WHERE id = ?
    `);

    const row = statement.get(id) as SessionBindingRow | undefined;
    return row ? mapSessionBindingRow(row) : null;
  }

  getBySession(
    userId: string,
    chatId: string,
    threadKey: string | null = null
  ): SessionBindingRecord | null {
    const statement = this.db.prepare(`
      SELECT
        id,
        user_id,
        chat_id,
        thread_key,
        workspace_id,
        active_thread_id,
        created_at,
        updated_at
      FROM session_bindings
      WHERE user_id = ? AND chat_id = ? AND IFNULL(thread_key, '') = IFNULL(?, '')
    `);

    const row = statement.get(userId, chatId, threadKey) as
      | SessionBindingRow
      | undefined;
    return row ? mapSessionBindingRow(row) : null;
  }

  upsert(input: UpsertSessionBindingInput): SessionBindingRecord {
    const existing = this.getBySession(
      input.userId,
      input.chatId,
      input.threadKey ?? null
    );
    const id = existing?.id ?? input.id;
    const createdAt = existing?.createdAt ?? getNowTimestamp();
    const updatedAt = getNowTimestamp();

    const statement = this.db.prepare(`
      INSERT INTO session_bindings (
        id,
        user_id,
        chat_id,
        thread_key,
        workspace_id,
        active_thread_id,
        created_at,
        updated_at
      )
      VALUES (
        @id,
        @user_id,
        @chat_id,
        @thread_key,
        @workspace_id,
        @active_thread_id,
        @created_at,
        @updated_at
      )
      ON CONFLICT(id) DO UPDATE SET
        user_id = excluded.user_id,
        chat_id = excluded.chat_id,
        thread_key = excluded.thread_key,
        workspace_id = excluded.workspace_id,
        active_thread_id = excluded.active_thread_id,
        updated_at = excluded.updated_at
    `);

    statement.run({
      id,
      user_id: input.userId,
      chat_id: input.chatId,
      thread_key: input.threadKey ?? null,
      workspace_id: input.workspaceId ?? null,
      active_thread_id: input.activeThreadId ?? null,
      created_at: createdAt,
      updated_at: updatedAt
    });

    return this.getById(id)!;
  }

  deleteById(id: string): void {
    this.db.prepare(`DELETE FROM session_bindings WHERE id = ?`).run(id);
  }
}

function mapSessionBindingRow(row: SessionBindingRow): SessionBindingRecord {
  return {
    id: row.id,
    userId: row.user_id,
    chatId: row.chat_id,
    threadKey: row.thread_key,
    workspaceId: row.workspace_id,
    activeThreadId: row.active_thread_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
