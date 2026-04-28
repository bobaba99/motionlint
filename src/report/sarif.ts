import type { ReviewReport, IssueSeverity } from "../types.js";

const SARIF_VERSION = "2.1.0";
const SARIF_SCHEMA = "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/main/Schemata/sarif-schema-2.1.0.json";

const SEVERITY_LEVEL: Record<IssueSeverity, "error" | "warning" | "note"> = {
  critical: "error",
  warning: "warning",
  suggestion: "note",
};

export function renderSarifReport(report: ReviewReport): string {
  const results = [];
  for (const entry of report.analyses) {
    const fileRef = entry.capture.screenshotPath ?? `${entry.capture.url}#${entry.capture.viewport.name}`;
    for (const issue of entry.analysis.issues) {
      results.push({
        ruleId: `${issue.category}/${issue.severity}`,
        level: SEVERITY_LEVEL[issue.severity],
        message: {
          text: `${issue.issue}\n\nWhy it matters: ${issue.why_it_matters}\n\nFix: ${issue.fix}`,
        },
        locations: [{
          physicalLocation: {
            artifactLocation: { uri: fileRef },
            region: { startLine: 1 },
          },
          logicalLocations: [{
            name: issue.location,
            kind: "uiElement",
          }],
        }],
        properties: {
          viewport: entry.capture.viewport.name,
          category: issue.category,
        },
      });
    }
  }

  const sarif = {
    $schema: SARIF_SCHEMA,
    version: SARIF_VERSION,
    runs: [{
      tool: {
        driver: {
          name: "motionlint",
          version: "0.1.0",
          informationUri: "https://github.com/bobaba99/motionlint",
          rules: [],
        },
      },
      results,
      properties: {
        url: report.url,
        provider: report.provider,
        model: report.model,
        aggregate_score: report.aggregate_score,
      },
    }],
  };

  return JSON.stringify(sarif, null, 2);
}
