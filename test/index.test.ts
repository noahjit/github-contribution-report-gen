import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { Probot, ProbotOctokit } from "probot";
import nock from "nock";
import fs from "node:fs";
import { openDatabase } from "../src/db.js";
import { registerApp } from "../src/index.js";
import type Database from "better-sqlite3";
import issueFixture from "./fixtures/issues.opened.json" with {type: "json"};

let db: Database.Database;
let handlers: Record<string, (context: any) => Promise<void>>;
let nextId = 1;
function context(body = "/ai debugging hints", overrides: any = {}) {
  const payload = {
    action: "created", installation: {id: 2},
    repository: {full_name: "team/project", name: "project", owner: {login: "team"}, private: true},
    issue: {number: 1, pull_request: {}},
    comment: {id: nextId++, body, author_association: "COLLABORATOR", user: {login: "alice", type: "User"}},
    ...overrides,
  };
  const createComment = vi.fn().mockResolvedValue({});
  return {name: "issue_comment", id: "test-delivery", payload,
    issue: (args: any) => ({owner: "team", repo: "project", issue_number: 1, ...args}),
    log: {info: vi.fn(), error: vi.fn()},
    octokit: {paginate: vi.fn().mockResolvedValue([]), rest: {
      issues: {createComment}, repos: {listCommits: vi.fn(), getCollaboratorPermissionLevel: vi.fn().mockResolvedValue({data: {permission: "admin"}})},
      pulls: {list: vi.fn(), listReviews: vi.fn(), listCommits: vi.fn()},
    }},
  };
}
const command = (ctx: ReturnType<typeof context>) => handlers["issue_comment.created"](ctx);
const count = (table: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as {n: number}).n;
const bodyOf = (ctx: ReturnType<typeof context>) => ctx.octokit.rest.issues.createComment.mock.calls.at(-1)?.[0].body as string;

beforeEach(() => {
  db = openDatabase(":memory:"); handlers = {};
  const app = {on: (events: string | string[], fn: any) => { for (const event of [events].flat()) handlers[event] = fn; }};
  registerApp(app as unknown as Probot, db);
});
afterEach(() => {db.close(); nock.cleanAll(); nock.enableNetConnect();});

describe("command trust and ownership", () => {
  test.each(["NONE", "CONTRIBUTOR", "FIRST_TIMER", "FIRST_TIME_CONTRIBUTOR"])("ignores %s without writing or replying", async association => {
    const ctx = context(); ctx.payload.comment.author_association = association;
    await command(ctx); expect(count("ai_declaration")).toBe(0);
    expect(ctx.octokit.rest.issues.createComment).not.toHaveBeenCalled();
  });
  test.each(["OWNER", "MEMBER", "COLLABORATOR"])("allows %s and deduplicates deliveries", async association => {
    const ctx = context(); ctx.payload.comment.author_association = association;
    await command(ctx); await command(ctx);
    expect(count("ai_declaration")).toBe(1); expect(ctx.octokit.rest.issues.createComment).toHaveBeenCalledTimes(1);
  });
  test.each(["/air fake", "/reporting", "/backfill-now", "text\n/ai fake"])("does not parse prefix %s", async text => {
    const ctx = context(text); await command(ctx); expect(ctx.octokit.rest.issues.createComment).not.toHaveBeenCalled();
  });
  test("ignores bots", async () => { const ctx = context(); ctx.payload.comment.user.type = "Bot"; await command(ctx); expect(count("ai_declaration")).toBe(0); });
  test("allows correction/removal only by entry owner in the original issue and repo", async () => {
    await command(context());
    const wrongUser = context("/ai edit 1 false"); wrongUser.payload.comment.user.login = "bob"; await command(wrongUser);
    const wrongIssue = context("/ai remove 1"); wrongIssue.payload.issue.number = 2; await command(wrongIssue);
    const wrongRepo = context("/ai remove 1"); wrongRepo.payload.repository.full_name = "other/project"; await command(wrongRepo);
    expect(count("ai_declaration")).toBe(1);
    expect((db.prepare("SELECT details FROM ai_declaration").get() as any).details).toBe("debugging hints");
    await command(context("/ai edit 1 I rejected the suggestion"));
    expect((db.prepare("SELECT details FROM ai_declaration").get() as any).details).toBe("I rejected the suggestion");
    await command(context("/ai remove 1")); expect(count("ai_declaration")).toBe(0);
  });
  test("rejects malformed edits and oversized declarations", async () => {
    for (const text of ["/ai", "/ai edit 1", "/ai remove 1 accidental text", "/ai " + "x".repeat(4001)]) await command(context(text));
    expect(count("ai_declaration")).toBe(0);
  });
});

describe("visibility and identity", () => {
  test.each(["/report", "/declaration bounded"])("requires public acknowledgement for %s", async text => {
    const ctx = context(text); ctx.payload.repository.private = false; await command(ctx);
    expect(bodyOf(ctx)).toContain("repeat your command with --public");
    const publicCtx = context(text + " --public"); publicCtx.payload.repository.private = false; await command(publicCtx);
    expect(bodyOf(publicCtx)).toContain("**Visibility:");
  });
  test("requires PR and rejects unrecognized flags", async () => {
    const ctx = context("/report", {issue: {number: 1}}); await command(ctx); expect(bodyOf(ctx)).toContain("on a pull request");
    const bad = context("/declaration --pubic"); await command(bad); expect(bodyOf(bad)).toContain("Use /report");
  });
  test("aliases require actual admin permission and support removal", async () => {
    const denied = context("/alias a@example.com alice"); denied.octokit.rest.repos.getCollaboratorPermissionLevel.mockResolvedValue({data: {permission: "write"}});
    await command(denied); expect(count("identity_alias")).toBe(0);
    await command(context("/alias a@example.com alice")); expect(count("identity_alias")).toBe(1);
    await command(context("/alias remove a@example.com")); expect(count("identity_alias")).toBe(0);
  });
  test("failed API requests produce a safe notice and log without duplicating writes", async () => {
    const ctx = context(); ctx.octokit.rest.issues.createComment.mockRejectedValueOnce(new Error("secret-value"));
    await expect(command(ctx)).rejects.toThrow("Webhook");
    expect(bodyOf(ctx)).toContain("Something went wrong"); expect(ctx.log.error).toHaveBeenCalled();
    expect(JSON.stringify(ctx.log.error.mock.calls)).not.toContain("secret-value");
    await command(ctx); expect(count("ai_declaration")).toBe(1);
  });
  test("backfill cooldown and API failure", async () => {
    const ctx = context("/backfill"); await command(ctx); expect(bodyOf(ctx)).toContain("Backfill complete");
    const second = context("/backfill"); await command(second); expect(bodyOf(second)).toContain("wait five minutes");
  });
});

describe("removal and concurrency", () => {
  test("uninstall purges every data table and blocks late events, with installation lookup fallback", async () => {
    await command(context());
    db.prepare("INSERT INTO identity_alias VALUES ('team/project','a@b.com','alice')").run();
    db.prepare("INSERT INTO pr_commit VALUES ('team/project',1,'original','alice','Codex')").run();
    const ctx = context(); ctx.payload = {installation: {id: 2}} as any;
    await handlers["installation.deleted"](ctx);
    for (const table of ["ai_declaration", "pull_request", "review", "commit_record", "identity_alias", "pr_commit", "processed_command", "repository_installation"]) expect(count(table)).toBe(0);
    await command(context()); expect(count("ai_declaration")).toBe(0);
  });
  test("removes only selected repo and allows explicit re-addition", async () => {
    await command(context());
    const other = context(); other.payload.repository.full_name = "team/other"; await command(other);
    const ctx = context(); ctx.payload = {installation: {id: 2}, repositories_removed: [{full_name: "team/project"}]} as any;
    await handlers["installation_repositories.removed"](ctx); await command(context()); expect(count("ai_declaration")).toBe(1);
    ctx.payload = {installation: {id: 2}, repositories_added: [{full_name: "team/project"}], repositories_removed: []} as any;
    await handlers["installation_repositories.added"](ctx); await command(context()); expect(count("ai_declaration")).toBe(2);
  });
  test("deletion waits for in-flight backfill and removes its writes", async () => {
    const ctx = context("/backfill");
    let release!: (rows: any[]) => void;
    ctx.octokit.paginate.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const scan = command(ctx); await Promise.resolve();
    const removal = context(); removal.payload = {installation: {id: 2}, repositories: [{full_name: "team/project"}]} as any;
    const deleted = handlers["installation.deleted"](removal);
    release([{sha: "x", author: {login: "alice"}, commit: {message: "test", author: {date: "2026-01-01"}}}]);
    await Promise.all([scan, deleted]); expect(count("commit_record")).toBe(0);
  });
});

test("actual Probot webhook dispatch posts a declaration receipt using mocked GitHub HTTP", async () => {
  nock.disableNetConnect();
  const probot = new Probot({appId: 123, privateKey: fs.readFileSync(new URL("./fixtures/mock-cert.pem", import.meta.url), "utf8"),
    Octokit: ProbotOctokit.defaults({retry: {enabled: false}, throttle: {enabled: false}})});
  registerApp(probot, db);
  const mock = nock("https://api.github.com").post("/app/installations/2/access_tokens").reply(200, {token: "test"})
    .post("/repos/hiimbex/testing-things/issues/1/comments", body => body.body.includes("AI use recorded as entry")).reply(201, {});
  await probot.receive({id: "integration", name: "issue_comment", payload: {...issueFixture, action: "created",
    repository: {...issueFixture.repository, full_name: "hiimbex/testing-things", private: true},
    comment: {id: 9001, body: "/ai Used hints", author_association: "COLLABORATOR", user: {login: "alice", type: "User"}}} as any});
  expect(mock.isDone()).toBe(true); expect(count("ai_declaration")).toBe(1);
});
