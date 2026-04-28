# Contributing to MotionLint

Thanks for your interest. MotionLint is MIT-licensed and welcomes contributions from anyone.

## Getting started

```bash
git clone https://github.com/bobaba99/motionlint.git
cd motionlint
npm install
npx playwright install chromium
npm run build
npm test
```

The test suite includes integration tests that need the bundled demo app running:

```bash
node demo/server.mjs &
UXV_DEMO_URL=http://localhost:4173/ npm test
```

## What changes need

- **Type-check + tests must pass** — `npx tsc` clean and `npm test` green (currently 25/25).
- **No regressions on the eval harness** — see [PRD §18.6](PRD-motionlint.md). If you change `src/analysis/prompt.ts`, `src/providers/*`, or scoring, run the eval and confirm L1 recall doesn't drop more than 5pp and L2 not more than 10pp.
- **Conventional commit messages** — `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`.
- **No secrets in PRs** — `.env` is gitignored; never paste API keys into issues or tests.

## Adding a new vision provider

1. Implement `VisionProvider` in `src/providers/<name>.ts`.
2. Wire it into `src/providers/resolver.ts`.
3. Add the env var to `.env.example` and document in the README provider table.
4. Run `motionlint eval --provider <name> --mosaic --with-dom --consistency 3` and post the L1/L2/L3 recall numbers in your PR description.

## Adding eval fixtures

1. Author a self-contained HTML file in `eval/fixtures/<name>.html` that isolates one (L1) or two-to-three (L2) seeded UX faults. Use `/eval/_base.css` for the shared baseline so each fixture tests one variable.
2. Add an entry to `eval/truth.json` with `expected_issues[]`, `categories`, `min_severity`, and 5–8 keywords that any reasonable model description would include.
3. Run `npm test` to confirm the harness picks up the new fixture and the structure is valid.

## Adding tuner support for a new animation library

The instrumentation script lives in `src/tuner/instrument.ts` (a string injected via Playwright `addInitScript`). To support a new library:

1. Add a hook function (`hookFooLib`) that wraps the library's animation entry point and calls `record({ source: 'foolib', selector, common_name, bbox, params })`.
2. Add the source to `AnimationSource` in `src/tuner/types.ts`.
3. Add a parameter mapping in `src/tuner/extract.ts` (`deriveParams` + `deriveTechnicalName`).
4. Verify with `motionlint tune <url>` against a page using that library.

## Reporting issues

Include the OS, Node version, the command you ran, and the full console output. If the issue is in the Animation Tuner, attach the `[ml-tuner]` and `[ml-preview]` console lines — they're already labelled for grep.
