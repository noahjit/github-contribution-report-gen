import {createHash, randomBytes} from "node:crypto";
import type Database from "better-sqlite3";
import type {IncomingMessage} from "node:http";

export const sessionHash = (token: string) => createHash("sha256").update(token).digest("hex");
export const secret = () => randomBytes(32).toString("hex");
export type DashboardSession = {token_hash: string; login: string; kind: "operator" | "github"; csrf: string; expires_at: number; bootstrap: number};
export function createDashboardSession(db: Database.Database, login: string, kind: DashboardSession["kind"], bootstrap = false) {
  db.prepare("DELETE FROM dashboard_session WHERE expires_at <= ?").run(Date.now());
  const token = secret(), csrf = secret(), expires = Date.now() + (bootstrap ? 600_000 : 8 * 3600_000);
  db.prepare("INSERT INTO dashboard_session VALUES (?, ?, ?, ?, ?, ?)").run(sessionHash(token), login, kind, csrf, expires, bootstrap ? 1 : 0);
  return {token, csrf};
}
export function cookieValue(req: IncomingMessage, name: string) {
  return req.headers.cookie?.split(";").map(v => v.trim()).find(v => v.startsWith(name + "="))?.slice(name.length + 1) ?? "";
}
export function dashboardSession(db: Database.Database, req: IncomingMessage): DashboardSession | undefined {
  const token = cookieValue(req, "gc_dashboard");
  if (!/^[a-f0-9]{64}$/.test(token)) return undefined;
  return db.prepare("SELECT * FROM dashboard_session WHERE token_hash = ? AND expires_at > ? AND bootstrap = 0").get(sessionHash(token), Date.now()) as DashboardSession | undefined;
}
