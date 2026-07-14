import { cosmiconfig } from "cosmiconfig";
import type { MotionLintConfig } from "../types.js";

const DEFAULT_CONFIG: MotionLintConfig = {
  provider: "auto",
  model: null,
  fallbackProvider: "anthropic",
  fallbackModel: "claude-sonnet-5",
  viewports: {
    mobile: { width: 375, height: 812 },
    tablet: { width: 768, height: 1024 },
    desktop: { width: 1440, height: 900 },
  },
  defaultViewports: ["mobile", "desktop"],
  waitFor: "networkidle",
  waitTimeout: 10000,
  screenshotDir: ".motionlint/screenshots",
  videoDir: ".motionlint/videos",
  reportDir: ".motionlint/reports",
  rules: null,
  record: false,
  maxFindings: null,
  maxPrAnnotations: null,
  memory: {
    enabled: true,
    path: ".motionlint/memory.json",
    baseline: ".motionlintignore",
    newOnly: false,
  },
  resources: { maxConcurrentReviews: null, providerCallsPerMinute: null, maxTokensPerRun: null },
  ci: { threshold: "warning", failOnCritical: true },
  auth: { cookies: null, localStorage: null, beforeNavigate: null },
};

function deepMerge<T>(base: T, override: Partial<T> | undefined): T {
  if (!override) return base;
  const baseRec = base as unknown as Record<string, unknown>;
  const overRec = override as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = { ...baseRec };
  for (const [key, value] of Object.entries(overRec)) {
    if (value === undefined) continue;
    const baseVal = baseRec[key];
    if (
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      typeof baseVal === "object" &&
      baseVal !== null &&
      !Array.isArray(baseVal)
    ) {
      out[key] = deepMerge(baseVal, value as Record<string, unknown>);
    } else {
      out[key] = value;
    }
  }
  return out as T;
}

export async function loadConfig(cwd: string = process.cwd()): Promise<MotionLintConfig> {
  const explorer = cosmiconfig("motionlint", {
    searchPlaces: [
      ".motionlintrc.json",
      ".motionlintrc",
      ".motionlintrc.js",
      "motionlint.config.js",
      "motionlint.config.cjs",
      "motionlint.config.mjs",
      "package.json",
    ],
  });
  const result = await explorer.search(cwd);
  const userCfg = (result?.config ?? {}) as Partial<MotionLintConfig>;
  return deepMerge(DEFAULT_CONFIG, userCfg);
}

export const defaultConfig = DEFAULT_CONFIG;
