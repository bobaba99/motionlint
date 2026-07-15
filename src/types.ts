export interface Viewport {
  name: string;
  width: number;
  height: number;
}

export interface ViewportMap {
  [name: string]: { width: number; height: number };
}

export type CaptureMode = "fullPage" | "viewport";

export interface InteractionStep {
  action: "click" | "hover" | "type" | "scroll" | "wait";
  selector?: string;
  value?: string;
  ms?: number;
}

export interface CaptureOptions {
  url: string;
  viewport: Viewport;
  fullPage?: boolean;
  waitFor?: string;
  waitTimeout?: number;
  record?: boolean;
  videoDir?: string;
  screenshotDir?: string;
  interactions?: InteractionStep[];
  auth?: AuthConfig;
  /** Also capture a DOM snapshot (element refs + measurements) alongside the screenshot. */
  withDom?: boolean;
}

export interface CaptureResult {
  url: string;
  viewport: Viewport;
  screenshot: Buffer;
  screenshotPath?: string;
  videoPath?: string;
  fullPage: boolean;
  timestamp: string;
  /** DOM snapshot captured with the screenshot (when withDom was set). */
  dom?: import("./capture/dom.js").DomSnapshot;
}

export type IssueCategory =
  | "hierarchy"
  | "spacing"
  | "alignment"
  | "typography"
  | "color"
  | "contrast"
  | "responsiveness"
  | "interaction"
  | "content"
  | "navigation"
  | "consistency"
  | "loading_state";

export type IssueSeverity = "critical" | "warning" | "suggestion";

export interface UXIssue {
  category: IssueCategory;
  severity: IssueSeverity;
  location: string;
  issue: string;
  why_it_matters: string;
  fix: string;
  /** Cross-run finding identity (set when memory is enabled). Add it to the baseline file to suppress the finding. */
  hash?: string;
  /** How many prior runs recorded this finding at this URL (set when memory is enabled). */
  previously_seen?: number;
  /** Ref of the DOM element this issue concerns (e.g. "E3"), cited by the model from the capture's element list. */
  element_ref?: string;
  /** The cited element's rect in document CSS px — resolved from the DOM snapshot, drawn on annotated screenshots. */
  element_rect?: { x: number; y: number; w: number; h: number };
}

/** Tokens consumed by one provider call, normalized across providers. */
export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
}

/** Token totals for a whole review run, plus budget bookkeeping. */
export interface RunUsage extends TokenUsage {
  /** Provider analyze() calls made (counted even when a provider reports no usage). */
  calls: number;
  /** Token budget for this run (resources.maxTokensPerRun / --max-tokens). null = unlimited. */
  limit: number | null;
  /** Viewports skipped because the budget was exhausted mid-run. */
  skipped_viewports: string[];
}

export interface AnalysisResult {
  overall_score: number;
  summary: string;
  issues: UXIssue[];
  strengths: string[];
  viewport: string;
  /** Tokens the provider reported for this call; absent when the API returned no usage block. */
  usage?: TokenUsage;
}

export interface AnalysisEntry {
  capture: CaptureResult;
  analysis: AnalysisResult;
}

/** Findings removed from the report before rendering, by mechanism. */
export interface OmittedCounts {
  /** Dropped by the per-run output cap (maxFindings). */
  by_cap: number;
  /** Suppressed because their hash is listed in the baseline file. */
  by_baseline: number;
  /** Dropped as previously-seen recurrences (newOnly mode). */
  by_memory: number;
}

export interface ReviewReport {
  timestamp: string;
  url: string;
  /** Baseline URL when the run was a before/after comparison (--against). */
  against?: string;
  provider: string;
  model: string;
  analyses: AnalysisEntry[];
  aggregate_score: number;
  critical_count: number;
  warning_count: number;
  suggestion_count: number;
  omitted: OmittedCounts;
  /** Token accounting for the run (set whenever the pipeline made provider calls). */
  usage?: RunUsage;
}

export interface VisionProvider {
  name: string;
  model: string;
  analyze(screenshot: Buffer, prompt: string, viewportName: string): Promise<AnalysisResult>;
  isAvailable(): Promise<boolean>;
}

export interface AuthConfig {
  cookies?: Array<{
    name: string;
    value: string;
    domain: string;
    path?: string;
  }> | null;
  localStorage?: Record<string, string> | null;
  beforeNavigate?: string | null;
}

export interface CIConfig {
  threshold: IssueSeverity;
  failOnCritical: boolean;
}

export interface ResourceConfig {
  /** Max reviews running at once in one process (MCP server under concurrent agent calls). null = unlimited. */
  maxConcurrentReviews: number | null;
  /** Ceiling on vision-provider analyze() calls per minute across the process (quota / spend control). null = unlimited. */
  providerCallsPerMinute: number | null;
  /** Token budget per review run — once total tokens cross it, remaining viewports are skipped. null = unlimited. */
  maxTokensPerRun: number | null;
}

export interface MemoryConfig {
  /** Master switch for cross-run memory (annotation, baseline, persistence). */
  enabled: boolean;
  /** JSON store path, keyed by reviewed URL. */
  path: string;
  /** Baseline file of finding hashes to always suppress. */
  baseline: string;
  /** Report only findings not seen in prior runs. */
  newOnly: boolean;
}

export interface MotionLintConfig {
  provider: string;
  model: string | null;
  fallbackProvider: string;
  fallbackModel: string;
  viewports: ViewportMap;
  defaultViewports: string[];
  waitFor: string;
  waitTimeout: number;
  screenshotDir: string;
  videoDir: string;
  reportDir: string;
  rules: string | null;
  /** Learned-heuristics file (written by `eval --evolve`) included in review prompts when present. null disables. */
  learnedHeuristics: string | null;
  record: boolean;
  /** Per-run output cap: keep only the top N findings, severity-ordered. null = uncapped. */
  maxFindings: number | null;
  /** PR-surface cap: emit at most N SARIF results per report, severity-ordered. null = uncapped. */
  maxPrAnnotations: number | null;
  memory: MemoryConfig;
  resources: ResourceConfig;
  ci: CIConfig;
  auth: AuthConfig;
}

export type OutputFormat = "md" | "json" | "sarif" | "html";
