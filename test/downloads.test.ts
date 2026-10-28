import {createServer} from "node:http";
import {afterEach, beforeEach, expect, test} from "vitest";
import {openDatabase, deleteRepository} from "../src/db.js";
import {createDownload, downloadBase, downloadHandler, DOWNLOAD_TTL} from "../src/downloads.js";
import {declarationWord} from "../src/word.js";
import {declarationDraft} from "../src/reports.js";
import JSZip from "jszip";
let db: ReturnType<typeof openDatabase>;
beforeEach(() => db = openDatabase(":memory:")); afterEach(() => db.close());
test("Word file contains editable text, headings, multiple entries and unchecked declarations", async () => {
  db.exec(`INSERT INTO ai_declaration(repo,number,declared_by,details,source) VALUES ('a/b',2,'alice','Tool: Codex\nPurpose: test <input> & values','command'), ('a/b',3,'alice','Tool: Claude\nDecision: rejected it','command');`);
  const bytes = await declarationWord(declarationDraft(db, "a/b", "alice", true));
  const zip = await JSZip.loadAsync(bytes), xml = await zip.file("word/document.xml")!.async("string");
  expect(xml).toContain("test &lt;input&gt; &amp; values"); expect(xml).toContain("rejected it");
  expect(xml).toContain("☐"); expect(xml).not.toContain("**"); expect(xml).not.toContain("&lt;details&gt;");
  expect(xml).toContain('w:pStyle w:val="Title"');
});
test("download origin is explicit and safe", () => {
  expect(downloadBase("http://localhost:3000")).toBe("http://localhost:3000");
  for (const url of ["http://public.example", "https://user:secret@host.example", "https://host.example/path", "https://host.example?token=x"]) expect(() => downloadBase(url)).toThrow();
});
test("HTTP download rejects invalid/expired tokens and revokes files on removal", async () => {
  const handler = downloadHandler(db);
  const server = createServer((req, res) => {void handler(req, res).then(handled => {if (!handled) {res.statusCode = 404; res.end();}});});
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as {port: number}, origin = `http://127.0.0.1:${address.port}`;
  const post = (token: string) => fetch(origin + "/declarations/download", {method: "POST", body: token});
  try {
    const link = createDownload(db, "a/b", Buffer.from("docx-bytes"), origin);
    const token = link.split("#")[1];
    const stored = db.prepare("SELECT token_hash FROM declaration_download").get() as {token_hash:string};
    expect(stored.token_hash).not.toBe(token);
    const page = await fetch(origin + "/declarations"); expect(page.headers.get("cache-control")).toBe("no-store");
    expect(await page.text()).not.toContain(token);
    const good = await post(token); expect(good.status).toBe(200); expect(await good.text()).toBe("docx-bytes");
    expect((await post("bad")).status).toBe(404);
    const expired = createDownload(db, "a/b", Buffer.from("old"), origin, Date.now() - DOWNLOAD_TTL - 1);
    expect((await post(expired.split("#")[1])).status).toBe(404);
    deleteRepository(db, "a/b"); expect((await post(token)).status).toBe(404);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
