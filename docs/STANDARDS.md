# The MotionLint animation standards

These are the rules `motionlint audit` checks. Every one is **deterministic** — measured from the live page's computed styles, CSS animations, and Web Animations API timelines. No LLM, no API key, no cost.

Read them even if you never run the tool. They're distilled from [Emil Kowalski's](https://emilkowal.ski/) animation writing, and they're the difference between motion that feels designed and motion that feels like a default.

The machine-readable source of truth is [`src/tuner/standards.ts`](../src/tuner/standards.ts); the checks are in [`src/tuner/lint.ts`](../src/tuner/lint.ts).

---

## Easing

Built-in CSS easings are too weak for deliberate UI motion. Use strong custom curves.

| Role | Curve |
| --- | --- |
| **Entering / exiting** | `cubic-bezier(0.23, 1, 0.32, 1)` — strong ease-out |
| **Moving / morphing on-screen** | `cubic-bezier(0.77, 0, 0.175, 1)` — strong ease-in-out |
| **Drawers / bottom sheets** | `cubic-bezier(0.32, 0.72, 0, 1)` — iOS curve |
| **Hover** | `ease` is acceptable |
| **Marquees, spinners, progress** | `linear` |

**Never use `ease-in` on UI motion.** It starts slow and ends fast — the animation feels sluggish exactly when the user is waiting for it, then snaps at the end. Ease-in is for things leaving the screen entirely, and even then ease-out usually wins.

`ease`, `ease-out`, `linear`, and `cubic-bezier(0.25, 0.1, 0.25, 1)` are flagged as **weak built-ins** on entrances — they're not *wrong*, they're undifferentiated.

## Duration

**Hard ceiling: 300ms for UI animation.** A 180ms dropdown feels more responsive than a 400ms one. Users notice slow far more than they notice fast.

| Element | Budget |
| --- | --- |
| Button / press feedback | 100–160ms |
| Tooltip, small popover | 125–200ms |
| Dropdown, select | 150–250ms |
| Modal, drawer | 200–500ms — the one family allowed past 300ms |

**Exits run ~20% faster than their entrance.** The user has already decided to dismiss; don't make them wait for the animation to agree.

## Physicality

**Nothing in the real world appears from nothing.** `scale(0)` on an entrance is always a finding.

- Minimum entrance scale: **0.9**
- Healthy band: **0.95–0.97**
- Press feedback: **0.97** (subtle — a button that shrinks to 0.9 feels broken, not tactile)

## Stagger

Grouped items should enter **30–80ms apart**.

- Under 30ms reads as simultaneous — you paid for the complexity and got nothing.
- Over 80ms and the last item feels forgotten; the list appears to load slowly even when it didn't.

## Performance

- **Never animate layout properties** — `width`, `height`, `top`, `left`, `margin`, `padding`. They trigger layout on every frame. Use `transform` and `opacity`.
- **Never use `transition: all`.** It animates properties you didn't intend, including layout ones, and it silently gets slower as the element gains styles.
- **No infinite animations on non-loader elements.** A permanent loop is a permanent distraction and a permanent battery cost.

## Consistency

A page with many hand-rolled easing curves has no motion system — it has accidents. MotionLint flags pages carrying an excessive number of distinct custom curves. Pick two or three and reuse them.

## Accessibility

- **Ship a `prefers-reduced-motion: reduce` path.** If the page animates movement (transforms, keyframes) and has no reduced-motion rule, that's a finding. Vestibular disorders are real and this is a one-block fix.
- **Gate hover motion for touch.** Hover animations that aren't wrapped in `@media (hover: hover)` fire on tap for touch users, producing motion they didn't ask for and can't undo.

---

## The full check list

`motionlint audit <url>` reports on:

1. `ease-in` on UI motion
2. Weak built-in easing on an entrance
3. Duration exceeds the UI budget
4. Entrance scales from 0
5. `transition: all`
6. Animating layout properties
7. Infinite animation on a non-loader element
8. Too many distinct hand-rolled easing curves
9. Stagger interval too tight
10. Stagger interval too slow
11. Exit isn't faster than its entrance
12. No `prefers-reduced-motion` path
13. Hover motion isn't gated for touch

Each finding carries the measured value, the standard it violates, and a concrete suggested fix.

```bash
npx motionlint audit http://localhost:3000 --open
```

## Using these rules with a coding agent

These standards are also injected into MotionLint's LLM review prompts, so `motionlint review` and `motionlint flow` judge motion against the same bar the deterministic linter uses. A finding means the same thing whichever command produced it.
