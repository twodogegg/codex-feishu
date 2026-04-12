import type { SqliteDatabase } from "../../shared/sqlite.js";
import type { UpsertUserInput, UserRecord } from "../../types/db.js";
import { getNowTimestamp } from "../utils.js";

type UserRow = {
  id: string;
  feishu_open_id: string;
  feishu_union_id: string | null;
  feishu_user_id: string | null;
  display_name: string;
  status: UserRecord["status"];
  created_at: string;
  updated_at: string;
};

export class UsersRepository {
  constructor(private readonly db: SqliteDatabase) {}

  list(): UserRecord[] {
    const statement = this.db.prepare(`
      SELECT
        id,
        feishu_open_id,
        feishu_union_id,
        feishu_user_id,
        display_name,
        status,
        created_at,
        updated_at
      FROM users
      ORDER BY created_at ASC
    `);

    return (statement.all() as UserRow[]).map(mapUserRow);
  }

  getById(id: string): UserRecord | null {
    const statement = this.db.prepare(`
      SELECT
        id,
        feishu_open_id,
        feishu_union_id,
        feishu_user_id,
        display_name,
        status,
        created_at,
        updated_at
      FROM users
      WHERE id = ?
    `);

    const row = statement.get(id) as UserRow | undefined;
    return row ? mapUserRow(row) : null;
  }

  getByFeishuOpenId(feishuOpenId: string): UserRecord | null {
    const statement = this.db.prepare(`
      SELECT
        id,
        feishu_open_id,
        feishu_union_id,
        feishu_user_id,
        display_name,
        status,
        created_at,
        updated_at
      FROM users
      WHERE feishu_open_id = ?
    `);

    const row = statement.get(feishuOpenId) as UserRow | undefined;
    return row ? mapUserRow(row) : null;
  }

  upsert(input: UpsertUserInput): UserRecord {
    const now = getNowTimestamp();
    const statement = this.db.prepare(`
      INSERT INTO users (
        id,
        feishu_open_id,
        feishu_union_id,
        feishu_user_id,
        display_name,
        status,
        created_at,
        updated_at
      )
      VALUES (
        @id,
        @feishu_open_id,
        @feishu_union_id,
        @feishu_user_id,
        @display_name,
        @status,
        @created_at,
        @updated_at
      )
      ON CONFLICT(id) DO UPDATE SET
        feishu_open_id = excluded.feishu_open_id,
        feishu_union_id = excluded.feishu_union_id,
        feishu_user_id = excluded.feishu_user_id,
        display_name = excluded.display_name,
        status = excluded.status,
        updated_at = excluded.updated_at
    `);

    statement.run({
      id: input.id,
      feishu_open_id: input.feishuOpenId,
      feishu_union_id: input.feishuUnionId ?? null,
      feishu_user_id: input.feishuUserId ?? null,
      display_name: input.displayName,
      status: input.status ?? "active",
      created_at: now,
      updated_at: now
    });

    return this.getById(input.id)!;
  }
}

function mapUserRow(row: UserRow): UserRecord {
  return {
    id: row.id,
    feishuOpenId: row.feishu_open_id,
    feishuUnionId: row.feishu_union_id,
    feishuUserId: row.feishu_user_id,
    displayName: row.display_name,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
