/** The requirement ids of a spec (`- **R1** …` under `## Requirements`), in order. */
export function requirementIds(spec: string): string[] {
  const withoutComments = spec.replace(/<!--[\s\S]*?-->/g, "");
  const section = withoutComments.split(/^## Requirements\s*$/m)[1]?.split(/^## /m)[0] ?? "";
  const ids = [...section.matchAll(/\*\*(R\d+)\*\*/g)].map((m) => m[1] as string);
  return [...new Set(ids)];
}

/** The requirements no test mentions: a test references one by its id (`R2: blocks…`). */
export function untestedRequirements(ids: readonly string[], tests: readonly string[]): string[] {
  return ids.filter((id) => !tests.some((text) => new RegExp(`\\b${id}\\b`).test(text)));
}
