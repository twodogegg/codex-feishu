import type { SqliteDatabase } from "../shared/sqlite.js";

export const CURRENT_SCHEMA_VERSION = 1;

const schemaStatements = [
  `
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      feishu_open_id TEXT NOT NULL UNIQUE,
      feishu_union_id TEXT,
      feishu_user_id TEXT,
      display_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS workspace_templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL DEFAULT '',
      default_model TEXT NOT NULL,
      default_effort TEXT NOT NULL,
      policy_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      owner_user_id TEXT NOT NULL,
      template_id TEXT,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      root_path TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'created',
      default_model TEXT NOT NULL,
      default_effort TEXT NOT NULL,
      policy_json TEXT NOT NULL DEFAULT '{}',
      last_active_thread_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(owner_user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(template_id) REFERENCES workspace_templates(id) ON DELETE SET NULL
    )
  `,
  `
    CREATE UNIQUE INDEX IF NOT EXISTS idx_workspaces_owner_slug
    ON workspaces(owner_user_id, slug)
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_workspaces_owner_user_id
    ON workspaces(owner_user_id)
  `,
  `
    CREATE TABLE IF NOT EXISTS threads (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      codex_thread_id TEXT NOT NULL UNIQUE,
      name TEXT,
      kind TEXT NOT NULL DEFAULT 'main',
      parent_thread_id TEXT,
      status TEXT NOT NULL DEFAULT 'created',
      is_active INTEGER NOT NULL DEFAULT 0,
      last_turn_id TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
      FOREIGN KEY(parent_thread_id) REFERENCES threads(id) ON DELETE SET NULL
    )
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_threads_workspace_id
    ON threads(workspace_id)
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_threads_parent_thread_id
    ON threads(parent_thread_id)
  `,
  `
    CREATE TABLE IF NOT EXISTS session_bindings (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      chat_id TEXT NOT NULL,
      thread_key TEXT,
      workspace_id TEXT,
      active_thread_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE SET NULL,
      FOREIGN KEY(active_thread_id) REFERENCES threads(id) ON DELETE SET NULL
    )
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_session_bindings_user_id
    ON session_bindings(user_id)
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_session_bindings_chat_id
    ON session_bindings(chat_id)
  `,
  `
    CREATE UNIQUE INDEX IF NOT EXISTS idx_session_bindings_user_chat_thread
    ON session_bindings(user_id, chat_id, IFNULL(thread_key, ''))
  `,
  `
    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      turn_id TEXT,
      state TEXT NOT NULL DEFAULT 'queued',
      reply_message_id TEXT,
      started_at TEXT,
      first_token_at TEXT,
      ended_at TEXT,
      error_text TEXT,
      metrics_json TEXT NOT NULL DEFAULT '{}',
      FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
      FOREIGN KEY(thread_id) REFERENCES threads(id) ON DELETE CASCADE
    )
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_runs_workspace_id
    ON runs(workspace_id)
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_runs_thread_id
    ON runs(thread_id)
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_runs_state
    ON runs(state)
  `,
  `
    CREATE TABLE IF NOT EXISTS approval_rules (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      rule_type TEXT NOT NULL,
      command_prefix TEXT,
      scope TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
    )
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_approval_rules_workspace_id
    ON approval_rules(workspace_id)
  `,
  `
    CREATE TABLE IF NOT EXISTS card_messages (
      id TEXT PRIMARY KEY,
      chat_id TEXT NOT NULL,
      message_id TEXT NOT NULL UNIQUE,
      workspace_id TEXT,
      thread_id TEXT,
      run_id TEXT,
      card_type TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE SET NULL,
      FOREIGN KEY(thread_id) REFERENCES threads(id) ON DELETE SET NULL,
      FOREIGN KEY(run_id) REFERENCES runs(id) ON DELETE SET NULL
    )
  `
];

export function initializeDatabaseSchema(db: SqliteDatabase): void {
  const currentVersion = db.pragma("user_version", { simple: true }) as number;

  if (currentVersion >= CURRENT_SCHEMA_VERSION) {
    for (const statement of schemaStatements) {
      db.exec(statement);
    }
    return;
  }

  const migrate = db.transaction(() => {
    for (const statement of schemaStatements) {
      db.exec(statement);
    }

    db.pragma(`user_version = ${CURRENT_SCHEMA_VERSION}`);
  });

  migrate();
}
