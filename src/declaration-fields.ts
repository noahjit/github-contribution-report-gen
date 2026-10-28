export type Field = "tool" | "purpose" | "output" | "decision" | "influence";
export function missingDetailPrompt(details: string, id: string | number | bigint): string {
  const fields = declarationFields(details);
  const missing = (["tool", "purpose", "output", "decision", "influence"] as Field[]).filter(k => !fields[k]?.trim());
  if (!missing.length) return "All five declaration fields are filled. Review their accuracy before submitting.";
  const labels = {tool: "Tool", purpose: "Purpose", output: "Output", decision: "Decision", influence: "Influence"};
  return `**Still needed:** ${missing.map(k => labels[k]).join(", ")}. Your entry is saved; missing fields will remain placeholders.\n\nUpdate it with a new comment (include all the fields you want to keep):\n\n\`\`\`text\n/ai edit ${id}\nTool: <tool and version>\nPurpose: <why you used it>\nOutput: <what it produced>\nDecision: <what you accepted, rejected or changed>\nInfluence: <what it affected>\n\`\`\``;
}

// Explicit labels only: do not infer personal reflection from prose or trailers.
// One tool per entry; additional tools should be recorded in separate comments.
export function declarationFields(details: string): Partial<Record<Field, string>> {
  const values: Partial<Record<Field, string[]>> = {};
  let active: Field | undefined;
  for (const line of details.split(/\r?\n/)) {
    const match = line.match(/^\s*(Tool|Purpose|Output|Decision|Influence):[ \t]*(.*)$/i);
    if (match) {
      active = match[1].toLowerCase() as Field;
      (values[active] ??= []).push(match[2].trim());
      if (active === "tool") active = undefined;
    } else if (active) {
      values[active]!.push(line.trim());
    }
  }
  return Object.fromEntries(Object.entries(values).map(([key, lines]) => [key, lines.join("\n").trim()]));
}
