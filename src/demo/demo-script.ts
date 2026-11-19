import {
  headerProblems,
  isObject,
  isText,
  needsText,
  PAGE_STEP_CHECKS,
  type PageStep,
  type StepCheck,
  stepProblem,
} from "../shared/browser/steps.ts";
import { fail, ok, type Result } from "../shared/result/result.ts";

/** One thing the demo does on screen, or says. */
export type Step = PageStep | { readonly say: string } | { readonly scroll: string };

/** A part of the demo with a title, shown in the PR text: the main path first, then «other paths». */
interface Scene {
  readonly title: string;
  readonly steps: readonly Step[];
}

/** Where the browser points; the command that starts the product is `demo.start` in the config. */
interface AppLaunch {
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

/** For each kind of step, what is wrong with its value, or `undefined` when it is valid. */
const STEP_CHECKS: Record<string, StepCheck> = {
  ...PAGE_STEP_CHECKS,
  say: needsText("say"),
  scroll: needsText("scroll"),
};

function sceneProblems(scene: unknown, index: number): string[] {
  const where = `scene ${index + 1}`;
  if (!isObject(scene) || !isText(scene.title) || !Array.isArray(scene.steps)) {
    return [`${where}: needs a \`title\` and a list of \`steps\``];
  }
  return scene.steps.flatMap((step, i) => {
    const problem = stepProblem(step, STEP_CHECKS);
    return problem ? [`${where}, step ${i + 1}: ${problem}`] : [];
  });
}

/** Checks a script read from JSON; every problem is reported at once, with where it is. */
export function parseScript(raw: unknown): Result<DemoScript, string[]> {
  if (!isObject(raw)) return fail(["the script must be a JSON object"]);
  const problems = headerProblems(raw, "a script: set `demo.start` in .aidt/config.json");
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
