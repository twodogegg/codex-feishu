import type { SqliteDatabase } from "../../shared/sqlite.js";
import type {
  ThreadMetadata,
  ThreadRecord,
  UpsertThreadInput
} from "../../types/db.js";
import { getNowTimestamp, parseJsonObject, stringifyJsonObject } from "../utils.js";

type ThreadRow = {
  id: string;
  workspace_id: string;
  codex_thread_id: string;
  name: string | null;
  kind: ThreadRecord["kind"];
  parent_thread_id: string | null;
  status: ThreadRecord["status"];
  is_active: number;
  last_turn_id: string | null;
  metadata_json: string;
  created_at: string;
  updated_at: string;
};

export class ThreadsRepository {
  constructor(private readonly db: SqliteDatabase) {}

  getById(id: string): ThreadRecord | null {
    const statement = this.db.prepare(`
      SELECT
        id,
        workspace_id,
        codex_thread_id,
        name,
        kind,
        parent_thread_id,
        status,
        is_active,
        last_turn_id,
        metadata_json,
        created_at,
        updated_at
      FROM threads
      WHERE id = ?
    `);

    const row = statement.get(id) as ThreadRow | undefined;
    return row ? mapThreadRow(row) : null;
  }

  getByCodexThreadId(codexThreadId: string): ThreadRecord | null {
    const statement = this.db.prepare(`
      SELECT
        id,
        workspace_id,
        codex_thread_id,
        name,
        kind,
        parent_thread_id,
        status,
        is_active,
        last_turn_id,
        metadata_json,
        created_at,
        updated_at
      FROM threads
      WHERE codex_thread_id = ?
    `);

    const row = statement.get(codexThreadId) as ThreadRow | undefined;
    return row ? mapThreadRow(row) : null;
  }

  listByWorkspaceId(workspaceId: string): ThreadRecord[] {
    const statement = this.db.prepare(`
      SELECT
        id,
        workspace_id,
        codex_thread_id,
        name,
        kind,
        parent_thread_id,
        status,
        is_active,
        last_turn_id,
        metadata_json,
        created_at,
        updated_at
      FROM threads
      WHERE workspace_id = ?
      ORDER BY updated_at DESC
    `);

    return (statement.all(workspaceId) as ThreadRow[]).map(mapThreadRow);
  }

  upsert(input: UpsertThreadInput): ThreadRecord {
    const now = getNowTimestamp();
    const statement = this.db.prepare(`
      INSERT INTO threads (
        id,
        workspace_id,
        codex_thread_id,
        name,
        kind,
        parent_thread_id,
        status,
        is_active,
        last_turn_id,
        metadata_json,
        created_at,
        updated_at
      )
      VALUES (
        @id,
        @workspace_id,
        @codex_thread_id,
        @name,
        @kind,
        @parent_thread_id,
        @status,
        @is_active,
        @last_turn_id,
        @metadata_json,
        @created_at,
        @updated_at
      )
      ON CONFLICT(id) DO UPDATE SET
        workspace_id = excluded.workspace_id,
        codex_thread_id = excluded.codex_thread_id,
        name = excluded.name,
        kind = excluded.kind,
        parent_thread_id = excluded.parent_thread_id,
        status = excluded.status,
        is_active = excluded.is_active,
        last_turn_id = excluded.last_turn_id,
        metadata_json = excluded.metadata_json,
        updated_at = excluded.updated_at
    `);

    statement.run({
      id: input.id,
      workspace_id: input.workspaceId,
      codex_thread_id: input.codexThreadId,
      name: input.name ?? null,
      kind: input.kind ?? "main",
      parent_thread_id: input.parentThreadId ?? null,
      status: input.status ?? "created",
      is_active: input.isActive ? 1 : 0,
      last_turn_id: input.lastTurnId ?? null,
      metadata_json: stringifyJsonObject(input.metadata),
      created_at: now,
      updated_at: now
    });

    return this.getById(input.id)!;
  }

  setActiveThread(workspaceId: string, threadId: string): ThreadRecord | null {
    const update = this.db.transaction(() => {
      const now = getNowTimestamp();
      this.db
        .prepare(`
          UPDATE threads
          SET is_active = 0, updated_at = ?
          WHERE workspace_id = ?
        `)
        .run(now, workspaceId);

      this.db
        .prepare(`
          UPDATE threads
          SET is_active = 1, updated_at = ?
          WHERE id = ? AND workspace_id = ?
        `)
        .run(now, threadId, workspaceId);
    });

    update();
    return this.getById(threadId);
  }

  updateThread(
    threadId: string,
    updates: {
      name?: string | null;
      status?: ThreadRecord["status"];
      lastTurnId?: string | null;
      isActive?: boolean;
    }
  ): ThreadRecord | null {
    const current = this.getById(threadId);
    if (!current) {
      return null;
    }

    const statement = this.db.prepare(`
      UPDATE threads
      SET
        name = ?,
        status = ?,
        is_active = ?,
        last_turn_id = ?,
        updated_at = ?
      WHERE id = ?
    `);

    statement.run(
      updates.name ?? current.name,
      updates.status ?? current.status,
      (updates.isActive ?? current.isActive) ? 1 : 0,
      updates.lastTurnId ?? current.lastTurnId,
      getNowTimestamp(),
      threadId
    );

    return this.getById(threadId);
  }
}

function mapThreadRow(row: ThreadRow): ThreadRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    codexThreadId: row.codex_thread_id,
    name: row.name,
    kind: row.kind,
    parentThreadId: row.parent_thread_id,
    status: row.status,
    isActive: row.is_active === 1,
    lastTurnId: row.last_turn_id,
    metadata: parseJsonObject<ThreadMetadata>(row.metadata_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
