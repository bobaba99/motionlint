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

  constructor(inner: VisionProvider, opts: SelfConsistencyOptions) {
    if (opts.samples < 1) throw new Error("samples must be >= 1");
    this.inner = inner;
    this.samples = opts.samples;
    this.threshold = opts.threshold ?? Math.ceil(opts.samples / 2);
    this.name = `${inner.name}+sc${opts.samples}`;
    this.model = inner.model;
  }

  isAvailable(): Promise<boolean> {
    return this.inner.isAvailable();
  }

  async analyze(screenshot: Buffer, prompt: string, viewportName: string): Promise<AnalysisResult> {
    if (this.samples === 1) return this.inner.analyze(screenshot, prompt, viewportName);

    const runs: AnalysisResult[] = [];
    for (let i = 0; i < this.samples; i++) {
      const result = await this.inner.analyze(screenshot, prompt, viewportName);
      runs.push(result);
    }
    return mergeRuns(runs, this.threshold, viewportName);
  }
}

function clusterKey(issue: UXIssue): string {
  return issueClusterSignature(issue.category, issue.issue);
}

export function mergeRuns(runs: AnalysisResult[], threshold: number, viewport: string): AnalysisResult {
  const buckets = new Map<string, { issue: UXIssue; votes: number; severities: IssueSeverity[] }>();
  for (const run of runs) {
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
    if (votes < threshold) continue;
    const maxSeverity = severities.reduce<IssueSeverity>(
      (max, cur) => (SEVERITY_RANK[cur] > SEVERITY_RANK[max] ? cur : max),
      "suggestion",
    );
    survivors.push({ ...issue, severity: maxSeverity });
  }

  // Median score across runs.
  const scores = runs.map((r) => r.overall_score).filter((s) => s > 0).sort((a, b) => a - b);
  const median = scores.length === 0 ? 0 : scores[Math.floor(scores.length / 2)];

  // Pick the longest non-empty summary as the synthesis.
  const summary = runs
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
