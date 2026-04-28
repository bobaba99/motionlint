// Shared nav/footer injected client-side so we don't repeat markup across HTML files.
(function () {
  const navHTML = `
    <header class="nav">
      <div class="container nav-inner">
        <a class="brand" href="/">
          <span class="logo"></span>
          <span>Aurora</span>
        </a>
        <nav class="nav-links" aria-label="primary">
          <a href="/">Product</a>
          <a href="/pricing">Pricing</a>
          <a href="/dashboard">Dashboard</a>
          <a href="/loading">Skeletons</a>
          <a href="/signup">Sign up</a>
        </nav>
        <div class="nav-cta">
          <a class="btn btn-ghost" href="/signup">Log in</a>
          <a class="btn btn-primary" href="/signup">Start free</a>
        </div>
      </div>
    </header>
  `;
  const footerHTML = `
    <footer class="container">
      <div>© Aurora — MotionLint demo · TS animation showcase</div>
      <div>Built with Motion One · GSAP · anime.js · auto-animate · lottie-web</div>
    </footer>
  `;
  document.addEventListener("DOMContentLoaded", () => {
    const navMount = document.querySelector("[data-nav]");
    const footerMount = document.querySelector("[data-footer]");
    if (navMount) navMount.outerHTML = navHTML;
    if (footerMount) footerMount.outerHTML = footerHTML;
  });
})();
