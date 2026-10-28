import {beforeEach, afterEach, expect, test} from "vitest";
import {openDatabase, deleteRepository} from "../src/db.js";
import {publishSnapshot, recordConfirmation, confirmationSummary} from "../src/confirmations.js";
import {missingDetailPrompt} from "../src/declaration-fields.js";
let db: ReturnType<typeof openDatabase>;
beforeEach(() => {db = openDatabase(":memory:");}); afterEach(() => db.close());
test("prompts name missing fields without losing free text, complete entries pass", () => {
  expect(missingDetailPrompt("Tool: Codex\nPurpose: bugs", 7)).toContain("**Still needed:** Output, Decision, Influence");
  expect(missingDetailPrompt("free prose", 7)).toContain("/ai edit 7");
  expect(missingDetailPrompt("Tool: Codex\nPurpose: bugs\nOutput: hint\nDecision: revised\nInfluence: tests", 1)).toContain("All five");
});
test("confirmations belong to a snapshot and PR; changes require renewed review", () => {
  const {id} = publishSnapshot(db, "a/b", 2);
  expect(recordConfirmation(db, "a/b", 2, id, "alice", "confirmed")).toContain("Confirmed");
  expect(recordConfirmation(db, "a/b", 2, id, "bob", "flagged", "<tag> @everyone | note")).toContain("Flagged");
  const summary = confirmationSummary(db, "a/b", 2, id);
  expect(summary).not.toContain("<tag>"); expect(summary).not.toContain("@everyone");
  expect(recordConfirmation(db, "a/b", 3, id, "alice", "confirmed")).toContain("not found");
  expect(recordConfirmation(db, "other/repo", 2, id, "alice", "confirmed")).toContain("not found");
  db.prepare("INSERT INTO repository_weights VALUES ('a/b', '50,20,30')").run();
  expect(recordConfirmation(db, "a/b", 2, id, "alice", "confirmed")).toContain("out of date");
  expect(confirmationSummary(db, "a/b", 2, id)).toContain("out of date");
  const next = publishSnapshot(db, "a/b", 2); expect(next.id).not.toBe(id);
  expect(confirmationSummary(db, "a/b", 2, next.id)).toContain("No responses yet");
  deleteRepository(db, "a/b"); expect(confirmationSummary(db, "a/b", 2, id)).toContain("not found");
});
test("one response per member can be changed from flag to confirmation", () => {
  const {id} = publishSnapshot(db, "a/b", 2);
  recordConfirmation(db, "a/b", 2, id, "alice", "flagged", "missing work");
  recordConfirmation(db, "a/b", 2, id, "Alice", "confirmed");
  const summary = confirmationSummary(db, "a/b", 2, id);
  expect(summary).not.toContain("missing work"); expect(summary).not.toContain("Flagged");
  expect(publishSnapshot(db, "a/b", 2).id).toBe(id);
});
