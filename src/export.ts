import {writeFileSync} from "node:fs";
import Database from "better-sqlite3";
import {contributionReport, declarationDraft} from "./reports.js";
import {declarationWord} from "./word.js";

const [kind, repo, output, login, format] = process.argv.slice(2);
if (!['report', 'declaration'].includes(kind) || !repo?.includes('/') || !output ||
  (kind === 'declaration' && !login) || (format && format !== 'bounded')) {
  console.error('Usage: npm run export -- report owner/repo output.md\n       npm run export -- declaration owner/repo output.md login [bounded]\nSet DATABASE_PATH to the existing, migrated database. Output is local; protect its permissions.');
  process.exitCode = 1;
} else {
  const db = new Database(process.env.DATABASE_PATH ?? 'data.sqlite', {readonly: true, fileMustExist: true});
  try {
    const body = kind === 'report' ? contributionReport(db, repo) : declarationDraft(db, repo, login, format === 'bounded');
    if (output.toLowerCase().endsWith('.docx') && kind !== 'declaration') throw new Error('Word export supports declarations only. Use .md for reports.');
    const content = output.toLowerCase().endsWith('.docx') ? await declarationWord(body) : body + '\n';
    writeFileSync(output, content, {flag: 'wx', mode: 0o600});
    console.log('Local export created. No GitHub comment was posted.');
  } finally {db.close();}
}
