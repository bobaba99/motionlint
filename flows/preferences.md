# Aurora — motion preferences

A reference document for MotionLint flow reviews. Pass via `--preferences flows/preferences.md`.

## Motion philosophy

- **Subtle, fast, calm.** Most UI motion should be 100–250ms. Anything longer than 400ms must justify itself.
- **No bouncy springs on entrances.** Spring physics are reserved for direct-manipulation gestures (drag, pull-to-refresh, swipe-to-dismiss). Entrances and state changes use `cubic-bezier(.16,1,.3,1)` (expo-out).
- **Asymmetric timing for symmetric pairs.** Hover-in is 150ms; hover-out is 100ms. Modal-in is 200ms; modal-out is 150ms. Always feels snappier on the way out.
- **Reduce-motion respect.** Any animation longer than 250ms or with translate ≥ 16px must check `@media (prefers-reduced-motion: reduce)` and provide a fade-only fallback.
- **No flicker.** Elements should never appear and disappear in the same step. If a state is transient, it should ease in then ease out, never pop.

## Default values

| Use | Duration | Easing |
| --- | --- | --- |
| Focus rings, tooltip pop-ins | 150ms in / 100ms out | ease-in / ease-out |
| Hover state on cards/buttons | 200ms | cubic-bezier(.16,1,.3,1) |
| List entrances (data load) | 300ms with 60ms stagger | cubic-bezier(.16,1,.3,1) |
| Modal / drawer | 250ms in / 200ms out | cubic-bezier(.16,1,.3,1) |
| Route transition | 350ms cross-fade | linear |
| Toast / snackbar | 200ms in, 200ms out, 4s visible | ease-out |

## Things we love (inspirations)

- **Linear's sidebar collapse** — instant on click, soft expand on open. No bounce.
- **Stripe's "Pay" button** — 100ms scale to 0.98 on press, 200ms ease-out spring back.
- **Notion's block insert** — 250ms slide-down + fade-in for the new line, neighbouring blocks shift in 150ms.
- **Vercel's deploy spinner** — looping ring with subtle pulse, never strobing.
- **Apple HIG's "transition trumps animation"** — moving objects between states beats appearing/disappearing.

## Things we don't want (anti-patterns)

- ❌ Modal that fades in opacity-only, no scale or slide. Reads as "nothing happened".
- ❌ Tooltips that snap visible with no transition.
- ❌ Loading states that show after 500ms+ of "nothing happens".
- ❌ Bouncy springs on every UI entrance — feels Bootstrap-2014 era.
- ❌ Layout shifts caused by a late-arriving image / late-applied style. CLS = 0.
- ❌ Auto-playing decorative motion (looping background gradients on every page).

## Flows we care about (please test these regularly)

1. **`/signup` happy path** — name → email → company → role → submit → success state.
2. **`/signup` error path** — submit empty form, all required fields show errors with fade-in. Then fix the fields, errors should fade out as inputs become valid.
3. **`/pricing` → `/signup` route transition** — clicking "Start free trial" should cross-fade between pages, not hard-cut.
4. **Dashboard cold load** — KPIs animate in (number ramps), table rows stagger in, charts ease.
5. **Loading skeletons (`/loading` route)** — shimmer continuously, then cross-fade to real content within 1.5s.
