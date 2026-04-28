# MotionLint Eval Report

> Blind labeled-truth evaluation of a vision LLM's ability to identify UI/UX faults from screenshots alone. Labels are held out from every API call. This report is structured for downstream consumption by LLM coding tools.

## Header

- **Generated:** 2026-04-28T06:50:33.609Z
- **Provider:** mock
- **Model:** motionlint-mock-heuristics
- **Truth version:** 1.1
- **Highest passing level:** (none)
- **First failing level:** L1-basic
- **Overall:** ❌ FAIL

## Terminology used in this report

- **recall** — fraction of labeled (seeded) issues the model correctly identified
- **precision_proxy** — fraction of model-raised issues that align with a labeled expectation; surplus = surprise issues
- **control_violation** — control-fixture (deliberately clean page) was flagged with critical or excess warning issues
- **wcag_aa_text_contrast** — 4.5:1 for normal text, 3:1 for large (>=18pt or 14pt bold)
- **fitts_tap_target_minimum** — 48x48 CSS px (Material) / 44x44 (Apple HIG)
- **body_copy_minimum** — 16px / 1.5 line-height for sustained reading
- **line_length_optimal** — 45-75 characters per line

## Result summary

| level | result | recall | controls | reason |
|---|---|---|---|---|
| L1-basic | ❌ FAIL | 10.0% | 0 violations | recall 10.0% < required 80% (1/10 labeled signals detected) |

## Next actions for the coding agent

These are structured TODOs an LLM coding tool can act on directly. Each entry maps to a specific UX dimension and a remediation hypothesis.

```json
[
  {
    "level": "L1-basic",
    "fixture": "low-contrast-cta",
    "ux_concept": "color-contrast WCAG AA",
    "category": "contrast",
    "severity": "warning",
    "description": "Model failed to surface a warning-severity contrast/color finding on fixture \"low-contrast-cta\". Seeded fault: Primary CTA uses light gray text on a white background — clearly fails WCAG AA contrast (≥4.5:1).",
    "expected_signal": "An issue with category ∈ {contrast, color}, severity ≥ warning, mentioning any of: cta, button, sign in, primary, contrast, wcag.",
    "suggested_fix": "Tighten the system prompt for this UX dimension. Add an explicit checkpoint and one positive/negative example. If the dimension already has a checkpoint, raise its priority and require the model to evaluate it before producing the summary."
  },
  {
    "level": "L1-basic",
    "fixture": "tiny-body-text",
    "ux_concept": "body-copy minimum size / readability",
    "category": "typography",
    "severity": "warning",
    "description": "Model failed to surface a warning-severity typography finding on fixture \"tiny-body-text\". Seeded fault: Body copy rendered at 9px — far below the 16px sustained-reading threshold.",
    "expected_signal": "An issue with category ∈ {typography}, severity ≥ warning, mentioning any of: body, text, size, small, legibil, readab.",
    "suggested_fix": "Tighten the system prompt for this UX dimension. Add an explicit checkpoint and one positive/negative example. If the dimension already has a checkpoint, raise its priority and require the model to evaluate it before producing the summary."
  },
  {
    "level": "L1-basic",
    "fixture": "cramped-spacing",
    "ux_concept": "Gestalt proximity, vertical rhythm, whitespace",
    "category": "spacing",
    "severity": "warning",
    "description": "Model failed to surface a warning-severity spacing/alignment finding on fixture \"cramped-spacing\". Seeded fault: All padding and margin removed — content slammed together with zero breathing room.",
    "expected_signal": "An issue with category ∈ {spacing, alignment}, severity ≥ warning, mentioning any of: spacing, padding, margin, cramp, breathing, whitespace.",
    "suggested_fix": "Tighten the system prompt for this UX dimension. Add an explicit checkpoint and one positive/negative example. If the dimension already has a checkpoint, raise its priority and require the model to evaluate it before producing the summary."
  },
  {
    "level": "L1-basic",
    "fixture": "mobile-overflow",
    "ux_concept": "responsive layout / horizontal overflow",
    "category": "responsiveness",
    "severity": "warning",
    "description": "Model failed to surface a warning-severity responsiveness/spacing finding on fixture \"mobile-overflow\". Seeded fault: 1100px-wide pricing table forces horizontal scrolling on a 375px viewport.",
    "expected_signal": "An issue with category ∈ {responsiveness, spacing}, severity ≥ warning, mentioning any of: overflow, scroll, horizontal, mobile, responsive, table.",
    "suggested_fix": "Tighten the system prompt for this UX dimension. Add an explicit checkpoint and one positive/negative example. If the dimension already has a checkpoint, raise its priority and require the model to evaluate it before producing the summary."
  },
  {
    "level": "L1-basic",
    "fixture": "inconsistent-buttons",
    "ux_concept": "design-system consistency",
    "category": "consistency",
    "severity": "warning",
    "description": "Model failed to surface a warning-severity consistency/interaction finding on fixture \"inconsistent-buttons\". Seeded fault: Five identical 'Save' buttons rendered with five wildly different styles — no consistent button language.",
    "expected_signal": "An issue with category ∈ {consistency, interaction}, severity ≥ warning, mentioning any of: button, consist, style, save, system, varied.",
    "suggested_fix": "Tighten the system prompt for this UX dimension. Add an explicit checkpoint and one positive/negative example. If the dimension already has a checkpoint, raise its priority and require the model to evaluate it before producing the summary."
  },
  {
    "level": "L1-basic",
    "fixture": "unclear-cta-copy",
    "ux_concept": "microcopy / actionable labels",
    "category": "content",
    "severity": "warning",
    "description": "Model failed to surface a warning-severity content/interaction finding on fixture \"unclear-cta-copy\". Seeded fault: Every CTA label is generic ('Click here', 'Submit', 'OK') — no verb-object pairing.",
    "expected_signal": "An issue with category ∈ {content, interaction}, severity ≥ warning, mentioning any of: click here, label, copy, vague, generic, verb.",
    "suggested_fix": "Tighten the system prompt for this UX dimension. Add an explicit checkpoint and one positive/negative example. If the dimension already has a checkpoint, raise its priority and require the model to evaluate it before producing the summary."
  },
  {
    "level": "L1-basic",
    "fixture": "disabled-no-distinction",
    "ux_concept": "interaction-state affordances",
    "category": "interaction",
    "severity": "warning",
    "description": "Model failed to surface a warning-severity interaction/consistency/color finding on fixture \"disabled-no-distinction\". Seeded fault: Disabled buttons are styled identically to active buttons — no opacity, no greying, no cursor change.",
    "expected_signal": "An issue with category ∈ {interaction, consistency, color}, severity ≥ warning, mentioning any of: disabled, state, active, distinguish, affordance, feedback.",
    "suggested_fix": "Tighten the system prompt for this UX dimension. Add an explicit checkpoint and one positive/negative example. If the dimension already has a checkpoint, raise its priority and require the model to evaluate it before producing the summary."
  },
  {
    "level": "L1-basic",
    "fixture": "empty-state-missing",
    "ux_concept": "empty state / first-run guidance",
    "category": "loading_state",
    "severity": "warning",
    "description": "Model failed to surface a warning-severity loading_state/content/interaction finding on fixture \"empty-state-missing\". Seeded fault: Empty list with no empty-state message, illustration, or call to action — user lands on a blank box.",
    "expected_signal": "An issue with category ∈ {loading_state, content, interaction}, severity ≥ warning, mentioning any of: empty, blank, placeholder, zero, starter, first run.",
    "suggested_fix": "Tighten the system prompt for this UX dimension. Add an explicit checkpoint and one positive/negative example. If the dimension already has a checkpoint, raise its priority and require the model to evaluate it before producing the summary."
  },
  {
    "level": "L1-basic",
    "fixture": "tap-target-too-small",
    "ux_concept": "Fitts's law / mobile tap target",
    "category": "responsiveness",
    "severity": "warning",
    "description": "Model failed to surface a warning-severity responsiveness/interaction finding on fixture \"tap-target-too-small\". Seeded fault: Toolbar icons rendered at 18×18px and packed tightly together — far below the 48×48 mobile tap target (Fitts/Material).",
    "expected_signal": "An issue with category ∈ {responsiveness, interaction}, severity ≥ warning, mentioning any of: tap, target, touch, small, icon, 48.",
    "suggested_fix": "Tighten the system prompt for this UX dimension. Add an explicit checkpoint and one positive/negative example. If the dimension already has a checkpoint, raise its priority and require the model to evaluate it before producing the summary."
  }
]
```

## Level: L1-basic — ❌ FAIL

> One isolated, glaringly obvious seeded fault per fixture. A competent vision model should detect every fault.

- **Recall:** 1/10 labeled signals = **10.0%** (threshold ≥ 80%)
- **Control violations:** 0 (threshold ≤ 0)
- **Failure reason:** recall 10.0% < required 80% (1/10 labeled signals detected)

| fixture | viewport | result | recall | surprise crit/warn | concept |
|---|---|---|---|---|---|
| `low-contrast-cta` | desktop | ⚠️ 0/1 | 0% | 0 / 1 | color-contrast WCAG AA |
| `tiny-body-text` | desktop | ⚠️ 0/1 | 0% | 0 / 1 | body-copy minimum size / readability |
| `cramped-spacing` | desktop | ⚠️ 0/1 | 0% | 0 / 1 | Gestalt proximity, vertical rhythm, whitespace |
| `weak-hierarchy` | desktop | ✅ 1/1 | 100% | 0 / 0 | type scale / typographic hierarchy |
| `mobile-overflow` | mobile | ⚠️ 0/1 | 0% | 0 / 1 | responsive layout / horizontal overflow |
| `inconsistent-buttons` | desktop | ⚠️ 0/1 | 0% | 0 / 1 | design-system consistency |
| `unclear-cta-copy` | desktop | ⚠️ 0/1 | 0% | 0 / 1 | microcopy / actionable labels |
| `disabled-no-distinction` | desktop | ⚠️ 0/1 | 0% | 0 / 1 | interaction-state affordances |
| `empty-state-missing` | desktop | ⚠️ 0/1 | 0% | 0 / 1 | empty state / first-run guidance |
| `tap-target-too-small` | mobile | ⚠️ 0/1 | 0% | 0 / 1 | Fitts's law / mobile tap target |
| `clean-control` | desktop | ✅ control clean | 100% | 0 / 1 | control / true-negative |

#### `low-contrast-cta` @ desktop

- **Seeded fault (held out from model):** Primary CTA uses light gray text on a white background — clearly fails WCAG AA contrast (≥4.5:1).
- **UX concept under test:** color-contrast WCAG AA
- **Recall:** 0/1 = 0%
- **Surprise findings:** 0 critical · 1 warning

**Expected → matched**
- categories=["contrast","color"] severity≥warning kw=["cta","button","sign in"] → ❌ MISSED

**Model output (overall 7/10):** Heuristic mock review (no vision LLM configured). Capture decoded successfully (1532 bytes compressed). Configure ANTHROPIC_API_KEY, OPENAI_API_KEY, GOOGLE_API_KEY or run Ollama locally for real analysis.

  - [warning] **hierarchy** — _above-the-fold hero (desktop)_: Primary CTA does not visually dominate the hero section.
  - [suggestion] **spacing** — _feature card grid (desktop)_: Gaps between feature cards look uneven across rows.
  - [suggestion] **typography** — _body copy throughout (desktop)_: Body text appears smaller than 16px on desktop.

#### `tiny-body-text` @ desktop

- **Seeded fault (held out from model):** Body copy rendered at 9px — far below the 16px sustained-reading threshold.
- **UX concept under test:** body-copy minimum size / readability
- **Recall:** 0/1 = 0%
- **Surprise findings:** 0 critical · 1 warning

**Expected → matched**
- categories=["typography"] severity≥warning kw=["body","text","size"] → ❌ MISSED

**Model output (overall 7/10):** Heuristic mock review (no vision LLM configured). Capture decoded successfully (1996 bytes compressed). Configure ANTHROPIC_API_KEY, OPENAI_API_KEY, GOOGLE_API_KEY or run Ollama locally for real analysis.

  - [warning] **hierarchy** — _above-the-fold hero (desktop)_: Primary CTA does not visually dominate the hero section.
  - [suggestion] **spacing** — _feature card grid (desktop)_: Gaps between feature cards look uneven across rows.
  - [suggestion] **typography** — _body copy throughout (desktop)_: Body text appears smaller than 16px on desktop.

#### `cramped-spacing` @ desktop

- **Seeded fault (held out from model):** All padding and margin removed — content slammed together with zero breathing room.
- **UX concept under test:** Gestalt proximity, vertical rhythm, whitespace
- **Recall:** 0/1 = 0%
- **Surprise findings:** 0 critical · 1 warning

**Expected → matched**
- categories=["spacing","alignment"] severity≥warning kw=["spacing","padding","margin"] → ❌ MISSED

**Model output (overall 7/10):** Heuristic mock review (no vision LLM configured). Capture decoded successfully (2844 bytes compressed). Configure ANTHROPIC_API_KEY, OPENAI_API_KEY, GOOGLE_API_KEY or run Ollama locally for real analysis.

  - [warning] **hierarchy** — _above-the-fold hero (desktop)_: Primary CTA does not visually dominate the hero section.
  - [suggestion] **spacing** — _feature card grid (desktop)_: Gaps between feature cards look uneven across rows.
  - [suggestion] **typography** — _body copy throughout (desktop)_: Body text appears smaller than 16px on desktop.

#### `weak-hierarchy` @ desktop

- **Seeded fault (held out from model):** H1, H2, and H3 are all the same size and weight — no visual hierarchy.
- **UX concept under test:** type scale / typographic hierarchy
- **Recall:** 1/1 = 100%
- **Surprise findings:** 0 critical · 0 warning

**Expected → matched**
- categories=["hierarchy","typography"] severity≥warning kw=["hierarchy","heading","h1"] → ✅ matched: `[warning] hierarchy` — _above-the-fold hero (desktop)_ → "Primary CTA does not visually dominate the hero section."

**Model output (overall 7/10):** Heuristic mock review (no vision LLM configured). Capture decoded successfully (2836 bytes compressed). Configure ANTHROPIC_API_KEY, OPENAI_API_KEY, GOOGLE_API_KEY or run Ollama locally for real analysis.

  - [warning] **hierarchy** — _above-the-fold hero (desktop)_: Primary CTA does not visually dominate the hero section.
  - [suggestion] **spacing** — _feature card grid (desktop)_: Gaps between feature cards look uneven across rows.
  - [suggestion] **typography** — _body copy throughout (desktop)_: Body text appears smaller than 16px on desktop.

#### `mobile-overflow` @ mobile

- **Seeded fault (held out from model):** 1100px-wide pricing table forces horizontal scrolling on a 375px viewport.
- **UX concept under test:** responsive layout / horizontal overflow
- **Recall:** 0/1 = 0%
- **Surprise findings:** 0 critical · 1 warning

**Expected → matched**
- categories=["responsiveness","spacing"] severity≥warning kw=["overflow","scroll","horizontal"] → ❌ MISSED

**Model output (overall 7/10):** Heuristic mock review (no vision LLM configured). Capture decoded successfully (3636 bytes compressed). Configure ANTHROPIC_API_KEY, OPENAI_API_KEY, GOOGLE_API_KEY or run Ollama locally for real analysis.

  - [warning] **hierarchy** — _above-the-fold hero (mobile)_: Primary CTA does not visually dominate the hero section. On mobile this is amplified because the CTA risks falling below the fold.
  - [suggestion] **spacing** — _feature card grid (mobile)_: Gaps between feature cards look uneven across rows.
  - [suggestion] **typography** — _body copy throughout (mobile)_: Body text appears smaller than 16px on desktop.

#### `inconsistent-buttons` @ desktop

- **Seeded fault (held out from model):** Five identical 'Save' buttons rendered with five wildly different styles — no consistent button language.
- **UX concept under test:** design-system consistency
- **Recall:** 0/1 = 0%
- **Surprise findings:** 0 critical · 1 warning

**Expected → matched**
- categories=["consistency","interaction"] severity≥warning kw=["button","consist","style"] → ❌ MISSED

**Model output (overall 7/10):** Heuristic mock review (no vision LLM configured). Capture decoded successfully (2848 bytes compressed). Configure ANTHROPIC_API_KEY, OPENAI_API_KEY, GOOGLE_API_KEY or run Ollama locally for real analysis.

  - [warning] **hierarchy** — _above-the-fold hero (desktop)_: Primary CTA does not visually dominate the hero section.
  - [suggestion] **spacing** — _feature card grid (desktop)_: Gaps between feature cards look uneven across rows.
  - [suggestion] **typography** — _body copy throughout (desktop)_: Body text appears smaller than 16px on desktop.

#### `unclear-cta-copy` @ desktop

- **Seeded fault (held out from model):** Every CTA label is generic ('Click here', 'Submit', 'OK') — no verb-object pairing.
- **UX concept under test:** microcopy / actionable labels
- **Recall:** 0/1 = 0%
- **Surprise findings:** 0 critical · 1 warning

**Expected → matched**
- categories=["content","interaction"] severity≥warning kw=["click here","label","copy"] → ❌ MISSED

**Model output (overall 7/10):** Heuristic mock review (no vision LLM configured). Capture decoded successfully (3088 bytes compressed). Configure ANTHROPIC_API_KEY, OPENAI_API_KEY, GOOGLE_API_KEY or run Ollama locally for real analysis.

  - [warning] **hierarchy** — _above-the-fold hero (desktop)_: Primary CTA does not visually dominate the hero section.
  - [suggestion] **spacing** — _feature card grid (desktop)_: Gaps between feature cards look uneven across rows.
  - [suggestion] **typography** — _body copy throughout (desktop)_: Body text appears smaller than 16px on desktop.

#### `disabled-no-distinction` @ desktop

- **Seeded fault (held out from model):** Disabled buttons are styled identically to active buttons — no opacity, no greying, no cursor change.
- **UX concept under test:** interaction-state affordances
- **Recall:** 0/1 = 0%
- **Surprise findings:** 0 critical · 1 warning

**Expected → matched**
- categories=["interaction","consistency","color"] severity≥warning kw=["disabled","state","active"] → ❌ MISSED

**Model output (overall 7/10):** Heuristic mock review (no vision LLM configured). Capture decoded successfully (2220 bytes compressed). Configure ANTHROPIC_API_KEY, OPENAI_API_KEY, GOOGLE_API_KEY or run Ollama locally for real analysis.

  - [warning] **hierarchy** — _above-the-fold hero (desktop)_: Primary CTA does not visually dominate the hero section.
  - [suggestion] **spacing** — _feature card grid (desktop)_: Gaps between feature cards look uneven across rows.
  - [suggestion] **typography** — _body copy throughout (desktop)_: Body text appears smaller than 16px on desktop.

#### `empty-state-missing` @ desktop

- **Seeded fault (held out from model):** Empty list with no empty-state message, illustration, or call to action — user lands on a blank box.
- **UX concept under test:** empty state / first-run guidance
- **Recall:** 0/1 = 0%
- **Surprise findings:** 0 critical · 1 warning

**Expected → matched**
- categories=["loading_state","content","interaction"] severity≥warning kw=["empty","blank","placeholder"] → ❌ MISSED

**Model output (overall 7/10):** Heuristic mock review (no vision LLM configured). Capture decoded successfully (1080 bytes compressed). Configure ANTHROPIC_API_KEY, OPENAI_API_KEY, GOOGLE_API_KEY or run Ollama locally for real analysis.

  - [warning] **hierarchy** — _above-the-fold hero (desktop)_: Primary CTA does not visually dominate the hero section.
  - [suggestion] **spacing** — _feature card grid (desktop)_: Gaps between feature cards look uneven across rows.
  - [suggestion] **typography** — _body copy throughout (desktop)_: Body text appears smaller than 16px on desktop.

#### `tap-target-too-small` @ mobile

- **Seeded fault (held out from model):** Toolbar icons rendered at 18×18px and packed tightly together — far below the 48×48 mobile tap target (Fitts/Material).
- **UX concept under test:** Fitts's law / mobile tap target
- **Recall:** 0/1 = 0%
- **Surprise findings:** 0 critical · 1 warning

**Expected → matched**
- categories=["responsiveness","interaction"] severity≥warning kw=["tap","target","touch"] → ❌ MISSED

**Model output (overall 7/10):** Heuristic mock review (no vision LLM configured). Capture decoded successfully (4360 bytes compressed). Configure ANTHROPIC_API_KEY, OPENAI_API_KEY, GOOGLE_API_KEY or run Ollama locally for real analysis.

  - [warning] **hierarchy** — _above-the-fold hero (mobile)_: Primary CTA does not visually dominate the hero section. On mobile this is amplified because the CTA risks falling below the fold.
  - [suggestion] **spacing** — _feature card grid (mobile)_: Gaps between feature cards look uneven across rows.
  - [suggestion] **typography** — _body copy throughout (mobile)_: Body text appears smaller than 16px on desktop.

#### `clean-control` @ desktop

- **Seeded fault (held out from model):** Deliberately well-designed control page. The vision model should NOT raise critical issues here.
- **UX concept under test:** control / true-negative
- **Recall:** 0/0 = 100%
- **Surprise findings:** 0 critical · 1 warning

**Model output (overall 7/10):** Heuristic mock review (no vision LLM configured). Capture decoded successfully (2764 bytes compressed). Configure ANTHROPIC_API_KEY, OPENAI_API_KEY, GOOGLE_API_KEY or run Ollama locally for real analysis.

  - [warning] **hierarchy** — _above-the-fold hero (desktop)_: Primary CTA does not visually dominate the hero section.
  - [suggestion] **spacing** — _feature card grid (desktop)_: Gaps between feature cards look uneven across rows.
  - [suggestion] **typography** — _body copy throughout (desktop)_: Body text appears smaller than 16px on desktop.

---
Generated by [MotionLint](https://github.com/bobaba99/motionlint) — eval harness 1.1.