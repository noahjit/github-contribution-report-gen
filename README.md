# GitHub contribution report

A Probot app that records repository activity and AI-use evidence, and prepares editable declaration drafts. Counts are not an objective measure of effort or quality. AI trailers are unverified hints, not an AI detector.

## Run locally

Use Node 22 or 24. Run `npm ci`, `npm run check`, then `npm start`. Copy `.env.example` to `.env` and configure your development app credentials. Never commit credentials or databases. The existing database is migrated additively on startup; stop the old app and back up its database before upgrading. Tests use isolated in-memory databases.

Configure your GitHub App with Contents read, Metadata read, Issues write, and Pull requests write. Subscribe to Issue comment, Pull request, Pull request review, and Push. Installation lifecycle events are automatic. Changing app.yml alone does not change an existing app's settings.

## Commands

Only OWNER, MEMBER and COLLABORATOR comments are accepted. Bots are ignored. Commands must begin the comment and match an exact command name.

| Command | Purpose |
|---|---|
| `/ai <details>` | Record your AI use; receipt includes its entry ID |
| `/ai edit <id> <details>` | Correct your own entry in the original issue/PR |
| `/ai remove <id>` | Delete your own entry in the original issue/PR |
| `/report` | Repository activity report, on a PR |
| `/declaration` | Your editable AI declaration, on a PR |
| `/declaration bounded` | Draft aligned with the supplied Bounded Process form |
| `/backfill` | Rescan history, with a five-minute per-repo cooldown |
| `/alias <email> <login>` | Map an unlinked email to a GitHub login; admins only |
| `/alias remove <email>` | Remove a mapping; admins only |
| `/help` | Command reference |

On public repos, `/report` and `/declaration` require `--public`. That publishes the output to everyone. A PR comment is never team-private on a public repo. AI commands and alias emails also have the repository's visibility. Do not put confidential material or student IDs in public comments.

Example comment:

```text
/ai Tool: Codex
Purpose: debugging hints for input validation.
Output: suggested three edge cases.
Decision: rejected one, wrote my own validation, tested the remaining two.
Influence: validation tests in PR #12.
```

Then request `/declaration bounded` (add `--public` on a public repo). Copy the draft into the official form and complete the five reflection fields, personal details and signature yourself. No compliance assertions are checked automatically. The supplied form references an absent Part E: ask your assessor how to handle no-AI declarations. Different courses can use the general draft; the app does not determine what AI use an assessment permits.

## Private local exports

After building and starting the updated app once to migrate its database, the operator can export without posting to GitHub:

```text
npm run export -- report owner/repo exports/report.md
npm run export -- declaration owner/repo exports/declaration.md login bounded
```

Create the exports folder first. Set DATABASE_PATH to the existing database. Export refuses to overwrite an existing file. Protect the output directory and share only with authorized recipients. Windows permissions are inherited from the containing directory. Outputs exceeding 55,000 characters are not posted; use this export instead.

## Coverage and operational limits

Backfill scans default-branch commits, all PRs and reviews, and original PR commits. Pushes add observed commits across all branches. Original PR commits retain trailer evidence through squash merges and are reported separately, not added to totals. GitHub's PR commits endpoint is limited to 250 commits; force-pushed historical evidence is retained. Counts may differ across squash/rebase workflows. Backfill cannot recreate old `/ai` declarations, off-platform AI use, or lost webhooks.

Email aliases are repository-scoped administrative assertions and only affect unlinked commit author emails. Review counts count review events, not unique reviewers. A failed scan can leave partial progress; rerunning is safe. Duplicate command deliveries do not duplicate stored declarations. If posting fails after saving a command, use a new comment to request a report; the original delivery is not reposted automatically.

Deploy one process/replica: handlers run in FIFO order so uninstall cleanup follows an in-flight scan. Large scans delay other events; this is suitable for a small pilot, not a large multi-tenant service. Cooldowns reset on restart. GitHub does not automatically redeliver every failed webhook: inspect deliveries and redeliver failures after fixing the cause. Repository renames/transfers and out-of-order installation selection events need operator reconciliation; repository keys are full names. Reconcile before a production rollout involving these operations.

See [deployment](docs/DEPLOYMENT.md), [privacy](PRIVACY.md) and [pilot checklist](docs/PILOT.md).

## Declaration autofill

Use `Tool:`, `Purpose:`, `Output:`, `Decision:` and `Influence:` on separate lines in an `/ai` comment (see the example above). Labels are case-insensitive. Purpose, Output, Decision and Influence accept continuation lines. Record one tool per entry; use separate comments for different tools. Repeated labels preserve both values.

Both `/declaration` and `/declaration bounded` fill the corresponding fields using your exact descriptions, with entry IDs and issue/PR references. Missing fields remain placeholders for each entry; ordinary unstructured descriptions remain in Recorded notes. Trailer names never populate personal reflections. Existing structured entries work without re-entering them. Use `/ai edit <id>` followed by the complete updated labeled details to correct an entry, then request a new draft. Previously posted drafts do not change.

Multiple entries now appear as separate interaction blocks within each tool section. Tool grouping ignores capitalization, preserving different version labels. See [a fictional two-entry declaration](docs/DEMO_DECLARATION.md). Run a fresh declaration command after new entries, corrections or removals.

## Estimated activity percentages

`/report` includes an estimated share of recorded GitHub activity. Defaults are 40% merged PRs, 30% observed commits and 30% review events on other people's PRs. Each person's share of each category is multiplied by its effective weight and added. Empty categories redistribute their weight proportionally; if no positively weighted category has activity, no estimate is shown. Rounded estimates total 100.0% using largest-remainder allocation (alphabetical tie breaks).

The operator can set `ACTIVITY_WEIGHTS=40,30,30` in `.env` or host environment settings, then restart. Values are relative weights in the order merged PRs, commits, reviews. Zero disables a category; at least one weight must be positive. Invalid settings produce a clear configuration error. Active weights and the category-share breakdown are shown in every report and local report export.

The estimate excludes known `[bot]` logins and `unknown` authors. Unlinked emails remain separate until an administrator adds an alias. Raw activity tables remain available. AI declarations and trailer counts do not affect the estimate. PR and commit activity overlaps; repeated review events, branch history, squash merges and incomplete webhook coverage can affect the result. Use the breakdown to discuss recorded activity rather than assigning grades or assuming it measures effort or quality.

### Team-editable weights

Comment `/weights` on an issue or PR to view your repository's weights. Repository admins can use `/weights 50 20 30` to set relative weights for merged PRs, commits and reviews, or `/weights reset` to restore the operator's ACTIVITY_WEIGHTS defaults. Weights need not total 100; they are normalized automatically. Changes persist across restarts, apply only to this repository, and are deleted when repository access is removed. Non-admin collaborators can view weights but cannot change them. Generate a fresh report after changing weights; old reports remain snapshots.
