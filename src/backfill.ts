import type { Context } from "probot";
import type Database from "better-sqlite3";
import { findAiCoAuthors } from "./trailers.js";

type Octokit = Context["octokit"];
type Log = Context["log"];

export async function backfillRepo(
  db: Database.Database,
  octokit: Octokit,
  owner: string,
  repo: string,
  log: Log,
): Promise<{ commits: number; prs: number; reviews: number }> {
  const fullName = `${owner}/${repo}`;

  // Commits on the default branch (an empty repo returns 409, so handle that)
  let commits: Awaited<ReturnType<typeof octokit.rest.repos.listCommits>>["data"] = [];
  try {
    commits = await octokit.paginate(octokit.rest.repos.listCommits, {
      owner,
      repo,
      per_page: 100,
    });
  } catch (err: unknown) {
    if (!(typeof err === "object" && err && "status" in err && err.status === 409)) throw err;
  }

  const insertCommit = db.prepare(
    `INSERT OR IGNORE INTO commit_record
       (repo, sha, author, committed_at, ai_trailer, ai_trailer_names)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const saveCommits = db.transaction((rows: typeof commits) => {
    for (const c of rows) {
      const ai = findAiCoAuthors(c.commit.message);
      insertCommit.run(
        fullName,
        c.sha,
        c.author?.login ?? c.commit.author?.email ?? "unknown",
        c.commit.author?.date ?? null,
        ai.length > 0 ? 1 : 0,
        ai.length > 0 ? ai.join(", ") : null,
      );
    }
  });
  saveCommits(commits);

  // All pull requests (open, closed, merged)
  const prs = await octokit.paginate(octokit.rest.pulls.list, {
    owner,
    repo,
    state: "all",
    per_page: 100,
  });

  const upsertPr = db.prepare(
    `INSERT INTO pull_request (repo, number, author, title, state, merged, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(repo, number) DO UPDATE SET
       title = excluded.title,
       state = excluded.state,
       merged = excluded.merged`,
  );
  const savePrs = db.transaction((rows: typeof prs) => {
    for (const pr of rows) {
      upsertPr.run(
        fullName,
        pr.number,
        pr.user?.login ?? "unknown",
        pr.title,
        pr.state,
        pr.merged_at ? 1 : 0,
        pr.created_at,
      );
    }
  });
  savePrs(prs);

  const insertReview = db.prepare(
  `INSERT OR REPLACE INTO review
     (repo, pr_number, review_id, reviewer, state, submitted_at)
   VALUES (?, ?, ?, ?, ?, ?)`,
    );
    let reviewCount = 0;
    for (const pr of prs) {
    const reviews = await octokit.paginate(octokit.rest.pulls.listReviews, {
        owner,
        repo,
        pull_number: pr.number,
        per_page: 100,
    });
    const saveReviews = db.transaction(() => {
        for (const rv of reviews) {
        if (rv.state === "PENDING") continue;
        insertReview.run(
            fullName,
            pr.number,
            rv.id,
            rv.user?.login ?? "unknown",
            rv.state.toLowerCase(),
            rv.submitted_at ?? null,
        );
        reviewCount++;
        }
    });
    saveReviews();
    await syncPrCommits(db, octokit, owner, repo, pr.number);
    }

  log.info({ repo: fullName, commits: commits.length, prs: prs.length, reviews: reviewCount }, "backfill done");
    return { commits: commits.length, prs: prs.length, reviews: reviewCount };
}

// Keep original PR commit evidence separate: squash commits must not count as
// additional original contributions, and their messages may lose AI trailers.
export async function syncPrCommits(db: Database.Database, octokit: Octokit, owner: string, repo: string, number: number) {
  const commits = await octokit.paginate(octokit.rest.pulls.listCommits, {
    owner, repo, pull_number: number, per_page: 100,
  });
  const insert = db.prepare(`INSERT OR REPLACE INTO pr_commit
    (repo, pr_number, sha, author, ai_names) VALUES (?, ?, ?, ?, ?)`);
  db.transaction(() => {
    for (const c of commits) {
      insert.run(`${owner}/${repo}`, number, c.sha,
        c.author?.login ?? c.commit.author?.email ?? "unknown",
        findAiCoAuthors(c.commit.message).join(", ") || null);
    }
  })();
}
