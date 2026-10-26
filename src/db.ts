import Database from "better-sqlite3";
export const db: Database.Database = new Database("data.sqlite");
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS pull_request (
  repo TEXT NOT NULL,
  number INTEGER NOT NULL,
  author TEXT NOT NULL,
  title TEXT,
  state TEXT NOT NULL,
  merged INTEGER NOT NULL DEFAULT 0,
  created_at TEXT,
  PRIMARY KEY (repo, number)
);

CREATE TABLE IF NOT EXISTS ai_declaration (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repo TEXT NOT NULL,
  number INTEGER NOT NULL,
  declared_by TEXT NOT NULL,
  details TEXT NOT NULL,
  source TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);