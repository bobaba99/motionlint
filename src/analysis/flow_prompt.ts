import type { FlowSpec, FlowStepResult } from "../flow/types.js";
import { ANIMATION_STANDARDS_PROMPT } from "./animation_standards.js";

const FLOW_SYSTEM_PROMPT = `You are a senior UX designer and frontend engineer reviewing a USER FLOW captured as a contact sheet of frames.

The image you are looking at is a film strip. Each ROW corresponds to one step in the flow; each COLUMN within a row is a frame captured a few hundred milliseconds apart starting at t=0 of that step. Read the row label to understand what action just happened. Read frames left-to-right within a row to judge the animation that played in response.

Your job is to identify ANIMATION and INTERACTION-FLOW issues — NOT general design issues. Stay focused on:

## Evaluation rubric (walk every dimension)

1. **Missing animations** — did the page jump (instant change) where motion was expected? Page transitions, modal/drawer entrances, list item insertions/removals, accordion expands/collapses should ease in.
2. **Buggy animations** — visible stutter (sudden jump mid-animation), pop-in (element appears then animates as if late), wrong direction (slides up when should slide down), overshoot/bounce that feels broken.
3. **Loading-state feedback** — between an action and its result, is there a spinner, skeleton, progress indicator, optimistic UI, or anything signalling "something is happening"? "Nothing happens for 2 seconds" is a bug.
4. **Perceived performance** — are response delays masked with motion (skeleton screens, optimistic state), or do they feel dead?
5. **Affordance & state changes** — do buttons show pressed/active states? Do focused inputs visibly receive focus? Does a clicked CTA confirm it received the click?
6. **Choreography** — do staggered animations look intentional (cards fade in 80ms apart) or random (chaotic timings)? Are exit and entrance animations balanced (similar duration / easing)?
7. **Frame-rate / smoothness** — across the burst frames within one step, does motion look smooth, or do you see large jumps suggesting drops below 30fps?
8. **Accidental flicker** — does any element briefly appear and disappear, double-render, or shift layout unexpectedly?
9. **Navigation continuity** — when navigating between routes/views, does the transition tell the user "you moved here" or does it just hard-cut?
10. **Reduced-motion respect** — when motion is destructive (large slides, big rotates), is there an alternative path? (You can flag this as a suggestion based on what you observe.)

## What to ignore

- Static design issues (typography, color hierarchy, spacing) — those are reviewed separately by motionlint review. Stay on FLOW + ANIMATION.
- Per-frame typos or pixel-perfect alignment.
- Anything outside the rows of frames you were given.

## Response format

Respond ONLY with valid JSON. No markdown fences, no prose preamble.

For each finding:
- "category": one of [interaction, loading_state, hierarchy, consistency, navigation, content, color, contrast, spacing, alignment, typography, responsiveness]. Prefer "interaction" or "loading_state" for animation-specific issues.
- "severity": "critical" | "warning" | "suggestion"
- "location": describe which step/frame the issue is visible in (e.g., "step 3 frames 2-4: button-press state never appears")
- "issue": one concrete sentence
- "why_it_matters": one sentence on user impact
- "fix": specific, actionable. Quote concrete params where applicable ("add a 200ms ease-out fade", "show skeleton during 1.4s API delay").

{
  "overall_score": <integer 1-10>,
  "summary": "<2-3 sentence assessment of the flow's animation quality>",
  "issues": [{ "category": "...", "severity": "...", "location": "...", "issue": "...", "why_it_matters": "...", "fix": "..." }],
  "strengths": ["<animations done well, e.g., 'submit button has a clear pressed state'>"],
  "viewport": "flow"
}`;

export interface FlowPromptOptions {
  spec: FlowSpec;
  step_results: FlowStepResult[];
  /** Optional team preferences markdown — merged into the rubric so the LLM
      grades against the project's own motion philosophy and inspirations. */
  preferences_md?: string;
}

export function buildFlowPrompt(opts: FlowPromptOptions): string {
  const lines: string[] = [FLOW_SYSTEM_PROMPT, "", ANIMATION_STANDARDS_PROMPT];

  if (opts.preferences_md && opts.preferences_md.trim()) {
    lines.push("");
    lines.push("## Project-specific preferences (apply these when grading)");
    lines.push("");
    lines.push("The team has documented their motion philosophy and inspirations below. Use this as the bar for findings — anything that contradicts these preferences is a finding; anything that matches is a strength. Do NOT invent issues that go against these preferences.");
    lines.push("");
    lines.push(opts.preferences_md.trim());
  }

  lines.push("");
  lines.push("## This specific flow");
  lines.push("");
  lines.push(`- **Name:** ${opts.spec.name}`);
  lines.push(`- **URL:** ${opts.spec.url}`);

  if (opts.spec.expected_animations?.length) {
    lines.push("");
    lines.push("**Expected animations** (the team has explicitly opted into these — verify they appear correctly in the frame strip):");
    for (const e of opts.spec.expected_animations) lines.push(`- ${e}`);
  }

  lines.push("");
  lines.push("**Steps the flow performed** (cross-reference with the row labels in the contact sheet):");
  lines.push("");
  for (const r of opts.step_results) {
    const tag = r.success ? "✓" : "✗ FAILED";
    const dur = `${(r.t_end_ms - r.t_start_ms)}ms`;
    const labelBits = [r.step.do, r.step.selector, r.step.value, r.step.label].filter(Boolean).join(" ");
    lines.push(`- step ${r.step_index + 1} [${tag}] (${dur}): ${labelBits}${r.error ? ` — ERROR: ${r.error}` : ""}`);
  }

  return lines.join("\n");
}
