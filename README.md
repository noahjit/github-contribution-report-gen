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

## Word downloads and team review

On a PR, request `/declaration word` or `/declaration word bounded`. On public repositories add `--public`. The bot returns a Word download link valid for 15 minutes. It contains only the requesting user's declaration entries and attributed trailer evidence, with editable student details, incomplete fields and unchecked assertions. It is an adapted draft, not an exact copy of a university's official Word template.

Set `PUBLIC_BASE_URL=http://localhost:3000` for use on the same computer as the bot. For teammates use the deployed app's HTTPS origin, e.g. `https://your-app.onrender.com`. Smee forwards webhook requests; a smee URL cannot serve these files. A link is a bearer credential: anyone with it can download, even for a private repo. Do not share links beyond the intended recipients. The token is kept in the URL fragment and sent by the download page in a POST body, keeping it out of ordinary URL access logs. Do not enable request-body capture in a proxy or monitoring service. Downloads are served with no-store caching headers.

Saved download files expire after 15 minutes and are purged at startup/on access and every minute while running. Up to 10 exports per repo are kept; requesting more revokes older links. New AI entries, corrections and deletions revoke existing links for that repository. Removal/uninstall deletes downloads too. Files already saved by a user cannot be revoked. Opening the link starts the Word download automatically, with no confirmation button. A small status tab clears the token from its address bar and shows an error if the link has expired. Reopen the original link to retry.

Without a reachable app URL, export privately from the operator's machine:

```text
npm run export -- declaration owner/repo exports/declaration.docx login bounded
```

Create the exports directory first and set DATABASE_PATH as described above. No Word or LibreOffice installation is required for the app to generate files. The initial implementation verifies document structure and text; visual pagination QA was unavailable locally because LibreOffice was not installed.

AI receipts now list missing Tool, Purpose, Output, Decision or Influence fields and provide the edit syntax. Entries are saved even when incomplete. Editing replaces the complete entry: include the fields you want to retain. Long evidence sections are collapsible; report estimates appear first.

Every `/report` now includes a report ID and team-review commands:

- `/confirm <report-id>` records that you reviewed that report.
- `/flag <report-id> <reason>` raises a concern (up to 1,000 characters).
- `/confirmations <report-id>` shows the latest responses.

These commands use the existing owner/member/collaborator authorization rule and must be posted in the PR containing the report. Each person has one response per snapshot and can change it. They record individual acknowledgements, not automatic unanimous team approval, signatures or university compliance. Report IDs identify repository, PR and report content. Changes to evidence, aliases or weights that alter the report require a fresh report and renewed review. Old responses are displayed as out of date; previously posted GitHub comments are not edited automatically. Confirmations and flag notes have repository visibility and are deleted when the app loses access. Snapshot storage retains identifiers only, not copies of declaration text.

## Web dashboard

The bot now serves a dashboard at `/dashboard` on the same server. It includes activity summaries, reports, declaration browsing and Word downloads, team review, and editable weights with a live preview.

For local operator access:

1. Restart the updated bot with `npm start`.
2. Open a second terminal in the project folder and run `npm run dashboard`.
3. Open the private link printed in that terminal. It works once and expires in 10 minutes. The signed-in session lasts eight hours.

The operator can inspect installed repositories, change weights and export declarations. It cannot impersonate a teammate to edit personal declarations or confirm reports. Team members can use GitHub sign-in after configuring the app's client credentials and callback URL. See [dashboard setup and permissions](docs/DASHBOARD.md). `/dashboard` in a repository comment returns the dashboard's public sign-in address, never an operator credential.

Dashboard weight controls use actual percentages: each must be 0–100 (up to two decimal places), totaling exactly 100%. The form shows the total and how much to add or remove, and disables Save when invalid. The API rejects invalid totals independently. Existing `/weights` command and ACTIVITY_WEIGHTS settings remain relative for compatibility; the dashboard converts those to percentages when opening the editor.
