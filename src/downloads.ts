import {createHash, randomBytes} from "node:crypto";
import type {IncomingMessage, ServerResponse} from "node:http";
import type Database from "better-sqlite3";

export const DOWNLOAD_TTL = 15 * 60 * 1000;
const hash = (token: string) => createHash("sha256").update(token).digest("hex");
export function downloadBase(value = process.env.PUBLIC_BASE_URL): string | undefined {
  if (!value) return undefined;
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/" ||
      (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))) {
    throw new Error("PUBLIC_BASE_URL must be an HTTPS origin, or http://localhost:3000 for local testing.");
  }
  return url.origin;
}
export function createDownload(db: Database.Database, repo: string, document: Buffer, base: string, now = Date.now()) {
  if (document.length > 5_000_000) throw new Error("Word export exceeds 5 MB; use the local export.");
  db.prepare("DELETE FROM declaration_download WHERE expires_at <= ?").run(now);
  const token = randomBytes(32).toString("hex");
  // Bound saved exports per repo; older links are revoked when requesting many.
  const old = db.prepare("SELECT token_hash FROM declaration_download WHERE repo = ? ORDER BY expires_at DESC LIMIT -1 OFFSET 9").all(repo) as {token_hash: string}[];
  for (const row of old) db.prepare("DELETE FROM declaration_download WHERE token_hash = ?").run(row.token_hash);
  db.prepare("INSERT INTO declaration_download VALUES (?, ?, ?, ?)").run(repo, hash(token), document, now + DOWNLOAD_TTL);
  // The fragment stays out of HTTP access logs. The browser submits it in POST.
  return `${base}/declarations#${token}`;
}
const page = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Downloading AI declaration</title><body><main><p id="status" role="status">Starting your Word download…</p><noscript>JavaScript is needed to start this download. Enable it and reopen the original link.</noscript></main><script>
const token=location.hash.slice(1);history.replaceState(null,'',location.pathname);
(async()=>{const s=document.getElementById('status');try{const r=await fetch('/declarations/download',{method:'POST',headers:{'Content-Type':'text/plain'},body:token});if(!r.ok)throw Error('This link is invalid, expired or revoked. Request a new declaration.');const url=URL.createObjectURL(await r.blob());const a=document.createElement('a');a.href=url;a.download='ai-declaration.docx';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);s.textContent='Download started. You can close this tab.';}catch(e){s.textContent=e.message;}})();
</script></body></html>`;
export function downloadHandler(db: Database.Database) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    const path = req.url?.split("?")[0];
    if (path !== "/declarations" && path !== "/declarations/download") return false;
    res.setHeader("Cache-Control", "no-store"); res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", "default-src 'none'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'");
    if (path === "/declarations" && req.method === "GET") {res.setHeader("Content-Type", "text/html; charset=utf-8"); res.end(page); return true;}
    if (path !== "/declarations/download" || req.method !== "POST") {res.statusCode = 405; res.end("Method not allowed"); return true;}
    let token = "";
    try {
      for await (const chunk of req) {token += chunk.toString(); if (token.length > 128) {res.statusCode = 400; res.end("Invalid token"); return true;}}
      db.prepare("DELETE FROM declaration_download WHERE expires_at <= ?").run(Date.now());
      const row = /^[a-f0-9]{64}$/.test(token) ? db.prepare("SELECT document FROM declaration_download WHERE token_hash = ?").get(hash(token)) as {document: Buffer} | undefined : undefined;
      if (!row) {res.statusCode = 404; res.end("Link expired, invalid or revoked"); return true;}
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      res.setHeader("Content-Disposition", 'attachment; filename="ai-declaration.docx"');
      res.end(row.document); return true;
    } catch {res.statusCode = 500; res.end("Download unavailable. Request a new export."); return true;}
  };
}
