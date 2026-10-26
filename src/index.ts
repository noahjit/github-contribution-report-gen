import { Probot } from "probot";
import { db } from "./db.js";

type AuthorRow = { author: string; opened: number; merged: number };
type DeclRow = { number: number; declared_by: string; details: string };

export default (app: Probot) => {
  app.on("issues.opened", async (context) => {
    await context.octokit.rest.issues.createComment(
      context.issue({ body: "Thanks for opening this issue!" }),
    );
  });

  app.on(
    [
      "pull_request.opened",
      "pull_request.reopened",
      "pull_request.edited",
      "pull_request.closed",
    ],
    async (context) => {
      const pr = context.payload.pull_request;
      db.prepare(
        `INSERT INTO pull_request (repo, number, author, title, state, merged, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(repo, number) DO UPDATE SET
           title = excluded.title,
           state = excluded.state,
           merged = excluded.merged`,
      ).run(
        context.payload.repository.full_name,
        pr.number,
        pr.user.login,
        pr.title,
        pr.state,
        pr.merged ? 1 : 0,
        pr.created_at,
      );
      context.log.info({ pr: pr.number }, "PR stored");
    },
  );

  app.on("issue_comment.created", async (context) => {
    const { comment, issue, repository } = context.payload;
    if (comment.user?.type === "Bot") return;

    const body = comment.body.trim();
    const repo = repository.full_name;

    if (body.startsWith("/ai")) {
      const details = body.slice(3).trim() || "no details given";
      db.prepare(
        `INSERT INTO ai_declaration (repo, number, declared_by, details, source)
         VALUES (?, ?, ?, ?, 'command')`,
      ).run(repo, issue.number, comment.user?.login ?? "unknown", details);

      await context.octokit.rest.issues.createComment(
        context.issue({ body: `AI use recorded for #${issue.number}: ${details}` }),
      );
    } else if (body.startsWith("/report")) {
      const authors = db
        .prepare(
          `SELECT author, COUNT(*) AS opened, SUM(merged) AS merged
           FROM pull_request WHERE repo = ? GROUP BY author ORDER BY author`,
        )
        .all(repo) as AuthorRow[];

      const decls = db
        .prepare(
          `SELECT number, declared_by, details
           FROM ai_declaration WHERE repo = ? ORDER BY id`,
        )
        .all(repo) as DeclRow[];

      const lines: string[] = ["## Contribution report", ""];
      lines.push("| Author | PRs opened | PRs merged |", "|---|---|---|");
      for (const a of authors) {
        lines.push(`| ${a.author} | ${a.opened} | ${a.merged} |`);
      }
      lines.push("", "## Declared AI use", "");
      if (decls.length === 0) {
        lines.push("No AI use has been declared.");
      } else {
        for (const d of decls) {
          lines.push(`- #${d.number} (${d.declared_by}): ${d.details}`);
        }
      }
      lines.push(
        "",
        "_Only activity since the app was installed is included. This report reflects self-declared AI use and can't detect undeclared use._",
      );

      await context.octokit.rest.issues.createComment(
        context.issue({ body: lines.join("\n") }),
      );
    }
  });
};