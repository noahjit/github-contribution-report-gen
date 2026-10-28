import {afterEach, beforeEach, expect, test} from "vitest";
import {openDatabase} from "../src/db.js";
import {contributionReport, declarationDraft} from "../src/reports.js";
import {findAiCoAuthors} from "../src/trailers.js";
let db: ReturnType<typeof openDatabase>;
beforeEach(() => {db = openDatabase(":memory:");});
afterEach(() => db.close());
test("trailer parsing is case insensitive, line anchored and deduplicated", () => {
  expect(findAiCoAuthors("Text mentions Codex\nCo-authored-by: Codex <codex@openai.com>\nco-AUTHORED-by: Codex <codex@openai.com>\nCo-authored-by: Human <human@example.com>")).toEqual(["Codex"]);
  expect(findAiCoAuthors("a Co-authored-by: Codex <bot@openai.com>\nCo-authored-by:\nCodex <bot@openai.com>")).toEqual([]);
  expect(findAiCoAuthors("Co-authored-by: Jean-Claude <human@example.com> trailing sentence")).toEqual([]);
});
test("reports merge email aliases, deduplicate commits, separate squash evidence, exclude self reviews and escape content", () => {
  db.exec(`INSERT INTO commit_record VALUES ('a/b','one','alice',NULL,0,NULL), ('a/b','two','a@example.com',NULL,1,'Codex');
    INSERT INTO identity_alias VALUES ('a/b','a@example.com','alice');
    INSERT INTO pr_commit VALUES ('a/b',1,'original','alice','Claude');
    INSERT INTO pull_request VALUES ('a/b',1,'alice','title','closed',1,NULL);
    INSERT INTO review VALUES ('a/b',1,1,'alice','approved',NULL),('a/b',1,2,'bob','approved',NULL);
    INSERT INTO ai_declaration(repo,number,declared_by,details,source) VALUES ('a/b',1,'alice','<script> @team | fake','command');`);
  const report = contributionReport(db, "a/b");
  expect(report).toContain("| alice | 2 | 1 |"); expect(report).toContain("| bob | 1 | 1 | 0 |");
  expect(report).toContain("original, PR #1"); expect(report).not.toContain("<script>"); expect(report).not.toContain("@team");
  expect(contributionReport(db, "other/repo")).not.toContain("original, PR #1");
});
test("bounded draft has the five reflection fields, only own records and no signed assertions", () => {
  const insert = db.prepare("INSERT INTO ai_declaration(repo,number,declared_by,details,source) VALUES ('a/b',1,?,?,'command')");
  insert.run("alice", "Tool: Codex\nI rejected the suggestion"); insert.run("bob", "private other-person note");
  const draft = declarationDraft(db, "a/b", "alice", true);
  for (const text of ["Part A", "Purpose of use", "What the AI produced", "What I did with that output", "How it influenced", "Part C", "Part E", "I rejected the suggestion"]) expect(draft).toContain(text);
  expect(draft).not.toContain("private other-person note"); expect(draft).not.toContain("[x]");
  expect(declarationDraft(db, "a/b", "nobody")).toContain("Missing evidence does not mean no AI use");
});
