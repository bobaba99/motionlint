# Changelog

All notable changes to MotionLint will be documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [SemVer](https://semver.org/).

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
