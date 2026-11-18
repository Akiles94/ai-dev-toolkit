import { type Device, SCREENS } from "../shared/browser/playwright.ts";
import {
  headerProblems,
  isObject,
  isText,
  PAGE_STEP_CHECKS,
  type PageStep,
  type StepCheck,
  stepProblem,
} from "../shared/browser/steps.ts";
import { fail, ok, type Result } from "../shared/result/result.ts";

/** A call to the app as a person, with their cookies: what a client that skips the page can do. */
export interface ApiCall {
  readonly method?: string;
  readonly path: string;
  readonly body?: unknown;
}

/** What only a QA walk does: the ways a person leaves the happy path, and what it looks at. */
type QaStep =
  | { readonly back: true }
  | { readonly reload: true }
  | { readonly look: string }
  | { readonly keep: Readonly<Record<string, string>> }
  | { readonly request: ApiCall }
  | { readonly offline: boolean }
  | { readonly clear: "cookies" | "storage" };

/** Beside its action, a step may say who does it (`as`); a click may be repeated (`times`). */
interface Modifiers {
  readonly as?: string;
  readonly times?: number;
}

export type WalkStep = (PageStep | QaStep) & Modifiers;

interface Person {
  readonly device: Device;
}

/**
 * A walk as the QA agent writes it and `aidt qa walk` plays it: committed with the report, it is
 * how a finding is reproduced from a known state, and where its end-to-end test starts.
 */
export interface Walk {
  readonly title: string;
  readonly app: { readonly url: string };
  /** Each person has a browser context of their own; the first one does every step without `as`. */
  readonly people: Readonly<Record<string, Person>>;
  readonly steps: readonly WalkStep[];
}

/** A call the page made during a step: its status, or why it failed. */
export interface Call {
  readonly method: string;
  readonly path: string;
  readonly status: number | string;
}

/** What the app answered to one step: everything a QA reads to judge it. */
export interface StepLog {
  readonly n: number;
  readonly person: string;
  readonly step: string;
  readonly url: string;
  readonly calls: readonly Call[];
  readonly consoleErrors: readonly string[];
  readonly pageErrors: readonly string[];
  /** A `request`'s status and body, or what a `keep` kept. */
  readonly answer?: string;
  readonly screenshot?: string;
  readonly text?: string;
  readonly failure?: string;
}

export interface WalkLog {
  readonly title: string;
  readonly url: string;
  readonly steps: readonly StepLog[];
  readonly stopped: boolean;
}

const CALL_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];
const NAME = /^[A-Za-z_]\w*$/;

/** For each kind of step, what is wrong with its value, or `undefined` when it is valid. */
const STEP_CHECKS: Record<string, StepCheck> = {
  ...PAGE_STEP_CHECKS,
  back: (value) => (value === true ? undefined : "back is `true`"),
  reload: (value) => (value === true ? undefined : "reload is `true`"),
  look: (value) => (isText(value) ? undefined : "look needs what to look at, as a text"),
  keep: (value) =>
    isObject(value) &&
    Object.keys(value).length > 0 &&
    Object.entries(value).every(([name, expression]) => NAME.test(name) && isText(expression))
      ? undefined
      : "keep needs names (letters, digits, _) and the page expression each one keeps",
  request: (value) => {
    const call = isObject(value) ? value : {};
    const method = call.method ?? "GET";
    return isText(call.path) && typeof method === "string" && CALL_METHODS.includes(method)
      ? undefined
      : `request needs a \`path\`, and a \`method\` among ${CALL_METHODS.join(", ")}`;
  },
  offline: (value) => (typeof value === "boolean" ? undefined : "offline is `true` or `false`"),
  clear: (value) =>
    value === "cookies" || value === "storage" ? undefined : "clear is `cookies` or `storage`",
};

/** What is wrong with the modifiers of a step, given the people the walk has. */
function modifierProblem(step: Record<string, unknown>, people: readonly string[]) {
  if (step.as !== undefined && !people.includes(step.as as string))
    return `\`as\` names nobody in \`people\` (${people.join(", ")})`;
  if (step.times === undefined) return undefined;
  if (!("click" in step)) return "`times` goes with a click";
  const times = step.times;
  return Number.isInteger(times) && (times as number) >= 1 && (times as number) <= 5
    ? undefined
    : "`times` is a whole number from 1 to 5";
}

function peopleOf(raw: unknown, problems: string[]): Record<string, Person> {
  if (raw === undefined) return { person: { device: "desktop" } };
  if (!isObject(raw) || Object.keys(raw).length === 0) {
    problems.push('`people` names each person, such as { "shopper": { "device": "phone" } }');
    return {};
  }
  const people: Record<string, Person> = {};
  for (const [name, person] of Object.entries(raw)) {
    const device = isObject(person) ? (person.device ?? "desktop") : undefined;
    if (!NAME.test(name) || typeof device !== "string" || !(device in SCREENS))
      problems.push(
        `person ${name}: a name of letters, digits or _, with a \`device\` of desktop or phone`,
      );
    else people[name] = { device: device as Device };
  }
  return people;
}

/** Checks a walk read from JSON; every problem is reported at once, with where it is. */
export function parseWalk(raw: unknown): Result<Walk, string[]> {
  if (!isObject(raw)) return fail(["the walk must be a JSON object"]);
  const problems = headerProblems(raw, "a walk: start the app as .aidt/app.md says");
  const people = peopleOf(raw.people, problems);
  const names = Object.keys(people);
  if (!Array.isArray(raw.steps) || raw.steps.length === 0) problems.push("needs at least one step");
  else
    raw.steps.forEach((step, i) => {
      const problem =
        stepProblem(step, STEP_CHECKS, ["as", "times"]) ??
        modifierProblem(step as Record<string, unknown>, names);
      if (problem) problems.push(`step ${i + 1}: ${problem}`);
    });
  if (problems.length > 0) return fail(problems);
  return ok({ ...(raw as unknown as Walk), people });
}

/**
 * `text` with every `{name}` replaced by the value kept under that name; the first name nothing
 * was kept under is an error, so a step never runs with a hole in it.
 */
export function fillIn(text: string, kept: ReadonlyMap<string, string>): Result<string, string> {
  const missing = [...text.matchAll(/\{([A-Za-z_]\w*)\}/g)].find(
    ([, name]) => !kept.has(name ?? ""),
  );
  if (missing) return fail(`nothing was kept as {${missing[1]}} before this step`);
  return ok(text.replace(/\{([A-Za-z_]\w*)\}/g, (_, name: string) => kept.get(name) ?? ""));
}

/** One step in words, for the walk's log. */
export function describeStep(step: WalkStep): string {
  const [kind, value] = Object.entries(step).find(([key]) => key !== "as" && key !== "times") ?? [];
  const times = step.times && step.times > 1 ? ` ×${step.times}` : "";
  if (kind === "go" || kind === "press" || kind === "clear") return `${kind} ${value}`;
  if (kind === "back" || kind === "reload") return kind;
  if (kind === "wait") return `wait ${value} ms`;
  if (kind === "offline") return value ? "offline" : "online";
  if (kind === "look") return `look «${value}»`;
  if (kind === "keep") return `keep ${Object.keys(value as object).join(", ")}`;
  if (kind === "request") {
    const call = value as ApiCall;
    return `request ${call.method ?? "GET"} ${call.path}`;
  }
  return `${kind} ${JSON.stringify(value)}${times}`;
}
