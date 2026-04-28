/**
 * Browser-side instrumentation script. This source is exported as a string
 * and injected into the page via Playwright's addInitScript() before any
 * library code runs, so we can hook GSAP/Motion/anime/auto-animate as they
 * are defined.
 *
 * The hook records every animation call into window.__mlAnimations and
 * leaves the original library calls intact.
 */
export const INSTRUMENTATION_SOURCE = `
(function () {
  if (window.__mlInstrumented) return;
  window.__mlInstrumented = true;
  window.__mlAnimations = [];

  function uniqueSelector(el) {
    if (!(el instanceof Element)) return null;
    if (el.id) return '#' + el.id;
    var path = [];
    while (el && el.nodeType === 1 && path.length < 6) {
      var seg = el.tagName.toLowerCase();
      if (el.className && typeof el.className === 'string') {
        var cls = el.className.trim().split(/\\s+/).filter(Boolean).slice(0, 2).join('.');
        if (cls) seg += '.' + cls;
      }
      var parent = el.parentNode;
      if (parent && parent.children) {
        var siblings = Array.prototype.filter.call(parent.children, function (c) { return c.tagName === el.tagName; });
        if (siblings.length > 1) {
          var idx = siblings.indexOf(el);
          if (idx >= 0) seg += ':nth-of-type(' + (idx + 1) + ')';
        }
      }
      path.unshift(seg);
      el = el.parentElement;
    }
    return path.join(' > ');
  }

  function commonName(el) {
    if (!(el instanceof Element)) return 'element';
    var section = el.closest('section, article, header, footer, nav, main, aside, form, [data-section]');
    var heading = section && section.querySelector('h1, h2, h3, [role=heading]');
    var headingText = heading ? (heading.textContent || '').trim().slice(0, 40) : '';
    var role = el.getAttribute('role') || el.tagName.toLowerCase();
    var label = (el.textContent || '').trim().slice(0, 30) || (el.getAttribute('aria-label') || '');
    return [headingText, role, label].filter(Boolean).join(' / ') || role;
  }

  function bbox(el) {
    if (!(el instanceof Element)) return null;
    var r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  }

  function record(entry) {
    try {
      entry.id = 'anim_' + (window.__mlAnimations.length + 1);
      entry.recorded_at = Date.now();
      window.__mlAnimations.push(entry);
    } catch (e) {
      console.warn('uxv record failed', e);
    }
  }

  function recordTarget(target, source, params) {
    var els = [];
    if (typeof target === 'string') {
      try { els = Array.prototype.slice.call(document.querySelectorAll(target)); } catch (e) {}
    } else if (target && target.nodeType === 1) {
      els = [target];
    } else if (Array.isArray(target) || target instanceof NodeList) {
      els = Array.prototype.slice.call(target);
    }
    if (els.length === 0) return;
    els.slice(0, 12).forEach(function (el, i) {
      record({
        source: source,
        selector: uniqueSelector(el),
        common_name: commonName(el),
        bbox: bbox(el),
        params: params,
        index: i,
      });
    });
  }

  // --- gsap ---
  function hookGsap(g) {
    if (!g || g.__mlHooked) return;
    g.__mlHooked = true;
    ['to', 'from', 'fromTo', 'set'].forEach(function (m) {
      var orig = g[m];
      if (typeof orig !== 'function') return;
      g[m] = function (target, vars) {
        recordTarget(target, 'gsap', { method: m, vars: vars });
        return orig.apply(this, arguments);
      };
    });
    if (typeof g.timeline === 'function') {
      var origTl = g.timeline;
      g.timeline = function () {
        var tl = origTl.apply(this, arguments);
        ['to', 'from', 'fromTo', 'set'].forEach(function (m) {
          var orig = tl[m];
          if (typeof orig !== 'function') return;
          tl[m] = function (target, vars) {
            recordTarget(target, 'gsap', { method: 'timeline.' + m, vars: vars });
            return orig.apply(this, arguments);
          };
        });
        return tl;
      };
    }
  }

  // --- anime.js ---
  function hookAnime(a) {
    if (!a || a.__mlHooked) return;
    var wrapped = function (params) {
      recordTarget((params && params.targets) || null, 'animejs', params);
      return a.apply(this, arguments);
    };
    Object.assign(wrapped, a);
    wrapped.__mlHooked = true;
    return wrapped;
  }

  // --- Motion One ---
  function hookMotion(m) {
    if (!m || !m.animate || m.__mlHooked) return m;
    m.__mlHooked = true;
    var origAnimate = m.animate;
    m.animate = function (els, keyframes, options) {
      recordTarget(els, 'motion-one', { keyframes: keyframes, options: options });
      return origAnimate.apply(this, arguments);
    };
    return m;
  }

  // --- auto-animate ---
  function hookAutoAnimate(fn) {
    if (!fn || fn.__mlHooked) return fn;
    var wrapped = function (parent, options) {
      record({
        source: 'auto-animate',
        selector: uniqueSelector(parent),
        common_name: commonName(parent),
        bbox: bbox(parent),
        params: { options: options || {} },
      });
      return fn.apply(this, arguments);
    };
    Object.assign(wrapped, fn);
    wrapped.__mlHooked = true;
    return wrapped;
  }

  // Patch ESM-resolved modules at import time. Because the demo loads via
  // <script type="module">, we can't intercept the imports themselves — but we
  // can poll for the symbols once the page begins executing and hook them.
  function tryHookGlobals() {
    if (window.gsap) hookGsap(window.gsap);
    if (window.anime && !window.anime.__mlHooked) {
      var hooked = hookAnime(window.anime);
      if (hooked) window.anime = hooked;
    }
    if (window.Motion) hookMotion(window.Motion);
  }

  function parseDurationMs(s) {
    if (typeof s !== 'string') return 0;
    var t = s.trim();
    if (t.endsWith('ms')) return parseFloat(t) || 0;
    if (t.endsWith('s')) return (parseFloat(t) || 0) * 1000;
    return parseFloat(t) || 0;
  }

  function isMeaningfulTransition(propStr) {
    if (!propStr || propStr === 'none') return false;
    var props = propStr.split(',').map(function (p) { return p.trim(); });
    if (props.every(function (p) { return p === 'all'; })) return false;
    return true;
  }

  // CSS animation/transition discovery — runs after the page settles.
  // Keep only transitions/keyframes the author explicitly opted into:
  //   - transitions: duration > 0 AND transition-property is specific (not just "all")
  //   - keyframes:  animationName !== 'none' AND duration > 0
  function harvestCssAnimations() {
    var seen = new Set();
    var cssTransitionsRecorded = 0;
    function walk(el) {
      if (!(el instanceof Element)) return;
      if (seen.has(el)) return;
      seen.add(el);

      var cs = window.getComputedStyle(el);
      var transitionDurMs = parseDurationMs(cs.transitionDuration);
      var animationDurMs = parseDurationMs(cs.animationDuration);
      var animationName = cs.animationName;

      if (transitionDurMs > 0 && isMeaningfulTransition(cs.transitionProperty) && cssTransitionsRecorded < 30) {
        record({
          source: 'css-transition',
          selector: uniqueSelector(el),
          common_name: commonName(el),
          bbox: bbox(el),
          params: {
            property: cs.transitionProperty,
            duration: cs.transitionDuration,
            timing: cs.transitionTimingFunction,
            delay: cs.transitionDelay,
          },
        });
        cssTransitionsRecorded++;
      }
      if (animationName && animationName !== 'none' && animationDurMs > 0) {
        record({
          source: 'css-keyframes',
          selector: uniqueSelector(el),
          common_name: commonName(el),
          bbox: bbox(el),
          params: {
            name: animationName,
            duration: cs.animationDuration,
            timing: cs.animationTimingFunction,
            delay: cs.animationDelay,
            iteration: cs.animationIterationCount,
          },
        });
      }
      Array.prototype.forEach.call(el.children, walk);
    }
    walk(document.body);
  }

  // Run hooks repeatedly during the early page lifecycle.
  var ticks = 0;
  var iv = setInterval(function () {
    tryHookGlobals();
    if (++ticks > 30) clearInterval(iv);
  }, 100);

  document.addEventListener('DOMContentLoaded', function () {
    setTimeout(function () { tryHookGlobals(); harvestCssAnimations(); }, 800);
  });
  window.addEventListener('load', function () {
    setTimeout(function () { tryHookGlobals(); harvestCssAnimations(); }, 1200);
  });
})();
`;
