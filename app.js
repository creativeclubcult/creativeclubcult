/* Creative Club Cult — shared interactions (prototype) */
(function () {
  'use strict';

  // ---- Smooth scroll (GSAP ScrollSmoother; skipped for reduced motion, native on touch) ----
  var smoother = null;
  if (window.gsap && window.ScrollTrigger && window.ScrollSmoother &&
      !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    gsap.registerPlugin(ScrollTrigger, ScrollSmoother);
    smoother = ScrollSmoother.create({
      wrapper: '#smooth-wrapper',
      content: '#smooth-content',
      smooth: 1.1,
      effects: true,
      smoothTouch: false
    });
  }

  // ---- Menu overlay ----
  var btn = document.querySelector('.menu-btn');
  var menu = document.getElementById('menu');
  if (btn && menu) {
    var setMenu = function (open) {
      menu.classList.toggle('open', open);
      menu.setAttribute('aria-hidden', open ? 'false' : 'true');
      document.documentElement.classList.toggle('menu-open', open);
      if (smoother) smoother.paused(open);
      btn.setAttribute('aria-expanded', open);
      btn.textContent = open ? 'Close' : 'Menu';
      // Wait a frame: the overlay is visibility:hidden until the class lands.
      if (open) requestAnimationFrame(function () { var first = menu.querySelector('a'); if (first) first.focus({ preventScroll: true }); });
    };
    btn.addEventListener('click', function () { setMenu(!menu.classList.contains('open')); });
    menu.addEventListener('click', function (e) { if (e.target.closest('a')) setMenu(false); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && menu.classList.contains('open')) { setMenu(false); btn.focus(); }
    });
  }

  // ---- Motion: reveals + word-mask text ----
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Wrap each word of a heading in a masked span (preserves nested markup like .dim / <em>)
  function wrapWords(node, out) {
    Array.prototype.slice.call(node.childNodes).forEach(function (child) {
      if (child.nodeType === 3) {
        var frag = document.createDocumentFragment();
        child.textContent.split(/(\s+)/).forEach(function (tok) {
          if (tok === '') return;
          if (/^\s+$/.test(tok)) { frag.appendChild(document.createTextNode(tok)); return; }
          var w = document.createElement('span'); w.className = 'word';
          var wi = document.createElement('span'); wi.className = 'wi'; wi.textContent = tok;
          w.appendChild(wi); frag.appendChild(w); out.push(wi);
        });
        node.replaceChild(frag, child);
      } else if (child.nodeType === 1 && child.tagName !== 'BR') {
        wrapWords(child, out);
      }
    });
  }

  if (!reduce) {
    // Word-mask the big entry headings
    document.querySelectorAll('.hero h1, .page-hero h1').forEach(function (h) {
      h.classList.add('anim-text');
      var inners = []; wrapWords(h, inners);
      inners.forEach(function (wi, i) { wi.style.transitionDelay = (0.045 * i) + 's'; });
    });

    // Hero / page-hero entrance fade-ups (staggered)
    var fades = document.querySelectorAll('.hero .hero-meta, .hero .band, .page-hero .eyebrow, .page-hero .lead, .page-hero .facts');
    fades.forEach(function (e, i) { e.classList.add('reveal'); e.style.transitionDelay = (0.12 + 0.08 * i) + 's'; });

    // Stagger grid children
    ['.cards', '.rail'].forEach(function (sel) {
      document.querySelectorAll(sel).forEach(function (group) {
        var n = 0;
        Array.prototype.slice.call(group.children).forEach(function (k) {
          if (k.classList.contains('reveal')) { k.style.transitionDelay = (0.06 * n) + 's'; n++; }
        });
      });
    });
  }

  var revealEls = document.querySelectorAll('.reveal, .anim-text');
  if (reduce || !('IntersectionObserver' in window)) {
    revealEls.forEach(function (e) { e.classList.add('in'); });
  } else {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
    revealEls.forEach(function (e) { io.observe(e); });
  }

  // ---- Archive filters ----
  var filterBar = document.querySelector('.filters');
  if (filterBar) {
    var items = document.querySelectorAll('[data-cat]');
    filterBar.addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      filterBar.querySelectorAll('button').forEach(function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
      var cat = b.getAttribute('data-filter');
      items.forEach(function (it) {
        var show = cat === 'all' || (it.getAttribute('data-cat') || '').split(' ').indexOf(cat) > -1;
        it.style.display = show ? '' : 'none';
      });
    });
  }

  // ---- Card rails: arrow controls ----
  document.querySelectorAll('.arrow[data-rail]').forEach(function (a) {
    var rail = document.getElementById(a.getAttribute('data-rail'));
    if (!rail) return;
    var dir = +a.getAttribute('data-dir');
    a.addEventListener('click', function () {
      var card = rail.firstElementChild;
      var step = card ? card.getBoundingClientRect().width + parseFloat(getComputedStyle(rail).columnGap || 0) : rail.clientWidth;
      rail.scrollBy({ left: dir * step, behavior: 'smooth' });
    });
    var sync = function () {
      var max = rail.scrollWidth - rail.clientWidth - 2;
      a.disabled = dir < 0 ? rail.scrollLeft <= 2 : rail.scrollLeft >= max;
    };
    rail.addEventListener('scroll', sync, { passive: true });
    window.addEventListener('resize', sync);
    sync();
  });

  // ---- Journal entries: highlight panel glides to the hovered row ----
  if (window.matchMedia('(hover: hover)').matches) {
    document.querySelectorAll('.entries').forEach(function (list) {
      var hl = list.querySelector('.entries-hl');
      if (!hl) return;
      var active = null;
      list.addEventListener('mouseover', function (e) {
        var row = e.target.closest('.entry');
        if (!row || row === active) return;
        if (active) active.classList.remove('is-active');
        active = row;
        row.classList.add('is-active');
        hl.style.transform = 'translateY(' + row.offsetTop + 'px)';
        hl.style.height = row.offsetHeight + 'px';
        list.classList.add('is-hover');
      });
      var reset = function () {
        list.classList.remove('is-hover');
        if (active) active.classList.remove('is-active');
        active = null;
      };
      list.addEventListener('mouseleave', reset);
      // Row positions change on resize and filtering; drop stale highlight state.
      window.addEventListener('resize', reset);
      document.addEventListener('click', function (e) { if (e.target.closest('.filters')) reset(); });
    });
  }

  // ---- Custom cursor (desktop / fine pointer only) ----
  (function () {
    var fine = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    if (!fine) return;
    var cur = document.createElement('div');
    cur.className = 'cursor';
    cur.setAttribute('aria-hidden', 'true');
    document.body.appendChild(cur);
    document.body.classList.add('has-cursor');

    var x = window.innerWidth / 2, y = window.innerHeight / 2, cx = x, cy = y, ready = false;
    window.addEventListener('mousemove', function (e) {
      x = e.clientX; y = e.clientY;
      if (!ready) { ready = true; cx = x; cy = y; cur.classList.add('ready'); }
    }, { passive: true });
    document.addEventListener('mouseleave', function () { cur.style.opacity = '0'; });
    document.addEventListener('mouseenter', function () { if (ready) cur.style.opacity = ''; });

    (function loop() {
      cx += (x - cx) * 0.2; cy += (y - cy) * 0.2;
      cur.style.transform = 'translate(' + cx.toFixed(1) + 'px,' + cy.toFixed(1) + 'px)';
      requestAnimationFrame(loop);
    })();

    var sel = 'a, button, input, textarea, select, [data-cursor]';
    document.addEventListener('mouseover', function (e) {
      if (e.target.closest && e.target.closest(sel)) cur.classList.add('hover');
    });
    document.addEventListener('mouseout', function (e) {
      var to = e.relatedTarget;
      if (e.target.closest && e.target.closest(sel) && !(to && to.closest && to.closest(sel))) {
        cur.classList.remove('hover');
      }
    });
  })();

  // ---- Page transition fallback (browsers without cross-document View Transitions) ----
  (function () {
    if ('startViewTransition' in document) return; // native VT handles it via CSS
    var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    document.documentElement.classList.add('pt-fallback');
    if (reduce) return;
    window.addEventListener('pageshow', function () {
      document.body.classList.remove('pt-out');
      requestAnimationFrame(function () { document.body.classList.add('pt-in'); });
    });
    document.addEventListener('click', function (e) {
      var a = e.target.closest && e.target.closest('a');
      if (!a) return;
      var href = a.getAttribute('href') || '';
      if (!href || href.charAt(0) === '#' || href.indexOf('mailto:') === 0 || href.indexOf('tel:') === 0 ||
          a.target === '_blank' || (a.host && a.host !== location.host)) return;
      e.preventDefault();
      document.body.classList.remove('pt-in');
      document.body.classList.add('pt-out');
      setTimeout(function () { location.href = href; }, 320);
    });
  })();

  // ---- Contact form ----
  var form = document.querySelector('form.inquiry');
  if (form) {
    var typeRow = form.querySelector('.type-row');
    if (typeRow) {
      typeRow.addEventListener('click', function (e) {
        var b = e.target.closest('button');
        if (!b) return;
        e.preventDefault();
        typeRow.querySelectorAll('button').forEach(function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
        var hidden = form.querySelector('input[name="inquiryType"]');
        if (hidden) hidden.value = b.textContent.trim();
      });
    }
    var status = form.querySelector('.form-status');
    var submit = form.querySelector('.submit-btn');
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var name = form.querySelector('[name="name"]');
      var email = form.querySelector('[name="email"]');
      var desc = form.querySelector('[name="description"]');
      var okEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((email.value || '').trim());
      if (!name.value.trim() || !okEmail || !desc.value.trim()) {
        status.textContent = 'Please fill in your name, a valid email, and a short description.';
        return;
      }
      // No backend in the prototype — capture intent gracefully.
      submit.disabled = true;
      status.textContent = "Thanks — we've received your note and will be in touch soon.";
      form.reset();
      if (typeRow) { typeRow.querySelectorAll('button').forEach(function (x, i) { x.setAttribute('aria-pressed', i === 0 ? 'true' : 'false'); }); }
    });
  }
})();
