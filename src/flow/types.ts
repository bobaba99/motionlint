import type { AnalysisResult, Viewport } from "../types.js";

export type FlowAction =
  | "navigate"
  | "click"
  | "hover"
  | "type"
  | "scroll"
  | "wait"
  | "press"        // keyboard press, e.g., "Enter"
  | "capture";     // frame-burst at this point

export interface FlowStep {
  /** What this step does. */
  do: FlowAction;
  /** CSS selector for click/hover/type. */
  selector?: string;
  /** Value for type / press / scroll-amount. */
  value?: string;
  /** ms for wait, scroll-amount-px for scroll. */
  ms?: number;
  /** Number of frames in the burst (capture-step only). Default 6. */
  frames?: number;
  /** Total duration of the burst in ms (capture-step only). Default 1500. */
  burst_ms?: number;
  /** Human-readable label that shows up in the report and on the contact sheet. */
  label?: string;
}

export interface FlowSpec {
  /** Human label for the whole flow (e.g., "signup happy path"). */
  name: string;
  /** Base URL the flow opens against. */
  url: string;
  /** Viewport — defaults to desktop 1440x900. */
  viewport?: Viewport;
  /** Optional list of expected animations the LLM should check for. Free-form English. */
  expected_animations?: string[];
  /** The ordered steps. */
  steps: FlowStep[];
  /** Default inter-frame interval (ms) for every burst step. Falls back to 50ms.
      A step's explicit `frames` / `burst_ms` overrides this. */
  burst_interval_ms?: number;
  /** Default burst window (ms) for every burst step. Falls back to 750ms. */
  burst_ms?: number;
}

export interface CapturedFrame {
  /** Step index this frame belongs to. */
  step_index: number;
  /** Step label (or generated). */
  step_label: string;
  /** Frame index within the burst. */
  frame_index: number;
  /** ms relative to the start of the burst. */
  t_offset_ms: number;
  /** Raw PNG buffer. */
  png: Buffer;
}

export interface FlowCaptureResult {
  spec: FlowSpec;
  /** Path to the saved Playwright video, if recording was enabled. */
  video_path?: string;
  /** All captured frames, in order. */
  frames: CapturedFrame[];
  /** Duration of the whole flow in ms. */
  total_duration_ms: number;
  /** Step-level metadata: which frames belong to which step + result of each action. */
  step_results: FlowStepResult[];
  /** Path to the rendered contact-sheet PNG used for analysis. */
  contact_sheet_path?: string;
}

export interface FlowStepResult {
  step_index: number;
  step: FlowStep;
  /** ms since the start of the flow when this step ran. */
  t_start_ms: number;
  /** ms since flow start when this step finished. */
  t_end_ms: number;
  /** Whether the action succeeded (e.g., selector found, type wrote). */
  success: boolean;
  /** Error message if !success. */
  error?: string;
  /** Indices into FlowCaptureResult.frames that were taken during/after this step. */
  frame_indices: number[];
}

export interface FlowReport {
  generated_at: string;
  flow_name: string;
  url: string;
  provider: string;
  model: string;
  capture: FlowCaptureResult;
  analysis: AnalysisResult;
  /** Deterministic input→feedback measurements, one per interaction burst. */
  latency?: import("./latency.js").LatencyMeasurement[];
  contact_sheet_path?: string;
  video_path?: string;
  /** Verbatim contents of the user-supplied preferences markdown, if any. */
  preferences_md?: string;
  /** Path to the preferences file (for the CC handoff section). */
  preferences_path?: string;
}
