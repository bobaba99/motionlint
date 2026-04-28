import type { InteractionStep } from "../types.js";

export function parseInteractionsFromString(input: string): InteractionStep[] {
  const trimmed = input.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("[")) {
    return JSON.parse(trimmed) as InteractionStep[];
  }
  return trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line): InteractionStep => {
      const [action, ...rest] = line.split(/\s+/);
      const value = rest.join(" ");
      switch (action) {
        case "click":
        case "hover":
          return { action, selector: value };
        case "type": {
          const idx = value.indexOf("=");
          return idx > 0
            ? { action, selector: value.slice(0, idx), value: value.slice(idx + 1) }
            : { action, selector: value };
        }
        case "scroll":
          return { action, value };
        case "wait":
          return { action, ms: Number(value) || 500 };
        default:
          throw new Error(`Unknown interaction action: ${action}`);
      }
    });
}
