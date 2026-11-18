import { fail, ok, type Result } from "../shared/result/result.ts";

/** What a step taps: a visible text, or a CSS selector when no text tells it apart. */
export type Target =
  | string
  | { readonly text?: string; readonly selector?: string; readonly nth?: number };

/** One thing the demo does on screen, or says. */
export type Step =
  | { readonly go: string }
  | { readonly say: string }
  | { readonly click: Target }
  | {
      readonly fill: {
        readonly label?: string;
        readonly selector?: string;
        readonly value: string;
      };
    }
  | { readonly press: string }
  | { readonly scroll: string }
  | { readonly wait: number };

/** A part of the demo with a title, shown in the PR text: the main path first, then «other paths». */
interface Scene {
  readonly title: string;
  readonly steps: readonly Step[];
}

/** How to bring the product up for the recording, and where to point the browser. */
interface AppLaunch {
  /** Shell command that starts it, stopped when the recording ends; none if it is already up. */
  readonly start?: string;
  /** Base address every `go` path is relative to. */
  readonly url: string;
}

/**
 * A demo as the agent writes it and `aidt demo render` records it: committed with the task, it is
 * what makes a new video cost no tokens.
 */
export interface DemoScript {
  readonly title: string;
  readonly app: AppLaunch;
  /** `desktop` (1280 × 720) or `phone` (390 × 844 at twice the pixels). */
  readonly device: "desktop" | "phone";
  readonly scenes: readonly Scene[];
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isText = (value: unknown): value is string => typeof value === "string" && value !== "";

const needsText = (kind: string) => (value: unknown) =>
  isText(value) ? undefined : `${kind} needs a text`;

/** For each kind of step, what is wrong with its value, or `undefined` when it is valid. */
const STEP_CHECKS: Record<string, (value: unknown) => string | undefined> = {
  go: needsText("go"),
  say: needsText("say"),
  press: needsText("press"),
  scroll: needsText("scroll"),
  wait: (value) => (typeof value === "number" && value > 0 ? undefined : "wait needs milliseconds"),
  click: (value) =>
    isText(value) || (isObject(value) && (isText(value.text) || isText(value.selector)))
      ? undefined
      : "click needs a text, or an object with `text` or `selector`",
  fill: (value) => {
    const fill = isObject(value) ? value : {};
    const where = isText(fill.label) || isText(fill.selector);
    return where && typeof fill.value === "string"
      ? undefined
      : "fill needs `label` or `selector`, and `value`";
  },
};

/** What is wrong with one step, or `undefined` when it is valid. */
function stepProblem(step: unknown): string | undefined {
  if (!isObject(step)) return 'must be an object such as { "say": "…" }';
  const kinds = Object.keys(step);
  const check = kinds.length === 1 ? STEP_CHECKS[kinds[0] as string] : undefined;
  if (!check) return `must have exactly one of ${Object.keys(STEP_CHECKS).join(", ")}`;
  return check(step[kinds[0] as string]);
}

function sceneProblems(scene: unknown, index: number): string[] {
  const where = `scene ${index + 1}`;
  if (!isObject(scene) || !isText(scene.title) || !Array.isArray(scene.steps)) {
    return [`${where}: needs a \`title\` and a list of \`steps\``];
  }
  return scene.steps.flatMap((step, i) => {
    const problem = stepProblem(step);
    return problem ? [`${where}, step ${i + 1}: ${problem}`] : [];
  });
}

/** Checks a script read from JSON; every problem is reported at once, with where it is. */
export function parseScript(raw: unknown): Result<DemoScript, string[]> {
  if (!isObject(raw)) return fail(["the script must be a JSON object"]);
  const problems: string[] = [];
  if (!isText(raw.title)) problems.push("needs a `title`");
  const app = isObject(raw.app) ? raw.app : {};
  if (!isText(app.url) || !/^https?:\/\//.test(app.url))
    problems.push("`app.url` must be an http(s) address");
  if (app.start !== undefined && !isText(app.start)) problems.push("`app.start` must be a command");
  const device = raw.device ?? "desktop";
  if (device !== "desktop" && device !== "phone") problems.push("`device` is `desktop` or `phone`");
  if (!Array.isArray(raw.scenes) || raw.scenes.length === 0)
    problems.push("needs at least one scene");
  else problems.push(...raw.scenes.flatMap(sceneProblems));
  if (problems.length > 0) return fail(problems);
  return ok({ ...(raw as unknown as DemoScript), device: device as DemoScript["device"] });
}

/** Every line the voice says, in order: what the subtitles and the PR text show. */
export const narration = (script: DemoScript): string[] =>
  script.scenes.flatMap((scene) =>
    scene.steps.flatMap((step) => ("say" in step ? [step.say] : [])),
  );
