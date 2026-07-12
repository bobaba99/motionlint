import type { TunerCapture } from "./types.js";
import { auditAnimations, type AnimationFinding } from "./lint.js";

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function escapeAttr(s: string): string {
  return escapeHtml(s);
}

const TUNER_CSS = `
:root {
  --bg: #0b0d12;
  --bg-elev: #12141b;
  --bg-card: #171a23;
  --border: #232734;
  --text: #e7eaf0;
  --text-dim: #9aa3b2;
  --accent: #6c7cff;
  --accent-2: #29e6c4;
  --accent-3: #ff7ab6;
  --danger: #ff5d6c;
  --warning: #ffb547;
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: var(--bg); color: var(--text); font: 14.5px/1.55 ui-sans-serif, system-ui, -apple-system, sans-serif; }
header { padding: 24px 32px; border-bottom: 1px solid var(--border); display: flex; align-items: baseline; gap: 16px; flex-wrap: wrap; }
header h1 { margin: 0; font-size: 20px; letter-spacing: -.01em; }
header .meta { color: var(--text-dim); font-size: 13px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
header .right { margin-left: auto; display: flex; gap: 8px; }
button.btn { background: var(--accent); color: #fff; padding: 8px 14px; border-radius: 999px; border: 0; font: inherit; font-weight: 600; cursor: pointer; }
button.btn.ghost { background: transparent; border: 1px solid var(--border); color: var(--text); }
main { max-width: 1320px; margin: 0 auto; padding: 24px 32px 80px; display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
@media (max-width: 1100px) { main { grid-template-columns: 1fr; } }
.card { background: var(--bg-card); border: 1px solid var(--border); border-radius: 14px; padding: 18px; display: grid; grid-template-rows: 110px 220px auto auto; gap: 14px; }
.card-header { overflow: hidden; display: flex; flex-direction: column; gap: 4px; }
.card-header .badges { margin-bottom: 4px; }
.card h3 { margin: 0; font-size: 16px; letter-spacing: -.005em; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; overflow: hidden; }
.card .badge { display: inline-block; font-size: 11px; padding: 3px 8px; border-radius: 999px; background: rgba(108,124,255,.18); color: var(--accent); margin-right: 6px; }
.card .badge.lib { background: rgba(41,230,196,.18); color: var(--accent-2); }
.card .common { color: var(--text-dim); font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.card .technical { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; color: var(--text-dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
/* Preview frame: a Shadow DOM host. The captured element + its CSS render directly
   inside the shadow root, so the preview is part of the regular page paint — no
   separate compositor layer per card means no GPU-eviction flash on fast scroll
   and no iframe-navigation hazards from captured <a href> elements. */
/* The preview-frame is the shadow-DOM host. Background/colour are set inside
   the shadow root via :host (using the captured page's body styles), so the
   outer rule only needs to size and clip the box. */
.preview-frame {
  border-radius: 10px;
  width: 100%;
  height: 220px;
  overflow: hidden;
  border: 1px solid var(--border);
  position: relative;
}
.controls { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.control { background: var(--bg-elev); border: 1px solid var(--border); border-radius: 10px; padding: 10px 12px; }
.control label { display: flex; justify-content: space-between; font-size: 12.5px; color: var(--text-dim); margin-bottom: 6px; }
.control label b { color: var(--text); font-weight: 600; }
.control input[type=range] { width: 100%; }
.control select, .control textarea { width: 100%; background: var(--bg); color: var(--text); border: 1px solid var(--border); border-radius: 8px; padding: 8px 10px; font: inherit; font-size: 13px; }
.control textarea { min-height: 60px; resize: vertical; }
.row { display: flex; gap: 8px; }
.row .btn { flex: 1; }
.export-bar { position: sticky; bottom: 0; background: var(--bg-card); border: 1px solid var(--border); border-radius: 14px; padding: 14px 18px; margin: 24px 32px; display: flex; align-items: center; gap: 12px; }
.export-bar .summary { color: var(--text-dim); font-size: 13px; }
dialog { background: var(--bg-card); color: var(--text); border: 1px solid var(--border); border-radius: 14px; padding: 0; max-width: 720px; width: 90vw; }
dialog::backdrop { background: rgba(0,0,0,.5); }
dialog .head { padding: 16px 20px; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center; }
dialog pre { margin: 0; padding: 16px 20px; max-height: 60vh; overflow: auto; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px; line-height: 1.5; white-space: pre-wrap; word-break: break-word; }
dialog .actions { padding: 12px 20px; border-top: 1px solid var(--border); display: flex; gap: 8px; justify-content: flex-end; }
.empty { padding: 60px; text-align: center; color: var(--text-dim); }
/* Emil-standards lint callout inside a card */
.card { grid-template-rows: 110px 220px auto auto auto; }
.lint { display: flex; flex-direction: column; gap: 6px; }
.lint .clean { font-size: 12.5px; color: var(--accent-2); display: flex; align-items: center; gap: 6px; }
.lint .finding { display: flex; gap: 8px; align-items: flex-start; font-size: 12.5px; background: var(--bg-elev); border: 1px solid var(--border); border-left: 3px solid var(--warning); border-radius: 8px; padding: 7px 10px; }
.lint .finding.crit { border-left-color: var(--danger); }
.lint .finding .sev { font-weight: 700; font-size: 10px; text-transform: uppercase; letter-spacing: .04em; color: var(--warning); flex: none; margin-top: 1px; }
.lint .finding.crit .sev { color: var(--danger); }
.lint .finding .body b { color: var(--text); font-weight: 650; }
.lint .finding .body { color: var(--text-dim); }
.lint .finding .body .fix { color: var(--accent-2); }
.header-lint { display: inline-flex; gap: 6px; align-items: center; font-size: 13px; color: var(--text-dim); }
.header-lint .chip { font-weight: 700; padding: 2px 9px; border-radius: 999px; font-size: 12px; }
.header-lint .chip.warn { background: rgba(255,181,71,.18); color: var(--warning); }
.header-lint .chip.crit { background: rgba(255,93,108,.18); color: var(--danger); }
.header-lint .chip.ok { background: rgba(41,230,196,.18); color: var(--accent-2); }
`;

const TUNER_JS = `
(function () {
  const FENCE = '\\u0060\\u0060\\u0060';
  const CAPTURE = window.__ML_CAPTURE;
  const state = {};
  CAPTURE.animations.forEach(a => {
    state[a.id] = {
      preset: 'ease-out (Emil)',
      values: Object.fromEntries(a.params.map(p => [p.name, p.value])),
      comments: ''
    };
  });

  // Shadow-DOM mount per animation. Replaces the previous iframe approach,
  // which suffered from GPU compositor-layer eviction (white flashes during
  // fast scroll) and from <a href> click navigation orphaning the iframe.
  // Shadow DOM gives us style isolation without iframes' compositor cost or
  // navigation hazards. The host element receives CSS variables directly;
  // play() / applyParams() operate on the .uxv-host inside the shadow root.
  const hostElements = new Map();

  // Rewrite :root selectors (which never match inside a shadow root) to :host
  // so the captured page's CSS-variable definitions still apply to the preview.
  function adaptCss(css) {
    return String(css || '').replace(/:root\\b/g, ':host');
  }

  // Sanitize CSS values that come from getComputedStyle. They're trusted (we
  // ran the eval ourselves), but defense-in-depth: forbid anything that could
  // break out of the rule (semicolons, braces, comment terminators).
  function safeCssValue(v, fallback) {
    if (typeof v !== 'string') return fallback;
    if (/[{};]|\\/\\*|\\*\\//.test(v)) return fallback;
    return v;
  }

  function mountAnimation(anim) {
    const host = document.querySelector('.preview-frame[data-anim="' + anim.id + '"]');
    if (!host) { console.warn('[ml-tuner] mountAnimation: host not found', anim.id); return; }
    if (host.shadowRoot) return; // already mounted
    const shadow = host.attachShadow({ mode: 'open' });
    const previewCss = adaptCss(anim.preview_css || '');
    const previewHtml = anim.preview_html || '<button style="background:#2563eb;color:#fff;padding:10px 18px;border-radius:8px;border:0;font:600 14px ui-sans-serif,system-ui;">Preview element</button>';
    // Use the captured page's body styles so the preview matches the source theme
    // (dark gradient, light, brand-coloured, etc.) instead of forcing white.
    const ps = (CAPTURE.page_styles || {});
    const bgColor = safeCssValue(ps.backgroundColor, '#fff');
    const bgImage = safeCssValue(ps.backgroundImage, 'none');
    const fgColor = safeCssValue(ps.color, '#111');
    const fontFam = safeCssValue(ps.fontFamily, 'ui-sans-serif, system-ui, -apple-system, sans-serif');
    shadow.innerHTML =
      '<style>' +
      ':host { display: grid; place-items: center; height: 100%; width: 100%; padding: 18px; box-sizing: border-box; overflow: hidden;' +
        ' background-color: ' + bgColor + ';' +
        ' background-image: ' + bgImage + ';' +
        ' color: ' + fgColor + ';' +
        ' font-family: ' + fontFam + ';' +
        ' font-size: 14px; line-height: 1.5; }' +
      '.uxv-host { pointer-events: none; max-width: 100%; max-height: 100%; transition: transform var(--dur, 600ms) var(--ease, cubic-bezier(.16,1,.3,1)) var(--delay, 0ms), opacity var(--dur, 600ms) var(--ease, cubic-bezier(.16,1,.3,1)) var(--delay, 0ms); }' +
      '.uxv-host.in { transform: translateY(0); opacity: 1; }' +
      '.uxv-host:not(.in) { transform: translateY(16px); opacity: 0; }' +
      previewCss +
      '</style>' +
      '<div class="uxv-host">' + previewHtml + '</div>';
    // Strip any <script> tags from the captured HTML — we don't want them executing.
    shadow.querySelectorAll('script').forEach(s => s.remove());
    hostElements.set(anim.id, host);
    console.log('[ml-tuner] shadow mounted', { animId: anim.id, bgColor, hasGradient: bgImage !== 'none' });
  }

  function play(animId, reason) {
    const host = hostElements.get(animId);
    if (!host || !host.shadowRoot) { console.warn('[ml-tuner] play: no host', animId); return; }
    const el = host.shadowRoot.querySelector('.uxv-host');
    if (!el) return;
    // Snap to off without triggering the backwards transition, then re-enable
    // and add .in on the next frame to play forward.
    const prev = el.style.transition;
    el.style.transition = 'none';
    el.classList.remove('in');
    void el.offsetHeight;
    el.style.transition = prev;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      el.classList.add('in');
      console.log('[ml-tuner] play done', { animId, reason });
    }));
  }

  function applyParams(anim, replay, reason) {
    const host = hostElements.get(anim.id);
    if (!host) return;
    const params = state[anim.id].values;
    const easing = (anim.presets.find(p => p.name === state[anim.id].preset) || anim.presets[0]).value;
    host.style.setProperty('--dur', Number(params.duration ?? 600) + 'ms');
    host.style.setProperty('--delay', Number(params.delay ?? 0) + 'ms');
    host.style.setProperty('--ease', easing);
    if (replay) play(anim.id, reason || 'apply');
  }

  function refreshPreview(anim, reason) {
    if (!hostElements.has(anim.id)) mountAnimation(anim);
    applyParams(anim, true, reason || 'refresh');
  }

  function init() {
    console.log('[ml-tuner] init', { animations: CAPTURE.animations.length, captureId: CAPTURE.capture_id });
    CAPTURE.animations.forEach(anim => {
      mountAnimation(anim);
      anim.params.forEach(p => {
        const input = document.querySelector('input[data-anim="' + anim.id + '"][data-param="' + p.name + '"]');
        if (!input) return;
        input.addEventListener('input', (e) => {
          const v = Number(e.target.value);
          state[anim.id].values[p.name] = v;
          const out = document.querySelector('output[data-anim="' + anim.id + '"][data-param="' + p.name + '"]');
          if (out) out.textContent = v + ' ' + p.unit;
          console.log('[ml-tuner] slider change', { animId: anim.id, param: p.name, value: v, unit: p.unit });
          refreshPreview(anim, 'slider-' + p.name);
        });
      });
      const sel = document.querySelector('select[data-anim="' + anim.id + '"]');
      if (sel) {
        sel.addEventListener('change', (e) => {
          state[anim.id].preset = e.target.value;
          console.log('[ml-tuner] preset change', { animId: anim.id, preset: e.target.value });
          refreshPreview(anim, 'preset-change');
        });
      }
      const cmt = document.querySelector('textarea[data-anim="' + anim.id + '"]');
      if (cmt) cmt.addEventListener('input', (e) => { state[anim.id].comments = e.target.value; });
      const replayBtn = document.querySelector('button[data-replay="' + anim.id + '"]');
      if (replayBtn) replayBtn.addEventListener('click', () => {
        console.log('[ml-tuner] replay click', { animId: anim.id });
        refreshPreview(anim, 'replay-click');
      });
      const resetBtn = document.querySelector('button[data-reset="' + anim.id + '"]');
      if (resetBtn) resetBtn.addEventListener('click', () => {
        console.log('[ml-tuner] reset click', { animId: anim.id });
        state[anim.id].preset = 'ease-out (Emil)';
        anim.params.forEach(p => { state[anim.id].values[p.name] = p.value; });
        refreshPreview(anim, 'reset-click');
        renderAll();
      });
      refreshPreview(anim, 'init');
    });

    document.getElementById('export').addEventListener('click', exportPrompt);
    document.getElementById('download').addEventListener('click', downloadJSON);
    document.getElementById('close-dialog').addEventListener('click', () => document.getElementById('dlg').close());
    document.getElementById('copy').addEventListener('click', () => {
      const txt = document.getElementById('exportText').textContent;
      navigator.clipboard.writeText(txt);
      const b = document.getElementById('copy');
      const orig = b.textContent;
      b.textContent = 'Copied ✓';
      setTimeout(() => b.textContent = orig, 1200);
    });
  }

  function renderAll() {
    CAPTURE.animations.forEach(anim => {
      anim.params.forEach(p => {
        const input = document.querySelector('input[data-anim="' + anim.id + '"][data-param="' + p.name + '"]');
        const out = document.querySelector('output[data-anim="' + anim.id + '"][data-param="' + p.name + '"]');
        if (input) input.value = String(state[anim.id].values[p.name]);
        if (out) out.textContent = state[anim.id].values[p.name] + ' ' + p.unit;
      });
      const sel = document.querySelector('select[data-anim="' + anim.id + '"]');
      if (sel) sel.value = state[anim.id].preset;
    });
  }

  function buildExport() {
    const changes = CAPTURE.animations.map(anim => {
      const orig = Object.fromEntries(anim.params.map(p => [p.name, p.value]));
      const next = state[anim.id].values;
      const diff = {};
      for (const k of Object.keys(orig)) if (orig[k] !== next[k]) diff[k] = { from: orig[k], to: next[k] };
      const presetChanged = state[anim.id].preset !== 'ease-out (Emil)';
      const comment = state[anim.id].comments.trim();
      if (Object.keys(diff).length === 0 && !presetChanged && !comment) return null;
      return {
        id: anim.id,
        selector: anim.selector,
        common_name: anim.common_name,
        technical_name: anim.technical_name,
        source: anim.source,
        param_changes: diff,
        easing_preset: presetChanged ? state[anim.id].preset : null,
        easing_value: presetChanged ? (anim.presets.find(p => p.name === state[anim.id].preset) || {}).value : null,
        comment: comment || null,
      };
    }).filter(Boolean);

    const md = [
      '# MotionLint animation tuner — proposed changes',
      '',
      '> Source page: ' + CAPTURE.url,
      '> Captured at: ' + CAPTURE.captured_at,
      '> Viewport: ' + CAPTURE.viewport.width + '×' + CAPTURE.viewport.height,
      '',
      '## Summary',
      '',
      changes.length === 0 ? '_No changes — current parameters are accepted as-is._' : changes.length + ' animation(s) tuned.',
      '',
      '## Changes',
      '',
      changes.length === 0 ? '' : FENCE + 'json\\n' + JSON.stringify(changes, null, 2) + '\\n' + FENCE,
      '',
      '## Prompt for Claude Code',
      '',
      'Update the following animation parameters in this codebase. Find each animation by selector or common name and apply the new values. Use the easing curves verbatim. Preserve all other styling.',
      '',
      changes.map(c => {
        const lines = ['- **' + c.common_name + '** — selector \`' + c.selector + '\` — source: ' + c.source];
        for (const [k, v] of Object.entries(c.param_changes)) lines.push('  - ' + k + ': ' + v.from + ' → **' + v.to + '**');
        if (c.easing_value) lines.push('  - easing: → **' + c.easing_value + '** (' + c.easing_preset + ')');
        if (c.comment) lines.push('  - rationale: ' + c.comment);
        return lines.join('\\n');
      }).join('\\n'),
      '',
    ].join('\\n');

    return { md: md, json: changes };
  }

  function exportPrompt() {
    const out = buildExport();
    document.getElementById('exportText').textContent = out.md;
    document.getElementById('dlg').showModal();
  }

  function downloadJSON() {
    const out = buildExport();
    const blob = new Blob([out.md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'motionlint-animation-changes.md';
    a.click();
    URL.revokeObjectURL(url);
  }

  document.addEventListener('DOMContentLoaded', init);
})();
`;

function renderLintBlock(findings: AnimationFinding[]): string {
  if (findings.length === 0) {
    return `<div class="lint"><div class="clean">✓ On-standard — no animation-standard violations.</div></div>`;
  }
  const rows = findings.map((f) => {
    const crit = f.severity === "critical" ? " crit" : "";
    const fix = f.suggested ? ` <span class="fix">→ ${escapeHtml(f.suggested)}</span>` : "";
    return `<div class="finding${crit}"><span class="sev">${escapeHtml(f.severity)}</span><span class="body"><b>${escapeHtml(f.title)}</b> — ${escapeHtml(f.fix)}${fix}</span></div>`;
  }).join("");
  return `<div class="lint">${rows}</div>`;
}

function renderAnimationCard(anim: TunerCapture["animations"][number], findings: AnimationFinding[]): string {
  const presets = anim.presets.map((p) =>
    `<option value="${escapeAttr(p.name)}">${escapeHtml(p.name)} — ${escapeHtml(p.description)}</option>`,
  ).join("");

  const sliders = anim.params.map((p) => `
    <div class="control">
      <label><span>${escapeHtml(p.label)}</span><b><output data-anim="${escapeAttr(anim.id)}" data-param="${escapeAttr(p.name)}">${p.value} ${escapeHtml(p.unit)}</output></b></label>
      <input type="range" min="${p.min}" max="${p.max}" step="${p.step}" value="${p.value}"
             data-anim="${escapeAttr(anim.id)}" data-param="${escapeAttr(p.name)}">
      <div class="technical">${escapeHtml(p.technical)}</div>
    </div>
  `).join("");

  return `
  <section class="card" id="${escapeAttr(anim.id)}">
    <div class="card-header">
      <div class="badges"><span class="badge lib">${escapeHtml(anim.source)}</span><span class="badge">${escapeHtml(anim.id)}</span></div>
      <h3>${escapeHtml(anim.common_name)}</h3>
      <div class="common">${escapeHtml(anim.technical_name)}</div>
      <div class="technical">selector: ${escapeHtml(anim.selector)}</div>
    </div>
    <div class="preview-frame" data-anim="${escapeAttr(anim.id)}"></div>
    ${renderLintBlock(findings)}
    <div class="row">
      <button class="btn ghost" data-replay="${escapeAttr(anim.id)}">▶ Replay</button>
      <button class="btn ghost" data-reset="${escapeAttr(anim.id)}">↺ Reset</button>
    </div>
    <div class="controls">
      ${sliders}
      <div class="control" style="grid-column: span 2;">
        <label><span>Easing preset</span></label>
        <select data-anim="${escapeAttr(anim.id)}">${presets}</select>
      </div>
      <div class="control" style="grid-column: span 2;">
        <label><span>Comments / rationale (becomes part of the export)</span></label>
        <textarea data-anim="${escapeAttr(anim.id)}" placeholder="Why this change? Anything CC should know about?"></textarea>
      </div>
    </div>
  </section>
  `;
}

export function renderTunerHTML(capture: TunerCapture): string {
  // Run the deterministic Emil-standards linter and group findings by animation id.
  const audit = auditAnimations(capture);
  const byAnim = new Map<string, AnimationFinding[]>();
  for (const f of audit.findings) {
    const list = byAnim.get(f.anim_id) ?? [];
    list.push(f);
    byAnim.set(f.anim_id, list);
  }
  const totalFlagged = audit.critical_count + audit.warning_count + audit.suggestion_count;
  const headerLint = capture.animations.length
    ? `<div class="header-lint">standards: ${
        totalFlagged === 0
          ? `<span class="chip ok">all clean</span>`
          : `${audit.critical_count ? `<span class="chip crit">${audit.critical_count} critical</span>` : ""}${
              audit.warning_count ? `<span class="chip warn">${audit.warning_count} warning</span>` : ""
            }${audit.suggestion_count ? `<span class="chip warn">${audit.suggestion_count} suggestion</span>` : ""} · score ${audit.score}/100`
      }</div>`
    : "";

  const cards = capture.animations.length
    ? capture.animations.map((a) => renderAnimationCard(a, byAnim.get(a.id) ?? [])).join("\n")
    : `<div class="empty">No animations detected on this page.</div>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>MotionLint Animation Tuner — ${escapeHtml(capture.url)}</title>
<style>${TUNER_CSS}</style>
</head>
<body>
<header>
  <h1>MotionLint · Animation Tuner</h1>
  <div class="meta">${escapeHtml(capture.url)}</div>
  <div class="meta">${escapeHtml(capture.captured_at)}</div>
  <div class="meta">${capture.animations.length} animation${capture.animations.length === 1 ? "" : "s"} detected</div>
  ${headerLint}
  <div class="right">
    <button class="btn ghost" id="download">↓ Download .md</button>
    <button class="btn" id="export">Export prompt for Claude Code</button>
  </div>
</header>
<main>${cards}</main>
<dialog id="dlg">
  <div class="head"><strong>Paste this into Claude Code</strong><button class="btn ghost" id="close-dialog">close</button></div>
  <pre id="exportText"></pre>
  <div class="actions"><button class="btn ghost" id="copy">Copy</button></div>
</dialog>
<script>window.__ML_CAPTURE = ${JSON.stringify(capture).replace(/</g, "\\u003c")};</script>
<script>${TUNER_JS}</script>
</body>
</html>`;
}
