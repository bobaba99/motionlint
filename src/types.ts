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
  ci: CIConfig;
  auth: AuthConfig;
}

export type OutputFormat = "md" | "json" | "sarif";
