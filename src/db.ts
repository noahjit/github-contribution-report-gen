import Database from "better-sqlite3";
export function openDatabase(filename = process.env.DATABASE_PATH ?? "data.sqlite"): Database.Database {
const db = new Database(filename);
db.pragma("journal_mode = WAL");
db.pragma("busy_timeout = 5000");
db.pragma("secure_delete = ON");

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

CREATE TABLE IF NOT EXISTS commit_record (
  repo TEXT NOT NULL,
  sha TEXT NOT NULL,
  author TEXT NOT NULL,
  committed_at TEXT,
  ai_trailer INTEGER NOT NULL DEFAULT 0,
  ai_trailer_names TEXT,
  PRIMARY KEY (repo, sha)
);

CREATE TABLE IF NOT EXISTS review (
  repo TEXT NOT NULL,
  pr_number INTEGER NOT NULL,
  review_id INTEGER NOT NULL,
  reviewer TEXT NOT NULL,
  state TEXT NOT NULL,
  submitted_at TEXT,
  PRIMARY KEY (repo, review_id)
);
`);
db.exec(`
CREATE TABLE IF NOT EXISTS repository_weights (repo TEXT PRIMARY KEY, weights TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS repository_installation (
  repo TEXT PRIMARY KEY, installation_id INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS deleted_installation (installation_id INTEGER PRIMARY KEY);
CREATE TABLE IF NOT EXISTS identity_alias (
  repo TEXT NOT NULL, email TEXT NOT NULL, login TEXT NOT NULL,
  PRIMARY KEY (repo, email)
);
CREATE TABLE IF NOT EXISTS pr_commit (
  repo TEXT NOT NULL, pr_number INTEGER NOT NULL, sha TEXT NOT NULL,
  author TEXT NOT NULL, ai_names TEXT, PRIMARY KEY (repo, pr_number, sha)
);
CREATE TABLE IF NOT EXISTS processed_command (
  repo TEXT NOT NULL, comment_id INTEGER NOT NULL, PRIMARY KEY (repo, comment_id)
);
`);
const columns = db.prepare("PRAGMA table_info(ai_declaration)").all() as {name: string}[];
if (!columns.some(c => c.name === "comment_id")) db.exec("ALTER TABLE ai_declaration ADD COLUMN comment_id INTEGER");
db.exec("CREATE UNIQUE INDEX IF NOT EXISTS declaration_comment ON ai_declaration(repo, comment_id)");
return db;
}

export function deleteRepository(db: Database.Database, repo: string) {
  db.transaction(() => {
    for (const table of ["pull_request", "ai_declaration", "commit_record", "review", "identity_alias", "pr_commit", "processed_command", "repository_weights"]) {
      db.prepare(`DELETE FROM ${table} WHERE repo = ?`).run(repo);
    }
    db.prepare("UPDATE repository_installation SET active = 0 WHERE repo = ?").run(repo);
  })();
}
