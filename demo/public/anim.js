// TS-style animation showcase using TS-friendly libraries via ESM CDNs.
// Loaded as a module from each page.
// Libraries:
//   - motion (Motion One, TS-first)            : in-view reveal & spring transitions
//   - gsap                                     : timeline + scroll/hover effects
//   - animejs                                  : staggered list reveals
//   - @formkit/auto-animate                    : automatic list transitions on insert/remove
//   - lottie-web                               : JSON vector animation in hero

import { animate, inView, stagger, scroll } from "https://cdn.jsdelivr.net/npm/motion@10.18.0/+esm";
import gsap from "https://cdn.jsdelivr.net/npm/gsap@3.12.5/+esm";
import anime from "https://cdn.jsdelivr.net/npm/animejs@3.2.2/+esm";
import autoAnimate from "https://cdn.jsdelivr.net/npm/@formkit/auto-animate@0.8.2/+esm";
import lottie from "https://cdn.jsdelivr.net/npm/lottie-web@5.12.2/+esm";

window.__ml_anim_loaded = true;

const ready = (fn) =>
  document.readyState === "loading"
    ? document.addEventListener("DOMContentLoaded", fn, { once: true })
    : fn();

ready(() => {
  // 1) Hero reveals via Motion One
  const heroEls = document.querySelectorAll("[data-reveal]");
  heroEls.forEach((el, i) => {
    inView(el, () => {
      animate(el, { opacity: [0, 1], y: [16, 0] }, { duration: 0.6, delay: 0.05 * i, easing: [0.2, 0.8, 0.2, 1] });
      el.classList.add("is-visible");
    }, { margin: "0px 0px -10% 0px" });
  });

  // 2) GSAP fade-in for marketing cards & nav brand
  const fadeEls = document.querySelectorAll("[data-gsap-fade]");
  if (fadeEls.length) {
    gsap.to(fadeEls, {
      opacity: 1,
      y: 0,
      duration: 0.7,
      ease: "power2.out",
      stagger: 0.06,
    });
  }

  // 3) anime.js staggered features
  const featureEls = document.querySelectorAll(".features .feature");
  if (featureEls.length) {
    anime({
      targets: featureEls,
      translateY: [12, 0],
      opacity: [0, 1],
      delay: anime.stagger(80, { start: 200 }),
      duration: 600,
      easing: "easeOutCubic",
    });
  }

  // 4) auto-animate: animate inserts/removals in any list with [data-auto-animate]
  document.querySelectorAll("[data-auto-animate]").forEach((el) => autoAnimate(el));

  // 5) Lottie hero loop (small animated badge), only if container exists
  const lottieEl = document.querySelector("[data-lottie]");
  if (lottieEl) {
    try {
      lottie.loadAnimation({
        container: lottieEl,
        renderer: "svg",
        loop: true,
        autoplay: true,
        // Tiny inline animation: pulsing dot
        animationData: {
          v: "5.7.4", fr: 30, ip: 0, op: 60, w: 64, h: 64, nm: "pulse", ddd: 0,
          assets: [], layers: [{
            ddd: 0, ind: 1, ty: 4, nm: "circle", sr: 1,
            ks: {
              o: { a: 1, k: [
                { t: 0, s: [40] },
                { t: 30, s: [100] },
                { t: 60, s: [40] }
              ] },
              r: { a: 0, k: 0 },
              p: { a: 0, k: [32, 32] },
              a: { a: 0, k: [0, 0] },
              s: { a: 1, k: [
                { t: 0, s: [80, 80] },
                { t: 30, s: [120, 120] },
                { t: 60, s: [80, 80] }
              ] }
            },
            shapes: [{
              ty: "el", p: { a: 0, k: [0, 0] }, s: { a: 0, k: [22, 22] }, d: 1, nm: "ellipse"
            }, {
              ty: "fl", c: { a: 0, k: [0.42, 0.49, 1, 1] }, o: { a: 0, k: 100 }, nm: "fill"
            }],
            ip: 0, op: 60, st: 0, bm: 0
          }]
        },
      });
    } catch (e) {
      console.warn("lottie failed", e);
    }
  }

  // 6) GSAP scroll-trigger-lite via Motion One scroll() — animates progress bar
  const progress = document.querySelector("[data-scroll-progress]");
  if (progress) {
    scroll(animate(progress, { scaleX: [0, 1] }, { ease: "linear" }));
  }

  // 7) Form: simple validation + reveal success card via auto-animate
  const form = document.querySelector("form[data-signup]");
  if (form) {
    const success = document.querySelector("[data-success]");
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const fields = form.querySelectorAll(".field");
      let valid = true;
      fields.forEach((f) => {
        const input = f.querySelector("input,select,textarea");
        if (!input) return;
        const empty = !input.value.trim();
        const isEmail = input.type === "email";
        const badEmail = isEmail && input.value && !/.+@.+\..+/.test(input.value);
        if (empty || badEmail) {
          f.classList.add("has-error"); valid = false;
        } else {
          f.classList.remove("has-error");
        }
      });
      if (valid && success) {
        success.hidden = false;
        animate(success, { opacity: [0, 1], y: [10, 0] }, { duration: 0.5 });
      }
    });
  }

  // 8) Dashboard: animate KPI numbers on load
  document.querySelectorAll("[data-count]").forEach((el) => {
    const target = Number(el.dataset.count);
    const obj = { v: 0 };
    anime({
      targets: obj,
      v: target,
      duration: 1100,
      easing: "easeOutQuart",
      update: () => { el.textContent = el.dataset.prefix ? el.dataset.prefix + Math.round(obj.v).toLocaleString() : Math.round(obj.v).toLocaleString(); },
    });
  });

  // 9) Loading skeletons → swap to real content after 1.4s with auto-animate
  document.querySelectorAll("[data-skeleton-swap]").forEach((container) => {
    setTimeout(() => {
      const realHtml = container.dataset.real;
      if (realHtml) container.innerHTML = realHtml;
    }, 1400);
  });
});
