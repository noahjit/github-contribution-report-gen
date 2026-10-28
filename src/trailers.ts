const AI_PATTERNS = [
  /\bclaude\b/i,
  /\banthropic\b/i,
  /\bcopilot\b/i,
  /\bcursor\b/i,
  /\bcodex\b/i,
  /\bopenai\b/i,
  /\bgemini\b/i,
  /\baider\b/i,
];

export function findAiCoAuthors(message: string): string[] {
  const found: string[] = [];
  const re = /^co-authored-by:[ \t]*(.+?)[ \t]*<([^>\r\n]*)>[ \t]*$/gim;
  for (const m of message.matchAll(re)) {
    const name = m[1];
    const email = m[2];
    if (AI_PATTERNS.some((p) => p.test(name) || p.test(email))) {
      found.push(name);
    }
  }
  return [...new Set(found)];
}
