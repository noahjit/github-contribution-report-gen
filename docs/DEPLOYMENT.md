# Deployment

Prepared 28 October 2026. Nothing has been deployed by these changes.

1. Stop the development process before upgrading; copy the SQLite database and its WAL/SHM files together while stopped to a protected backup folder. Keep the original .env. Review the changes, run npm ci and npm run check, then restart development to exercise the migration.
2. Create a separate production GitHub App. Keep the existing development app and smee channel. Use the permissions/events in app.yml. Set a strong, unique webhook secret and download the production private key.
3. Create a Render account and connect the repository. Review pricing before accepting billing. The included render.yaml selects a paid Starter Docker web service and a 1 GB persistent disk. The free tier cannot attach that disk and sleeps after inactivity; it is unsuitable for this deployment. Check current prices at https://render.com/pricing and disk behavior at https://render.com/docs/disks.
4. Use the Blueprint file or create an equivalent Docker service, one instance, with a persistent disk mounted at /data. Set APP_ID, PRIVATE_KEY (complete PEM value), and WEBHOOK_SECRET in the host's secret settings. Do not paste these in chat or commit them. DATABASE_PATH=/data/data.sqlite, NODE_ENV=production, LOG_LEVEL=info. Do not enable debug/trace logging: Probot debug logs can include webhook payloads. Do not set WEBHOOK_PROXY_URL in production.
5. After the service starts, verify /ping. If the host volume is not writable by the container's node user, set its ownership to UID 1000 using the host's volume controls. Keep one instance and one attached volume.
6. Set the production app webhook URL to https://YOUR-SERVICE.onrender.com/api/github/webhooks and install it on a disposable private test repository. Confirm signed webhooks succeed and invalid signatures are rejected. The Probot middleware performs signature validation; never leave the secret blank.
7. Exercise /ai, edits/removal, /report, /declaration bounded, a squash merge and uninstall. Restart the service and confirm persistence. Remove access to the test repo and verify data cleanup before inviting a team.
8. Configure restricted backup access and a documented retention period. SQLite backups must be consistent: use its backup API or stop the app before copying the database and WAL. Test restore. After restoring, reconcile current installations before restarting ingestion so removed data is not resurrected. Delete expired snapshots, exports and logs under the stated retention policy.

Docker locally: build with `docker build -t github-contrib-report .`, create a named volume, then run with `--env-file` pointing to production-style secrets, `-p 3000:3000`, and `-v contribution-data:/data`. The image builds TypeScript in a separate stage, runs as a non-root user and excludes credentials and local data from the build context.

The container build is checked by CI but was not executed locally in the initial implementation session. GitHub Actions needs the changes committed and pushed before it can run remotely. No production registration, hosting account, billing, or deployment has been completed.

References: https://probot.github.io/docs/deployment/ ; https://render.com/docs/free ; https://docs.github.com/en/webhooks/webhook-events-and-payloads
