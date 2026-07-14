/**
 * Provider scorecard history: every eval run appends a compact record keyed by
 * provider+model, so regressions across releases (recall drops, newly failing
 * levels) are caught by comparing against the previous run of the same
 * configuration — not by memory.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { EvalReport } from "./types.js";

export interface EvalRunRecord {
  timestamp: string;
  provider: string;
  model: string;
  levels: Record<string, { recall: number; control_violations: number; passing: boolean }>;
  aggregate_recall: number;
  overall_passing: boolean;
  next_actions: number;
}

export interface EvalHistory {
  version: 1;
  runs: EvalRunRecord[];
}

const MAX_RUNS = 100;

export function emptyHistory(): EvalHistory {
  return { version: 1, runs: [] };
}

export async function loadHistory(path: string): Promise<EvalHistory> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as EvalHistory;
    if (parsed?.version !== 1 || !Array.isArray(parsed.runs)) return emptyHistory();
    return parsed;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return emptyHistory();
    return emptyHistory();
  }
}

export async function saveHistory(path: string, history: EvalHistory): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(history, null, 2), "utf8");
}

export function recordFromReport(report: EvalReport): EvalRunRecord {
  const levels: EvalRunRecord["levels"] = {};
  let expected = 0;
  let detected = 0;
  for (const level of report.levels) {
    levels[level.level] = {
      recall: level.recall,
      control_violations: level.control_violations,
      passing: level.passing,
    };
    expected += level.total_expected;
    detected += level.total_detected;
  }
  return {
    timestamp: report.generated_at,
    provider: report.provider,
    model: report.model,
    levels,
    aggregate_recall: expected > 0 ? Math.round((detected / expected) * 1000) / 1000 : 0,
    overall_passing: report.overall_passing,
    next_actions: report.next_actions.length,
  };
}

/** Append immutably, keeping the newest MAX_RUNS records. */
export function appendRun(history: EvalHistory, record: EvalRunRecord): EvalHistory {
  return { version: 1, runs: [...history.runs, record].slice(-MAX_RUNS) };
}

/** Most recent prior run of the same provider+model, if any. */
export function previousRun(history: EvalHistory, record: EvalRunRecord): EvalRunRecord | null {
  for (let i = history.runs.length - 1; i >= 0; i--) {
    const run = history.runs[i];
    if (run.provider === record.provider && run.model === record.model) return run;
  }
  return null;
}

const RECALL_DROP_THRESHOLD = 0.1;

/**
 * Regression messages comparing the current run against the previous run of
 * the same provider+model. Empty when there is no baseline or no regressions.
 */
export function detectRegressions(history: EvalHistory, record: EvalRunRecord): string[] {
  const prev = previousRun(history, record);
  if (!prev) return [];
  const out: string[] = [];

  if (record.aggregate_recall < prev.aggregate_recall - RECALL_DROP_THRESHOLD) {
    out.push(
      `aggregate recall dropped ${(prev.aggregate_recall * 100).toFixed(1)}% → ${(record.aggregate_recall * 100).toFixed(1)}% (vs ${prev.timestamp})`,
    );
  }
  for (const [level, cur] of Object.entries(record.levels)) {
    const before = prev.levels[level];
    if (!before) continue;
    if (before.passing && !cur.passing) {
      out.push(`${level} newly failing (was passing on ${prev.timestamp})`);
    } else if (cur.recall < before.recall - RECALL_DROP_THRESHOLD) {
      out.push(`${level} recall dropped ${(before.recall * 100).toFixed(1)}% → ${(cur.recall * 100).toFixed(1)}%`);
    }
  }
  return out;
}
