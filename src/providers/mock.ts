import type { AnalysisResult, VisionProvider } from "../types.js";
import { compressForLLM } from "./util.js";

const SAMPLE_ISSUES = [
  {
    category: "hierarchy" as const,
    severity: "warning" as const,
    location: "above-the-fold hero",
    issue: "Primary CTA does not visually dominate the hero section.",
    why_it_matters: "Users may not immediately know what action to take, lowering conversion.",
    fix: "Increase the CTA's color contrast and font weight; reduce competing elements nearby.",
  },
  {
    category: "spacing" as const,
    severity: "suggestion" as const,
    location: "feature card grid",
    issue: "Gaps between feature cards look uneven across rows.",
    why_it_matters: "Inconsistent rhythm reads as unpolished and reduces perceived quality.",
    fix: "Standardize on a single spacing token (e.g., gap-6) and verify column gutters match.",
  },
  {
    category: "typography" as const,
    severity: "suggestion" as const,
    location: "body copy throughout",
    issue: "Body text appears smaller than 16px on desktop.",
    why_it_matters: "Reduces readability for users over 35 and on high-DPI screens.",
    fix: "Bump body to 16px / line-height 1.5; reserve 14px for captions only.",
  },
];

/**
 * Mock vision provider used when no API key is set and no Ollama is running.
 * Generates deterministic, plausible UX feedback so the full pipeline can be exercised
 * end-to-end (capture → analysis → report) for demos, CI smoke tests, and offline use.
 */
export class MockProvider implements VisionProvider {
  readonly name = "mock";
  readonly model = "motionlint-mock-heuristics";

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async analyze(screenshot: Buffer, prompt: string, viewportName: string): Promise<AnalysisResult> {
    // Touch sharp so the mock at least decodes the image (catches truly broken captures).
    const { data } = await compressForLLM(screenshot, { format: "jpeg", maxWidth: 320, quality: 60 });
    const fingerprint = data.length;

    // When the prompt lists element refs, cite the first one like a real model
    // would — keeps the annotation path exercisable offline.
    const hasRefs = prompt.includes("## Interactive elements (stable refs)");
    const issues = SAMPLE_ISSUES.map((i, idx) => ({
      ...i,
      location: `${i.location} (${viewportName})`,
      issue: idx === 0 && viewportName === "mobile"
        ? `${i.issue} On mobile this is amplified because the CTA risks falling below the fold.`
        : i.issue,
      ...(hasRefs && idx === 0 ? { element_ref: "E1" } : {}),
    }));

    return {
      overall_score: 7,
      summary: `Heuristic mock review (no vision LLM configured). Capture decoded successfully (${fingerprint} bytes compressed). Configure ANTHROPIC_API_KEY, OPENAI_API_KEY, GOOGLE_API_KEY or run Ollama locally for real analysis.`,
      issues,
      strengths: [
        "Page rendered without errors and the screenshot was captured cleanly.",
        "Layout fits within the target viewport without horizontal scroll.",
      ],
      viewport: viewportName,
      // Deterministic synthetic usage so budget/accounting paths are testable offline.
      usage: { input_tokens: 1000, output_tokens: 250, total_tokens: 1250 },
    };
  }
}
