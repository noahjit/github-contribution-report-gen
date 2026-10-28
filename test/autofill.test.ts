import {expect, test} from "vitest";
import {declarationFields} from "../src/declaration-fields.js";
import {declarationDraft} from "../src/reports.js";
import {openDatabase} from "../src/db.js";

test("explicit fields handle empty values, CRLF, case, continuations and repeated labels", () => {
  expect(declarationFields("Tool:\r\nPurpose: debugging\r\n  pUrPoSe: tests\r\nOutput: a hint\r\nand an example\r\nDecision: rejected it\r\nInfluence:"))
    .toEqual({tool: "", purpose: "debugging\ntests", output: "a hint\nand an example", decision: "rejected it", influence: ""});
  expect(declarationFields("Used Codex for debugging")).toEqual({});
  expect(declarationFields("Tool: Codex\nAn unstructured note").tool).toBe("Codex");
});
test.each([false, true])("draft autofills explicit reflections, retains missing fields and sources, bounded=%s", bounded => {
  const db = openDatabase(":memory:");
  try {
    const add = db.prepare("INSERT INTO ai_declaration(repo,number,declared_by,details,source) VALUES ('a/b',1,?,?,'command')");
    add.run("alice", "Tool: Codex\nPurpose: debugging\nOutput: <hint> @team\nDecision: rewrote it\nInfluence: validation");
    add.run("alice", "Tool: codex\nPurpose: test design");
    add.run("alice", "Tool: Claude\nPurpose: headings");
    add.run("bob", "Tool: Codex\nPurpose: excluded secret");
    const draft = declarationDraft(db, "a/b", "alice", bounded);
    expect(draft).toContain("2. **Purpose of use:** debugging");
    expect(draft).toContain("3. **What the AI produced:** &lt;hint&gt; &#64;team");
    expect(draft).toContain("4. **What I did with that output:** rewrote it");
    expect(draft).toContain("5. **How it influenced the final submission:** validation");
    expect(draft).toContain("#### Tool: Claude");
    expect(draft.match(/^#### Tool: Codex$/gm)).toHaveLength(1);
    expect(draft).not.toContain("#### Tool: codex");
    const second = draft.split("##### Entry 2")[1].split("#### Tool: Claude")[0];
    expect(second).toContain("2. **Purpose of use:** test design");
    expect(second).toContain("3. **What the AI produced:** [describe the actual output]");
    expect(second).not.toContain("rewrote it");
    add.run("alice", "Tool: Codex 2\nPurpose: version-specific");
    expect(declarationDraft(db, "a/b", "alice", bounded)).toContain("#### Tool: Codex 2");
    expect(draft).not.toContain("excluded secret");
    expect(draft).not.toContain("[x]");
    db.prepare("UPDATE ai_declaration SET details = 'Tool: Codex\nPurpose: corrected' WHERE id = 1").run();
    expect(declarationDraft(db, "a/b", "alice")).toContain("2. **Purpose of use:** corrected");
    db.prepare("DELETE FROM ai_declaration WHERE id = 1").run();
    expect(declarationDraft(db, "a/b", "alice")).not.toContain("corrected");
  } finally { db.close(); }
});
