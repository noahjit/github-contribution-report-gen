import type Database from "better-sqlite3";
export function repositoryWeights(db: Database.Database, repo: string): Weights {
  const row = db.prepare("SELECT weights FROM repository_weights WHERE repo = ?").get(repo) as {weights: string} | undefined;
  return configuredWeights(row?.weights);
}
export type Activity = {author: string; merged: number; commits: number; reviews: number};
export type Weights = [number, number, number];
export function configuredWeights(value = process.env.ACTIVITY_WEIGHTS): Weights {
  if (value === undefined) return [40, 30, 30];
  const weights = value.split(",").map(Number);
  if (weights.length !== 3 || value.split(",").some(v => !v.trim()) ||
      weights.some(v => !Number.isFinite(v) || v < 0 || v > 10000) || !weights.some(v => v > 0)) {
    throw new Error("ACTIVITY_WEIGHTS must contain three nonnegative numbers (merged PRs, commits, reviews), with at least one positive value; maximum 10000 each.");
  }
  return weights as Weights;
}

export function activityShares(activity: Activity[], weights: Weights) {
  const people = new Map<string, Activity>();
  for (const a of activity) {
    const key = a.author.toLowerCase();
    if (key === "unknown" || key.endsWith("[bot]")) continue;
    const row = people.get(key) ?? {author: key, merged: 0, commits: 0, reviews: 0};
    row.merged += a.merged; row.commits += a.commits; row.reviews += a.reviews;
    people.set(key, row);
  }
  const rows = [...people.values()].sort((a, b) => a.author.localeCompare(b.author));
  const totals = [rows.reduce((n, a) => n + a.merged, 0), rows.reduce((n, a) => n + a.commits, 0), rows.reduce((n, a) => n + a.reviews, 0)];
  const active = weights.map((w, i) => totals[i] > 0 ? w : 0);
  const totalWeight = active.reduce((a, b) => a + b, 0);
  const effective = active.map(w => totalWeight ? w / totalWeight : 0);
  const result = rows.map(a => {
    const shares = [a.merged, a.commits, a.reviews].map((n, i) => totals[i] ? n / totals[i] : null);
    const exact = shares.reduce<number>((n, share, i) => n + (share ?? 0) * effective[i], 0) * 1000;
    return {...a, shares, units: Math.floor(exact), remainder: exact - Math.floor(exact)};
  });
  // Allocate tenths of a percent with largest remainders so display totals 100.0%.
  const remaining = totalWeight ? 1000 - result.reduce((n, a) => n + a.units, 0) : 0;
  const ranked = [...result].sort((a, b) => b.remainder - a.remainder || a.author.localeCompare(b.author));
  for (let i = 0; i < remaining; i++) ranked[i % ranked.length].units++;
  return {effective, available: totalWeight > 0, rows: result.sort((a, b) => b.units - a.units || a.author.localeCompare(b.author))};
}
