export type AnimationSource =
  | "css-transition"
  | "css-keyframes"
  | "motion-one"
  | "gsap"
  | "animejs"
  | "auto-animate"
  | "lottie"
  | "web-animations-api";

export interface AnimationParam {
  /** Canonical parameter name shown in the tuner. */
  name: string;
  /** Human label rendered above the slider. */
  label: string;
  /** Underlying CSS or JS property the parameter drives. */
  technical: string;
  /** Slider min. */
  min: number;
  /** Slider max. */
  max: number;
  /** Slider step. */
  step: number;
  /** Current value (numeric). */
  value: number;
  /** Display unit (ms, px, deg). */
  unit: string;
}

export interface AnimationPreset {
  name: string;
  /** Easing or style key, e.g., "ease-out", "spring(0.6,0.4)", "power2.out". */
  value: string;
  description: string;
}

export interface DetectedAnimation {
  /** Stable id used as a DOM anchor in the tuner. */
  id: string;
  /** Best-guess CSS selector pointing at the animated element. */
  selector: string;
  /** Source library / mechanism. */
  source: AnimationSource;
  /** UX terminology — e.g., "spring entrance with stagger". */
  technical_name: string;
  /** Common name for the user flow — e.g., "Pricing → CTA hover". */
  common_name: string;
  /** Element bounding box (page coords). */
  bbox: { x: number; y: number; w: number; h: number };
  /** Captured outerHTML for the live preview iframe (truncated). */
  preview_html: string;
  /** Captured stylesheet text needed to render the preview faithfully. */
  preview_css: string;
  /** Tunable parameters. */
  params: AnimationParam[];
  /** Easing / style presets the user can swap between. */
  presets: AnimationPreset[];
  /** The original raw record from the instrumentation script (for debugging). */
  raw: Record<string, unknown>;
}

export interface PageStyles {
  backgroundColor: string;
  backgroundImage: string;
  color: string;
  fontFamily: string;
}

export interface TunerCapture {
  url: string;
  captured_at: string;
  viewport: { width: number; height: number };
  animations: DetectedAnimation[];
  /** A hash of (URL + selectors) used to identify this capture. */
  capture_id: string;
  /** Computed styles of the captured page's <body> — applied to each shadow-DOM preview
      so previews reflect the source page's real theme (dark, light, gradient, etc.). */
  page_styles: PageStyles;
}
