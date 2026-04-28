# PRD: MotionLint — Visual UI/UX Review Tool for Claude Code

> **Version:** 0.1.0-draft
> **Author:** Gavin (Resila Technologies Inc.)
> **Date:** 2026-04-27
> **Status:** Ready for CC bootstrap

---

## 1. Problem Statement

AI coding agents (Claude Code, Cursor, Copilot) operate at the **code level** — they read JSX/HTML/CSS, lint, and refactor. But they are blind to what the user actually **sees**. Spacing that looks correct in code renders badly. Visual hierarchy breaks. Reading flow is wrong. Color contrast fails in practice. Interaction states (hover, focus, loading) are never checked.

Today, developers must manually open their app, click through every route, resize the viewport, and eyeball every screen. This is the last major manual bottleneck in the AI-assisted development workflow.

**No existing tool acts as an automated "design review colleague" that looks at a running product and gives opinionated, actionable UX feedback.**

---

## 2. Product Vision

**MotionLint** is a CLI tool and/or MCP server for Claude Code that automates visual UI/UX review by:

1. **Capturing** screenshots and interaction states from a running application
2. **Analyzing** them using vision-capable LLMs (local or cloud)
3. **Reporting** actionable UX issues with annotated screenshots and fix suggestions
4. **Integrating** into the CC workflow so developers never leave their terminal

---

## 3. Target Users

| Segment | Pain Level | Description |
|---------|-----------|-------------|
| Solo developers | **Critical** | Shipping without a designer, no one to review UI |
| Small startups (2-10 eng, 0 designers) | **High** | Move fast, skip design QA, ship visual bugs |
| CC / Cursor power users | **High** | Want AI to review everything, not just code |
| Agencies | **Medium** | Ship client work fast, need quick QA passes |

**Primary persona:** A developer using Claude Code who just finished implementing a feature and wants a UX review before pushing.

---

## 4. Scope

### 4.1 In Scope (v0.1 — MVP)

- CLI tool installable via `npm install -g motionlint` or `npx motionlint`
- MCP server mode for direct CC integration (`motionlint --mcp`)
- Screenshot capture of specified URLs at configurable viewports
- Full-page and above-the-fold capture
- Multi-viewport support (mobile 375px, tablet 768px, desktop 1440px)
- Vision LLM analysis with structured UX feedback
- Support for multiple model providers:
  - **Free/local:** Ollama (llava, llama3.2-vision, moondream, etc.)
  - **Paid cloud:** Anthropic Claude (claude-sonnet-4-20250514), OpenAI GPT-4o, Google Gemini
- Configurable via `.motionlintrc` or `motionlint.config.js`
- Markdown report output with inline base64 screenshots
- JSON output for programmatic consumption
- Exit code for CI integration (0 = pass, 1 = issues found)

### 4.2 In Scope (v0.2 — Fast Follow)

- Interaction state capture (click, hover, focus, modal triggers)
- Multi-page crawl (auto-discover routes from sitemap or Next.js file structure)
- Before/after comparison (capture baseline, compare after changes)
- GitHub Action wrapper
- Annotated screenshot output (bounding boxes on problem areas)
- Severity scoring (critical / warning / suggestion)
- Design system rule injection (user provides their own heuristics)

### 4.3 Out of Scope

- Figma-to-production comparison (different product category)
- Accessibility auditing (axe/Lighthouse already handle this well)
- Performance testing
- Visual regression testing against baselines (Chromatic/Percy territory)
- Native mobile app review (iOS/Android screenshots)

---

## 5. Architecture

### 5.1 High-Level Flow

```
Developer runs `motionlint review http://localhost:3000`
       │
       ▼
┌──────────────┐
│  URL Router  │  Resolves target URLs (single, list, or crawl)
└──────┬───────┘
       │
       ▼
┌──────────────────┐
│  Capture Engine  │  Playwright headless browser
│  (playwright)    │  → full-page screenshots at each viewport
└──────┬───────────┘
       │  Screenshots (PNG buffers)
       ▼
┌──────────────────┐
│  Analysis Engine │  Sends screenshots + system prompt to vision LLM
│  (multi-provider)│  → structured UX feedback per screen
└──────┬───────────┘
       │  Structured JSON analysis
       ▼
┌──────────────────┐
│  Report Engine   │  Aggregates, ranks by severity, formats output
│  (md/json/sarif) │  → Markdown report, JSON, or SARIF for CI
└──────────────────┘
```

### 5.2 Module Breakdown

#### `capture/`
- **Technology:** Playwright (Node.js)
- **Responsibilities:**
  - Launch headless Chromium
  - Navigate to target URL(s)
  - Wait for network idle + configurable selectors
  - Capture full-page screenshot at each viewport
  - Capture above-the-fold screenshot (viewport-height only)
  - Optional: execute interaction sequences (click, hover, type) then capture
- **Output:** Array of `{ url, viewport, screenshot: Buffer, timestamp }`

#### `providers/`
- **Responsibilities:** Unified interface to vision LLMs
- **Provider interface:**
  ```typescript
  interface VisionProvider {
    name: string;
    analyze(screenshot: Buffer, prompt: string): Promise<AnalysisResult>;
    isAvailable(): Promise<boolean>;
  }
  ```
- **Implementations:**
  - `OllamaProvider` — connects to local Ollama instance, sends image via `/api/generate`
  - `AnthropicProvider` — Claude API with base64 image input
  - `OpenAIProvider` — GPT-4o via chat completions with image_url
  - `GoogleProvider` — Gemini via generateContent with inline image
- **Model auto-detection:** If no provider specified, check for Ollama first (free), fall back to env vars (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_API_KEY`)

#### `analysis/`
- **Responsibilities:**
  - Construct the UX review prompt with the screenshot
  - Parse structured output from LLM
  - Map findings to severity levels
- **Core prompt template (see Section 6)**

#### `report/`
- **Responsibilities:**
  - Aggregate findings across all URLs and viewports
  - Rank by severity
  - Generate Markdown report with embedded screenshots
  - Generate JSON for programmatic use
  - Generate SARIF for GitHub code scanning integration
- **Output formats:** `--format md` (default), `--format json`, `--format sarif`

#### `mcp/`
- **Responsibilities:**
  - Expose MotionLint as an MCP server
  - Tools: `review_url`, `review_routes`, `get_report`
  - Resources: latest report as a resource
- **Transport:** stdio (for CC local usage)

#### `cli/`
- **Responsibilities:**
  - Parse CLI arguments
  - Orchestrate capture → analysis → report pipeline
  - Handle config file loading
  - Display progress and results

---

## 6. UX Review Prompt (Core IP)

This is the system prompt sent alongside each screenshot. It encodes opinionated design heuristics.

```markdown
You are a senior UX designer and frontend engineer reviewing a screenshot of a web application.

Analyze this screenshot and identify UI/UX issues across the following dimensions.
For each issue, provide:
- **category**: one of [hierarchy, spacing, alignment, typography, color, contrast, responsiveness, interaction, content, navigation, consistency, loading_state]
- **severity**: one of [critical, warning, suggestion]
- **location**: description of where on the screen (e.g., "top navigation bar", "hero section CTA button")
- **issue**: what the problem is
- **why_it_matters**: impact on user experience (1 sentence)
- **fix**: specific, actionable recommendation

## Evaluation Criteria

### Visual Hierarchy
- Is it immediately clear what the user should look at first?
- Do heading sizes create a logical reading order (H1 > H2 > H3)?
- Are CTAs visually dominant? Do secondary actions look secondary?
- Does the eye flow naturally top-to-bottom, left-to-right (or RTL where appropriate)?

### Spacing & Layout
- Is whitespace consistent? (Same spacing between similar elements)
- Do groups of related content feel visually grouped (Gestalt proximity)?
- Is there enough breathing room, or does the layout feel cramped?
- Are margins and padding consistent across sections?

### Typography
- Is body text legible? (Size >= 16px for body, line-height >= 1.4)
- Are there too many font sizes/weights? (Ideal: 3-4 sizes max)
- Is text contrast sufficient against its background?
- Are line lengths readable? (45-75 characters per line optimal)

### Color & Contrast
- Does the color palette feel cohesive (not random)?
- Is there sufficient contrast for all text? (WCAG AA minimum)
- Are interactive elements visually distinguishable from static content?
- Is color used meaningfully (not just decoratively)?

### Responsiveness (if viewport < 768px)
- Is content readable without horizontal scrolling?
- Are tap targets large enough (48x48px minimum)?
- Is the navigation accessible on mobile?
- Do images scale appropriately?

### Content & Copy
- Is it clear what this page/section does within 5 seconds?
- Are labels clear and unambiguous?
- Is there unnecessary jargon?
- Are empty states handled?

### Consistency
- Do similar elements look and behave the same way?
- Is the visual language consistent across what you can see?
- Do buttons follow a consistent style?

### Interaction Cues
- Is it clear what is clickable/tappable?
- Do interactive elements have visible affordances?
- Are disabled states visually distinct?

## Response Format

Respond ONLY with valid JSON:
{
  "overall_score": <1-10>,
  "summary": "<2-3 sentence overall assessment>",
  "issues": [
    {
      "category": "...",
      "severity": "critical|warning|suggestion",
      "location": "...",
      "issue": "...",
      "why_it_matters": "...",
      "fix": "..."
    }
  ],
  "strengths": ["<things done well>"],
  "viewport": "<the viewport this was captured at>"
}
```

---

## 7. CLI Interface

### Basic Usage

```bash
# Review a single URL at all default viewports
motionlint review http://localhost:3000

# Review specific routes
motionlint review http://localhost:3000 --routes /,/about,/dashboard,/settings

# Review with specific viewport only
motionlint review http://localhost:3000 --viewport mobile

# Use a specific model provider
motionlint review http://localhost:3000 --provider ollama --model llava:13b
motionlint review http://localhost:3000 --provider anthropic --model claude-sonnet-4-20250514
motionlint review http://localhost:3000 --provider openai --model gpt-4o

# Output JSON instead of Markdown
motionlint review http://localhost:3000 --format json

# Save report to file
motionlint review http://localhost:3000 --output review-report.md

# CI mode — exit code 1 if any critical issues
motionlint review http://localhost:3000 --ci --threshold warning

# Auto-discover routes from Next.js app directory
motionlint review http://localhost:3000 --discover nextjs

# Review with custom design rules
motionlint review http://localhost:3000 --rules ./design-rules.md
```

### MCP Server Mode

```bash
# Start as MCP server (stdio transport for CC)
motionlint mcp

# CC can then use tools:
# - review_url(url, viewports?, provider?, model?)
# - review_routes(base_url, routes, viewports?)
# - get_latest_report(format?)
```

### Configuration File (`.motionlintrc.json`)

```json
{
  "provider": "ollama",
  "model": "llava:13b",
  "fallbackProvider": "anthropic",
  "fallbackModel": "claude-sonnet-4-20250514",
  "viewports": {
    "mobile": { "width": 375, "height": 812 },
    "tablet": { "width": 768, "height": 1024 },
    "desktop": { "width": 1440, "height": 900 }
  },
  "defaultViewports": ["mobile", "desktop"],
  "waitFor": "networkidle",
  "waitTimeout": 10000,
  "screenshotDir": ".motionlint/screenshots",
  "reportDir": ".motionlint/reports",
  "rules": null,
  "ci": {
    "threshold": "warning",
    "failOnCritical": true
  },
  "auth": {
    "cookies": null,
    "localStorage": null,
    "beforeNavigate": null
  }
}
```

---

## 8. MCP Server Specification

### Tools

#### `review_url`
```json
{
  "name": "review_url",
  "description": "Capture and analyze a URL for UI/UX issues using vision AI",
  "inputSchema": {
    "type": "object",
    "properties": {
      "url": { "type": "string", "description": "URL to review" },
      "viewports": {
        "type": "array",
        "items": { "type": "string", "enum": ["mobile", "tablet", "desktop"] },
        "default": ["mobile", "desktop"]
      },
      "provider": { "type": "string", "description": "LLM provider override" },
      "model": { "type": "string", "description": "Model override" },
      "wait_for": { "type": "string", "description": "CSS selector to wait for before capture" }
    },
    "required": ["url"]
  }
}
```

#### `review_routes`
```json
{
  "name": "review_routes",
  "description": "Review multiple routes of an application",
  "inputSchema": {
    "type": "object",
    "properties": {
      "base_url": { "type": "string" },
      "routes": { "type": "array", "items": { "type": "string" } },
      "viewports": { "type": "array", "items": { "type": "string" } }
    },
    "required": ["base_url", "routes"]
  }
}
```

#### `review_interactions`
(v0.2)
```json
{
  "name": "review_interactions",
  "description": "Review UI after performing interaction sequences",
  "inputSchema": {
    "type": "object",
    "properties": {
      "url": { "type": "string" },
      "interactions": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "action": { "type": "string", "enum": ["click", "hover", "type", "scroll", "wait"] },
            "selector": { "type": "string" },
            "value": { "type": "string" },
            "capture_after": { "type": "boolean", "default": true }
          }
        }
      }
    },
    "required": ["url", "interactions"]
  }
}
```

### Resources

```json
{
  "name": "latest_report",
  "description": "The most recent UX review report",
  "uri": "motionlint://reports/latest",
  "mimeType": "application/json"
}
```

---

## 9. Tech Stack

| Component | Technology | Rationale |
|-----------|-----------|-----------|
| Language | TypeScript | CC ecosystem, type safety, npm distribution |
| Runtime | Node.js >= 18 | Required for Playwright, broad compatibility |
| Browser automation | Playwright | Best headless browser API, multi-browser |
| CLI framework | Commander.js | Lightweight, well-maintained |
| MCP SDK | @modelcontextprotocol/sdk | Official MCP TypeScript SDK |
| Image processing | Sharp | Resize/compress screenshots before LLM upload |
| HTTP client | Native fetch (Node 18+) | No dependencies for API calls |
| Config | cosmiconfig | Standard config file resolution |
| Report rendering | Marked + custom templates | Markdown with embedded images |

---

## 10. Provider Integration Details

### Ollama (Free / Local)

```typescript
// POST http://localhost:11434/api/generate
{
  "model": "llava:13b",
  "prompt": "<UX review prompt>",
  "images": ["<base64 screenshot>"],
  "stream": false,
  "options": { "temperature": 0.3 }
}
```

**Recommended models (ranked by capability):**
1. `llava:13b` — best quality for local, ~8GB VRAM
2. `llava:7b` — lighter, ~4GB VRAM
3. `moondream` — smallest, fast, less detailed feedback
4. `llama3.2-vision` — good balance

**Trade-off:** Local models give worse analysis than Claude/GPT-4o but cost $0 and have no rate limits. Ideal for rapid iteration loops.

### Anthropic Claude

```typescript
// POST https://api.anthropic.com/v1/messages
{
  "model": "claude-sonnet-4-20250514",
  "max_tokens": 4096,
  "messages": [{
    "role": "user",
    "content": [
      { "type": "image", "source": { "type": "base64", "media_type": "image/png", "data": "<base64>" } },
      { "type": "text", "text": "<UX review prompt>" }
    ]
  }]
}
```

### OpenAI GPT-4o

```typescript
// POST https://api.openai.com/v1/chat/completions
{
  "model": "gpt-4o",
  "messages": [{
    "role": "user",
    "content": [
      { "type": "image_url", "image_url": { "url": "data:image/png;base64,<base64>" } },
      { "type": "text", "text": "<UX review prompt>" }
    ]
  }],
  "response_format": { "type": "json_object" }
}
```

---

## 11. Project Structure

```
motionlint/
├── package.json
├── tsconfig.json
├── .motionlintrc.json          # Default config
├── README.md
├── LICENSE                    # MIT
├── src/
│   ├── index.ts              # CLI entry point
│   ├── cli/
│   │   ├── commands.ts       # Commander.js command definitions
│   │   └── output.ts         # Terminal output formatting
│   ├── capture/
│   │   ├── browser.ts        # Playwright browser management
│   │   ├── screenshot.ts     # Screenshot capture logic
│   │   └── interactions.ts   # (v0.2) Interaction sequences
│   ├── providers/
│   │   ├── interface.ts      # VisionProvider interface
│   │   ├── ollama.ts
│   │   ├── anthropic.ts
│   │   ├── openai.ts
│   │   ├── google.ts
│   │   └── resolver.ts       # Auto-detect available provider
│   ├── analysis/
│   │   ├── prompt.ts         # UX review prompt template
│   │   ├── parser.ts         # Parse LLM JSON response
│   │   └── rules.ts          # Custom design rule injection
│   ├── report/
│   │   ├── markdown.ts       # Markdown report generator
│   │   ├── json.ts           # JSON output
│   │   └── sarif.ts          # SARIF for GitHub integration
│   ├── mcp/
│   │   ├── server.ts         # MCP server setup
│   │   └── tools.ts          # Tool definitions
│   ├── config/
│   │   └── loader.ts         # Config file resolution
│   └── types.ts              # Shared TypeScript types
├── prompts/
│   ├── default.md            # Default UX review prompt
│   └── mobile-first.md       # Mobile-specific prompt variant
└── test/
    ├── fixtures/              # Sample screenshots for testing
    └── providers/             # Provider integration tests
```

---

## 12. Key Types

```typescript
interface Viewport {
  name: string;       // "mobile" | "tablet" | "desktop"
  width: number;
  height: number;
}

interface CaptureResult {
  url: string;
  viewport: Viewport;
  screenshot: Buffer;
  fullPage: boolean;
  timestamp: string;
}

interface UXIssue {
  category: 'hierarchy' | 'spacing' | 'alignment' | 'typography' | 'color' |
            'contrast' | 'responsiveness' | 'interaction' | 'content' |
            'navigation' | 'consistency' | 'loading_state';
  severity: 'critical' | 'warning' | 'suggestion';
  location: string;
  issue: string;
  why_it_matters: string;
  fix: string;
}

interface AnalysisResult {
  overall_score: number;        // 1-10
  summary: string;
  issues: UXIssue[];
  strengths: string[];
  viewport: string;
}

interface ReviewReport {
  timestamp: string;
  url: string;
  provider: string;
  model: string;
  analyses: {
    capture: CaptureResult;
    analysis: AnalysisResult;
  }[];
  aggregate_score: number;
  critical_count: number;
  warning_count: number;
  suggestion_count: number;
}

interface VisionProvider {
  name: string;
  analyze(screenshot: Buffer, prompt: string): Promise<AnalysisResult>;
  isAvailable(): Promise<boolean>;
}
```

---

## 13. Implementation Plan

### Phase 1: MVP CLI (Target: 1 weekend)

**Goal:** `motionlint review <url>` works end-to-end with Ollama or Anthropic.

1. Scaffold TypeScript project with Commander.js
2. Implement Playwright capture (single URL, 3 viewports)
3. Implement Ollama provider (llava)
4. Implement Anthropic provider (Claude Sonnet)
5. Implement provider auto-detection
6. Build UX review prompt
7. Parse JSON response with fallback for malformed output
8. Generate Markdown report
9. Wire CLI → capture → analyze → report pipeline
10. Add `--ci` exit code logic
11. Publish to npm

### Phase 2: MCP Server (Target: 2-3 days after Phase 1)

1. Add MCP server mode using `@modelcontextprotocol/sdk`
2. Implement `review_url` and `review_routes` tools
3. Implement `latest_report` resource
4. Test with Claude Code directly
5. Write CC usage examples in README

### Phase 3: Distribution & Recognition (Target: same week)

1. Record demo video (30-second terminal recording showing real issues caught)
2. Write sharp README with before/after examples
3. Publish to npm
4. Post on Hacker News, X, 即刻
5. Submit to MCP server directories (Smithery, mcp.run, Glama)

---

## 14. Success Metrics

### 14.1 Adoption (vanity)

| Metric | Target (Week 1) | Target (Month 1) |
|--------|-----------------|-------------------|
| GitHub stars | 100 | 500 |
| npm weekly downloads | 50 | 500 |
| HN front page | Yes | — |
| CC MCP directory listing | Submitted | Listed |

### 14.2 Quality (the bar that defines "successful product")

MotionLint is only worth shipping if it actually identifies UX faults a human reviewer would surface. We define success as **measured precision/recall against a labeled-truth fixture set**, evaluated continuously per provider × model. The fixture set is tiered into three complexity levels, and a model release is only certified for a given level if the prior level has passed.

The eval is **blind**: each fixture is captured with the standard UX prompt only. Labels (the seeded fault, expected categories, expected keywords) are NEVER sent to the API.

| Level | Description | Recall threshold | Control-violation cap |
| --- | --- | --- | --- |
| **L1 — Basic** | One obvious, isolated seeded fault per fixture (low-contrast CTA, 9px body text, zero spacing, etc.). Includes one true-negative control. | **≥ 80%** | **0** |
| **L2 — Intermediate** | Two or three subtler co-occurring issues per fixture (form lacking required indicators + identically-styled destructive buttons; icon-only nav + invisible active state; etc.). | **≥ 60%** | **0** |
| **L3 — Realistic** | Production-style pages where the fault is conditional (only at certain viewports, only after a state change, only in dense content). | **≥ 50%** | **≤ 1** |

**Definitions** (also embedded in the runtime report):

- **Recall** — fraction of labeled (seeded) issues the model correctly identified, where a "correct" detection requires (a) one of the expected `categories`, (b) severity ≥ the expected `min_severity`, and (c) a keyword match in the model's `issue/location/fix/category` text.
- **Control violation** — a deliberately well-designed control fixture was flagged with critical issues or excess warnings — i.e., the model confabulated faults on a clean page (false-positive proxy).
- **Greedy match** — each model-returned issue can satisfy at most one expected slot, so over-counting cannot inflate recall.

### 14.3 Provider scorecard (kept in `eval/results/<date>-<provider>-<model>.md`)

A model release is declared "production-grade" only when:

1. L1 passes at recall ≥ 0.8, zero control violations.
2. L2 passes at recall ≥ 0.6, zero control violations.
3. L3 attempts run (does not have to pass to ship, but recall is reported).

The `next_actions` block of the eval report — a JSON array of structured remediation TODOs — is the contract handed to the **prompt-tuning loop** (see §18) and to downstream LLM coding tools.

---

## 15. Naming & Branding

**Primary name:** `motionlint`
**npm package:** `motionlint`
**Tagline:** "AI design review in your terminal"
**Alternative names if taken:** `uxeye`, `pixelcheck`, `designlint`, `screenlint`, `uxlens`

---

## 16. Open Questions

1. **Auth handling:** How to handle apps behind login? Cookie injection? Playwright auth state? → v0.1: manual cookie config, v0.2: Playwright auth state persistence
2. **Screenshot size:** Full-page screenshots can be very tall. Compress and/or chunk for local models with limited context windows?
3. **Rate limiting:** Cloud providers have rate limits. Batch screenshots or serialize?
4. **Dark mode:** Should we capture and review both light and dark mode variants?
5. **Prompt tuning:** The UX review prompt needs iteration. Ship with a default, let users override via `--rules`.

---

## 17. CC Bootstrap Command

To get Claude Code started on this project, paste the following:

```
Read the PRD at ./PRD-motionlint.md thoroughly. Then execute Phase 1 of the implementation plan:

1. Initialize the TypeScript project (package.json, tsconfig.json, .gitignore)
2. Install dependencies: playwright, commander, sharp, cosmiconfig, @modelcontextprotocol/sdk
3. Implement the full project structure from Section 11
4. Start with capture/browser.ts and capture/screenshot.ts
5. Then providers/interface.ts, providers/ollama.ts, providers/anthropic.ts
6. Then analysis/prompt.ts and analysis/parser.ts
7. Then report/markdown.ts
8. Then cli/commands.ts and index.ts to wire it all together
9. Test the full pipeline with `npx ts-node src/index.ts review https://example.com`

Use the exact types from Section 12. Use the UX review prompt from Section 6. Follow the architecture from Section 5.
```

---

## 18. Eval Harness & Continuous Testing

### 18.1 Why this section exists

A vision-LLM-powered design reviewer is only useful if it actually catches real UX problems and doesn't hallucinate them on clean pages. Without a continuously-running eval, a MotionLint release that "looks fine in the demo" can silently regress when an upstream model is retrained. This section defines how that's prevented.

### 18.2 Architecture

```
eval/
├── truth.json              The labeled answer key. NEVER sent to the model.
└── fixtures/
    ├── _base.css           Shared minimal stylesheet (so each fixture isolates one fault).
    ├── L1-*.html           One isolated seeded fault per file.
    ├── L2-*.html           Two-to-three co-occurring subtler faults per file.
    └── L3-*.html           Realistic pages with viewport-/state-/density-conditional faults.

src/eval/
├── server.ts               Spawns an ephemeral HTTP server on a random port, serving fixtures/.
├── runner.ts               Captures (Playwright) → analyzes (provider) → scores → progresses level.
├── scorer.ts               Greedy match against expected_issues; control-violation gate.
├── report.ts               Renders the LLM-consumable scorecard (markdown + structured next_actions JSON).
└── types.ts                Public shapes for truth, scores, levels, actions.
```

### 18.3 Blind protocol

For every fixture × viewport pair:

1. The eval server returns the seeded HTML.
2. Playwright captures a full-page screenshot.
3. The provider's `analyze()` is called with **only** the standard UX prompt + the screenshot. It receives no labels, no fixture name, no UX concept, and no expected categories.
4. The scorer compares the returned issues to `truth.json[level].fixtures[*].expected_issues` using a greedy match keyed on `categories ∩ min_severity ∩ any_keywords`.

If a future contributor wants to add a new dimension, they: (a) author a fixture HTML; (b) add an entry to `truth.json` describing the seeded fault and acceptable categories/keywords; (c) re-run the eval. No code changes.

### 18.4 Level progression

The runner attempts levels in order. After each level it computes recall and control violations and emits a `level_done` event. If `passing == false` and `stopOnFail` is set (default), the runner halts. The final report records:

- `highest_passing_level` — the deepest level the provider × model combination satisfied.
- `first_failing_level` — where the regression starts (or `null` if all attempted levels passed).
- `next_actions[]` — structured remediation TODOs (one per missed expected issue and one per control violation), each carrying `{ level, fixture, ux_concept, category, severity, description, expected_signal, suggested_fix }`. This block is the machine-readable contract for downstream LLM coding tools.

### 18.5 Continuous testing in CI

```yaml
# .github/workflows/eval.yml
on: { schedule: [{ cron: "0 7 * * *" }], workflow_dispatch: }
jobs:
  eval:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        target:
          - { provider: anthropic, model: claude-sonnet-4-20250514 }
          - { provider: openai,    model: gpt-4o }
          - { provider: google,    model: gemini-1.5-pro }
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci && npx playwright install chromium
      - run: |
          npx motionlint eval \
            --provider ${{ matrix.target.provider }} \
            --model    ${{ matrix.target.model }} \
            --output   eval/results/$(date +%Y-%m-%d)-${{ matrix.target.provider }}-${{ matrix.target.model }}.md \
            --json     eval/results/$(date +%Y-%m-%d)-${{ matrix.target.provider }}-${{ matrix.target.model }}.json \
            --ci
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          OPENAI_API_KEY:    ${{ secrets.OPENAI_API_KEY }}
          GOOGLE_API_KEY:    ${{ secrets.GOOGLE_API_KEY }}
      - uses: actions/upload-artifact@v4
        with: { name: eval-${{ matrix.target.model }}, path: eval/results/ }
```

The same workflow drives a per-PR check: any change to `src/analysis/prompt.ts`, `src/providers/*`, or `eval/` re-runs the eval against the default provider before merge.

### 18.6 Promotion gate (model & prompt changes)

A change to the system prompt or to a provider implementation is only mergeable if:

1. Recall on **L1** does not regress by more than 5 percentage points.
2. Recall on **L2** does not regress by more than 10 percentage points.
3. Control violations across all levels do not increase.

Regressions block the merge. Improvements ratchet the thresholds upward (recorded in `eval/baselines.json`).

### 18.7 Final-product success definition

MotionLint is "shipped" when, on at least one supported provider × model:

- L1 ≥ 0.80 recall, 0 control violations.
- L2 ≥ 0.60 recall, 0 control violations.
- L3 attempted, recall reported (no minimum required).
- The `next_actions` JSON parses and round-trips cleanly through `JSON.parse`.
- A live demo run against the provided TS animation showcase produces a markdown report whose claims are factually grounded in the captured screenshot.

These five criteria are the load-bearing definition of "successful final product." They are checked end-to-end by `motionlint eval --ci` and by the test suite.
