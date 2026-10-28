import {expect, test} from "vitest";
import {githubDiagnostic} from "../src/diagnostics.js";
test("logs GitHub rejection reason and diagnostic headers without request secrets", () => {
  const result = githubDiagnostic({status: 403, message: "private request body", request: {headers: {authorization: "secret"}}, response: {
    data: {message: "Resource not accessible by integration", extra: "private-data"},
    headers: {"x-github-request-id": "123", "x-accepted-github-permissions": "pull_requests=write", "x-ratelimit-remaining": "0", "retry-after": "60", authorization: "secret"},
  }});
  expect(result.githubMessage).toBe("Resource not accessible by integration");
  expect(result.acceptedPermissions).toBe("pull_requests=write");
  expect(result.retryAfter).toBe("60");
  expect(JSON.stringify(result)).not.toMatch(/secret|private/);
  expect(githubDiagnostic(new Error("secret"))).not.toHaveProperty("githubMessage", "secret");
});
