import type { Locator, Page } from "./playwright.ts";

// What the demo and the QA share when they drive a page from a JSON file an agent wrote: how a
// step names what it taps, types into or chooses, and how a step is checked before it runs.

/** What a step taps: a visible text, or a CSS selector when no text tells it apart. */
export type Target =
  | string
  | { readonly text?: string; readonly selector?: string; readonly nth?: number };

/** A form field by its label, or by a selector when no label tells it apart. */
export interface Field {
  readonly label?: string;
  readonly selector?: string;
}

type FillStep = { readonly fill: Field & { readonly value: string } };
/** A dropdown: the browser's own option list is not drawn, so the choice is set directly. */
type SelectStep = { readonly select: Field & { readonly option: string } };

/** The steps both files share: going somewhere, tapping, typing, choosing, a key, a pause. */
export type PageStep =
  | { readonly go: string }
  | { readonly click: Target }
  | FillStep
  | SelectStep
  | { readonly press: string }
  | { readonly wait: number };

export const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const isText = (value: unknown): value is string =>
  typeof value === "string" && value !== "";

export const needsText = (kind: string) => (value: unknown) =>
  isText(value) ? undefined : `${kind} needs a text`;

/**
 * What is wrong with the top of a file an agent wrote: its `title`, and the `app.url` its steps go
 * to. `app.start` is refused with `startHint`: an agent that writes the file must not choose what a
 * command runs on the user's machine.
 */
export function headerProblems(raw: Record<string, unknown>, startHint: string): string[] {
  const problems: string[] = [];
  if (!isText(raw.title)) problems.push("needs a `title`");
  const app = isObject(raw.app) ? raw.app : {};
  if (!isText(app.url) || !/^https?:\/\//.test(app.url))
    problems.push("`app.url` must be an http(s) address");
  if (app.start !== undefined) problems.push(`\`app.start\` is not read from ${startHint}`);
  return problems;
}

/** A check of one step's value: what is wrong with it, or `undefined` when it is valid. */
export type StepCheck = (value: unknown) => string | undefined;

/** The checks of the steps every file shares, by kind of step. */
export const PAGE_STEP_CHECKS: Record<string, StepCheck> = {
  go: needsText("go"),
  press: needsText("press"),
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
  select: (value) => {
    const select = isObject(value) ? value : {};
    const where = isText(select.label) || isText(select.selector);
    return where && isText(select.option)
      ? undefined
      : "select needs `label` or `selector`, and the `option` to choose";
  },
};

/**
 * What is wrong with a step, or `undefined` when it is valid: it has exactly one of the kinds in
 * `checks`, a valid value for it, and no other key than the `modifiers` allowed beside it.
 */
export function stepProblem(
  step: unknown,
  checks: Record<string, StepCheck>,
  modifiers: readonly string[] = [],
): string | undefined {
  if (!isObject(step)) return 'must be an object such as { "go": "/" }';
  const kinds = Object.keys(step).filter((key) => Object.hasOwn(checks, key));
  const kind = kinds[0];
  if (kinds.length !== 1 || kind === undefined)
    return `must have exactly one of ${Object.keys(checks).join(", ")}`;
  const unknown = Object.keys(step).filter((key) => key !== kind && !modifiers.includes(key));
  if (unknown.length > 0) return `unknown key ${unknown.map((k) => `\`${k}\``).join(", ")}`;
  return (checks[kind] as StepCheck)(step[kind]);
}

/** The element a step taps: by its visible text among what can be tapped, or as the target says. */
export function locate(page: Page, target: Target): Locator {
  if (typeof target === "string") {
    return page
      .locator("a, button, [role=button], label, summary, input[type=submit]")
      .filter({ hasText: target })
      .first();
  }
  if (target.selector) return page.locator(target.selector).nth(target.nth ?? 0);
  return page.getByText(target.text ?? "").nth(target.nth ?? 0);
}

/** A form field by its label, or by a selector when no label tells it apart. */
export const field = (page: Page, where: Field): Locator =>
  where.label ? page.getByLabel(where.label).first() : page.locator(where.selector ?? "").first();
