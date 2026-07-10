# Changelog

All notable changes to MotionLint will be documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [SemVer](https://semver.org/).

## [Unreleased]

### Added

- **Per-run output cap** — `--max-findings N` / `maxFindings` config / `max_findings` MCP param keeps only the top N findings per run, severity-ordered, for agent focus. Reports carry an `omitted` counts block.
- **Cross-run memory** — findings get a stable id (category + element location + normalized issue text); sightings are recorded per URL in `.motionlint/memory.json`. Recurrence detection uses fuzzy matching (category-synonym compatibility + canonical-token overlap, calibrated on real cross-run data) so LLM rewording between runs still counts as the same finding. Recurring findings are annotated with "seen in N prior runs"; `--new-only` / `new_only` reports only new findings; `.motionlintignore` baselines finding ids permanently (rewordings of a baselined finding stay suppressed); `--no-memory` disables the layer. SARIF output carries the id as a `partialFingerprint` for GitHub code-scanning dedup.
- **PR-surface cap** — `--max-pr-annotations N` / `maxPrAnnotations` config / `max_pr_annotations` MCP param bounds SARIF results per report, severity-ordered, so code-scanning uploads don't flood a PR. Dropped count surfaces as the SARIF run's `omitted_by_pr_cap` property.
- **Resource cap** — `resources.maxConcurrentReviews` bounds concurrent reviews per process (MCP server under agent fan-out); `resources.providerCallsPerMinute` is a process-wide sliding-window ceiling on vision-LLM calls, applied to review and flow paths (each `--consistency` sample counts).
- **Memory-store locking** — the cross-run store's read-modify-write now runs under a stale-aware lock file, so concurrent reviews of one project no longer clobber each other's recorded sightings. A wedged lock degrades to a warning, never a failed review.

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
