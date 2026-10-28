# GitHub Contribution App Next Steps

Prepared 28 October 2026. This is a plan; it does not change the app.

## 1. Multiple AI entries in one declaration

**Already supported:** each new `/ai` comment creates a separate entry. A new `/declaration` includes all stored entries by the requesting user across that repository, grouped by the tool name as entered. Each field includes the entry ID and issue/PR number. `/report` includes everyone's declarations. Previously posted drafts are snapshots: request a new one after adding or correcting entries.

**Next improvement:** make multiple entries easier to read. Show each recorded interaction as its own block within its tool section, keeping its purpose, output, decision and influence together instead of joining each field with semicolons. Group tool names regardless of capitalization, while preserving version distinctions. Keep missing fields visible for each entry.

Example: two Codex entries and one Claude entry should produce a Codex section with two interaction blocks and a Claude section with one. Adding an entry must preserve earlier entries. Editing or removing an entry must affect the next generated draft. Other students' entries must stay out of a personal declaration.

Verify this with tests covering multiple entries, different tools, different authors, corrections, removal and duplicate webhook deliveries. Reposting the same text as a new comment counts as another entry; retrying the same webhook must not.

## 2. Save a tested baseline

Run the build and tests, review the changes, then commit and push them. Confirm GitHub Actions passes. Exclude secrets, databases and private exports. Back up the database before restarting with changes.

## 3. Run a small team trial

Have two or three consenting classmates try the commands on a private test repository. Check report accuracy, declaration readability and whether copying into the university form saves time. Capture confusion and fix the most common problems.

## 4. Deploy a production pilot

Create a separate production GitHub App and hosting account, configure secrets and persistent storage, then verify webhook delivery, restart persistence and uninstall cleanup. Hosting account setup and any paid plan selection still need the user's participation.

## 5. Prepare for sharing

Add a sanitized demo, installation link, support contact and actual privacy/retention details. Consider Marketplace only after the pilot proves useful.

The next implementation task is item 1. No deployment or paid service is started by this plan.
