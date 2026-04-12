import { createSqliteDatabase, type SqliteDatabase } from "../shared/sqlite.js";
import type { DatabaseInitOptions } from "../types/db.js";
import { SessionBindingsRepository, ThreadsRepository, UsersRepository, WorkspacesRepository } from "./repositories/index.js";
import { initializeDatabaseSchema } from "./schema.js";

export interface DatabaseContext {
  db: SqliteDatabase;
  users: UsersRepository;
  workspaces: WorkspacesRepository;
  sessionBindings: SessionBindingsRepository;
  threads: ThreadsRepository;
  close(): void;
}

export function initializeDatabase(
  options: DatabaseInitOptions
): DatabaseContext {
  const db = createSqliteDatabase(options.databasePath);
  initializeDatabaseSchema(db);

  return {
    db,
    users: new UsersRepository(db),
    workspaces: new WorkspacesRepository(db),
    sessionBindings: new SessionBindingsRepository(db),
    threads: new ThreadsRepository(db),
    close() {
      db.close();
    }
  };
}
