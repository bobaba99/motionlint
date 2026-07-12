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
}

export interface CaptureResult {
  url: string;
  viewport: Viewport;
  screenshot: Buffer;
  screenshotPath?: string;
  videoPath?: string;
  fullPage: boolean;
  timestamp: string;
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
}

export interface AnalysisResult {
  overall_score: number;
  summary: string;
  issues: UXIssue[];
  strengths: string[];
  viewport: string;
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
  provider: string;
  model: string;
  analyses: AnalysisEntry[];
  aggregate_score: number;
  critical_count: number;
  warning_count: number;
  suggestion_count: number;
  omitted: OmittedCounts;
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
