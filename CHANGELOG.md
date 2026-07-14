# Changelog

All notable changes to MotionLint will be documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [SemVer](https://semver.org/).

## [Unreleased]

## [0.2.0] — 2026-07-14

### Added

- **Provider scorecard history** — every `eval` run appends a compact record (per-level recall/violations/pass, aggregate recall) to `.motionlint/eval-history.json` (capped at 100) and compares against the previous run of the same provider+model: recall drops >10 points and newly-failing levels are called out as regressions in the terminal. `--history <path>` / `--no-history`. Regressions never change the exit code — truth.json thresholds stay the only gate.
- **Closed-loop prompt evolution** — `eval --evolve` distills the run's `next_actions` (missed expected issues, control violations) into `.motionlint/prompt-addenda.md`: deduped by fixture/category, newest first, capped at 12 lines. Review prompts automatically include the file as a "Learned heuristics" section (config `learnedHeuristics`, set null to disable). The file is plain markdown — the loop has a visible, editable knob.
- **Interaction-state grids** — `review --state-grid` captures up to six interactive elements in their default/hover/focus/active states (real hover/focus/mousedown, 320ms settle for transitions) and composes one labeled grid image reviewed as an extra `interaction-states` pseudo-viewport with a dedicated prompt (affordance visibility, WCAG 2.4.7 focus indication, pressed feedback). Best-effort: pages with no usable elements contribute nothing.
- **Annotated bounding boxes** — review captures now include a DOM snapshot with stable element refs (`E1`…, selector + label + document-coordinate rect, capped at 30) listed in the prompt; the model grounds findings via `"element_ref"`, cited refs resolve to pixel rects (unknown refs are dropped), and the HTML report draws severity-colored boxes with ref tags over the screenshot. Markdown carries a `Where:` line. The mock provider cites `E1` so the path is testable offline.
- **Route auto-discovery** — `review --discover-routes` merges two best-effort sources into the review target list: the site's `/sitemap.xml` (same-origin `<loc>` entries, following one level of sitemap-index children) and a Next.js app directory (`app/` or `src/app/`) in the working directory (static segments only — route groups unwrap, dynamic `[slug]`, parallel `@slot` and private `_` segments are skipped). Deduped, `/` first, capped at 20.
- **Token accounting + cost ceiling** — all four real providers now capture the usage block their APIs already return (Anthropic `usage.*`, OpenAI `usage.prompt/completion_tokens`, Google `usageMetadata.*`, Ollama `*_eval_count`), normalized onto a shared `TokenUsage` shape and totalled per run (`report.usage`: in/out/total tokens, call count). Self-consistency sampling sums usage across samples. `--max-tokens N` / `resources.maxTokensPerRun` is a per-run token budget: once the running total crosses it, remaining viewports are skipped (listed in `usage.skipped_viewports`) instead of billed. Surfaced in the markdown/terminal `Tokens:` line, the HTML report header, and SARIF run properties (`token_usage`). The mock provider emits deterministic synthetic usage so the budget path is testable offline.
- **Linter: stagger + exit-speed rules** — `motionlint audit` now consumes the two remaining encoded standards: grouped entrances (same keyframes name or transition signature, ≥3 members with distinct delays) whose median stagger interval falls outside the 30–80ms band are flagged (cohesion), and entrance/exit pairs matched by animation name (`fadeIn`/`fadeOut`, `slide-in`/`slide-out`) where the exit isn't ~20% faster than the entrance are flagged (duration). Both are conservative: no group or pair, no finding.

- **Animation standards linter (Emil Kowalski)** — a deterministic linter (`src/tuner/lint.ts`) grades harvested animation values against Emil Kowalski's motion standards, encoded as machine-checkable constants (`src/tuner/standards.ts`): `ease-in` on UI and weak built-in curves on entrances (easing), durations over the 300ms UI ceiling with a 200–500ms modal/drawer band (duration), `scale(0)` entrances vs a scale-0.97 floor (physicality), `transition: all` / layout-property animation / stray infinite loops (performance), hand-rolled easing-curve sprawl (cohesion), and — from the harvested stylesheet — a missing `prefers-reduced-motion` path and ungated hover motion (accessibility, Standard 8). No vision model required.
- **CLI: `motionlint audit <url>`** — instruments a page, runs the standards linter, and emits a polished HTML report scored 0–100. Easing findings render a before → after cubic-bezier curve comparison. `--json` and `--ci` (fail on critical) supported.
- **Polished HTML review report** — `motionlint review --format html` (also exposed to Claude Code over MCP) renders findings as a single shareable file: score ring, severity tallies, embedded screenshots, and an issue → fix before/after panel per finding. The report's own UI dogfoods the standards (strong ease-out/ease-in-out tokens, sub-300ms durations, `scale(0.97)` entrances, 40ms stagger, GPU-only `transform`/`opacity`, `prefers-reduced-motion` path, light + dark themes).
- **Standards-aware tuner** — the Animation Tuner now offers Emil's strong easing curves first in its dropdown and surfaces the linter's findings inline on each animation card (severity badge, fix, suggested value) plus a header score chip.
- **Standards-aware flow review** — the `flow` vision prompt now embeds the animation-standards block so motion findings cite concrete rules (exact easing curves, duration budgets, the scale-from-0.95 rule) instead of vague impressions. The static-screenshot review prompt is intentionally left unchanged — motion isn't observable in a still.
- **Per-run output cap** — `--max-findings N` / `maxFindings` config / `max_findings` MCP param keeps only the top N findings per run, severity-ordered, for agent focus. Reports carry an `omitted` counts block.
- **Cross-run memory** — findings get a stable id (category + element location + normalized issue text); sightings are recorded per URL in `.motionlint/memory.json`. Recurrence detection uses fuzzy matching (category-synonym compatibility + canonical-token overlap, calibrated on real cross-run data) so LLM rewording between runs still counts as the same finding. Recurring findings are annotated with "seen in N prior runs"; `--new-only` / `new_only` reports only new findings; `.motionlintignore` baselines finding ids permanently (rewordings of a baselined finding stay suppressed); `--no-memory` disables the layer. SARIF output carries the id as a `partialFingerprint` for GitHub code-scanning dedup.
- **PR-surface cap** — `--max-pr-annotations N` / `maxPrAnnotations` config / `max_pr_annotations` MCP param bounds SARIF results per report, severity-ordered, so code-scanning uploads don't flood a PR. Dropped count surfaces as the SARIF run's `omitted_by_pr_cap` property.
- **Resource cap** — `resources.maxConcurrentReviews` bounds concurrent reviews per process (MCP server under agent fan-out); `resources.providerCallsPerMinute` is a process-wide sliding-window ceiling on vision-LLM calls, applied to review and flow paths (each `--consistency` sample counts).
- **Memory-store locking** — the cross-run store's read-modify-write now runs under a stale-aware lock file, so concurrent reviews of one project no longer clobber each other's recorded sightings. A wedged lock degrades to a warning, never a failed review.
- **Feature walkthrough page** — `demo/walkthrough/index.html`, a self-contained tour of the four commands with embedded screen recordings (CLI `audit` run via vhs; audit report, demo-app tour, Animation Tuner session and review report captured with Screen Studio — 2× Retina window capture at 120fps, driven by self-scripted pages; frame-accurate trims stored in the Screen Studio projects and rendered with ffmpeg — title cards, crossfades, 1280×800 60fps H.264). Includes the six lint categories with real before → after values from a deliberately-bad playground audit (16/100), live-embedded audit + review reports, a `flow` contact sheet, and the Standard 8 accessibility rules. The page dogfoods the standards it demos: two shared easing tokens, every transition ≤ 300ms, `scale(0.97)` press feedback, hover motion gated for touch, `prefers-reduced-motion` path, light + dark themes — `motionlint audit` scores it 100/100.

## [0.1.0] — 2026-04-27

Initial public release.

### Added

- **CLI: `motionlint review <url>`** — capture a URL at multiple viewports (mobile / tablet / desktop), analyse with a vision LLM, render a Markdown / JSON / SARIF report.
- **CLI: `motionlint flow`** — run a scripted user journey through Playwright with frame-burst capture after every interaction, video recording, and a vision-LLM review focused on animation/interaction quality (missing/buggy animations, loading-state feedback, choreography, smoothness, flicker). Supports inline DSL or JSON spec; ships with two sample flows.
- **CLI: `motionlint tune <url>`** — open an interactive Animation Tuner with live previews (Shadow DOM), sliders for duration/delay/stagger/easing, and a structured Claude-Code export.
- **CLI: `motionlint eval`** — run the labelled-truth eval harness against a vision provider; tiered L1 / L2 / L3 complexity progression with `next_actions[]` JSON for downstream LLM coding tools.
- **CLI: `motionlint mcp`** — run as an MCP server over stdio for Claude Code (`review_url`, `review_routes`, `get_latest_report`).
- **Vision providers** — Ollama (local), Anthropic Claude, OpenAI GPT-4o, Google Gemini, plus a deterministic Mock provider for offline / CI smoke tests.
- **Aggressive eval stack** — rubric-style prompt, multi-viewport mosaic capture, DOM snapshot side-channel (computed measurements), self-consistency sampling, synonym-graph + soft-keyword scoring.
- **Animation Tuner** — instrumentation script hooks Motion One / GSAP / anime.js / @formkit/auto-animate / lottie-web plus all CSS transitions and keyframes; Shadow-DOM live previews themed to the source page.
- **`.env` auto-loading** at CLI startup with precedence rules (`MOTIONLINT_ENV_FILE` → `.env.local` → `.env`).
- **TS animation demo app** — multi-route showcase (`/`, `/pricing`, `/signup`, `/dashboard`, `/loading`) used as a review target.
- **25 unit + integration tests** covering parser, scorer, synonym graph, self-consistency merge, eval runner, animation extraction, tuner rendering.

### Notes on quality bar

MotionLint's "production-grade" criteria are defined in [PRD-motionlint.md §14.2](PRD-motionlint.md) and validated by `motionlint eval --ci`:

- L1 ≥ 0.80 recall, 0 control violations.
- L2 ≥ 0.60 recall, 0 control violations.
- L3 attempted, recall reported.
