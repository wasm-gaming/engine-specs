// Two small behaviours the default theme does not cover. Wired through
// typedoc.json → customJs (which takes a single file, hence both live here).

// 1. Render ```mermaid fences.
//
// TypeDoc emits them as <pre><code class="mermaid">, which is exactly what mermaid
// looks for. If the CDN is unreachable the fences stay as plain code blocks: the
// diagram source is readable either way.
//
// Renders are serialized on a promise chain. Two overlapping mermaid.run() calls
// corrupt each other: the second one reads the node after the first has written its
// SVG into it, tries to parse that as diagram source, and paints "Syntax error".

(function () {
  var codes = Array.prototype.slice.call(document.querySelectorAll('pre > code.mermaid'));
  if (codes.length === 0) return;

  var CDN = 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs';

  function currentTheme() {
    var theme = document.documentElement.dataset.theme;
    if (theme !== 'light' && theme !== 'dark') {
      theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return theme === 'dark' ? 'dark' : 'default';
  }

  import(CDN)
    .then(function (module) {
      var mermaid = module.default;

      // Swap each fence for a host div, keeping the source to re-render on theme change.
      var hosts = codes.map(function (code) {
        var host = document.createElement('div');
        host.className = 'mermaid-diagram';
        host.dataset.source = code.textContent;
        host.textContent = code.textContent;
        code.parentElement.replaceWith(host);
        return host;
      });

      function draw(theme) {
        hosts.forEach(function (host) {
          host.removeAttribute('data-processed');
          host.textContent = host.dataset.source;
        });
        mermaid.initialize({ startOnLoad: false, theme: theme });
        return mermaid.run({ nodes: hosts });
      }

      var queue = Promise.resolve();
      var drawn = null;

      function schedule() {
        var theme = currentTheme();
        if (theme === drawn) return;
        drawn = theme;
        queue = queue.then(function () {
          return draw(theme);
        }).catch(function () {
          /* keep the chain alive so a later theme switch still renders */
        });
      }

      schedule();

      new MutationObserver(schedule).observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['data-theme'],
      });
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', schedule);
    })
    .catch(function () {
      /* offline or CDN down — the fences remain as code blocks */
    });
})();

// 2. Expand the sidebar groups by default.
//
// main.js builds the tree with <details> and no `open`, and the accordion falls back
// to that attribute when localStorage holds no preference — so everything starts
// collapsed. We only open branches the reader has never touched; a branch they
// collapsed themselves has a stored value and is left alone.

(function () {
  var container = document.getElementById('tsd-nav-container');
  if (!container) return;

  function stored(summary) {
    var name = summary.dataset.key || summary.textContent.trim().replace(/\s+/g, '-').toLowerCase();
    try {
      return localStorage.getItem('tsd-accordion-' + name);
    } catch (e) {
      return null; // private mode: treat as "no preference"
    }
  }

  function expand() {
    var accordions = container.querySelectorAll('details.tsd-accordion');
    if (accordions.length === 0) return false;

    accordions.forEach(function (details) {
      var summary = details.querySelector('summary');
      if (summary && stored(summary) === null) details.open = true;
    });
    return true;
  }

  // The tree is built asynchronously, so it may not exist yet.
  if (expand()) return;

  var observer = new MutationObserver(function () {
    if (expand()) observer.disconnect();
  });
  observer.observe(container, { childList: true, subtree: true });
})();
