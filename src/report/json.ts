import type { ReviewReport } from "../types.js";

export function renderJsonReport(report: ReviewReport): string {
  // strip raw screenshot Buffers from the JSON output — keep paths instead
  const safe = {
    ...report,
    analyses: report.analyses.map((entry) => ({
      capture: {
        url: entry.capture.url,
        viewport: entry.capture.viewport,
        fullPage: entry.capture.fullPage,
        timestamp: entry.capture.timestamp,
        screenshotPath: entry.capture.screenshotPath,
        videoPath: entry.capture.videoPath,
      },
      analysis: entry.analysis,
    })),
  };
  return JSON.stringify(safe, null, 2);
}
