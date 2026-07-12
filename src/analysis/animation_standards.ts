/**
 * Emil Kowalski's animation standards, distilled into a compact prompt block the
 * vision models can grade against. Keeps the exact values in sync with the
 * deterministic linter (src/tuner/standards.ts) — cite, don't approximate.
 */
export const ANIMATION_STANDARDS_PROMPT = `## Animation standards (grade motion against these)

Distilled from Emil Kowalski's design-engineering philosophy. Treat a violation as a finding and cite the specific rule.

**Easing**
- Entering / exiting → ease-out (starts fast, feels responsive). Moving/morphing on screen → ease-in-out. Hover/colour → ease. Constant motion → linear.
- \`ease-in\` on UI is always a finding — it starts slow and delays the exact moment the user is watching.
- Built-in CSS easings are weak; strong curves read as intentional (e.g. ease-out \`cubic-bezier(0.23, 1, 0.32, 1)\`, ease-in-out \`cubic-bezier(0.77, 0, 0.175, 1)\`).

**Duration** — UI animations stay under 300ms.
- Button/press feedback 100–160ms · tooltips 125–200ms · dropdowns 150–250ms · modals/drawers 200–500ms.
- A 180ms transition feels snappier than a 400ms one. Exits should run ~20% faster than their entrance.

**Physicality**
- Never scale from 0 — nothing in the real world appears from nothing. Enter from scale(0.9–0.97) + opacity:0.
- Popovers/dropdowns/tooltips scale from their trigger, not centre (modals are exempt — they're centred).
- Pressable elements get subtle press feedback: transform: scale(0.97) on :active.

**Performance & a11y**
- Animate transform and opacity only; animating width/height/margin/top/left (or \`transition: all\`) stutters off the GPU.
- Movement should have a \`prefers-reduced-motion\` alternative (keep opacity/colour, drop large position changes) — not zero animation.

**Purpose** — every animation needs a reason (spatial continuity, state, feedback, explanation, preventing a jarring change). "It looks cool" on a frequently-seen element is not a reason; keyboard-initiated actions should not animate.`;
