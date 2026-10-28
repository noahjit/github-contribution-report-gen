import { Probot, type Context } from "probot";
import type Database from "better-sqlite3";
import { openDatabase, deleteRepository } from "./db.js";
import { findAiCoAuthors } from "./trailers.js";
import { backfillRepo, syncPrCommits } from "./backfill.js";
import { contributionReport, declarationDraft } from "./reports.js";
import { githubDiagnostic } from "./diagnostics.js";
import {configuredWeights, repositoryWeights} from "./activity-share.js";

const trusted = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);
const help = `Commands must occupy a new comment and come from a repository owner, member or collaborator.
- /ai <details> — record your use; optionally start with Tool: <name/version> on the first line.
- /ai edit <entry-id> <details> — correct your own entry in this issue or PR.
- /ai remove <entry-id> — remove your own entry in this issue or PR.
- /report — repository activity and evidence (PR comments only).
- /declaration [bounded] — your editable declaration draft (PR comments only).
- /backfill — rescan history (at most once every five minutes per repository).
- /alias <email> <login> or /alias remove <email> — map an unlinked commit email (repository admins only).
- /help — show this help.
- /weights — show activity weights; admins can set /weights 40 30 30 or /weights reset.

Reports and drafts are visible to everyone who can access this repository. On public repositories they require --public, for example /declaration bounded --public. Never put sensitive information in public commands.`;

export function registerApp(app: Probot, db: Database.Database) {
  // One process and a FIFO prevent in-flight backfills from restoring deleted data.
  let queue = Promise.resolve();
  const lastBackfill = new Map<string, number>();
  const run = (context: Context, work: () => Promise<void>, reply = false) => {
    const task = queue.then(work).catch(async (error: unknown) => {
      context.log.error({ event: context.name, delivery: context.id, ...githubDiagnostic(error) }, "Event failed; GitHub response diagnostics");
      if (reply) {
        try { await context.octokit.rest.issues.createComment(context.issue({ body: "Something went wrong while processing that command. It may have been saved already; check /report before creating another declaration. Please try again with a new comment, or ask the app operator to inspect the logs." })); }
        catch (noticeError) { context.log.error({ delivery: context.id, ...githubDiagnostic(noticeError) }, "GitHub rejected the error notice too; check installation permissions and API limits"); }
      }
      throw new Error(`Webhook ${context.name} failed; see delivery ${context.id}`);
    });
    queue = task.catch(() => {});
    return task;
  };
  function activate(repo: string, installation: number) {
    db.prepare(`INSERT INTO repository_installation(repo, installation_id, active) VALUES (?, ?, 1)
      ON CONFLICT(repo) DO UPDATE SET installation_id = excluded.installation_id, active = 1`).run(repo, installation);
  }
  function allowed(repo: string, installation: number): boolean {
    if (db.prepare("SELECT 1 FROM deleted_installation WHERE installation_id = ?").get(installation)) return false;
    const state = db.prepare("SELECT installation_id, active FROM repository_installation WHERE repo = ?").get(repo) as {installation_id: number; active: number} | undefined;
    if (!state) { activate(repo, installation); return true; }
    return state.installation_id === installation && state.active === 1;
  }
  function remove(repo: string) { deleteRepository(db, repo); lastBackfill.delete(repo); }

  app.on(["installation.created", "installation_repositories.added"], context => run(context, async () => {
    const p = context.payload;
    if (db.prepare("SELECT 1 FROM deleted_installation WHERE installation_id = ?").get(p.installation.id)) return;
    const repos = "repositories_added" in p ? p.repositories_added : p.repositories ?? [];
    if ("repositories_removed" in p) for (const repo of p.repositories_removed) {
      if (repo.full_name) { activate(repo.full_name, p.installation.id); remove(repo.full_name); }
    }
    for (const repo of repos) activate(repo.full_name, p.installation.id);
    for (const repo of repos) {
      const [owner, name] = repo.full_name.split("/");
      await backfillRepo(db, context.octokit, owner, name, context.log);
    }
  }));
  app.on("installation_repositories.removed", context => run(context, async () => {
    for (const repo of context.payload.repositories_removed) {
      activate(repo.full_name, context.payload.installation.id); remove(repo.full_name);
    }
  }));
  app.on("installation.deleted", context => run(context, async () => {
    const id = context.payload.installation.id;
    db.transaction(() => {
      db.prepare("INSERT OR IGNORE INTO deleted_installation VALUES (?)").run(id);
      const stored = db.prepare("SELECT repo FROM repository_installation WHERE installation_id = ?").all(id) as {repo: string}[];
      const names = new Set([...stored.map(r => r.repo), ...(context.payload.repositories ?? []).map(r => r.full_name)]);
      for (const repo of names) remove(repo);
      db.prepare("DELETE FROM repository_installation WHERE installation_id = ?").run(id);
    })();
    db.pragma("wal_checkpoint(TRUNCATE)");
  }));
  app.on(["pull_request.opened", "pull_request.reopened", "pull_request.edited", "pull_request.synchronize", "pull_request.closed"], context => run(context, async () => {
    const { pull_request: pr, repository: repo, installation } = context.payload;
    if (!installation || !allowed(repo.full_name, installation.id)) return;
    db.prepare(`INSERT INTO pull_request(repo, number, author, title, state, merged, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(repo, number) DO UPDATE SET title = excluded.title, state = excluded.state, merged = excluded.merged`)
      .run(repo.full_name, pr.number, pr.user?.login ?? "unknown", pr.title, pr.state, pr.merged ? 1 : 0, pr.created_at);
    await syncPrCommits(db, context.octokit, repo.owner.login, repo.name, pr.number);
  }));
  app.on(["pull_request_review.submitted", "pull_request_review.edited", "pull_request_review.dismissed"], context => run(context, async () => {
    const { review, pull_request, repository, installation } = context.payload;
    if (!installation || !allowed(repository.full_name, installation.id)) return;
    db.prepare(`INSERT OR REPLACE INTO review(repo, pr_number, review_id, reviewer, state, submitted_at)
      VALUES (?, ?, ?, ?, ?, ?)`).run(repository.full_name, pull_request.number, review.id,
      review.user?.login ?? "unknown", review.state.toLowerCase(), review.submitted_at);
  }));
  app.on("push", context => run(context, async () => {
    const { repository, commits, installation } = context.payload;
    if (!installation || !allowed(repository.full_name, installation.id)) return;
    const insert = db.prepare(`INSERT OR IGNORE INTO commit_record(repo, sha, author, committed_at, ai_trailer, ai_trailer_names) VALUES (?, ?, ?, ?, ?, ?)`);
    db.transaction(() => {
      for (const c of commits) {
        const names = findAiCoAuthors(c.message);
        insert.run(repository.full_name, c.id, c.author.username ?? c.author.email ?? "unknown", c.timestamp, names.length ? 1 : 0, names.join(", ") || null);
      }
    })();
  }));
  app.on("issue_comment.created", context => {
    const {comment, issue, repository, installation} = context.payload;
    const command = comment.body.trim().match(/^\/(ai|report|declaration|backfill|alias|help|weights)(?:\s+([\s\S]*))?$/);
    if (!command || !comment.user || comment.user.type === "Bot" || !trusted.has(comment.author_association) || !installation) return Promise.resolve();
    const login = comment.user.login;
    return run(context, async () => {
      const repo = repository.full_name;
      if (!allowed(repo, installation.id)) return;
      if (db.prepare("SELECT 1 FROM processed_command WHERE repo = ? AND comment_id = ?").get(repo, comment.id)) return;
      const name = command[1], args = command[2]?.trim() ?? "";
      const send = async (body: string) => {
        if (body.length > 55000) body = "The output exceeds the safe comment size. Nothing has been posted or silently truncated. Ask the operator to export it locally using the export script described in the README.";
        await context.octokit.rest.issues.createComment(context.issue({body}));
      };
      let response = help;
      if (name === "ai") {
        const edit = args.match(/^(edit|remove)\s+([1-9]\d*)(?:\s+([\s\S]+))?$/);
        if (edit) {
          const [, action, id, details] = edit;
          if (action === "edit" && (!details?.trim() || details.length > 4000) || action === "remove" && details) { await send("Use /ai edit <entry-id> <details> (up to 4,000 characters), or /ai remove <entry-id>."); return; }
          const result = action === "edit"
            ? db.prepare("UPDATE ai_declaration SET details = ? WHERE id = ? AND repo = ? AND number = ? AND declared_by = ?").run(details!.trim(), id, repo, issue.number, login)
            : db.prepare("DELETE FROM ai_declaration WHERE id = ? AND repo = ? AND number = ? AND declared_by = ?").run(id, repo, issue.number, login);
          response = result.changes ? `AI entry ${id} ${action === "edit" ? "updated" : "removed"}. Previously posted reports and command comments are unchanged; regenerate reports and delete old comments separately if needed.` : "Entry not found among your declarations in this issue or PR.";
        } else if (!args || /^(edit|remove)(?:\s|$)/.test(args) || args.length > 4000) {
          await send("Use /ai <details> (up to 4,000 characters), /ai edit <entry-id> <details>, or /ai remove <entry-id>."); return;
        } else {
          const result = db.prepare("INSERT OR IGNORE INTO ai_declaration(repo, number, declared_by, details, source, comment_id) VALUES (?, ?, ?, ?, 'command', ?)").run(repo, issue.number, login, args, comment.id);
          response = `AI use recorded as entry ${result.lastInsertRowid} for #${issue.number}. Correct it with /ai edit <entry-id> <details>, or remove it with /ai remove <entry-id>.`;
        }
      } else if (name === "report" || name === "declaration") {
        const words = args.split(/\s+/).filter(Boolean);
        if (words.some(w => w !== "--public" && !(name === "declaration" && w === "bounded"))) { await send("Use /report [--public] or /declaration [bounded] [--public]."); return; }
        if (!issue.pull_request) { await send("Request reports and declarations on a pull request. They are visible to everyone with repository access."); return; }
        if (!repository.private && !words.includes("--public")) { await send("This repository is public. To publish the output where anyone can read it, repeat your command with --public. Use the operator's local export for a private copy."); return; }
        response = "**Visibility: everyone with access to this repository can read this output.**\n\n" + (name === "report" ? contributionReport(db, repo) : declarationDraft(db, repo, login, words.includes("bounded")));
      } else if (name === "backfill") {
        if (args) { await send("Use /backfill without arguments."); return; }
        if (Date.now() - (lastBackfill.get(repo) ?? 0) < 300000) { await send("A backfill ran recently. Please wait five minutes before requesting another."); return; }
        const result = await backfillRepo(db, context.octokit, repository.owner.login, repository.name, context.log);
        lastBackfill.set(repo, Date.now());
        response = `Backfill complete: ${result.commits} commits, ${result.prs} PRs and ${result.reviews} reviews scanned. AI command history is not reconstructed.`;
      } else if (name === "weights") {
        if (args) {
          let weights;
          if (args !== "reset") {
            if (!/^\d+(?:\.\d+)?\s+\d+(?:\.\d+)?\s+\d+(?:\.\d+)?$/.test(args)) { await send("Use /weights <merged-PRs> <commits> <reviews>, for example /weights 50 20 30, or /weights reset."); return; }
            try { weights = configuredWeights(args.split(/\s+/).join(",")); }
            catch { await send("Weights must be between 0 and 10000, with at least one positive weight."); return; }
          }
          const permission = await context.octokit.rest.repos.getCollaboratorPermissionLevel({owner: repository.owner.login, repo: repository.name, username: login});
          if (permission.data.permission !== "admin") { await send("Only repository administrators can change activity weights. Use /weights to view them."); return; }
          if (weights) db.prepare("INSERT OR REPLACE INTO repository_weights VALUES (?, ?)").run(repo, weights.join(","));
          else db.prepare("DELETE FROM repository_weights WHERE repo = ?").run(repo);
        }
        const weights = repositoryWeights(db, repo), sum = weights.reduce((a, b) => a + b, 0);
        response = `Repository activity weights (merged PRs / commits / reviews): ${weights.join(" / ")} (${weights.map(w => (w / sum * 100).toFixed(1) + "%").join(" / ")}). Empty categories redistribute their weight. Request a new /report to apply these weights; earlier reports stay unchanged. Admins can use /weights 50 20 30 or /weights reset.`;
      } else if (name === "alias") {
        const permission = await context.octokit.rest.repos.getCollaboratorPermissionLevel({owner: repository.owner.login, repo: repository.name, username: login});
        if (permission.data.permission !== "admin") { await send("Only repository administrators can change identity aliases."); return; }
        const removeAlias = args.match(/^remove\s+([^\s@]+@[^\s@]+)$/);
        const addAlias = args.match(/^([^\s@]+@[^\s@]+)\s+@?([a-z\d](?:[a-z\d-]{0,37}[a-z\d])?)$/i);
        if (removeAlias) db.prepare("DELETE FROM identity_alias WHERE repo = ? AND email = ?").run(repo, removeAlias[1].toLowerCase());
        else if (addAlias) db.prepare("INSERT OR REPLACE INTO identity_alias VALUES (?, ?, ?)").run(repo, addAlias[1].toLowerCase(), addAlias[2].toLowerCase());
        else { await send("Use /alias <email> <login> or /alias remove <email>. Only map verified identities; command text follows repository visibility."); return; }
        response = "Repository identity alias updated. Regenerate reports to see the change.";
      }
      db.prepare("INSERT OR IGNORE INTO processed_command VALUES (?, ?)").run(repo, comment.id);
      await send(response);
    }, true);
  });
}

export default (app: Probot) => {
  if (process.env.NODE_ENV === "production" && !process.env.DATABASE_PATH) throw new Error("Set DATABASE_PATH to a persistent volume in production.");
  registerApp(app, openDatabase());
};
