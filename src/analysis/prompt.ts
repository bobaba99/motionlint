import { readFile } from "node:fs/promises";

export const DEFAULT_SYSTEM_PROMPT = `You are a senior UX designer and frontend engineer reviewing a screenshot of a web application.

Your job is to identify UI/UX issues comprehensively. Treat this as a structured rubric, NOT a free-form review.

## Procedure (you must do these in order)

### Step 1 — Description (private; do not include in your final response)
Internally describe what you see: page type, dominant elements, layout columns, text density, primary calls-to-action, color palette, viewport hints.

### Step 2 — Walk the rubric
Evaluate EVERY one of the twelve dimensions below. For each, decide whether it is "ok" or has at least one finding. You must produce at least one observation per dimension (either a concrete issue or an explicit "no finding"). Internal note only — your final output will only include the issues, but you must mentally check all twelve before producing the final list.

1.  hierarchy           — heading scale, CTA dominance, eye-flow.
2.  spacing             — whitespace consistency, Gestalt proximity, breathing room, padding/margin rhythm.
3.  alignment           — column alignment, baseline alignment, asymmetric edges.
4.  typography          — body size ≥ 16px / line-height ≥ 1.4, ≤ 4 type sizes, line length 45–75ch.
5.  color               — palette cohesion, meaningful color use, brand consistency.
6.  contrast            — WCAG AA (4.5:1 normal text, 3:1 large/icon), interactive vs. static distinction.
7.  responsiveness      — overflow, mobile tap targets ≥ 48×48 (Material) / 44×44 (HIG), navigation accessibility.
8.  interaction         — visible affordances, hover/focus/disabled states, destructive vs. safe action distinction.
9.  content             — clarity within 5s, label specificity (verb-object), microcopy, jargon, empty states.
10. navigation          — discoverability, active-state visibility, escape hatches (Cancel, X, Back).
11. consistency         — design-system uniformity, identical actions look identical, corner-radius / button language.
12. loading_state       — skeletons, progress indicators, optimistic feedback, "nothing happens" anti-patterns.

### Step 3 — Produce the output

Respond ONLY with valid JSON. Do not include markdown fences, do not include the rubric checklist itself — only the issues array, summary, strengths, and viewport.

For each issue:
- "category": one of [hierarchy, spacing, alignment, typography, color, contrast, responsiveness, interaction, content, navigation, consistency, loading_state]
- "severity": "critical" | "warning" | "suggestion"
  - **critical** = blocks task completion or fails WCAG / known a11y standard
  - **warning** = degrades usability or perceived quality measurably
  - **suggestion** = polish / nice-to-have
- "location": where on the screen (e.g., "above-the-fold hero CTA", "footer link grid")
- "issue": what is wrong (one sentence, concrete)
- "why_it_matters": user-impact in one sentence
- "fix": specific, actionable recommendation. Quote concrete numbers where applicable (e.g., "increase to 16px / 1.5 line-height", "raise contrast to 4.5:1").

## Anti-patterns (DO NOT DO)

- Do NOT pad. If the page is well-designed, return a SHORT issues array (or empty). Inflating the list on a clean page is a confabulation failure.
- Do NOT repeat the same issue under multiple categories. Pick the best-fitting category.
- Do NOT use vague language like "improve the design" — every issue must be measurable or visually verifiable.

## Response shape (strict)

{
  "overall_score": <integer 1-10>,
  "summary": "<2-3 sentence overall assessment>",
  "issues": [
    { "category": "...", "severity": "...", "location": "...", "issue": "...", "why_it_matters": "...", "fix": "..." }
  ],
  "strengths": ["<things done well>"],
  "viewport": "<the viewport this was captured at>"
}`;

export interface PromptOptions {
  viewportName: string;
  customRules?: string | null;
  rulesPath?: string | null;
  /** Pre-computed DOM measurements / outline appended as a JSON block. */
  domSnapshot?: unknown;
  /** Multi-viewport mosaic mode — instructs the model to compare viewports. */
  mosaic?: { viewports: Array<{ name: string; width: number; height: number }> };
  /** Notable page elements with stable refs — lets the model ground findings via "element_ref". */
  elements?: Array<{ ref: string; selector: string; label: string; rect: { x: number; y: number; w: number; h: number } }>;
  /** Interaction-state grid mode — the image is a grid of element states, not a page. */
  stateGrid?: { states: readonly string[]; elements: string[] };
  /** Learned heuristics distilled from eval misses (bullet lines), carried into the rubric. */
  learned?: string | null;
}

export async function buildPrompt(opts: PromptOptions): Promise<string> {
  const parts: string[] = [DEFAULT_SYSTEM_PROMPT];

  if (opts.rulesPath) {
    try {
      const extra = (await readFile(opts.rulesPath, "utf8")).trim();
      if (extra) parts.push(`\n\n## Project-specific design rules\n${extra}`);
    } catch {
      /* ignore */
    }
  } else if (opts.customRules) {
    parts.push(`\n\n## Project-specific design rules\n${opts.customRules.trim()}`);
  }

  if (opts.mosaic) {
    parts.push(
      `\n\n## Multi-viewport mosaic mode\n` +
      `This image stacks captures from multiple viewports vertically: ${opts.mosaic.viewports.map((v) => `${v.name} ${v.width}x${v.height}`).join(", ")}. ` +
      `When you find an issue, indicate which viewport it appears on in the location field (prefix like "[mobile]" or "[desktop]"). ` +
      `Pay special attention to issues that exist on one viewport but not another (overflow, sticky elements covering content, tap targets too small only on mobile).`,
    );
  }

  if (opts.domSnapshot) {
    parts.push(
      `\n\n## DOM measurements (ground truth — do not trust pixels alone)\n` +
      `The following JSON contains computed measurements extracted from the live page. Treat it as authoritative for sizes, counts, and overflow. Cross-check your visual judgment against it.\n` +
      "```json\n" + JSON.stringify(opts.domSnapshot, null, 2) + "\n```",
    );
  }

  if (opts.learned) {
    parts.push(
      `\n\n## Learned heuristics (distilled from prior eval runs)\n` +
      `Past evaluations show these issue patterns are easy to miss on this rubric. Check each one deliberately:\n` +
      opts.learned.trim(),
    );
  }

  if (opts.stateGrid) {
    parts.push(
      `\n\n## Interaction-state grid mode\n` +
      `This image is NOT a page screenshot. It is a grid: each row is one interactive element (${opts.stateGrid.elements.map((e) => `"${e}"`).join(", ")}), ` +
      `and the columns show that element in its ${opts.stateGrid.states.join(" / ")} states, captured live.\n` +
      `Judge ONLY interaction affordances by comparing columns within each row: does hover give visible feedback, is the focus ring clearly visible (WCAG 2.4.7), does active/pressed state respond, are the states distinguishable from each other and from default? ` +
      `Report findings under the "interaction" category (or "contrast" for low-visibility focus indicators), naming the element row in the location field. ` +
      `Ignore layout/typography/spacing dimensions — the grid's own chrome is not the subject.`,
    );
  }

  if (opts.elements?.length) {
    const lines = opts.elements.map(
      (e) => `${e.ref} — <${e.selector}> "${e.label}" at (${e.rect.x}, ${e.rect.y}) ${e.rect.w}×${e.rect.h}px`,
    );
    parts.push(
      `\n\n## Interactive elements (stable refs)\n` +
      `These elements were measured on the live page (document coordinates, CSS px):\n` +
      lines.join("\n") +
      `\n\nWhen an issue concerns one of these elements, add "element_ref": "<ref>" (e.g. "element_ref": "E3") to that issue object so the finding can be drawn on the screenshot. Omit it when no listed element fits.`,
    );
  }

  parts.push(`\n\nThis screenshot was captured at the "${opts.viewportName}" viewport.`);
  return parts.join("");
}
