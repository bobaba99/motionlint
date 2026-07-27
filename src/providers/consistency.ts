import type { AnalysisResult, IssueSeverity, UXIssue, VisionProvider } from "../types.js";
import { issueClusterSignature } from "../eval/synonyms.js";

const SEVERITY_RANK: Record<IssueSeverity, number> = { suggestion: 0, warning: 1, critical: 2 };

export interface SelfConsistencyOptions {
  samples: number;
  /** An issue must appear in at least this many samples to survive. Default = ceil(samples/2). */
  threshold?: number;
}

/**
 * Decorates any VisionProvider with self-consistency sampling.
 *
 * Calls the underlying provider N times and merges the results:
 *   - issues are clustered by (category, normalized location, normalized issue text)
 *   - clusters with < threshold votes are dropped (filters single-run hallucinations)
 *   - surviving issues take the maximum severity across votes
 *   - the cheapest non-empty summary is kept
 *   - overall_score is the median of the samples
 *
 * Recall typically rises ~10-20pp at the cost of N× provider spend.
 */
export class SelfConsistencyProvider implements VisionProvider {
  readonly name: string;
  readonly model: string;
  private readonly inner: VisionProvider;
  private readonly samples: number;
  private readonly threshold: number;
  /** Only set when the caller pinned a threshold; otherwise it is derived per run
      from how many samples actually succeeded. */
  private readonly explicitThreshold: number | undefined;

  constructor(inner: VisionProvider, opts: SelfConsistencyOptions) {
    if (opts.samples < 1) throw new Error("samples must be >= 1");
    this.inner = inner;
    this.samples = opts.samples;
    this.explicitThreshold = opts.threshold;
    this.threshold = opts.threshold ?? Math.ceil(opts.samples / 2);
    this.name = `${inner.name}+sc${opts.samples}`;
    this.model = inner.model;
  }

  isAvailable(): Promise<boolean> {
    return this.inner.isAvailable();
  }

  async analyze(screenshot: Buffer, prompt: string, viewportName: string): Promise<AnalysisResult> {
    if (this.samples === 1) return this.inner.analyze(screenshot, prompt, viewportName);

    // Providers now throw on truncated / refused / blocked responses. One bad
    // sample must not sink the whole run, but the failures have to be visible —
    // silently sampling 1 of 3 while charging for 3 is its own kind of lie.
    const runs: AnalysisResult[] = [];
    const failures: string[] = [];
    for (let i = 0; i < this.samples; i++) {
      try {
        runs.push(await this.inner.analyze(screenshot, prompt, viewportName));
      } catch (err) {
        failures.push((err as Error).message);
      }
    }

    if (runs.length === 0) {
      throw new Error(
        `All ${this.samples} self-consistency samples failed for ${viewportName}. First error: ${failures[0]}`,
      );
    }

    // Scale the threshold to the samples that actually produced a review. Using
    // the attempted count let failed samples veto findings the surviving samples
    // genuinely reported.
    const threshold = Math.min(
      this.explicitThreshold ?? Math.ceil(runs.length / 2),
      runs.length,
    );

    const merged = mergeRuns(runs, threshold, viewportName);
    if (failures.length === 0) return merged;

    return {
      ...merged,
      summary:
        `[${failures.length} of ${this.samples} samples failed; merged from ${runs.length}] ` +
        merged.summary,
    };
  }
}

function clusterKey(issue: UXIssue): string {
  return issueClusterSignature(issue.category, issue.issue);
}

export function mergeRuns(runs: AnalysisResult[], threshold: number, viewport: string): AnalysisResult {
  // A run that reported no issues AND scored 0 produced nothing usable: either it
  // failed to parse, or it claims a page is worst-possible while naming no fault.
  // Counting those toward the vote denominator let failures veto real findings —
  // the surviving sample's issues fell short of a threshold sized for samples
  // that never voted, and the merge came back "no issues" with a healthy median.
  const voting = runs.filter((r) => r.issues.length > 0 || r.overall_score > 0);
  const counted = voting.length > 0 ? voting : runs;

  // Also clamp: a threshold above the usable-run count can never be met.
  const effectiveThreshold = Math.max(1, Math.min(threshold, counted.length));

  const buckets = new Map<string, { issue: UXIssue; votes: number; severities: IssueSeverity[] }>();
  for (const run of counted) {
    const seenKeys = new Set<string>();
    for (const issue of run.issues) {
      const key = clusterKey(issue);
      if (seenKeys.has(key)) continue; // don't double-count within one run
      seenKeys.add(key);
      const existing = buckets.get(key);
      if (existing) {
        existing.votes += 1;
        existing.severities.push(issue.severity);
      } else {
        buckets.set(key, { issue, votes: 1, severities: [issue.severity] });
      }
    }
  }

  const survivors: UXIssue[] = [];
  for (const { issue, votes, severities } of buckets.values()) {
    if (votes < effectiveThreshold) continue;
    const maxSeverity = severities.reduce<IssueSeverity>(
      (max, cur) => (SEVERITY_RANK[cur] > SEVERITY_RANK[max] ? cur : max),
      "suggestion",
    );
    survivors.push({ ...issue, severity: maxSeverity });
  }

  // Median score across runs.
  const scores = counted.map((r) => r.overall_score).filter((s) => s > 0).sort((a, b) => a - b);
  const median = scores.length === 0 ? 0 : scores[Math.floor(scores.length / 2)];

  // Pick the longest non-empty summary as the synthesis.
  const summary = counted
    .map((r) => r.summary)
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)[0] ?? "";

  // Union of strengths.
  const strengthSet = new Set<string>();
  for (const r of runs) for (const s of r.strengths) strengthSet.add(s);

  // Sum usage across samples — the caller paid for every one of them.
  const reported = runs.filter((r) => r.usage);
  const usage = reported.length === 0 ? undefined : reported.reduce(
    (acc, r) => ({
      input_tokens: acc.input_tokens + (r.usage?.input_tokens ?? 0),
      output_tokens: acc.output_tokens + (r.usage?.output_tokens ?? 0),
      total_tokens: acc.total_tokens + (r.usage?.total_tokens ?? 0),
    }),
    { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
  );

  return {
    overall_score: median,
    summary,
    issues: survivors,
    strengths: [...strengthSet],
    viewport,
    ...(usage ? { usage } : {}),
  };
}
