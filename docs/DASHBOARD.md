# Dashboard setup

The dashboard runs inside Probot, sharing its SQLite database. There is no separate frontend deployment, external asset CDN or browser-stored GitHub token.

## Local use now

Run `npm run build` after updates and restart `npm start`. In another terminal in the same project run `npm run dashboard`. This reads `.env`, migrates the configured database if needed and prints a single-use operator login link. Open that link within 10 minutes. Your browser receives an HttpOnly, SameSite cookie with an eight-hour lifetime; the initial credential is rotated and removed from the address bar. Treat the printed link as a password. Do not post it to GitHub, screenshot it or share it.

`PUBLIC_BASE_URL` must match the origin used in your browser. For development that is normally `http://localhost:3000`. Avoid mixing `localhost` and `127.0.0.1`, or changing ports after signing in; write requests enforce the configured origin. For nonstandard database locations, keep DATABASE_PATH consistent between the bot and login command. On a host with environment variables instead of a .env file, `node lib/dashboard-login.js` also works. Node 22 or 24 is recommended and tested.

Operator access requires local access to the database and grants management rights over the installed repositories it contains. It does not assert a GitHub user identity. A local operator can browse evidence, change weights, create review snapshots and export selected authors' Word drafts, but cannot edit another person's declaration or confirm as them.

## Team GitHub sign-in

1. Set PUBLIC_BASE_URL to the app's deployed HTTPS origin.
2. In the existing GitHub App settings, configure a user authorization callback URL of `https://YOUR-APP/dashboard/auth/callback`. For local testing use `http://localhost:3000/dashboard/auth/callback` and the separate development app.
3. Copy the GitHub App's Client ID (different from APP_ID), generate its client secret, and save them as GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET in the host's secrets. Never commit them. Restart the bot.
4. Visit `/dashboard` and choose Continue with GitHub. Authorize the correct app. The dashboard verifies identity via GitHub's user endpoint, then discards the GitHub token and uses its own short-lived session.
5. Test with an admin, a writer and a user with no access. GitHub permissions are checked on each repository request; API errors fail closed. GitHub sign-in is implemented and covered by mocked integration tests, but needs these account settings before a live end-to-end authorization trial.

GitHub guidance: https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app

## Permissions

| Action | Local operator | GitHub repository admin | GitHub writer | GitHub reader |
|---|---|---|---|---|
| Browse accessible repo evidence/review | Yes | Yes | Yes | Yes |
| Change/reset weights | Yes | Yes | No | No |
| Export own Word declaration | Select an author | Yes | Yes | Yes |
| Edit own declaration | No | Yes | Yes | No |
| Create a report snapshot | Yes | Yes | Yes | No |
| Confirm/flag as yourself | No | Yes | Yes | No |

The app exposes only repositories with an active recorded installation. Operator access sees all of them. GitHub users see repositories for which the installation API reports read, write or admin access. Public repository content remains visible to GitHub users who have read access; writes require write/admin access, and settings require admin. No dashboard role grants permission to edit another user's declaration.

## Workflow

- **Overview:** raw counts, estimated activity shares, recent PRs and incomplete declarations.
- **Reports:** inspect/export current Markdown and create a snapshot associated with a tracked PR. Creating a dashboard snapshot does not post a GitHub comment.
- **AI declarations:** filter by author, inspect missing fields, edit your own full entry when signed in with GitHub, and download Word directly. Operators choose an author; GitHub users export only their own declaration even if they browse other authors.
- **Team review:** view current/stale snapshots and individual responses. GitHub writers/admins can confirm or flag the current version. Changes to the report require renewed review. Existing bot comments remain snapshots.
- **Weights:** enter percentages totaling exactly 100%, inspect the preview, then save. The total and any correction needed appear beside the preview; Save is disabled for invalid totals. The API independently enforces the same rule. Existing relative command/environment values are converted to displayed percentages (rounded to hundredths totaling 100%). Only admins/operators can save. Existing `/weights` commands read the same settings.

## Operations

Run one process/replica with the persistent SQLite volume. Use HTTPS when hosted. Allow GET/POST dashboard routes through the reverse proxy. Do not cache dashboard API responses, log cookies or POST bodies, or log OAuth callback query strings. Default browser content security policy blocks external scripts; no repository Markdown is interpreted as HTML.

Sessions expire after eight hours and can be revoked by signing out. To revoke all dashboard sessions locally, the operator may delete rows from dashboard_session using a trusted SQLite maintenance tool. Do not restore session records when recovering stale database backups. Changes made in the dashboard do not restart the bot or require reinstallation. Removing repository access/uninstalling still purges its declarations, weights, downloads and review data; remaining global sessions do not grant access to inactive repositories.
