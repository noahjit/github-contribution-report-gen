export type Field = "tool" | "purpose" | "output" | "decision" | "influence";

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
