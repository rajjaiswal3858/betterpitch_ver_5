// Motion layer for the BetterPitch theme (colours live in theme.css): a scroll
// progress bar and staggered scroll-reveal of each section's content. Injected
// into every HTML page by server.js. Like content.js it waits for React to
// hydrate, and it only adds attributes and one fixed overlay - no element is
// moved, removed or re-ordered.
(function () {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Elements already animated by the page's own scripts (inline opacity /
  // transform) or positioned with translate utilities are left alone.
  function animatedByPage(el) {
    const st = el.getAttribute('style') || '';
    if (/opacity|transform|translate/.test(st)) return true;
    const cs = getComputedStyle(el);
    return cs.translate !== 'none' || cs.transform !== 'none' || cs.position === 'absolute' || cs.position === 'fixed' || cs.position === 'sticky';
  }

  // Content blocks to reveal inside one top-level section: the children of its
  // main content column, and the cards inside row/grid containers among them.
  function targets(section) {
    const col = section.querySelector('[class*="max-w-7xl"], [class*="max-w-[1320px]"]') || section.firstElementChild;
    if (!col) return [];
    // the column itself is the card grid (e.g. pricing plans)
    if (/(^|\s)grid(\s|$)/.test(col.getAttribute('class') || '')) return [...col.children].map((c, i) => [c, i]);
    const out = [];
    for (const child of col.children) {
      if (child.querySelector('[class*="sticky"]')) continue; // scroll-driven section: leave intact
      const cls = child.getAttribute('class') || '';
      const isRow = /(^|\s)(grid|lg:flex-row|md:grid)/.test(cls) && child.children.length > 1;
      if (isRow) out.push(...[...child.children].map((c, i) => [c, i]));
      else out.push([child, 0]);
    }
    return out;
  }

  function reveal() {
    if (reduce || !('IntersectionObserver' in window)) return;
    const main = document.querySelector('main');
    if (!main) return;
    const io = new IntersectionObserver(entries => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        e.target.setAttribute('data-bp-reveal', 'in');
        io.unobserve(e.target);
      }
    }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });

    // outermost sections, plus top-level panels that aren't wrapped in a <section>
    const sections = [...main.querySelectorAll('section')].filter(s => s.id !== 'bp-hero' && !s.parentElement.closest('section'));
    for (const d of main.querySelectorAll(':scope > div > div')) if (!d.querySelector('section') && !d.closest('section')) sections.push(d);
    const vh = innerHeight;
    sections.forEach(sec => {
      let n = 0;
      for (const [el, i] of targets(sec)) {
        if (el.hasAttribute('data-bp-reveal') || animatedByPage(el)) continue;
        // anything already on screen stays put, so nothing visible blinks out
        if (el.getBoundingClientRect().top < vh) continue;
        el.style.setProperty('--bp-delay', (Math.min(i, 5) * 0.09 + Math.min(n, 2) * 0.05).toFixed(2) + 's');
        el.setAttribute('data-bp-reveal', 'out');
        io.observe(el);
        n++;
      }
    });
  }

  function progress() {
    const bar = document.createElement('div');
    bar.id = 'bp-progress';
    bar.setAttribute('aria-hidden', 'true');
    document.body.appendChild(bar);
    let raf = 0;
    const update = () => {
      raf = 0;
      // React can re-render <body> after a hydration mismatch, dropping the bar
      // and replacing #page-scroller, so look both up again every time
      if (!bar.isConnected) document.body.appendChild(bar);
      const sc = document.getElementById('page-scroller') || document.scrollingElement;
      const max = sc.scrollHeight - sc.clientHeight;
      bar.style.transform = 'scaleX(' + (max > 0 ? sc.scrollTop / max : 0).toFixed(4) + ')';
    };
    // scroll doesn't bubble, but capturing on document sees every scroller
    document.addEventListener('scroll', () => { raf ||= requestAnimationFrame(update); }, { passive: true, capture: true });
    update();
  }

  let started = false;
  function start() {
    if (started) return;
    started = true;
    progress();
    // after hero.js has placed the home-page hero, so positions are final
    setTimeout(reveal, 150);
  }
  window.addEventListener('load', () => setTimeout(start, 450));
  setTimeout(start, 4200);
})();
