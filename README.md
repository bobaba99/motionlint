# MotionLint

> **AI design review in your terminal — for what users actually see, click, and watch animate.** Three modes: static UX review, scripted-flow animation review (16 frames per burst at 50ms intervals via CDP screencast), and an interactive animation tuner that hands changes back to Claude Code. Works as a CLI or as an MCP server inside Claude Code, Cursor, or any MCP-aware client.

[![npm version](https://img.shields.io/npm/v/motionlint)](https://www.npmjs.com/package/motionlint) [![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## What it does

| Command | What it answers |
| --- | --- |
| `motionlint review <url>` | *"How does this page **look**?"* — captures full-page screenshots at multiple viewports, sends them to a vision LLM, returns ranked UX issues across 12 dimensions (hierarchy, spacing, contrast, responsiveness, …). |
| `motionlint flow --spec flow.json` | *"How does this page **behave**?"* — runs a scripted user journey through Playwright, captures a 50ms-interval frame burst after every interaction, and asks the LLM to grade animation quality (missing transitions, jank, missing loading states, choreography, scroll-driven effects). |
| `motionlint tune <url>` | *"Let me **tune** these animations live."* — detects every animation on a page (CSS + Motion One / GSAP / anime.js / auto-animate / lottie), opens an interactive HTML page with sliders + presets, exports a Claude Code-ready prompt. |
| `motionlint mcp` | *"Run me as an MCP server"* — exposes all of the above as MCP tools (`review_url`, `review_flow`, `tune_animations`, …) so Claude Code can drive them directly inside a chat. |

```text
$ motionlint flow --spec flows/signup.json --provider anthropic
→ Running flow "signup-happy-path" against http://localhost:3000/signup (11 steps, 50ms intervals × 750ms window)
  provider: anthropic (claude-sonnet-4-20250514)
  capturing flow…
  ✓ step 1: 16 frames    ✓ step 2: 16 frames    ✓ step 3: 16 frames    …
  captured 176 frames in 31s
  contact sheet → .motionlint/flows/signup-…png
  analyzing flow…
  report → .motionlint/flows/signup.md

Score: 4/10 · 3 critical findings
  [critical] interaction — input focus rings missing across steps 2/4/6
  [critical] interaction — submit button has no pressed state
  [critical] loading_state — 1.4s wait with no spinner during submit
```

## Why

AI coding agents read JSX/HTML/CSS — they're blind to what the user actually sees, clicks, and watches animate. Spacing that looks correct in code renders badly. Hover states never get checked. A modal that *should* slide in just pops. MotionLint plugs the visual + motion feedback loop into the same terminal where you write the code.

## Validated quality across providers

The flow-review pipeline was stress-tested across **12 popular web-app animation patterns × 2 variants** (24 fixtures total) covering: staggered entrances, hover/press/focus states, modal entrances, loading skeletons, form errors, toasts, counter ramps, multi-animation dashboards, modal-with-content stagger, rich form feedback (focus + press + spinner + success), and scroll-driven animations (progress bar + IntersectionObserver reveal + parallax).

Run on **2026-04-28** against the latest model from each major provider:

| Provider · model | Recall (broken caught) | FPR (clean flagged) | Score gap | Wall time |
| --- | --- | --- | --- | --- |
| **OpenAI · gpt-5.5** | **100%** (12/12) | **0%** (0/12) | +4.2 | 11.6 min |
| **Anthropic · claude-opus-4-7** | **100%** (12/12) | 8% (1/12) | +4.2 | 9.6 min |
| **Anthropic · claude-sonnet-4-6** | **100%** (12/12) | 8% (1/12) | +5.1 | 14.2 min |
| **Google · gemini-3.1-pro-preview** | 92% (11/12) | **0%** (0/12) | +5.5 | 5.3 min |
| **Ollama · gemma3:4b (local)** | 83% (10/12) | 17% (2/12) | +1.1 | 3.6 min |

**Read this as:** four out of five providers are shippable. **OpenAI gpt-5.5 is the only provider with both 100% recall AND 0% FPR.** Both Anthropic models (Opus 4.7 and Sonnet 4.6) match on recall but flag the same one clean fixture as critical — Sonnet is the better Anthropic value (~5× cheaper per token than Opus, equivalent quality on this test). Gemini 3.1 Pro is ~3× faster and 5× cheaper, at the cost of one missed broken pattern. Local Ollama is workable for iteration loops but flags too many clean implementations to use as a CI gate.

Full per-provider scorecards in [.motionlint/stress/](.motionlint/stress/) after running [scripts/run-all-benchmarks.mjs](scripts/run-all-benchmarks.mjs).

## Use cases

MotionLint is built around four concrete workflows:

- **Pre-merge UX guardrail.** You're a solo dev or 2-person startup with no designer. You finished a feature on a branch, the preview deploy is up, and you'd like a sanity-check before shipping. Run `motionlint review https://pr-123.preview.example.com --ci --threshold critical` in CI; a warning-or-worse blocks the merge until you've at least seen the issues.
- **MCP design colleague inside Claude Code.** Add MotionLint as an MCP server (`claude mcp add motionlint -- npx -y motionlint mcp`). Then ask CC: *"Use motionlint to review the local app at mobile and desktop and tell me the top 3 issues to fix."* CC drives the review tool and gets back annotated feedback in the same conversation.
- **Continuous quality monitoring.** Schedule a nightly cron (`motionlint review https://prod.example.com --format sarif -o ux.sarif`) and surface SARIF in your code-scanning dashboard so production regressions get caught the morning after.
- **Animation / flow QA on a feature you just shipped.** Static screenshots can't tell you whether a button has a press state, whether the modal slides in or just pops, whether there's a spinner during the API call, or whether the success animation stutters. `motionlint flow` runs a scripted user journey through Playwright like a human would, captures frame bursts at every interaction, records video, and asks the LLM to review the *animation behavior* across the captured frames. See *Flow review* below.

Plus a structural workflow worth its own section:

- **Live animation tuning + handoff to Claude Code.** Capture every animation on a page, tune timing/easing/delay live with sliders, export a structured prompt CC can act on directly. See *Animation Tuner* below.

## Flow review

Static screenshots can't tell you whether a flow's *animations* and *interaction states* work. They can only tell you whether the final frame looks right. The `motionlint flow` command fills that gap.

Given a scripted user journey, it:

1. Runs the journey in headless Chromium via Playwright — clicking, typing, hovering, scrolling, pressing keys exactly like a user would.
2. Captures a **burst of 16 frames over 750ms (50ms intervals) after every interaction** via CDP screencast (`Page.captureScreenshot` JPEG, ~8ms per shot). 50ms is half the human visual-detection threshold and below the industry-typical 100ms minimum animation interval — short animations like 100ms button presses get caught with 2-3 mid-state frames.
3. Records the **full Playwright video** as an artifact you can scrub later.
4. Composites every burst into a labeled **contact sheet** — one row per step, frames laid out in sub-rows.
5. Sends the sheet to the vision LLM with a flow-aware rubric that focuses on: missing animations, buggy/janky animations, missing loading states, perceived performance, affordance & state changes, choreography, smoothness, accidental flicker, navigation continuity, reduced-motion respect.
6. Produces a Markdown report with per-step trace, ranked findings, and a **"Prompt for Claude Code"** block at the bottom — paste it into CC and it acts on the findings directly.

### Multi-animation handling

A single recording can capture and analyze multiple concurrent animations. The harness has been validated on:

- **Dashboard reveal** (3 concurrent: tile stagger + counter ramps + chart bar rise)
- **Modal stack** (backdrop fade + modal slide+fade + inner content stagger)
- **Rich form feedback** (focus ring + button press + loading spinner + success card)
- **Scroll-driven** (scroll-progress bar + IntersectionObserver section reveal + parallax hero)

The LLM correctly identifies *which* animations are broken without false-flagging the working ones — see the validated quality table at the top.

### Scroll-driven animations

For sites with scroll-linked animations (parallax, scroll-progress bars, IntersectionObserver reveals), `scroll <px>` steps animate the scroll over the burst window via `requestAnimationFrame`, so each frame shows progressive scroll position and the LLM sees the animation timing as the page scrolls.

### Examples

```bash
# Inline DSL — semicolon-separated steps
motionlint flow \
  --url http://localhost:3000 \
  --steps "navigate /signup; click input#email; type input#email=ada@example.com; click button[type=submit]; wait 2000; capture \"post-submit\"" \
  --name signup-happy-path

# Or load a structured spec with expected_animations[] hints
motionlint flow --spec flows/signup.json --provider anthropic

# Pass team motion preferences (motion philosophy + inspirations + accepted defaults)
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

Three ready-to-run sample flows ship with the repo: [flows/signup.json](flows/signup.json), [flows/loading-state.json](flows/loading-state.json), and [flows/preferences.md](flows/preferences.md) (sample team-preferences markdown).

## Animation Tuner

Most AI coding tools generate animations from scratch. MotionLint lets you **tune the animations that are already running on your page**, in real time, and hand the changes back to your coding agent as a structured prompt.

```bash
motionlint tune http://localhost:3000 --open
```

This:

1. Opens your app in headless Chromium with an instrumentation script that hooks the major TS animation libraries (Motion One, GSAP, anime.js, @formkit/auto-animate, lottie-web) plus all CSS transitions and `@keyframes` running on the page.
2. Captures every detected animation: the element selector, source library, timing parameters, and the bounding box.
3. Generates a self-contained interactive HTML page at `.motionlint/tuner/index.html` (auto-opens with `--open`):
   - **Live preview surface** per animation (Shadow DOM — no iframes, no flash, themed to the source page).
   - **Sliders** for duration / delay / stagger / speed.
   - **Easing-preset dropdown** (linear, ease-out, spring snappy, spring bouncy, Material decelerate, custom cubic-bezier).
   - **Comments box** per animation for design rationale.
4. Exports a markdown file + a Claude-Code-ready prompt with a structured `changes[]` JSON block. Paste that into CC, and it edits your codebase to apply the new parameters.

This is the "tighter feedback loop than Claude Design or Google Stitch" angle: you're tuning what's *already in production*, not generating new designs from scratch.

```text
$ motionlint tune http://localhost:3000

→ Capturing animations on http://localhost:3000…
  detected 15 animation(s)
  tuner → /Users/you/proj/.motionlint/tuner/index.html
  open with: file:///Users/you/proj/.motionlint/tuner/index.html
```

## Setup

```bash
# Install (global or one-shot)
npm install -g motionlint        # global install
npx motionlint review <url>      # one-off without install

# Install Playwright Chromium (one-time per machine, ~300MB)
npx playwright install chromium
```

**Requires Node 18+**.

### API keys

MotionLint auto-loads a `.env` file from the working directory at startup. Drop your provider key in:

```bash
# .env (gitignored)
ANTHROPIC_API_KEY=sk-ant-...
# or
OPENAI_API_KEY=sk-...
# or
GOOGLE_API_KEY=...
# or run a local Ollama (no key needed) — MotionLint auto-detects on http://localhost:11434
```

Real environment variables take precedence over `.env`. With no key set and no Ollama running, MotionLint falls back to a **mock provider** so the full pipeline (capture → analysis → report) still runs end-to-end for smoke tests.

## Quick start

### 1. CLI

```bash
# Single URL, default viewports (mobile + desktop), Markdown report.
motionlint review http://localhost:3000

# Multiple routes, all viewports, video recording, embed screenshots.
motionlint review http://localhost:3000 \
  --routes /,/pricing,/signup,/dashboard \
  --viewports mobile,tablet,desktop \
  --record \
  --embed

# CI mode — exit non-zero on critical issues.
motionlint review https://staging.acme.dev --ci --threshold critical

# Pick a provider explicitly.
motionlint review http://localhost:3000 --provider anthropic --model claude-sonnet-4-20250514
motionlint review http://localhost:3000 --provider openai    --model gpt-4o
motionlint review http://localhost:3000 --provider google    --model gemini-1.5-pro
motionlint review http://localhost:3000 --provider ollama    --model llava:13b

# JSON / SARIF for tooling.
motionlint review http://localhost:3000 --format json  -o ux.json
motionlint review http://localhost:3000 --format sarif -o ux.sarif

# Run interactions before capture.
motionlint review http://localhost:3000/signup \
  --interactions '[{"action":"type","selector":"#email","value":"a@b.co"},{"action":"click","selector":"button[type=submit]"},{"action":"wait","ms":500}]'
```

### 2. MCP server (for Claude Code, Cursor, any MCP-aware client)

MotionLint ships an MCP server over stdio so an LLM agent can drive it directly inside a chat. The `motionlint mcp` subcommand boots it; the agent client spawns the process when a tool is called.

#### Installation in Claude Code

One-liner using the published npm package:

```bash
claude mcp add motionlint -- npx -y motionlint mcp
```

Or against a local checkout (handy while developing):

```bash
claude mcp add motionlint -- node /absolute/path/to/motionlint/dist/index.js mcp
```

After registration:

1. Confirm it appears: `claude mcp list` — you should see `motionlint` with status `running` or `available`.
2. Make sure API keys are reachable. The MCP server inherits the env it's spawned in. For Claude Code on macOS, the cleanest path is to put `ANTHROPIC_API_KEY=...` (or `OPENAI_API_KEY` / `GOOGLE_API_KEY`) in a `.env` file in the project directory you're working from — MotionLint auto-loads it on startup. Alternatively export it in your shell before launching CC.
3. First run: `npx playwright install chromium` if you haven't already. (MotionLint prints a postinstall reminder when you `npm install` it.)

Then in Claude Code:

> *"Use motionlint to review the local app at mobile and desktop and tell me the top 3 issues to fix."*
>
> *"Run motionlint review_flow on `http://localhost:3000/signup` with steps `click input#email; type input#email=test@test.com; click button[type=submit]; wait 2000; capture` and check the animations."*
>
> *"Run motionlint tune_animations on `http://localhost:3000/pricing` — I want to fine-tune the card hover animations."*

#### Tools exposed

| Tool | What it does |
| --- | --- |
| `review_url(url, viewports?, provider?, model?, wait_for?, record?, format?)` | Static UX review of a URL at multiple viewports. Returns a markdown / JSON / SARIF report. |
| `review_routes(base_url, routes, viewports?, ...)` | Same review across multiple routes of one app. |
| `review_flow(url, steps?\|spec_path?, preferences_path?, provider?, ...)` | Animation/interaction review of a scripted user journey. Captures frame bursts after every interaction, builds a contact sheet, returns a flow report with the structured CC handoff block at the bottom. |
| `tune_animations(url, viewport_*?, settle_ms?, output?)` | Detects every animation on a page and writes an interactive HTML tuner. Returns the file path so the agent can ask the user to open it in their browser. |
| `get_latest_report(format?)` | Returns the most recent review/flow report content. |

Resources:

- `motionlint://reports/latest` — the most recent report content.

#### Deployment checklist

Before deploying or sharing the MCP server with other users:

- [ ] **Build is fresh.** `npm run build` then verify `dist/index.js` exists. Without this, `motionlint mcp` won't start.
- [ ] **Playwright Chromium installed** on the target machine: `npx playwright install chromium`. The postinstall hook reminds you, but it's not enforced (we don't auto-download a 300 MB binary on `npm install`).
- [ ] **API keys reachable** — either via shell env or via a `.env` file in the working directory the MCP client launches from. Mock provider works without keys for smoke testing.
- [ ] **Smoke-test the MCP surface.** `npm test` includes an MCP smoke test that boots the server, lists tools, and asserts the expected tool surface.
- [ ] **No secrets committed.** `.env` is gitignored; `.env.example` should be a placeholder. Worth a final `git diff --cached | grep -i 'sk-\|api_key'` before pushing.
- [ ] **Confirm with `claude mcp list`** that the server shows up and isn't erroring at startup.
- [ ] **For npm publish:** bump `version` in `package.json`, then `npm publish` (the `prepublishOnly` script runs the build automatically).

## Providers

MotionLint auto-detects in this order: **Ollama (local) → Anthropic → OpenAI → Google**. The first one with a working API key (or running service) wins. Override with `--provider`.

| Provider | Default model | Setup | Stress-test quality (24 fixtures, 2026-04-28) | Cost per review¹ |
| --- | --- | --- | --- | --- |
| `openai` | `gpt-5.5` | `OPENAI_API_KEY=…` | **100% recall · 0% FPR · +4.2 gap** | ~$0.005 |
| `anthropic` | `claude-opus-4-7` | `ANTHROPIC_API_KEY=…` | **100% recall** · 8% FPR · +4.2 gap | ~$0.025 |
| `anthropic` | `claude-sonnet-4-6` | `ANTHROPIC_API_KEY=…` | **100% recall** · 8% FPR · +5.1 gap | ~$0.005 |
| `google` | `gemini-3.1-pro-preview` | `GOOGLE_API_KEY=…` | 92% recall · **0% FPR** · +5.5 gap | ~$0.001 |
| `ollama` | `gemma3:4b` (local) | `ollama serve` + `ollama pull gemma3:4b` | 83% recall · 17% FPR · +1.1 gap | $0 |
| `mock` | heuristic stub | (auto fallback) | n/a — deterministic stub for CI smoke tests | $0 |

¹ Order-of-magnitude estimate per static review at the default 2 viewports. Flow review is 1 image per flow but the contact sheet is bigger; the Animation Tuner makes 0 LLM calls.

### How to pick

- **Best quality, shipping.** OpenAI `gpt-5.5` — the only provider that hit 100% recall *and* 0% false-positive rate on the stress test.
- **Best Anthropic value.** Anthropic `claude-sonnet-4-6` ties Opus 4.7 on recall and FPR (both 100% / 8%) and is **5× cheaper per token**. Pass `--model claude-opus-4-7` if you specifically want the Opus tier; otherwise Sonnet 4.6 is the better value.
- **Cost-sensitive CI.** Google `gemini-3.1-pro-preview` — 5× cheaper than Anthropic Sonnet, ~3× faster, 0% FPR, missed one broken pattern. Run the stress test on your own flows before relying on it as a hard merge gate.
- **Offline / no-network / iteration loops.** Ollama with `gemma3:4b`. Local, free, no rate limits, but the higher FPR (2 of 12 clean implementations got hallucinated criticals) means it's not safe as a CI gate. Use it for prompt-tuning and quick smoke runs.

If no provider is reachable and you didn't pass `--provider mock`, MotionLint falls back to the **mock** provider so the full pipeline (capture → analysis → report) still runs end-to-end. Set an API key for real analysis.

### Switching providers

```bash
# Explicit pick (overrides auto-detect)
motionlint review http://localhost:3000 --provider anthropic --model claude-sonnet-4-20250514
motionlint review http://localhost:3000 --provider openai    --model gpt-4o
motionlint review http://localhost:3000 --provider google    --model gemini-1.5-pro
motionlint review http://localhost:3000 --provider ollama    --model llava:13b

# Same for flow / tune / eval — every command honours --provider and --model.
motionlint flow --spec flows/signup.json --provider google --model gemini-1.5-pro
```

### Benchmarking your own provider

To compare a new provider against Anthropic's 100%/0% baseline on the same 24-fixture stress test:

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

## What it captures

- **Full-page screenshots** at three default viewports (mobile 375 / tablet 768 / desktop 1440). Override via config.
- **Above-the-fold** screenshots with `--no-full-page`.
- **Videos** of the navigation+capture run with `--record` (Playwright `.webm`).
- **Interaction sequences** before capture: `click`, `hover`, `type`, `scroll`, `wait`.
- **Auth state**: cookies, `localStorage`, and a `beforeNavigate` script — all configurable in `.motionlintrc.json`.

## What it analyzes

MotionLint sends each screenshot to a vision model with an opinionated UX-review system prompt covering twelve dimensions (`hierarchy`, `spacing`, `alignment`, `typography`, `color`, `contrast`, `responsiveness`, `interaction`, `content`, `navigation`, `consistency`, `loading_state`). For each issue the model returns:

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

## Configuration

Drop a `.motionlintrc.json` in your repo root (or use `motionlint.config.js` / a `"motionlint"` key in `package.json`):

```json
{
  "provider": "auto",
  "fallbackProvider": "anthropic",
  "fallbackModel": "claude-sonnet-4-20250514",
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
  "ci": { "threshold": "warning", "failOnCritical": true },
  "auth": { "cookies": null, "localStorage": null, "beforeNavigate": null }
}
```

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

## Try the demo

A multi-route TS animation showcase ships in `demo/` (Motion One · GSAP · anime.js · @formkit/auto-animate · lottie-web):

```bash
node demo/server.mjs                                       # http://localhost:4173
motionlint review http://localhost:4173 \
  --routes /,/pricing,/signup,/dashboard,/loading \
  --viewports mobile,tablet,desktop --record --embed
```

Reports go to `.motionlint/reports/`, screenshots to `.motionlint/screenshots/`, videos to `.motionlint/videos/`.

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
- Animation Tuner with Shadow-DOM previews (no iframe flash), live sliders, easing presets, Claude-Code export.
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
