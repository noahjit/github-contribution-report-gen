import type Database from "better-sqlite3";
import { declarationFields, type Field } from "./declaration-fields.js";

export function safe(value: unknown): string {
  return String(value ?? "").replace(/[\\`*_\[\]#]/g, "\\$&")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/@/g, "&#64;").replace(/\|/g, "&#124;")
    .replace(/[\r\n]+/g, " ");
}
function person(db: Database.Database, repo: string, author: string): string {
  const alias = db.prepare("SELECT login FROM identity_alias WHERE repo = ? AND email = ?")
    .get(repo, author.toLowerCase()) as {login: string} | undefined;
  return alias?.login ?? author;
}
type Declaration = {id: number; number: number; declared_by: string; details: string};
type Evidence = {sha: string; author: string; names: string; pr: number | null};
function declarations(db: Database.Database, repo: string): Declaration[] {
  return db.prepare("SELECT id, number, declared_by, details FROM ai_declaration WHERE repo = ? ORDER BY id").all(repo) as Declaration[];
}
function evidence(db: Database.Database, repo: string): Evidence[] {
  return db.prepare(`SELECT sha, author, ai_trailer_names AS names, NULL AS pr FROM commit_record
    WHERE repo = ? AND ai_trailer = 1
    UNION ALL SELECT sha, author, ai_names AS names, pr_number AS pr FROM pr_commit p
    WHERE repo = ? AND ai_names IS NOT NULL AND NOT EXISTS
      (SELECT 1 FROM commit_record c WHERE c.repo = p.repo AND c.sha = p.sha AND c.ai_trailer = 1)
    ORDER BY sha, pr`).all(repo, repo) as Evidence[];
}
export function contributionReport(db: Database.Database, repo: string): string {
  const lines = ["## Contribution report", "", `Repository: ${safe(repo)}`, "",
    "Activity counts are context, not a score of effort, quality, or individual contribution.", "",
    "### Pull requests", "| Author | Opened | Merged |", "|---|---:|---:|"];
  const prs = db.prepare("SELECT author, COUNT(*) AS opened, SUM(merged) AS merged FROM pull_request WHERE repo = ? GROUP BY author ORDER BY author").all(repo) as {author: string; opened: number; merged: number}[];
  for (const p of prs) lines.push(`| ${safe(p.author)} | ${p.opened} | ${p.merged} |`);
  lines.push("", "### Observed commits", "| Author | Commits | With AI co-author trailer |", "|---|---:|---:|");
  const commits = db.prepare("SELECT author, COUNT(*) AS commits, SUM(ai_trailer) AS ai FROM commit_record WHERE repo = ? GROUP BY author").all(repo) as {author: string; commits: number; ai: number}[];
  const totals = new Map<string, {commits: number; ai: number}>();
  for (const c of commits) {
    const who = person(db, repo, c.author), count = totals.get(who) ?? {commits: 0, ai: 0};
    count.commits += c.commits; count.ai += c.ai; totals.set(who, count);
  }
  for (const [who, c] of [...totals].sort(([a], [b]) => a.localeCompare(b))) lines.push(`| ${safe(who)} | ${c.commits} | ${c.ai} |`);
  lines.push("", "### Reviews of others' pull requests", "| Reviewer | Reviews | Approvals | Changes requested |", "|---|---:|---:|---:|");
  const reviews = db.prepare(`SELECT reviewer, COUNT(*) AS reviews, SUM(r.state = 'approved') AS approvals,
    SUM(r.state = 'changes_requested') AS changes FROM review r JOIN pull_request p
    ON p.repo = r.repo AND p.number = r.pr_number WHERE r.repo = ? AND r.reviewer != p.author
    GROUP BY reviewer ORDER BY reviewer`).all(repo) as {reviewer: string; reviews: number; approvals: number; changes: number}[];
  for (const r of reviews) lines.push(`| ${safe(r.reviewer)} | ${r.reviews} | ${r.approvals} | ${r.changes} |`);
  lines.push("", "### Declared AI use");
  const ds = declarations(db, repo);
  if (!ds.length) lines.push("No declarations recorded. This does not establish that no AI was used.");
  for (const d of ds) lines.push(`- Entry ${d.id}, #${d.number}, ${safe(d.declared_by)}: ${safe(d.details)}`);
  lines.push("", "### AI trailer evidence (including original PR commits)");
  const ev = evidence(db, repo);
  if (!ev.length) lines.push("No matching trailers recorded.");
  for (const e of ev) lines.push(`- ${safe(e.sha)}${e.pr ? `, PR #${e.pr}` : ""}: ${safe(person(db, repo, e.author))}; ${safe(e.names)}`);
  lines.push("", "_Coverage: default-branch history scanned by backfill, plus observed pushes on all branches since installation. PR commit evidence is listed separately and is not added to observed commit totals. Squash/rebase history can change counts. Original PR commits are retained as historical evidence even after force pushes; GitHub limits the PR commits API to 250 commits. Trailers are unverified indicators, not proof of AI use or a complete AI-use detector._");
  return lines.join("\n");
}

export function declarationDraft(db: Database.Database, repo: string, login: string, bounded = false): string {
  const ds = declarations(db, repo).filter(d => d.declared_by.toLowerCase() === login.toLowerCase());
  const ev = evidence(db, repo).filter(e => person(db, repo, e.author).toLowerCase() === login.toLowerCase());
  const lines = [`## ${bounded ? "AI bounded process use declaration" : "AI use declaration"} — editable draft`, "",
    `Prepared from recorded evidence for ${safe(login)} in ${safe(repo)}. Review and copy into your required submission document. This draft does not establish policy compliance or declare that no AI was used.`, "",
    "### Part A: Student details", "- Student name: [complete]", "- Student number: [complete]",
    "- Course code and name: [complete]", "- Assessment number and title: [complete]",
    "- AI use permitted by this assessment: [check task instructions and complete]", "- Date submitted: [complete]", "",
    "### Part B: Account of AI use", "Complete the five fields for each tool used. Include use outside GitHub. Recorded descriptions below are self-reports; trailer names are only hints.", ""];
  const groups = new Map<string, {tool: string; entries: Declaration[]}>();
  for (const d of ds) {
    const tool = declarationFields(d.details).tool || "[tool and version to confirm]";
    const key = tool.toLowerCase();
    const group = groups.get(key) ?? {tool, entries: []};
    group.entries.push(d);
    groups.set(key, group);
  }
  if (!groups.size) groups.set("unknown", {tool: "[tool and version to confirm, or remove after confirming no AI use]", entries: []});
  for (const {tool, entries} of groups.values()) {
    lines.push(`#### Tool: ${safe(tool)}`, "");
    for (const entry of entries.length ? entries : [undefined]) {
    if (entry) lines.push(`##### Entry ${entry.id} — #${entry.number}`, "");
    const fields = entry ? declarationFields(entry.details) : {};
    const field = (key: Field, placeholder: string) => {
      const value = fields[key];
      return value ? safe(value) : placeholder;
    };
    lines.push("1. **Tool used:** " + safe(fields.tool || tool),
      "2. **Purpose of use:** " + field("purpose", "[specific task and permitted purpose]"),
      "3. **What the AI produced:** " + field("output", "[describe the actual output]"),
      "4. **What I did with that output:** " + field("decision", "[what you accepted, rejected, revised or rewrote, and why]"),
      "5. **How it influenced the final submission:** " + field("influence", "[affected section or stage, and extent]"), "", "Recorded notes:");
    if (!entry) lines.push("- No self-reported entries available. Complete from your own records.");
    else lines.push(`- Entry ${entry.id}, #${entry.number}: ${safe(entry.details)}`);
    lines.push("");
    }
  }
  lines.push("### Supporting trailer evidence", "These names do not establish purpose, permitted scope, or what you accepted.");
  if (!ev.length) lines.push("No matching evidence recorded for this account. Missing evidence does not mean no AI use.");
  for (const e of ev) lines.push(`- ${safe(e.sha)}${e.pr ? ` (PR #${e.pr})` : ""}: ${safe(e.names)}`);
  lines.push("", "### Part C: Declaration", "Select only statements you personally verify; leave the draft unsigned until reviewed.",
    "- [ ] I did not use any AI tool in preparing or submitting this assessment.", "", "Or, where AI was used:",
    "- [ ] I used AI only for purposes explicitly permitted by the task instructions.",
    "- [ ] I remained the author and final decision-maker.",
    "- [ ] This account accurately and honestly describes my AI use.",
    "- [ ] I take responsibility for the quality, accuracy, integrity and final form of the submission.",
    "- [ ] I understand I may be asked to explain my work and AI use without referring to AI-generated material.",
    "- [ ] I understand that use beyond the permitted scope or missing required declarations may lead to academic integrity consequences.",
    "", "Signature: [complete yourself]", "Date: [complete]");
  if (bounded) lines.push("", "_Adapted to the supplied Bounded Process form's Parts A–C. The source refers to a Part E that is absent from the supplied document; confirm the no-AI procedure with your assessor. This Markdown draft is not the official form._");
  return lines.join("\n");
}
