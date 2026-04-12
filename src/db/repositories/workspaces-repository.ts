import type { SqliteDatabase } from "../../shared/sqlite.js";
import type {
  UpsertWorkspaceInput,
  WorkspacePolicy,
  WorkspaceRecord
} from "../../types/db.js";
import { getNowTimestamp, parseJsonObject, stringifyJsonObject } from "../utils.js";

type WorkspaceRow = {
  id: string;
  owner_user_id: string;
  template_id: string | null;
  name: string;
  slug: string;
  root_path: string;
  status: WorkspaceRecord["status"];
  default_model: string;
  default_effort: string;
  policy_json: string;
  last_active_thread_id: string | null;
  created_at: string;
  updated_at: string;
};

export class WorkspacesRepository {
  constructor(private readonly db: SqliteDatabase) {}

  getById(id: string): WorkspaceRecord | null {
    const statement = this.db.prepare(`
      SELECT
        id,
        owner_user_id,
        template_id,
        name,
        slug,
        root_path,
        status,
        default_model,
        default_effort,
        policy_json,
        last_active_thread_id,
        created_at,
        updated_at
      FROM workspaces
      WHERE id = ?
    `);

    const row = statement.get(id) as WorkspaceRow | undefined;
    return row ? mapWorkspaceRow(row) : null;
  }

  getByOwnerAndSlug(ownerUserId: string, slug: string): WorkspaceRecord | null {
    const statement = this.db.prepare(`
      SELECT
        id,
        owner_user_id,
        template_id,
        name,
        slug,
        root_path,
        status,
        default_model,
        default_effort,
        policy_json,
        last_active_thread_id,
        created_at,
        updated_at
      FROM workspaces
      WHERE owner_user_id = ? AND slug = ?
    `);

    const row = statement.get(ownerUserId, slug) as WorkspaceRow | undefined;
    return row ? mapWorkspaceRow(row) : null;
  }

  listByOwnerUserId(ownerUserId: string): WorkspaceRecord[] {
    const statement = this.db.prepare(`
      SELECT
        id,
        owner_user_id,
        template_id,
        name,
        slug,
        root_path,
        status,
        default_model,
        default_effort,
        policy_json,
        last_active_thread_id,
        created_at,
        updated_at
      FROM workspaces
      WHERE owner_user_id = ?
      ORDER BY created_at ASC
    `);

    return (statement.all(ownerUserId) as WorkspaceRow[]).map(mapWorkspaceRow);
  }

  upsert(input: UpsertWorkspaceInput): WorkspaceRecord {
    const now = getNowTimestamp();
    const statement = this.db.prepare(`
      INSERT INTO workspaces (
        id,
        owner_user_id,
        template_id,
        name,
        slug,
        root_path,
        status,
        default_model,
        default_effort,
        policy_json,
        last_active_thread_id,
        created_at,
        updated_at
      )
      VALUES (
        @id,
        @owner_user_id,
        @template_id,
        @name,
        @slug,
        @root_path,
        @status,
        @default_model,
        @default_effort,
        @policy_json,
        @last_active_thread_id,
        @created_at,
        @updated_at
      )
      ON CONFLICT(id) DO UPDATE SET
        owner_user_id = excluded.owner_user_id,
        template_id = excluded.template_id,
        name = excluded.name,
        slug = excluded.slug,
        root_path = excluded.root_path,
        status = excluded.status,
        default_model = excluded.default_model,
        default_effort = excluded.default_effort,
        policy_json = excluded.policy_json,
        last_active_thread_id = excluded.last_active_thread_id,
        updated_at = excluded.updated_at
    `);

    statement.run({
      id: input.id,
      owner_user_id: input.ownerUserId,
      template_id: input.templateId ?? null,
      name: input.name,
      slug: input.slug,
      root_path: input.rootPath,
      status: input.status ?? "created",
      default_model: input.defaultModel,
      default_effort: input.defaultEffort,
      policy_json: stringifyJsonObject(input.policy),
      last_active_thread_id: input.lastActiveThreadId ?? null,
      created_at: now,
      updated_at: now
    });

    return this.getById(input.id)!;
  }

  setLastActiveThreadId(
    workspaceId: string,
    threadId: string | null
  ): WorkspaceRecord | null {
    const statement = this.db.prepare(`
      UPDATE workspaces
      SET
        last_active_thread_id = ?,
        updated_at = ?
      WHERE id = ?
    `);

    statement.run(threadId, getNowTimestamp(), workspaceId);
    return this.getById(workspaceId);
  }

  updateDefaults(
    workspaceId: string,
    updates: {
      defaultModel?: string;
      defaultEffort?: string;
      status?: WorkspaceRecord["status"];
    }
  ): WorkspaceRecord | null {
    const current = this.getById(workspaceId);
    if (!current) {
      return null;
    }

    const statement = this.db.prepare(`
      UPDATE workspaces
      SET
        default_model = ?,
        default_effort = ?,
        status = ?,
        updated_at = ?
      WHERE id = ?
    `);

    statement.run(
      updates.defaultModel ?? current.defaultModel,
      updates.defaultEffort ?? current.defaultEffort,
      updates.status ?? current.status,
      getNowTimestamp(),
      workspaceId
    );

    return this.getById(workspaceId);
  }
}

function mapWorkspaceRow(row: WorkspaceRow): WorkspaceRecord {
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    templateId: row.template_id,
    name: row.name,
    slug: row.slug,
    rootPath: row.root_path,
    status: row.status,
    defaultModel: row.default_model,
    defaultEffort: row.default_effort,
    policy: parseJsonObject<WorkspacePolicy>(row.policy_json),
    lastActiveThreadId: row.last_active_thread_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
