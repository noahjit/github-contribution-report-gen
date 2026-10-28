import {createHash} from "node:crypto";
import type Database from "better-sqlite3";
import {contributionReport, safe} from "./reports.js";

export function reportId(repo: string, number: number, body: string) {
  return createHash("sha256").update(JSON.stringify([repo, number, body])).digest("hex").slice(0, 16);
}
export function publishSnapshot(db: Database.Database, repo: string, number: number) {
  const body = contributionReport(db, repo), id = reportId(repo, number, body);
  db.prepare("INSERT OR IGNORE INTO report_snapshot VALUES (?, ?, ?)").run(repo, id, number);
  return {body, id};
}
export function recordConfirmation(db: Database.Database, repo: string, number: number, id: string, login: string, status: "confirmed" | "flagged", reason = "") {
  const snapshot = db.prepare("SELECT 1 FROM report_snapshot WHERE repo = ? AND number = ? AND report_id = ?").get(repo, number, id);
  if (!snapshot) return "Report not found in this PR. Copy the report ID from a bot report here.";
  if (reportId(repo, number, contributionReport(db, repo)) !== id) return "That report is out of date. Request a new /report, review it, then confirm or flag its new ID.";
  db.prepare(`INSERT INTO team_confirmation(repo, report_id, login, status, reason) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(repo, report_id, login) DO UPDATE SET status=excluded.status, reason=excluded.reason, updated_at=datetime('now')`)
    .run(repo, id, login.toLowerCase(), status, reason);
  return `Your ${status === "confirmed" ? "confirmation" : "flag"} is recorded for report \`${id}\`.\n\n` + confirmationSummary(db, repo, number, id);
}
export function confirmationSummary(db: Database.Database, repo: string, number: number, id: string) {
  if (!db.prepare("SELECT 1 FROM report_snapshot WHERE repo = ? AND number = ? AND report_id = ?").get(repo, number, id)) return "Report not found in this PR.";
  const stale = reportId(repo, number, contributionReport(db, repo)) !== id;
  const rows = db.prepare("SELECT login, status, reason FROM team_confirmation WHERE repo = ? AND report_id = ? ORDER BY login").all(repo, id) as {login: string; status: string; reason: string}[];
  return ["### Team review", "", `Report: \`${id}\`${stale ? " — out of date; request a new report." : ""}`, "",
    "These are individual acknowledgements of this snapshot, not proof that the whole team agrees or that percentages measure effort.", "",
    ...(rows.length ? ["| Team member | Response | Note |", "|---|---|---|", ...rows.map(r => `| ${safe(r.login)} | ${r.status === "confirmed" ? "Confirmed" : "Flagged"} | ${safe(r.reason) || "—"} |`)] : ["No responses yet."]), "",
    `After reviewing: \`/confirm ${id}\` · Raise a concern: \`/flag ${id} <reason>\` · Refresh responses: \`/confirmations ${id}\``].join("\n");
}
