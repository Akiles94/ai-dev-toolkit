import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = import.meta.dirname;
const SHARED = "shared";

/** Every TypeScript file under `dir`, recursively. */
function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return files(path);
    return entry.name.endsWith(".ts") ? [path] : [];
  });
}

/** The top-level folder under `src/` a file belongs to, or `""` for files at the root (cli.ts). */
const areaOf = (path: string): string => {
  const parts = relative(SRC, path).split(sep);
  return parts.length > 1 ? (parts[0] ?? "") : "";
};

/** Imports of a file that point inside `src/`, resolved to the area they land in. */
function importedAreas(path: string): string[] {
  const source = readFileSync(path, "utf8");
  const specifiers = [...source.matchAll(/from "(\.{1,2}\/[^"]+)"/g)].map((m) => m[1] ?? "");
  return specifiers.map((specifier) => areaOf(join(path, "..", specifier)));
}

const violations = (allowed: (from: string, to: string) => boolean) =>
  files(SRC)
    .filter((path) => areaOf(path) !== "")
    .flatMap((path) =>
      importedAreas(path)
        .filter((to) => !allowed(areaOf(path), to))
        .map((to) => `${relative(SRC, path)} → ${to || "cli.ts"}`),
    );

describe("architecture", () => {
  it("a flow imports only itself and shared; cli.ts is the only place that composes flows", () => {
    expect(violations((from, to) => to === from || to === SHARED)).toEqual([]);
  });

  it("shared imports no flow", () => {
    expect(violations((from, to) => from !== SHARED || to === SHARED)).toEqual([]);
  });
});
