import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { findingHash } from "../src/memory/hash.js";
import { loadBaseline } from "../src/memory/baseline.js";
import {
  emptyStore,
  loadMemory,
  recordFindings,
  saveMemory,
  seenCount,
} from "../src/memory/store.js";
import { applyMemory } from "../src/memory/filter.js";
import { aggregate } from "../src/report/aggregate.js";
import { renderMarkdownReport } from "../src/report/markdown.js";
import { renderSarifReport } from "../src/report/sarif.js";
import { runReview } from "../src/pipeline.js";
import { defaultConfig } from "../src/config/loader.js";
import type { AnalysisEntry, MotionLintConfig, UXIssue } from "../src/types.js";

function issue(overrides: Partial<UXIssue> = {}): UXIssue {
  return {
    category: "spacing",
    severity: "warning",
    location: "feature card grid",
    issue: "Gaps between feature cards look uneven across rows.",
    why_it_matters: "Inconsistent rhythm reads as unpolished.",
    fix: "Standardize on a single spacing token.",
    ...overrides,
  };
}

function entryWith(issues: UXIssue[]): AnalysisEntry {
  return {
    capture: {
      url: "http://x",
      viewport: { name: "desktop", width: 1440, height: 900 },
      screenshot: Buffer.from(""),
      fullPage: true,
      timestamp: new Date().toISOString(),
    },
    analysis: {
      overall_score: 7,
      summary: "",
      issues,
      strengths: [],
      viewport: "desktop",
    },
  };
}

const scratchDirs: string[] = [];
async function scratchDir(): Promise<string> {
  const dir = await mkdtemp(resolve(".motionlint/test-samples/memory-"));
  scratchDirs.push(dir);
  return dir;
}

after(async () => {
  for (const dir of scratchDirs) await rm(dir, { recursive: true, force: true });
});

describe("findingHash", () => {
  it("is deterministic and 16 hex chars", () => {
    const a = findingHash(issue());
    const b = findingHash(issue());
    assert.equal(a, b);
    assert.match(a, /^[0-9a-f]{16}$/);
  });

  it("differs when the category differs", () => {
    assert.notEqual(findingHash(issue()), findingHash(issue({ category: "alignment" })));
  });

  it("differs when the location differs", () => {
    assert.notEqual(findingHash(issue()), findingHash(issue({ location: "site footer" })));
  });

  it("normalizes location case and whitespace", () => {
    assert.equal(
      findingHash(issue({ location: "Feature   Card Grid " })),
      findingHash(issue({ location: "feature card grid" })),
    );
  });

  it("tolerates rephrased issue text with the same leading key tokens", () => {
    // issueClusterSignature keys on the first three canonical tokens, sorted,
    // so trailing rewording must not change the hash.
    assert.equal(
      findingHash(issue({ issue: "Gaps between feature cards appear inconsistent." })),
      findingHash(issue({ issue: "Gaps between feature cards look uneven across rows." })),
    );
  });

  it("ignores severity — the same finding at a different severity is the same finding", () => {
    assert.equal(findingHash(issue({ severity: "critical" })), findingHash(issue({ severity: "warning" })));
  });
});

describe("findingsMatch (fuzzy recurrence)", () => {
  // Real pairs observed across live vision-LLM runs — same fault, different phrasing.
  it("matches the same fault described differently across runs", async () => {
    const { findingsMatch } = await import("../src/memory/match.js");
    assert.ok(findingsMatch(
      {
        category: "loading_state",
        location: "Testimonials section below 'Loved by teams...' heading",
        issue: "The testimonials section has a heading and subtext but no actual testimonial cards, quotes, or avatars rendered.",
      },
      {
        category: "content",
        location: "Testimonials section below 'Loved by teams...' heading",
        issue: "The section heading and subcopy explicitly state 'Sample testimonials below' but no testimonials are rendered.",
      },
    ));
    assert.ok(findingsMatch(
      {
        category: "spacing",
        location: "Gap between hero CTA area and 'Everything you need' section",
        issue: "There is a very large empty vertical gap (roughly 400-500px) between sections.",
      },
      {
        category: "spacing",
        location: "Between hero section and 'Everything you need to move fast' heading",
        issue: "There is a very large empty vertical gap (roughly 250-300px) with no content.",
      },
    ));
  });

  it("does not match distinct findings that merely share a category", async () => {
    const { findingsMatch } = await import("../src/memory/match.js");
    assert.ok(!findingsMatch(
      {
        category: "contrast",
        location: "Faded 'Lottie + JSON' card text and icon",
        issue: "Text and icon in the ghosted card fall well below 4.5:1 contrast against the dark background.",
      },
      {
        category: "typography",
        location: "Hero subheading paragraph",
        issue: "Paragraph text wraps at a wide measure exceeding the 75ch line-length guideline.",
      },
    ));
  });

  it("requires compatible categories even with token overlap", async () => {
    const { findingsMatch } = await import("../src/memory/match.js");
    assert.ok(!findingsMatch(
      { category: "color", location: "feature card grid", issue: "Feature card grid colors clash with the brand palette badly here." },
      { category: "navigation", location: "feature card grid", issue: "Feature card grid colors clash with the brand palette badly here." },
    ));
  });
});

describe("fuzzy recurrence through store and filter", () => {
  const original: UXIssue = issue({
    category: "loading_state",
    location: "Testimonials section below 'Loved by teams...' heading",
    issue: "The testimonials section has a heading and subtext but no actual testimonial cards, quotes, or avatars rendered.",
  });
  const rephrased: UXIssue = issue({
    category: "content",
    location: "Testimonials section below 'Loved by teams...' heading",
    issue: "The section heading and subcopy explicitly state 'Sample testimonials below' but no testimonials are rendered.",
  });

  it("recordFindings increments the matched entry instead of creating a duplicate", () => {
    const s1 = recordFindings(emptyStore(), "http://a/", [original], "2026-07-01T00:00:00Z");
    const s2 = recordFindings(s1, "http://a/", [rephrased], "2026-07-02T00:00:00Z");
    const entries = Object.entries(s2.urls["http://a/"]);
    assert.equal(entries.length, 1, "rephrased recurrence must merge into the existing entry");
    assert.equal(entries[0][1].seen_count, 2);
  });

  it("does not collapse similar findings observed within the same run", () => {
    // Fuzzy resolution must run against the pre-run store, not entries created
    // moments earlier in the same loop — otherwise the second finding is
    // silently dropped and permanently conflated with the first.
    const s1 = recordFindings(emptyStore(), "http://a/", [original, rephrased], "2026-07-01T00:00:00Z");
    const entries = Object.values(s1.urls["http://a/"]);
    assert.equal(entries.length, 2, "same-run similar findings must keep their own entries");
    assert.ok(entries.every((e) => e.seen_count === 1));
  });

  it("applyMemory annotates a rephrased recurrence with the canonical id", () => {
    const s1 = recordFindings(emptyStore(), "http://a/", [original], "2026-07-01T00:00:00Z");
    const result = applyMemory({
      analyses: [entryWith([rephrased])],
      url: "http://a/",
      baseline: new Set(),
      store: s1,
      newOnly: false,
    });
    const annotated = result.analyses[0].analysis.issues[0];
    assert.equal(annotated.hash, findingHash(original), "must carry the stored canonical id");
    assert.equal(annotated.previously_seen, 1);
  });

  it("baseline on the canonical id suppresses rephrased recurrences", () => {
    const s1 = recordFindings(emptyStore(), "http://a/", [original], "2026-07-01T00:00:00Z");
    const result = applyMemory({
      analyses: [entryWith([rephrased])],
      url: "http://a/",
      baseline: new Set([findingHash(original)]),
      store: s1,
      newOnly: true,
    });
    assert.equal(result.analyses[0].analysis.issues.length, 0);
    assert.equal(result.by_baseline, 1);
  });
});

describe("loadBaseline", () => {
  it("returns an empty set for a missing file", async () => {
    const dir = await scratchDir();
    const set = await loadBaseline(join(dir, "does-not-exist"));
    assert.equal(set.size, 0);
  });

  it("parses hashes, ignoring comments, notes, and blank lines", async () => {
    const dir = await scratchDir();
    const path = join(dir, ".motionlintignore");
    await writeFile(
      path,
      [
        "# suppressed findings",
        "",
        "aaaaaaaaaaaaaaaa",
        "bbbbbbbbbbbbbbbb hero CTA contrast — intentional brand color",
        "cccccccccccccccc # waved off 2026-07-01",
      ].join("\n"),
      "utf8",
    );
    const set = await loadBaseline(path);
    assert.deepEqual([...set].sort(), ["aaaaaaaaaaaaaaaa", "bbbbbbbbbbbbbbbb", "cccccccccccccccc"]);
  });
});

describe("memory store", () => {
  it("records findings and reports prior sighting counts", () => {
    const s0 = emptyStore();
    const s1 = recordFindings(s0, "http://a/", [issue()], "2026-07-01T00:00:00Z");
    const s2 = recordFindings(s1, "http://a/", [issue()], "2026-07-02T00:00:00Z");
    const hash = findingHash(issue());
    assert.equal(seenCount(s0, "http://a/", hash), 0);
    assert.equal(seenCount(s1, "http://a/", hash), 1);
    assert.equal(seenCount(s2, "http://a/", hash), 2);
    assert.equal(seenCount(s2, "http://other/", hash), 0);
  });

  it("counts a finding once per run even if it appears in multiple entries", () => {
    const s1 = recordFindings(emptyStore(), "http://a/", [issue(), issue()], "2026-07-01T00:00:00Z");
    assert.equal(seenCount(s1, "http://a/", findingHash(issue())), 1);
  });

  it("does not mutate the input store", () => {
    const s0 = emptyStore();
    recordFindings(s0, "http://a/", [issue()], "2026-07-01T00:00:00Z");
    assert.deepEqual(s0.urls, {});
  });

  it("round-trips through disk", async () => {
    const dir = await scratchDir();
    const path = join(dir, "memory.json");
    const s1 = recordFindings(emptyStore(), "http://a/", [issue()], "2026-07-01T00:00:00Z");
    await saveMemory(path, s1);
    const loaded = await loadMemory(path);
    assert.deepEqual(loaded, s1);
  });

  it("returns an empty store for a missing file", async () => {
    const dir = await scratchDir();
    const loaded = await loadMemory(join(dir, "missing.json"));
    assert.deepEqual(loaded, emptyStore());
  });

  it("throws a descriptive error for a corrupt file", async () => {
    const dir = await scratchDir();
    const path = join(dir, "memory.json");
    await writeFile(path, "{not json", "utf8");
    await assert.rejects(() => loadMemory(path), /corrupt/);
  });

  it("preserves first_seen while updating last_seen", async () => {
    const s1 = recordFindings(emptyStore(), "http://a/", [issue()], "2026-07-01T00:00:00Z");
    const s2 = recordFindings(s1, "http://a/", [issue()], "2026-07-02T00:00:00Z");
    const entry = s2.urls["http://a/"][findingHash(issue())];
    assert.equal(entry.first_seen, "2026-07-01T00:00:00Z");
    assert.equal(entry.last_seen, "2026-07-02T00:00:00Z");
  });
});

describe("applyMemory", () => {
  it("annotates every finding with its hash and prior sighting count", () => {
    const store = recordFindings(emptyStore(), "http://a/", [issue()], "2026-07-01T00:00:00Z");
    const fresh = issue({ location: "site footer", issue: "Footer links wrap awkwardly." });
    const result = applyMemory({
      analyses: [entryWith([issue(), fresh])],
      url: "http://a/",
      baseline: new Set(),
      store,
      newOnly: false,
    });
    const issues = result.analyses[0].analysis.issues;
    assert.equal(issues.length, 2);
    assert.equal(issues[0].hash, findingHash(issue()));
    assert.equal(issues[0].previously_seen, 1);
    assert.equal(issues[1].hash, findingHash(fresh));
    assert.equal(issues[1].previously_seen, 0);
    assert.equal(result.by_baseline, 0);
    assert.equal(result.by_memory, 0);
  });

  it("suppresses baselined findings and counts them", () => {
    const result = applyMemory({
      analyses: [entryWith([issue()])],
      url: "http://a/",
      baseline: new Set([findingHash(issue())]),
      store: emptyStore(),
      newOnly: false,
    });
    assert.equal(result.analyses[0].analysis.issues.length, 0);
    assert.equal(result.by_baseline, 1);
  });

  it("drops previously-seen findings in newOnly mode, keeping new ones", () => {
    const store = recordFindings(emptyStore(), "http://a/", [issue()], "2026-07-01T00:00:00Z");
    const fresh = issue({ location: "site footer", issue: "Footer links wrap awkwardly." });
    const result = applyMemory({
      analyses: [entryWith([issue(), fresh])],
      url: "http://a/",
      baseline: new Set(),
      store,
      newOnly: true,
    });
    const issues = result.analyses[0].analysis.issues;
    assert.equal(issues.length, 1);
    assert.equal(issues[0].hash, findingHash(fresh));
    assert.equal(result.by_memory, 1);
  });

  it("does not mutate the input analyses or issues", () => {
    const analyses = [entryWith([issue()])];
    applyMemory({
      analyses,
      url: "http://a/",
      baseline: new Set(),
      store: emptyStore(),
      newOnly: false,
    });
    assert.equal("hash" in analyses[0].analysis.issues[0], false);
  });

  it("scopes memory to the URL — the same finding on another page is new", () => {
    const store = recordFindings(emptyStore(), "http://a/", [issue()], "2026-07-01T00:00:00Z");
    const result = applyMemory({
      analyses: [entryWith([issue()])],
      url: "http://b/",
      baseline: new Set(),
      store,
      newOnly: true,
    });
    assert.equal(result.analyses[0].analysis.issues.length, 1);
    assert.equal(result.by_memory, 0);
  });
});

describe("reporter surfacing of memory annotations", () => {
  function annotatedReport() {
    const store = recordFindings(emptyStore(), "http://a/", [issue()], "2026-07-01T00:00:00Z");
    const filtered = applyMemory({
      analyses: [entryWith([issue()])],
      url: "http://a/",
      baseline: new Set(),
      store,
      newOnly: false,
    });
    return aggregate("http://a/", "mock", "m", filtered.analyses, {
      omitted: { by_baseline: filtered.by_baseline, by_memory: filtered.by_memory },
    });
  }

  it("markdown shows the finding id and prior sighting count", () => {
    const md = renderMarkdownReport(annotatedReport());
    assert.ok(md.includes(findingHash(issue())), "id missing from markdown");
    assert.ok(md.includes("seen in 1 prior run"), "sighting count missing from markdown");
  });

  it("markdown shows an Omitted line only when findings were removed", () => {
    const store = recordFindings(emptyStore(), "http://a/", [issue()], "2026-07-01T00:00:00Z");
    const filtered = applyMemory({
      analyses: [entryWith([issue()])],
      url: "http://a/",
      baseline: new Set(),
      store,
      newOnly: true,
    });
    const capped = aggregate("http://a/", "mock", "m", filtered.analyses, {
      omitted: { by_baseline: filtered.by_baseline, by_memory: filtered.by_memory },
    });
    assert.ok(renderMarkdownReport(capped).includes("**Omitted:** 1 previously seen"));
    assert.ok(!renderMarkdownReport(annotatedReport()).includes("**Omitted:**"));
  });

  it("terminal summary shows the Omitted line when findings were removed", async () => {
    const { summarize } = await import("../src/cli/output.js");
    const store = recordFindings(emptyStore(), "http://a/", [issue()], "2026-07-01T00:00:00Z");
    const filtered = applyMemory({
      analyses: [entryWith([issue()])],
      url: "http://a/",
      baseline: new Set(),
      store,
      newOnly: true,
    });
    const report = aggregate("http://a/", "mock", "m", filtered.analyses, {
      omitted: { by_baseline: filtered.by_baseline, by_memory: filtered.by_memory },
    });
    assert.ok(summarize(report).includes("Omitted:"), "terminal summary must explain removed findings");
    assert.ok(!summarize(annotatedReport()).includes("Omitted:"));
  });

  it("sarif carries the finding hash as a partial fingerprint", () => {
    const sarif = JSON.parse(renderSarifReport(annotatedReport()));
    const result = sarif.runs[0].results[0];
    assert.equal(result.partialFingerprints["motionlintFinding/v1"], findingHash(issue()));
    assert.equal(result.properties.previously_seen, 1);
  });
});

describe("pipeline memory integration (requires demo server on :4173)", () => {
  async function memoryConfig(): Promise<{ config: MotionLintConfig; dir: string }> {
    const dir = await scratchDir();
    const config: MotionLintConfig = {
      ...defaultConfig,
      defaultViewports: ["desktop"],
      screenshotDir: join(dir, "screenshots"),
      videoDir: join(dir, "videos"),
      reportDir: join(dir, "reports"),
      memory: {
        ...defaultConfig.memory,
        path: join(dir, "memory.json"),
        baseline: join(dir, ".motionlintignore"),
      },
    };
    return { config, dir };
  }

  const URL = "http://localhost:4173";

  it("annotates recurrences on the second run and persists the store", async () => {
    const { config } = await memoryConfig();
    const run1 = await runReview({ url: URL, config, provider: "mock", outputPath: null });
    const first = run1.report.analyses[0].analysis.issues;
    assert.ok(first.length > 0, "mock provider should report issues");
    assert.ok(first.every((i) => i.hash && i.previously_seen === 0), "run 1 findings must be new");

    const run2 = await runReview({ url: URL, config, provider: "mock", outputPath: null });
    const second = run2.report.analyses[0].analysis.issues;
    assert.ok(second.every((i) => (i.previously_seen ?? 0) >= 1), "run 2 findings must be marked as seen");

    const store = await loadMemory(config.memory.path);
    assert.ok(Object.keys(store.urls[URL] ?? {}).length > 0, "memory store must be persisted");
  });

  it("drops recurrences with newOnly and suppresses baselined hashes", async () => {
    const { config } = await memoryConfig();
    const run1 = await runReview({ url: URL, config, provider: "mock", outputPath: null });
    const issues = run1.report.analyses[0].analysis.issues;

    const newOnly = await runReview({ url: URL, config, provider: "mock", outputPath: null, newOnly: true });
    assert.equal(newOnly.report.analyses[0].analysis.issues.length, 0);
    assert.equal(newOnly.report.omitted.by_memory, issues.length);

    await writeFile(config.memory.baseline, `${issues[0].hash} waved off in test\n`, "utf8");
    const baselined = await runReview({ url: URL, config, provider: "mock", outputPath: null });
    assert.equal(baselined.report.omitted.by_baseline, 1);
    assert.equal(baselined.report.analyses[0].analysis.issues.length, issues.length - 1);
  });

  it("writes no memory state when disabled", async () => {
    const { config } = await memoryConfig();
    const run = await runReview({ url: URL, config, provider: "mock", outputPath: null, memory: false });
    const issues = run.report.analyses[0].analysis.issues;
    assert.ok(issues.every((i) => i.hash === undefined), "findings must not be annotated when memory is off");
    await assert.rejects(() => readFile(config.memory.path, "utf8"), /ENOENT/);
  });
});
