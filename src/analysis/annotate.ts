/**
 * Resolves model-cited element refs ("E3") against the capture's DOM snapshot.
 * A ref that matches gets its pixel rect attached (drawn on annotated
 * screenshots); a ref the snapshot doesn't know is dropped — the model may
 * only cite elements it was actually shown.
 */
import type { AnalysisResult } from "../types.js";
import type { DomSnapshot } from "../capture/dom.js";

export function resolveElementRefs(analysis: AnalysisResult, dom: DomSnapshot | undefined): AnalysisResult {
  const byRef = new Map((dom?.elements ?? []).map((e) => [e.ref, e.rect]));
  return {
    ...analysis,
    issues: analysis.issues.map((issue) => {
      if (!issue.element_ref) return issue;
      const rect = byRef.get(issue.element_ref);
      if (!rect) {
        const { element_ref: _dropped, ...rest } = issue;
        return rest;
      }
      return { ...issue, element_rect: rect };
    }),
  };
}
