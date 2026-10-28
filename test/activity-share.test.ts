import {expect, test} from "vitest";
import {activityShares, configuredWeights} from "../src/activity-share.js";
test("weighted shares match the example and normalize author capitalization", () => {
  const result = activityShares([
    {author: "Alice", merged: 1, commits: 2, reviews: 1},
    {author: "alice", merged: 0, commits: 0, reviews: 0},
    {author: "bob", merged: 1, commits: 3, reviews: 4},
  ], [40,30,30]);
  expect(result.rows.find(a => a.author === "alice")?.units).toBe(380);
  expect(result.rows.reduce((sum, a) => sum + a.units, 0)).toBe(1000);
});
test("redistributes missing categories and handles empty or disabled categories", () => {
  const data = [{author: "a", merged: 0, commits: 1, reviews: 0}];
  expect(activityShares(data, [40,30,30]).effective).toEqual([0,1,0]);
  expect(activityShares(data, [40,30,30]).rows[0].units).toBe(1000);
  expect(activityShares(data, [100,0,0]).available).toBe(false);
  expect(activityShares([], [40,30,30]).available).toBe(false);
});
test("thirds sum to 100.0 and bots/unknown do not dilute shares", () => {
  const result = activityShares(["a","b","c","dependabot[bot]","unknown"].map(author => ({author, merged:0, commits:1, reviews:0})), [40,30,30]);
  expect(result.rows.map(a => a.units)).toEqual([334,333,333]);
});
test("weight configuration rejects bad settings", () => {
  expect(configuredWeights("4,3,3")).toEqual([4,3,3]);
  for (const value of ["", "0,0,0", "-1,2,3", "NaN,2,3", "1,2", "1,,3", "Infinity,1,1"]) expect(() => configuredWeights(value)).toThrow("ACTIVITY_WEIGHTS");
});
