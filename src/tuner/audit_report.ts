/**
 * Polished HTML report for a deterministic animation audit (the linter's output).
 * Renders each Emil-standard violation with a before → after panel; easing findings
 * get an inline cubic-bezier curve comparison so the fix is visible, not just described.
 */
import { escapeHtml, htmlShell, scoreRing, severityPills } from "../report/html_shell.js";
import type { AnimationAudit, AnimationFinding } from "./lint.js";

const CATEGORY_LABEL: Record<AnimationFinding["category"], string> = {
  easing: "Easing",
  duration: "Duration",
  physicality: "Physicality",
  performance: "Performance",
  accessibility: "Accessibility",
  cohesion: "Cohesion",
};

/** Parse a cubic-bezier(...) string into its four control points; null for keywords. */
function parseBezier(v: string): [number, number, number, number] | null {
  const named: Record<string, [number, number, number, number]> = {
    ease: [0.25, 0.1, 0.25, 1],
    "ease-in": [0.42, 0, 1, 1],
    "ease-out": [0, 0, 0.58, 1],
    "ease-in-out": [0.42, 0, 0.58, 1],
    linear: [0, 0, 1, 1],
  };
  const key = v.trim().toLowerCase();
  if (named[key]) return named[key];
  const m = key.match(/cubic-bezier\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)/);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
  return null;
}

/** A tiny SVG plot of an easing curve inside a unit box (y inverted for screen coords). */
function curveSvg(v: string, color: string): string {
  const pts = parseBezier(v);
  const W = 96;
  const H = 96;
  const pad = 8;
  const x = (t: number) => pad + t * (W - 2 * pad);
  const y = (t: number) => H - pad - t * (H - 2 * pad);
  const grid = `<rect x="${pad}" y="${pad}" width="${W - 2 * pad}" height="${H - 2 * pad}" fill="none" stroke="var(--border)" stroke-width="1"/>`;
  if (!pts) {
    return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${grid}<line x1="${x(0)}" y1="${y(0)}" x2="${x(1)}" y2="${y(1)}" stroke="${color}" stroke-width="2"/></svg>`;
  }
  const [x1, y1, x2, y2] = pts;
  const d = `M ${x(0)} ${y(0)} C ${x(x1)} ${y(y1)}, ${x(x2)} ${y(y2)}, ${x(1)} ${y(1)}`;
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${grid}<path d="${d}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round"/></svg>`;
}

function beforeAfter(finding: AnimationFinding): string {
  if (!finding.current && !finding.suggested) return "";
  // Easing findings render a visual curve comparison; everything else uses value chips.
  if (finding.category === "easing" && finding.current && finding.suggested) {
    return `
    <div class="ba">
      <div class="cell"><div class="cap">Current</div><div class="curve">${curveSvg(finding.current, "var(--critical)")}</div><div class="v">${escapeHtml(finding.current)}</div></div>
      <div class="arrow">→</div>
      <div class="cell after"><div class="cap">Suggested</div><div class="curve">${curveSvg(finding.suggested, "var(--good)")}</div><div class="v">${escapeHtml(finding.suggested)}</div></div>
    </div>`;
  }
  return `
    <div class="ba">
      <div class="cell"><div class="cap">Current</div><div class="v">${escapeHtml(finding.current ?? "—")}</div></div>
      <div class="arrow">→</div>
      <div class="cell after"><div class="cap">Suggested</div><div class="v">${escapeHtml(finding.suggested ?? "—")}</div></div>
    </div>`;
}

function renderFinding(finding: AnimationFinding, index: number): string {
  const delay = Math.min(index * 40, 320);
  return `
  <article class="finding sev-${finding.severity}" style="animation-delay:${delay}ms">
    <div class="top">
      <span class="badge">${escapeHtml(finding.severity)}</span>
      <span class="tag">${escapeHtml(CATEGORY_LABEL[finding.category])}</span>
      <h3>${escapeHtml(finding.title)}</h3>
    </div>
    <p class="loc">🎯 ${escapeHtml(finding.common_name)} · <code>${escapeHtml(finding.selector)}</code></p>
    <div class="field"><span class="lbl">What's happening</span>${escapeHtml(finding.detail)}</div>
    <div class="field"><span class="lbl">Why it matters</span>${escapeHtml(finding.why)}</div>
    <div class="field"><span class="lbl">Fix</span>${escapeHtml(finding.fix)}</div>
    ${beforeAfter(finding)}
    <div class="std"><b>Standard</b> — ${escapeHtml(finding.standard)}</div>
  </article>`;
}

const AUDIT_CSS = `
.ba .curve { display: grid; place-items: center; margin: 4px 0 6px; }
.ba .curve svg { border-radius: 8px; background: var(--bg-elev); }
.ba .cell { text-align: center; }
.ba .cell .v { text-align: center; }
`;

function headline(audit: AnimationAudit): { title: string; blurb: string } {
  if (audit.total_animations === 0) {
    return { title: "No animations detected", blurb: "Nothing on the page opted into a transition, keyframe, or JS tween that MotionLint could measure." };
  }
  if (audit.critical_count > 0) return { title: "Motion needs work", blurb: "Critical deviations from the animation standards were found." };
  if (audit.warning_count > 0) return { title: "A few motion issues", blurb: "No blockers, but some animations drift from the standards." };
  if (audit.suggestion_count > 0) return { title: "Solid motion, minor polish", blurb: "Only nice-to-have refinements remain." };
  return { title: "Motion is on-standard", blurb: "Every measured animation matches Emil Kowalski's standards." };
}

export function renderAnimationAuditHtml(audit: AnimationAudit): string {
  const h = headline(audit);
  const summary = `
  <div class="summary">
    ${scoreRing(audit.score)}
    <div class="headline">
      <h2>${escapeHtml(h.title)}</h2>
      <p>${escapeHtml(h.blurb)} · ${audit.total_animations} animation${audit.total_animations === 1 ? "" : "s"} measured</p>
    </div>
    ${severityPills({ critical: audit.critical_count, warning: audit.warning_count, suggestion: audit.suggestion_count })}
  </div>`;

  let body: string;
  if (audit.total_animations === 0) {
    body = `${summary}<div class="empty"><div class="big">🕸️</div>No animations to audit.</div>`;
  } else if (audit.findings.length === 0) {
    body = `${summary}<div class="empty"><div class="big">✨</div>All ${audit.total_animations} animations are on-standard. Nothing to fix.</div>`;
  } else {
    body = `${summary}
    <div class="section-h"><h2>Findings</h2><span class="count">${audit.findings.length} total</span></div>
    ${audit.findings.map(renderFinding).join("\n")}`;
  }

  return htmlShell({
    title: "MotionLint Animation Audit",
    subtitle: `<span class="mono">${escapeHtml(audit.url)}</span> · ${audit.viewport.width}×${audit.viewport.height} · ${escapeHtml(audit.captured_at)}`,
    body,
    extraCss: AUDIT_CSS,
  });
}
