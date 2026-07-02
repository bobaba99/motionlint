# MotionLint

[![npm version](https://img.shields.io/npm/v/motionlint)](https://www.npmjs.com/package/motionlint) [![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE) [![CI](https://github.com/bobaba99/motionlint/actions/workflows/ci.yml/badge.svg)](https://github.com/bobaba99/motionlint/actions/workflows/ci.yml)

## The problem

AI coding agents read JSX, HTML, and CSS — they're blind to what the user actually sees, clicks, and watches animate. Spacing that looks correct in code renders broken; modals that should slide in just pop; loading states get omitted; focus rings disappear. Code review can't catch any of this before merge.

## What MotionLint does

MotionLint is a vision-LLM design reviewer that runs in your terminal and as an MCP server inside Claude Code, Cursor, or any MCP-aware client. It captures what your app actually *does* — multi-viewport screenshots, 50ms-interval frame bursts after every interaction, and an interactive timing tuner — then hands ranked, actionable findings back to your coding agent.

## How it's different

| | MotionLint | Visual regression tools (Percy, Chromatic, Playwright snapshots) | AI design generators (v0, Galileo, Claude Design, Stitch) |
| --- | --- | --- | --- |
| Multi-viewport UX review | ranked findings across 12 dimensions | pixel diffs only | generates new layouts from prompts |
| **Animation review** | **50ms frame bursts via CDP screencast → contact sheet → LLM** | ✗ | ✗ |
| **Live animation tuning** | **Shadow-DOM previews + sliders + Claude Code export** | ✗ | generates new motion, doesn't tune what's there |
| Native MCP server | ✓ stdio MCP for Claude Code / Cursor | ✗ | varies |
| CI gate | ✓ SARIF + exit codes for code scanning | ✓ image diff thresholds | ✗ |
| Validated quality | **100% recall · 0% FPR on 24-fixture stress test** | n/a | n/a |

The conceptual gap MotionLint closes: visual-regression tools catch what *changed* but not whether the new pixels are *good*; AI design tools generate from scratch but don't review what's already running. MotionLint reviews live behavior with a vision LLM and feeds the verdict back into the coding loop.

## Install

```bash
# CLI
npm install -g motionlint                              # global
npx motionlint review <url>                            # one-shot, no install

# Claude Code (MCP server)
claude mcp add motionlint -- npx -y motionlint mcp

# One-time per machine: Playwright Chromium (~300MB)
npx playwright install chromium
```

Requires Node 18+. Package on npm: [motionlint](https://www.npmjs.com/package/motionlint).

## Quick start

```bash
# Static review of a URL at mobile + desktop → Markdown report.
motionlint review http://localhost:3000

# Animation review of a scripted user journey → contact sheet + flow report.
motionlint flow --spec flows/signup.json

# Detect every animation on a page → interactive HTML tuner.
motionlint tune http://localhost:3000

# CI mode — non-zero exit on critical issues, SARIF output for code scanning.
motionlint review https://staging.acme.dev --ci --threshold critical --format sarif -o ux.sarif

# Pick a provider explicitly (auto-detect picks the first reachable one).
motionlint review http://localhost:3000 --provider anthropic --model claude-sonnet-4-6

# Agent focus — keep only the top 5 findings, and only ones not seen in prior runs.
motionlint review http://localhost:3000 --max-findings 5 --new-only
```

Sample terminal output for a flow review:

```text
$ motionlint flow --spec flows/signup.json --provider anthropic
→ Running flow "signup-happy-path" against http://localhost:3000/signup (11 steps, 50ms intervals × 750ms window)
  provider: anthropic (claude-sonnet-4-6)
  capturing flow…
  ✓ step 1: 16 frames    ✓ step 2: 16 frames    ✓ step 3: 16 frames    …
  captured 176 frames in 31s
  contact sheet → .motionlint/flows/signup-happy-path-…png
  analyzing flow…
  report → .motionlint/flows/signup-happy-path.md

Score: 4/10 · 3 critical findings
  [critical] interaction — input focus rings missing across steps 2/4/6
  [critical] interaction — submit button has no pressed state
  [critical] loading_state — 1.4s wait with no spinner during submit
```

## Try the demo

A multi-route TS animation showcase ships in [demo/](demo/) — covering Motion One, GSAP, anime.js, @formkit/auto-animate, and lottie-web — including a cat-themed one-pager that exercises every MotionLint capability in a single URL:

```bash
node demo/server.mjs                                # http://localhost:4173
motionlint review http://localhost:4173/cat --record --embed
motionlint flow --spec flows/signup.json
motionlint tune http://localhost:4173/dashboard
```

Routes available: `/`, `/pricing`, `/signup`, `/dashboard`, `/loading`, `/cat`. Reports go to `.motionlint/reports/`, screenshots to `.motionlint/screenshots/`, videos to `.motionlint/videos/`.

## Setup

### API keys

MotionLint auto-loads a `.env` file from the working directory at startup:

```bash
# .env (gitignored)
ANTHROPIC_API_KEY=sk-ant-...
# or
OPENAI_API_KEY=sk-...
# or
GOOGLE_API_KEY=...
# or run a local Ollama (no key needed) — auto-detected on http://localhost:11434
```

Real environment variables take precedence over `.env`. With no key set and no Ollama running, MotionLint falls back to a deterministic **mock provider** so the full pipeline (capture → analysis → report) still runs end-to-end for smoke tests.

### Provider auto-detect

MotionLint auto-detects in this order: **Ollama (local) → Anthropic → OpenAI → Google**. The first one with a working API key (or running service) wins. Override with `--provider <name>` and `--model <id>`. See [Providers in depth](#providers-in-depth) for the per-provider quality scorecard and how to pick.

---

> *Everything below is for readers who want to understand how MotionLint works under the hood, pick the right provider for their workflow, or wire it into CI.*

## Validated quality across providers

The flow-review pipeline was stress-tested across **12 popular web-app animation patterns × 2 variants** (24 fixtures total) — staggered entrances, hover/press/focus, modal entrances, loading skeletons, form errors, toasts, counter ramps, multi-animation dashboards, modal-with-content stagger, rich form feedback (focus + press + spinner + success), and scroll-driven animations (progress bar + IntersectionObserver reveal + parallax).

Run on **2026-04-29** against the latest model from each major provider plus three Ollama-served local models:

| Provider · model | Recall (broken caught) | FPR (clean flagged) | Score gap | Wall time¹ |
| --- | --- | --- | --- | --- |
| **OpenAI · gpt-5.5** | **100%** (12/12) | **0%** (0/12) | +4.2 | 11.6 min |
| **Anthropic · claude-opus-4-7** | **100%** (12/12) | 8% (1/12) | +4.2 | 9.6 min |
| **Anthropic · claude-sonnet-4-6** | **100%** (12/12) | 8% (1/12) | +5.1 | 14.2 min |
| **Ollama · nemotron3:33b** (local, 27 GB) | **100%** (12/12) | 25% (3/12) | +5.1 | 7.7 min |
| **Google · gemini-3.1-pro-preview** | 92% (11/12) | **0%** (0/12) | +5.5 | 5.3 min |
| **Ollama · gemma3:4b** (local, 3.3 GB) | 83% (10/12) | 17% (2/12) | +1.1 | 3.6 min |
| **Ollama · glm-ocr** (local, 2.2 GB) | 33% (4/12) | 33% (4/12) | +0.3 | 11.3 min |

¹ Local-model wall times measured on an Apple M4 Max (128 GB unified). Cloud-provider times reflect API latency, not local compute.

**Read this as:** six of the seven model combinations are shippable for at least one workflow. **OpenAI gpt-5.5 remains the only provider with 100% recall AND 0% FPR** — the safest hard CI gate. The standout new result: **nemotron3:33b is the first 100%-recall local model**, ties Sonnet 4.6 on score gap, runs entirely on-device, and costs $0 — but its 25% false-positive rate (3 clean fixtures flagged critical) means it's better as an iteration-loop reviewer than a merge-blocker on a powerful local machine. Both Anthropic models match on recall and flag the same one clean fixture; Sonnet 4.6 is the better Anthropic value (~5× cheaper per token than Opus, equivalent quality on this test). Gemini 3.1 Pro is ~3× faster and 5× cheaper than Sonnet, at the cost of one missed broken pattern. **glm-ocr is too weak for this task** (33% recall, 33% FPR — barely above coin-flip) and is documented here only so future readers don't try the same path.

Full per-provider scorecards in [.motionlint/stress/](.motionlint/stress/) after running [scripts/run-all-benchmarks.mjs](scripts/run-all-benchmarks.mjs).

## Providers in depth

| Provider | Default model | Setup | Quality (24 fixtures) | Cost per review¹ |
| --- | --- | --- | --- | --- |
| `openai` | `gpt-5.5` | `OPENAI_API_KEY=…` | **100% recall · 0% FPR · +4.2 gap** | ~$0.005 |
| `anthropic` | `claude-opus-4-7` | `ANTHROPIC_API_KEY=…` | **100% recall** · 8% FPR · +4.2 gap | ~$0.025 |
| `anthropic` | `claude-sonnet-4-6` | `ANTHROPIC_API_KEY=…` | **100% recall** · 8% FPR · +5.1 gap | ~$0.005 |
| `ollama` | `nemotron3:33b` (local, 27 GB) | `ollama serve` + `ollama pull nemotron3:33b` | **100% recall** · 25% FPR · +5.1 gap | $0 |
| `google` | `gemini-3.1-pro-preview` | `GOOGLE_API_KEY=…` | 92% recall · **0% FPR** · +5.5 gap | ~$0.001 |
| `ollama` | `gemma3:4b` (local, 3.3 GB) | `ollama serve` + `ollama pull gemma3:4b` | 83% recall · 17% FPR · +1.1 gap | $0 |
| `ollama` | `glm-ocr` (local, 2.2 GB) | `ollama serve` + `ollama pull glm-ocr` | 33% recall · 33% FPR · +0.3 gap | $0 |
| `mock` | heuristic stub | (auto fallback) | n/a — deterministic stub for CI smoke tests | $0 |

¹ Order-of-magnitude estimate per static review at the default 2 viewports. Flow review is one composite image per flow but the contact sheet is bigger. The Animation Tuner makes 0 LLM calls.

### How to pick

- **Best quality, hard CI gate.** OpenAI `gpt-5.5` — the only provider that hit 100% recall *and* 0% FPR.
- **Best Anthropic value.** Anthropic `claude-sonnet-4-6` ties Opus 4.7 on recall and FPR (both 100% / 8%) and is **5× cheaper per token**. Pass `--model claude-opus-4-7` for the Opus tier; otherwise Sonnet 4.6.
- **Best local quality (NEW).** Ollama `nemotron3:33b` — first local model at 100% recall, ties Sonnet 4.6 on score gap. 25% FPR keeps it out of hard CI gates, but it's the right pick for iteration loops and air-gapped reviews when you have ≥32 GB unified memory and don't want to pay per-call.
- **Cost-sensitive CI.** Google `gemini-3.1-pro-preview` — 5× cheaper than Anthropic Sonnet, ~3× faster, 0% FPR, missed one broken pattern. Run the stress test on your own flows before relying on it as a hard merge gate.
- **Lightweight local.** Ollama `gemma3:4b` (3.3 GB). 83% recall, 17% FPR. Use when nemotron3:33b doesn't fit in memory or when you need faster turn-around per fixture.
- **Skip:** Ollama `glm-ocr` is OCR-tuned and too weak for general design review (33% recall / 33% FPR).

### Switching providers

Every command honours `--provider` and `--model`:

```bash
motionlint review http://localhost:3000 --provider openai    --model gpt-5.5
motionlint flow   --spec flows/signup.json --provider google --model gemini-3.1-pro-preview
motionlint review http://localhost:3000 --provider ollama    --model llava:13b
```

### Benchmarking your own provider

To compare a new provider against the same 24-fixture stress test:

```bash
node -e "
import('./dist/config/env.js').then(async ({ loadEnv }) => {
  loadEnv();
  const { runStress, renderStressMarkdown } = await import('./dist/flow/stress.js');
  const { writeFile, mkdir } = await import('node:fs/promises');
  const { resolve } = await import('node:path');
  await mkdir('.motionlint/stress', { recursive: true });
  const r = await runStress({
    stressPath: resolve('eval/animation-stress.json'),
    fixturesDir: resolve('eval/animation-fixtures'),
    artifactDir: resolve('.motionlint/stress'),
    provider: 'YOUR_PROVIDER',  // 'openai' | 'google' | 'ollama'
  });
  await writeFile('.motionlint/stress/SCORECARD.md', renderStressMarkdown(r), 'utf8');
  console.error('Recall:', (r.broken_recall*100).toFixed(0)+'%, FPR:', (r.good_false_positive_rate*100).toFixed(0)+'%, gap:', r.avg_score_gap.toFixed(1));
});
"
```

Open `.motionlint/stress/SCORECARD.md` for the per-pattern breakdown.

## How `motionlint flow` works

Static screenshots can't tell you whether a flow's animations and interaction states work — only whether the final frame looks right. `motionlint flow` fills that gap.

Given a scripted user journey, it:

1. Runs the journey in headless Chromium via Playwright — clicking, typing, hovering, scrolling, pressing keys exactly like a user would.
2. Captures a **burst of 16 frames over 750ms (50ms intervals) after every interaction** via CDP screencast (`Page.captureScreenshot` JPEG, ~8ms per shot). 50ms is half the human visual-detection threshold and below the industry-typical 100ms minimum animation interval — short animations like 100ms button presses get caught with 2-3 mid-state frames.
3. Records the **full Playwright video** as an artifact you can scrub later.
4. Composites every burst into a labeled **contact sheet** — one row per step, frames laid out in sub-rows.
5. Sends the sheet to the vision LLM with a flow-aware rubric covering: missing animations, buggy/janky animations, missing loading states, perceived performance, affordance & state changes, choreography, smoothness, accidental flicker, navigation continuity, reduced-motion respect.
6. Produces a Markdown report with per-step trace, ranked findings, and a **"Prompt for Claude Code"** block at the bottom — paste it into CC and it acts on the findings directly.

### Multi-animation handling

A single recording can capture and analyze multiple concurrent animations. Validated on:

- **Dashboard reveal** (3 concurrent: tile stagger + counter ramps + chart bar rise)
- **Modal stack** (backdrop fade + modal slide+fade + inner content stagger)
- **Rich form feedback** (focus ring + button press + loading spinner + success card)
- **Scroll-driven** (scroll-progress bar + IntersectionObserver section reveal + parallax hero)

The LLM correctly identifies *which* animations are broken without false-flagging the working ones — see the validated-quality table.

### Scroll-driven animations

For sites with scroll-linked animations, `scroll <px>` steps animate the scroll over the burst window via `requestAnimationFrame` so each frame shows progressive scroll position and the LLM sees the timing as the page scrolls.

### Flow examples

```bash
# Inline DSL — semicolon-separated steps
motionlint flow \
  --url http://localhost:3000 \
  --steps "navigate /signup; click input#email; type input#email=ada@example.com; click button[type=submit]; wait 2000; capture \"post-submit\"" \
  --name signup-happy-path

# Or load a structured spec with expected_animations[] hints
motionlint flow --spec flows/signup.json --provider anthropic

# Pass team motion preferences (philosophy + inspirations + accepted defaults)
# Embedded into the prompt AND the report's CC handoff block.
motionlint flow --spec flows/signup.json --preferences flows/preferences.md

# Tighten the interval below 50ms for fine-grained timing review
motionlint flow --spec flows/signup.json --interval 30 --burst-ms 600

# Auto-detect: scan the page's animations, pick an interval that captures
# the shortest one with 4 frames inside it (clamped to [20, 100]ms).
motionlint flow --spec flows/signup.json --auto-interval
```

### Inline DSL reference

| Action | Form | Notes |
| --- | --- | --- |
| navigate | `navigate /pricing` | path or full URL |
| click | `click button#start` | CSS selector |
| hover | `hover .feature` | CSS selector |
| type | `type input#email=ada@example.com` | selector=value |
| press | `press Enter` | keyboard key |
| scroll | `scroll 800` | pixels; animates over the burst window |
| wait | `wait 500` | ms |
| capture | `capture "post-submit"` | take an explicit burst with optional label |

Defaults: a frame burst is taken after *every* interaction. Pass `--no-implicit-bursts` to only burst on explicit `capture` steps. Pass `--no-record` to skip video.

Three ready-to-run sample flows ship in the repo: [flows/signup.json](flows/signup.json), [flows/loading-state.json](flows/loading-state.json), and [flows/preferences.md](flows/preferences.md).

## How the Animation Tuner works

Most AI coding tools generate animations from scratch. The Tuner lets you **tune the animations that are already running on your page**, in real time, and hand the changes back to your coding agent as a structured prompt.

```bash
motionlint tune http://localhost:3000 --open
```

This:

1. Opens your app in headless Chromium with an instrumentation script that hooks the major TS animation libraries (Motion One, GSAP, anime.js, @formkit/auto-animate, lottie-web) plus all CSS transitions and `@keyframes` running on the page.
2. Captures every detected animation: the element selector, source library, timing parameters, and bounding box.
3. Generates a self-contained interactive HTML page at `.motionlint/tuner/index.html` (auto-opens with `--open`):
   - **Live preview surface** per animation (Shadow DOM — no iframes, no flash, themed to the source page).
   - **Sliders** for duration / delay / stagger / speed.
   - **Easing-preset dropdown** (linear, ease-out, spring snappy, spring bouncy, Material decelerate, custom cubic-bezier).
   - **Comments box** per animation for design rationale.
4. Exports a markdown file plus a Claude-Code-ready prompt with a structured `changes[]` JSON block. Paste that into CC and it edits your codebase to apply the new parameters.

```text
$ motionlint tune http://localhost:3000

→ Capturing animations on http://localhost:3000…
  detected 15 animation(s)
  tuner → /Users/you/proj/.motionlint/tuner/index.html
  open with: file:///Users/you/proj/.motionlint/tuner/index.html
```

## MCP server — tools, resources, deployment

MotionLint ships an MCP server over stdio so an LLM agent can drive it directly inside a chat. The `motionlint mcp` subcommand boots it; the agent client spawns the process when a tool is called.

### Installing in Claude Code

Published-npm version (recommended):

```bash
claude mcp add motionlint -- npx -y motionlint mcp
```

Local checkout (handy while developing):

```bash
claude mcp add motionlint -- node /absolute/path/to/motionlint/dist/index.js mcp
```

After registration:

1. Confirm it appears: `claude mcp list` — `motionlint` should show as `running` or `available`.
2. Make sure API keys are reachable. The MCP server inherits the env it's spawned in. Cleanest path: drop a `.env` file in the project directory you're working from — MotionLint auto-loads it on startup.
3. First run: `npx playwright install chromium` if you haven't already.

Then in Claude Code:

> *"Use motionlint to review the local app at mobile and desktop and tell me the top 3 issues to fix."*
>
> *"Run motionlint review_flow on `http://localhost:3000/signup` with steps `click input#email; type input#email=test@test.com; click button[type=submit]; wait 2000; capture` and check the animations."*
>
> *"Run motionlint tune_animations on `http://localhost:3000/pricing` — I want to fine-tune the card hover animations."*

### Tools exposed

| Tool | What it does |
| --- | --- |
| `review_url(url, viewports?, provider?, model?, wait_for?, record?, format?, max_findings?, new_only?)` | Static UX review of a URL at multiple viewports. Returns a markdown / JSON / SARIF report. |
| `review_routes(base_url, routes, viewports?, ..., max_findings?, new_only?)` | Same review across multiple routes of one app. |
| `review_flow(url, steps?\|spec_path?, preferences_path?, provider?, ...)` | Animation/interaction review of a scripted user journey. Returns a flow report with the structured CC handoff block. |
| `tune_animations(url, viewport_*?, settle_ms?, output?)` | Detects every animation on a page and writes an interactive HTML tuner. Returns the file path. |
| `get_latest_report(format?)` | Returns the most recent review/flow report content. |

Resources: `motionlint://reports/latest` — the most recent report content.

### Deployment checklist

Before deploying or sharing the MCP server with other users:

- [ ] **Build is fresh.** `npm run build` then verify `dist/index.js` exists. Without this, `motionlint mcp` won't start.
- [ ] **Playwright Chromium installed** on the target machine: `npx playwright install chromium`. The postinstall hook reminds you, but it's not enforced (we don't auto-download a 300 MB binary on `npm install`).
- [ ] **API keys reachable** — either via shell env or via a `.env` file in the working directory the MCP client launches from.
- [ ] **Smoke-test the MCP surface.** `npm test` includes an MCP smoke test that boots the server, lists tools, and asserts the expected tool surface.
- [ ] **No secrets committed.** `.env` is gitignored; `.env.example` should be a placeholder. Worth a final `git diff --cached | grep -i 'sk-\|api_key'` before pushing.
- [ ] **Confirm with `claude mcp list`** that the server shows up and isn't erroring at startup.

## CI integration

```yaml
# .github/workflows/ux.yml
- run: npm ci
- run: npx playwright install chromium
- run: npx motionlint review $STAGING_URL --ci --threshold critical --format sarif -o ux.sarif
- uses: github/codeql-action/upload-sarif@v3
  with: { sarif_file: ux.sarif }
```

MotionLint exits with `1` when critical issues exceed the configured threshold (`failOnCritical`) — wire it as a status check.

## What it captures · what it analyzes

**Captures:**

- **Full-page screenshots** at three default viewports (mobile 375 / tablet 768 / desktop 1440). Override via config.
- **Above-the-fold** screenshots with `--no-full-page`.
- **Videos** of the navigation+capture run with `--record` (Playwright `.webm`).
- **Interaction sequences** before capture: `click`, `hover`, `type`, `scroll`, `wait`.
- **Auth state**: cookies, `localStorage`, and a `beforeNavigate` script — all configurable in `.motionlintrc.json`.

**Analyzes:** each screenshot is sent to a vision model with an opinionated UX-review system prompt covering twelve dimensions (`hierarchy`, `spacing`, `alignment`, `typography`, `color`, `contrast`, `responsiveness`, `interaction`, `content`, `navigation`, `consistency`, `loading_state`). For each issue the model returns:

```json
{
  "category": "hierarchy",
  "severity": "critical | warning | suggestion",
  "location": "above-the-fold hero",
  "issue": "Primary CTA blends into the background gradient.",
  "why_it_matters": "Users miss the conversion path on first scroll.",
  "fix": "Increase background contrast or use a solid surface behind the button."
}
```

Override the prompt with `--rules path/to/your-design-rules.md` to inject project-specific heuristics.

## Configuration reference

Drop a `.motionlintrc.json` in your repo root (or use `motionlint.config.js` / a `"motionlint"` key in `package.json`):

```json
{
  "provider": "auto",
  "fallbackProvider": "anthropic",
  "fallbackModel": "claude-sonnet-5",
  "viewports": {
    "mobile":  { "width": 375,  "height": 812 },
    "tablet":  { "width": 768,  "height": 1024 },
    "desktop": { "width": 1440, "height": 900 }
  },
  "defaultViewports": ["mobile", "desktop"],
  "waitFor": "networkidle",
  "waitTimeout": 10000,
  "screenshotDir": ".motionlint/screenshots",
  "videoDir": ".motionlint/videos",
  "reportDir": ".motionlint/reports",
  "rules": null,
  "record": false,
  "maxFindings": null,
  "memory": {
    "enabled": true,
    "path": ".motionlint/memory.json",
    "baseline": ".motionlintignore",
    "newOnly": false
  },
  "ci": { "threshold": "warning", "failOnCritical": true },
  "auth": { "cookies": null, "localStorage": null, "beforeNavigate": null }
}
```

## Review volume control

Re-running review on the same routes used to surface the same findings every run. Two mechanisms keep the output focused:

- **Per-run output cap** — `--max-findings N` (or `maxFindings` in config) keeps only the top N findings per run, severity-ordered, so an agent works on what matters most first. The report's `Omitted` line says how many were capped.
- **Cross-run memory** — every finding gets a stable id (hash of category + element location + normalized issue text). Recurrence detection goes further than exact hashing: category-synonym compatibility plus canonical-token overlap (thresholds calibrated on real cross-run data) matches the same fault even when the vision LLM rewords it between runs. Sightings are recorded per URL in `.motionlint/memory.json`; recurring findings are annotated with *seen in N prior runs* rather than silently dropped. Opt into deltas-only with `--new-only`. To permanently wave off a finding, copy its id into `.motionlintignore` (one hash per line, `#` comments and trailing notes allowed). Disable everything with `--no-memory`.

SARIF output carries the finding id as a `partialFingerprint`, so GitHub code scanning dedups the same finding across runs and PRs natively.

## Use cases

- **Pre-merge UX guardrail.** Solo dev or 2-person startup with no designer. Run `motionlint review https://pr-123.preview.example.com --ci --threshold critical` in CI; warning-or-worse blocks the merge until you've at least seen the issues.
- **MCP design colleague inside Claude Code.** Add MotionLint as an MCP server, then ask CC: *"review the local app at mobile and desktop and tell me the top 3 issues to fix."* CC drives the tool and gets back annotated feedback in the same conversation.
- **Continuous quality monitoring.** Schedule a nightly cron (`motionlint review https://prod.example.com --format sarif -o ux.sarif`) and surface SARIF in your code-scanning dashboard so production regressions get caught the morning after.
- **Animation / flow QA on a feature you just shipped.** `motionlint flow` runs a scripted user journey through Playwright like a human would, captures frame bursts at every interaction, records video, and asks the LLM to review the *animation behavior* across the captured frames.
- **Live animation tuning + handoff to Claude Code.** Capture every animation on a page, tune timing/easing/delay live with sliders, export a structured prompt CC can act on directly.

## Project layout

```text
src/
  capture/      Playwright capture (screenshot, mosaic, DOM snapshot) + interaction sequences
  providers/    Vision LLM providers (ollama, anthropic, openai, google, mock) + self-consistency wrapper
  analysis/     Rubric-style UX prompt + JSON parser + rule injection
  report/       Markdown / JSON / SARIF report generators
  eval/         Tiered eval harness (L1/L2/L3 fixtures, scorer, runner, report)
  flow/         Flow runner — spec parser, capture orchestrator, animation-aware report
  tuner/        Animation Tuner — extractor, instrumentation script, Shadow-DOM render
  mcp/          MCP server for Claude Code
  cli/          Commander.js commands + terminal output
  config/       cosmiconfig loader + .env loader
demo/           TS animation showcase used as a review target
flows/          Sample flow specs (signup, loading-state) for `motionlint flow`
eval/fixtures/  Labelled HTML pages with seeded UX faults at three complexity levels
test/           Node test runner unit + integration tests
```

## Roadmap

**v0.1 (this release)** — shipped:

- Three CLI commands: `review`, `flow`, `tune` + MCP server (`motionlint mcp`).
- Five vision providers: Anthropic, OpenAI, Google, Ollama, mock.
- Multi-viewport static review with mosaic capture, DOM measurement side-channel, self-consistency sampling, soft-keyword scoring with synonym graph.
- Tiered eval harness (L1 / L2 / L3) with 21 labelled fixtures and structured `next_actions[]` JSON for downstream LLM coding tools.
- Flow review at **50ms inter-frame intervals** via CDP screencast (16 frames × 750ms burst), with multi-animation and scroll-driven support.
- Animation Tuner with Shadow-DOM previews, live sliders, easing presets, Claude-Code export.
- Animation stress-test harness validated at **100% recall / 0% FPR on 24 fixtures across 12 patterns**.
- Team motion preferences markdown (`--preferences`) embedded into the LLM rubric and the CC handoff block.
- Auto-interval scan (`--auto-interval`) that picks an inter-frame interval based on the shortest animation detected on the page.
- SARIF output for GitHub code scanning.

**v0.2 (next)**:

- Auto-discover routes (Next.js app directory / sitemap.xml).
- Interaction-state grids (capture hover/focus/loading variants of the same element in one shot).
- Annotated bounding boxes on screenshots showing where each finding lives.
- Closed-loop prompt evolution from eval `next_actions` (auto-tune the system prompt across runs).
- GitHub Action wrapper (`motionlint-action`).
- Provider scorecard tracking (per-model regression detection across releases).

## License

[MIT](LICENSE) © Resila Technologies Inc.
