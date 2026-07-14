/**
 * Shared HTML report shell. Every MotionLint HTML report (design review, animation
 * audit) is built from this shell so they read as one product.
 *
 * The shell dogfoods Emil Kowalski's standards in MotionLint's own UI: strong custom
 * easing tokens, sub-300ms durations, entrances from scale(0.97) + opacity (never 0),
 * a 40ms stagger, GPU-only transform/opacity animation, and a reduced-motion path.
 */

export function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** The shared design tokens + base styles, including the Emil easing curves as CSS vars. */
export const SHELL_CSS = `
:root {
  color-scheme: light dark;
  /* Emil's strong easing curves as shared tokens (the linter recommends these verbatim). */
  --ease-out: cubic-bezier(0.23, 1, 0.32, 1);
  --ease-in-out: cubic-bezier(0.77, 0, 0.175, 1);
  --dur-fast: 140ms;
  --dur: 220ms;
  --dur-slow: 280ms;

  --bg: #f6f7f9;
  --bg-elev: #ffffff;
  --bg-sunken: #eef0f3;
  --border: #e2e5ea;
  --border-strong: #cfd4dc;
  --text: #14161c;
  --text-dim: #5b6472;
  --text-faint: #8a93a3;
  --accent: #5b63f5;
  --accent-soft: rgba(91, 99, 245, 0.1);
  --critical: #e5484d;
  --critical-soft: rgba(229, 72, 77, 0.12);
  --warning: #f2a20c;
  --warning-soft: rgba(242, 162, 12, 0.14);
  --suggestion: #6b7280;
  --suggestion-soft: rgba(107, 114, 128, 0.12);
  --good: #30a46c;
  --good-soft: rgba(48, 164, 108, 0.14);
  --shadow: 0 1px 2px rgba(20, 22, 28, 0.04), 0 8px 24px -12px rgba(20, 22, 28, 0.18);
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0b0d12;
    --bg-elev: #14171f;
    --bg-sunken: #0f1218;
    --border: #232833;
    --border-strong: #313846;
    --text: #e8ebf1;
    --text-dim: #9aa3b3;
    --text-faint: #6b7488;
    --accent: #7c84ff;
    --accent-soft: rgba(124, 132, 255, 0.16);
    --critical: #ff6169;
    --critical-soft: rgba(255, 97, 105, 0.16);
    --warning: #ffb84d;
    --warning-soft: rgba(255, 184, 77, 0.16);
    --suggestion: #9aa3b3;
    --suggestion-soft: rgba(154, 163, 179, 0.14);
    --good: #45c98a;
    --good-soft: rgba(69, 201, 138, 0.16);
    --shadow: 0 1px 2px rgba(0, 0, 0, 0.3), 0 12px 32px -16px rgba(0, 0, 0, 0.6);
  }
}

* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font: 15px/1.6 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  -webkit-font-smoothing: antialiased;
}
.wrap { max-width: 960px; margin: 0 auto; padding: 40px 24px 96px; }
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }
code, .mono { font-family: ui-monospace, "SF Mono", SFMono-Regular, Menlo, monospace; font-size: 0.86em; }
code {
  background: var(--bg-sunken); border: 1px solid var(--border);
  padding: 1px 6px; border-radius: 6px; white-space: nowrap;
}

/* — Header — */
.masthead { display: flex; align-items: flex-start; gap: 16px; flex-wrap: wrap; margin-bottom: 8px; }
.logo {
  width: 40px; height: 40px; border-radius: 11px; flex: none;
  background: linear-gradient(135deg, var(--accent), #a78bfa);
  display: grid; place-items: center; box-shadow: var(--shadow);
}
.logo svg { width: 22px; height: 22px; }
.masthead h1 { margin: 0; font-size: 22px; letter-spacing: -0.02em; }
.masthead .sub { margin: 2px 0 0; color: var(--text-dim); font-size: 13.5px; }
.masthead .sub .mono { color: var(--text-faint); }

/* — Score ring / summary band — */
.summary {
  display: flex; align-items: center; gap: 24px; flex-wrap: wrap;
  background: var(--bg-elev); border: 1px solid var(--border);
  border-radius: 16px; padding: 22px 24px; margin: 24px 0 32px;
  box-shadow: var(--shadow);
}
.ring { --v: 0; width: 76px; height: 76px; flex: none; position: relative; }
.ring svg { transform: rotate(-90deg); }
.ring .track { stroke: var(--bg-sunken); }
.ring .val { stroke: var(--ring-color, var(--good)); stroke-linecap: round; transition: stroke-dashoffset 700ms var(--ease-out); }
.ring .num { position: absolute; inset: 0; display: grid; place-items: center; font-weight: 700; font-size: 19px; letter-spacing: -0.02em; }
.summary .headline { flex: 1 1 220px; }
.summary .headline h2 { margin: 0 0 4px; font-size: 16px; font-weight: 650; letter-spacing: -0.01em; }
.summary .headline p { margin: 0; color: var(--text-dim); font-size: 13.5px; }
.tallies { display: flex; gap: 8px; flex-wrap: wrap; }
.pill {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 12.5px; font-weight: 600; padding: 5px 11px; border-radius: 999px;
  border: 1px solid var(--border);
}
.pill .dot { width: 7px; height: 7px; border-radius: 50%; }
.pill.crit { background: var(--critical-soft); color: var(--critical); border-color: transparent; }
.pill.crit .dot { background: var(--critical); }
.pill.warn { background: var(--warning-soft); color: var(--warning); border-color: transparent; }
.pill.warn .dot { background: var(--warning); }
.pill.sug { background: var(--suggestion-soft); color: var(--suggestion); border-color: transparent; }
.pill.sug .dot { background: var(--suggestion); }
.pill.good { background: var(--good-soft); color: var(--good); border-color: transparent; }
.pill.good .dot { background: var(--good); }

/* — Section headers — */
.section-h { display: flex; align-items: baseline; gap: 10px; margin: 40px 0 16px; }
.section-h h2 { margin: 0; font-size: 15px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-dim); font-weight: 650; }
.section-h .count { color: var(--text-faint); font-size: 13px; }

/* — Finding cards — */
.finding {
  background: var(--bg-elev); border: 1px solid var(--border);
  border-left: 3px solid var(--sev-color, var(--suggestion));
  border-radius: 14px; padding: 18px 20px; margin-bottom: 14px;
  box-shadow: var(--shadow);
  opacity: 0; transform: translateY(10px) scale(0.99);
  animation: rise var(--dur-slow) var(--ease-out) forwards;
}
.finding.sev-critical { --sev-color: var(--critical); }
.finding.sev-warning { --sev-color: var(--warning); }
.finding.sev-suggestion { --sev-color: var(--suggestion); }
@keyframes rise { to { opacity: 1; transform: none; } }
.finding .top { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 8px; }
.badge {
  font-size: 11px; font-weight: 700; letter-spacing: 0.03em; text-transform: uppercase;
  padding: 3px 8px; border-radius: 6px; background: var(--sev-color); color: #fff;
}
.finding.sev-warning .badge { color: #1a1204; }
.tag { font-size: 12px; font-weight: 600; color: var(--text-dim); background: var(--bg-sunken); border: 1px solid var(--border); padding: 2px 9px; border-radius: 999px; }
.finding h3 { margin: 0; font-size: 16px; letter-spacing: -0.01em; flex: 1 1 auto; min-width: 200px; }
.finding .loc { color: var(--text-faint); font-size: 12.5px; margin: 0 0 12px; }
.finding .field { margin: 8px 0; font-size: 14px; }
.finding .field .lbl { color: var(--text-faint); font-weight: 600; font-size: 11.5px; text-transform: uppercase; letter-spacing: 0.04em; display: block; margin-bottom: 1px; }
.finding .std { margin-top: 12px; padding: 9px 12px; background: var(--accent-soft); border-radius: 9px; font-size: 12.5px; color: var(--text-dim); }
.finding .std b { color: var(--accent); font-weight: 650; }

/* — Before/after — */
.ba { display: grid; grid-template-columns: 1fr auto 1fr; gap: 12px; align-items: stretch; margin: 12px 0 4px; }
@media (max-width: 560px) { .ba { grid-template-columns: 1fr; } .ba .arrow { transform: rotate(90deg); } }
.ba .cell { background: var(--bg-sunken); border: 1px solid var(--border); border-radius: 10px; padding: 10px 12px; }
.ba .cell.after { border-color: var(--good); background: var(--good-soft); }
.ba .cell .cap { font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 700; color: var(--text-faint); margin-bottom: 5px; }
.ba .cell.after .cap { color: var(--good); }
.ba .cell .v { font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 13px; word-break: break-word; }
.ba .arrow { align-self: center; color: var(--text-faint); font-size: 18px; }

/* — Screenshot — */
.shot { margin: 8px 0 20px; border-radius: 12px; overflow: hidden; border: 1px solid var(--border); box-shadow: var(--shadow); position: relative; }
.shot img { display: block; width: 100%; height: auto; }

/* — Finding annotations drawn over the screenshot — */
.anno { position: absolute; border: 2px solid var(--suggestion); border-radius: 6px; pointer-events: none; box-shadow: 0 0 0 2px rgba(0,0,0,0.25); }
.anno .anno-tag {
  position: absolute; top: -10px; left: -2px; transform: translateY(-100%);
  font: 700 11px ui-monospace, monospace; letter-spacing: 0.04em;
  color: #fff; background: var(--suggestion); border-radius: 5px; padding: 2px 6px;
}
.anno.sev-critical { border-color: var(--critical); } .anno.sev-critical .anno-tag { background: var(--critical); }
.anno.sev-warning { border-color: var(--warning); } .anno.sev-warning .anno-tag { background: var(--warning); color: #1a1204; }

/* — Footer — */
.foot { margin-top: 48px; padding-top: 20px; border-top: 1px solid var(--border); color: var(--text-faint); font-size: 12.5px; text-align: center; }
.empty { text-align: center; color: var(--text-dim); padding: 48px 24px; background: var(--bg-elev); border: 1px dashed var(--border-strong); border-radius: 14px; }
.empty .big { font-size: 32px; margin-bottom: 8px; }

@media (prefers-reduced-motion: reduce) {
  .finding { animation: fade var(--dur) ease forwards; transform: none; }
  .ring .val { transition: none; }
  @keyframes fade { to { opacity: 1; } }
}
`;

const LOGO_SVG =
  '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
  '<path d="M4 17c3-9 4.5-9 7.5 0S16 26 20 7" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>' +
  "</svg>";

/** A circular score ring, 0–100. */
export function scoreRing(score: number): string {
  const pct = Math.max(0, Math.min(100, score));
  const r = 32;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - pct / 100);
  const color = pct >= 85 ? "var(--good)" : pct >= 60 ? "var(--warning)" : "var(--critical)";
  return `
  <div class="ring" style="--ring-color:${color}">
    <svg width="76" height="76" viewBox="0 0 76 76">
      <circle class="track" cx="38" cy="38" r="${r}" fill="none" stroke-width="7"/>
      <circle class="val" cx="38" cy="38" r="${r}" fill="none" stroke-width="7"
        stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${offset.toFixed(1)}"/>
    </svg>
    <div class="num">${Math.round(pct)}</div>
  </div>`;
}

/** Severity count pills. Renders a single "clean" pill when there are no findings. */
export function severityPills(counts: { critical: number; warning: number; suggestion: number }): string {
  const parts: string[] = [];
  if (counts.critical) parts.push(`<span class="pill crit"><span class="dot"></span>${counts.critical} critical</span>`);
  if (counts.warning) parts.push(`<span class="pill warn"><span class="dot"></span>${counts.warning} warning</span>`);
  if (counts.suggestion) parts.push(`<span class="pill sug"><span class="dot"></span>${counts.suggestion} suggestion</span>`);
  if (parts.length === 0) parts.push(`<span class="pill good"><span class="dot"></span>clean</span>`);
  return `<div class="tallies">${parts.join("")}</div>`;
}

export interface ShellOptions {
  title: string;
  /** Small monospace subtitle line under the H1 (e.g. the reviewed URL + timestamp). */
  subtitle: string;
  /** Inner HTML for the <main> body. */
  body: string;
  /** Extra <style> appended after the shared shell CSS. */
  extraCss?: string;
  /** Optional <script> body (already escaped/safe). */
  script?: string;
}

/** Wrap body content in the full standalone HTML document. */
export function htmlShell(opts: ShellOptions): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(opts.title)}</title>
<style>${SHELL_CSS}${opts.extraCss ?? ""}</style>
</head>
<body>
<div class="wrap">
  <div class="masthead">
    <div class="logo">${LOGO_SVG}</div>
    <div>
      <h1>${escapeHtml(opts.title)}</h1>
      <p class="sub">${opts.subtitle}</p>
    </div>
  </div>
  ${opts.body}
  <div class="foot">Generated by <a href="https://github.com/bobaba99/motionlint">MotionLint</a> · animation standards after <a href="https://emilkowal.ski/">Emil Kowalski</a></div>
</div>
${opts.script ? `<script>${opts.script}</script>` : ""}
</body>
</html>`;
}
