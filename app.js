/* Creative Club Cult — shared interactions (prototype) */
(function () {
  'use strict';

  // ---- Type fitting (runs first: ScrollTrigger measures the final layout) ----
  // .ptitle: shrink a long project name until it fits on one line.
  // .fit: scale giant type so it fills data-fit (0–1) of its content width.
  var fitTitles = function () {
    document.querySelectorAll('.ptitle').forEach(function (t) {
      t.style.fontSize = '';
      var room = t.parentElement.clientWidth - parseFloat(getComputedStyle(t.parentElement).paddingLeft) * 2;
      if (t.scrollWidth > room) t.style.fontSize = (parseFloat(getComputedStyle(t).fontSize) * room / t.scrollWidth) + 'px';
    });
    document.querySelectorAll('.fit').forEach(function (t) {
      var cs = getComputedStyle(t);
      var room = (t.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)) * (parseFloat(t.getAttribute('data-fit')) || 1);
      t.style.fontSize = '100px';
      var r = document.createRange(); r.selectNodeContents(t);
      t.style.fontSize = (100 * room / r.getBoundingClientRect().width) + 'px';
    });
  };
  fitTitles();

  // Design px (as measured on a 1440px-wide screen) to px on this screen. On desktop the layout is
  // sized off the viewport width, not the browser zoom (ZOOM LOCK in styles.css), so motion distances
  // follow it the same way; phones keep plain px.
  var dpx = function (n) { var w = window.innerWidth; return w > 760 ? n * w / 1440 : n; };

  // ---- Smooth scroll (GSAP ScrollSmoother; skipped for reduced motion, native on touch) ----
  var smoother = null;
  if (window.gsap && window.ScrollTrigger && window.ScrollSmoother &&
      !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    gsap.registerPlugin(ScrollTrigger, ScrollSmoother);
    if (window.Flip) gsap.registerPlugin(Flip);
    // A browser-restored scroll position lands before triggers are measured and throws them off,
    // so pages always open at the top; re-measure once images have settled the layout.
    if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
    if (!location.hash) window.scrollTo(0, 0);
    window.addEventListener('load', function () { ScrollTrigger.refresh(); });
    smoother = ScrollSmoother.create({
      wrapper: '#smooth-wrapper',
      content: '#smooth-content',
      smooth: 1.1,
      effects: true,
      smoothTouch: false
    });
    document.documentElement.classList.add('has-smoother');
    // position: sticky can't work inside the smoothed content, so pin the project photo instead.
    document.querySelectorAll('.pstory').forEach(function (story) {
      // Hold the photo until the next section has slid all the way over it ('bottom top').
      ScrollTrigger.create({ trigger: story, start: 'top top', end: 'bottom top', pin: story.querySelector('.pstory-bg'), pinSpacing: false });
      // The photo drifts up slower than the text, and a thin black veil builds as you read.
      var scrub = { trigger: story, start: 'top top', end: 'bottom top', scrub: true };
      gsap.to(story.querySelector('.pstory-bg img'), { yPercent: -15, ease: 'none', scrollTrigger: scrub });
      gsap.fromTo(story.querySelector('.pstory-shade'), { opacity: 0 }, { opacity: 0.35, ease: 'none', scrollTrigger: scrub });
    });

    // ---- Home landing: scroll-driven transitions ----
    if (document.querySelector('.h-hero')) {
      // Hero sinks and darkens while the black section slides over it.
      gsap.timeline({ scrollTrigger: { trigger: '.h-black', start: 'top bottom', end: 'top top', scrub: true } })
        .to('.h-hero-inner', { yPercent: 80, ease: 'none' }, 0)
        .to('.h-hero-shade', { opacity: 0.8, ease: 'none' }, 0)
        .fromTo(['.h-hero-title', '.h-hero-sub'], { opacity: 1 }, { opacity: 0, duration: 0.6, ease: 'none', immediateRender: false }, 0);

      // The intro holds on screen with the plus — a glyph just before the intro line — at rest. A little
      // scroll into it and the rest plays on its own, accordion.net.au-style, at its own pace however
      // fast the visitor scrolls: the plus turns on its way to the centre and folds into a square, the
      // square grows to fill the screen, the intro flies apart and the work section opens out of the
      // square with its title falling in. Scroll is held for it; scrolling back up plays it backwards.
      var intro = document.querySelector('.h-intro');
      var plus = document.querySelector('.h-plus');
      var introP = document.querySelector('.h-intro-text p');
      var work = document.querySelector('.h-work');
      var plusBars = gsap.utils.toArray('.h-plus i.h, .h-plus i.v');
      var sq = plus.querySelector('i.sq'); // the square the hand-over grows (not a bar)
      if (!sq) { sq = document.createElement('i'); sq.className = 'sq'; plus.appendChild(sq); } // (a page cached from before it)
      var grow = 'power3.inOut', fall = 'power3.out';
      if (window.CustomEase) {
        gsap.registerPlugin(CustomEase);
        // accordion.net.au's curves: a long soft start, a quick middle, a long soft landing
        CustomEase.create('ccc-grow', 'M0,0 C0.29,0 0.317,0.018 0.388,0.103 0.457,0.186 0.466,0.362 0.498,0.502 0.518,0.592 0.528,0.77 0.591,0.864 0.666,0.975 0.704,1 1,1');
        CustomEase.create('ccc-fall', '0.47, 0, 0, 1');
        grow = 'ccc-grow'; fall = 'ccc-fall';
      }
      var plusStart = function () {
        // offsets, not rects: unaffected by the pin and the intro's own tweens
        var x = 0, y = 0, el = introP;
        while (el && el !== intro) { x += el.offsetLeft; y += el.offsetTop; el = el.offsetParent; }
        var cs = getComputedStyle(introP), fs = parseFloat(cs.fontSize), lh = parseFloat(cs.lineHeight) || fs * 1.15;
        var size = fs * 0.72, gap = fs * 0.45;
        var cx = x - gap - size / 2, cy = y + lh / 2;
        if (cx - size / 2 < 8) { cx = x + size / 2; cy = y - gap - size / 2; } // no room on the left: sit above
        return { x: cx - intro.offsetWidth / 2, y: cy - intro.offsetHeight / 2, scale: size / plus.offsetWidth };
      };
      gsap.set(plusBars.concat(sq), { xPercent: -50, yPercent: -50 });
      gsap.set(sq, { scaleX: 1, scaleY: 1, visibility: 'hidden' }); // (whatever the stylesheet in the cache says)
      gsap.set('.h-plus i.h', { scaleX: 5, scaleY: 1 });
      gsap.set('.h-plus i.v', { scaleX: 1, scaleY: 5 });

      // The opening, built on first use (the title is split into letters further down this file).
      var hidden = 'inset(0px 0px 100% 0px)';
      gsap.set(work, { clipPath: hidden });
      var reveal = null;
      var buildReveal = function () {
        var square = function () { // the folded square's box (unscaled), in the work section's coordinates
          var p = plus.getBoundingClientRect(), w = work.getBoundingClientRect(), h = sq.offsetWidth / 2;
          var cx = p.left + p.width / 2, cy = p.top + p.height / 2;
          return 'inset(' + (cy - h - w.top) + 'px ' + (w.right - cx - h) + 'px ' + (w.bottom - cy - h) + 'px ' + (cx - h - w.left) + 'px)';
        };
        var tl = gsap.timeline({ paused: true, defaults: { ease: grow },
          onComplete: function () { gsap.set(work, { clipPath: 'none' }); state = 'open'; },
          onReverseComplete: function () { gsap.set(work, { clipPath: hidden }); gsap.set(sq, { visibility: 'hidden' }); unfold(); } });
        // Both the square and the opening overshoot the screen by a fifth, so their edges leave it while
        // still moving — the curve's long soft landing happens off-screen instead of as a thin black
        // frame that hangs, then snaps shut.
        var over = function () { // past the screen all round, in the work section's coordinates
          var vw = window.innerWidth, vh = window.innerHeight;
          // (the bottom reaches two screens down, so scrolling on before it's done never shows a gap)
          return 'inset(' + (-0.2 * vh) + 'px ' + (-0.2 * vw) + 'px ' + (work.offsetHeight - 2.2 * vh) + 'px ' + (-0.2 * vw) + 'px)';
        };
        tl.set(sq, { visibility: 'visible' }, 0)
          .fromTo(sq, { scaleX: 1, scaleY: 1 }, {
            scaleX: function () { return 1.2 * window.innerWidth / sq.offsetWidth; },
            scaleY: function () { return 1.2 * window.innerHeight / sq.offsetHeight; }, duration: 1.2, immediateRender: false }, 0)
          .to('.h-intro-top', { y: '-10em', opacity: 0, duration: 0.8 }, 0)
          .to('.h-strip', { y: '10em', opacity: 0, duration: 0.8 }, 0)
          .fromTo(work, { clipPath: square }, { clipPath: over, duration: 1.2 }, 0.25)
          .fromTo('.h-work-label', { clipPath: 'inset(0% 50% 0% 50%)', opacity: 0 }, { clipPath: 'inset(0% 0% 0% 0%)', opacity: 1, duration: 1 }, 0.5)
          .fromTo('.h-count > span', { yPercent: 105 }, { yPercent: 0, duration: 1, stagger: 0.06 }, 0.6)
          .fromTo(work.querySelectorAll('.h-work-intro [data-title] .ch'),
            { y: function (i) { return -(2.5 + 1.2 * i) + 'em'; }, rotate: -12,
              textShadow: '-0.3em 0.8em 0 currentColor, -0.6em 1.6em 0 currentColor' },
            { y: '0em', rotate: 0, textShadow: '0em 0.8em 0 currentColor, 0em 1.6em 0 currentColor',
              duration: 1.5, stagger: 0.015, ease: fall }, 0.5);
        return tl;
      };
      var content = document.getElementById('smooth-content');
      var root = document.documentElement;
      // closed → opening → open → closing → closed. Each hand-over runs once per crossing; while one
      // holds the scroll nothing else may start (the scrub catching up, or a 1px correction, would
      // otherwise re-trigger it or read as scrolling back and close it again).
      var state = 'closed', locked = false, releasedAt = 0;
      // Hold = ignore the visitor's wheel / swipe / scroll keys. Not smoother.paused(): that also freezes
      // the page on screen, so the glide below would happen unseen and the page would jump to catch up
      // on the next scroll.
      var block = function (e) { e.preventDefault(); };
      var blockKeys = function (e) { if (/^(ArrowUp|ArrowDown|PageUp|PageDown|Home|End| )$/.test(e.key)) e.preventDefault(); };
      var hold = function () {
        locked = true; root.classList.add('is-handover');
        window.addEventListener('wheel', block, { passive: false });
        window.addEventListener('touchmove', block, { passive: false });
        window.addEventListener('keydown', blockKeys);
      };
      var release = function () {
        locked = false; releasedAt = performance.now(); root.classList.remove('is-handover');
        window.removeEventListener('wheel', block, { passive: false });
        window.removeEventListener('touchmove', block, { passive: false });
        window.removeEventListener('keydown', blockKeys);
      };
      var visualScroll = function () { return -gsap.getProperty(content, 'y'); }; // what's on screen, not the wheel target
      // The plus's journey: from the text to the centre, turning, folding into a square (and the photo
      // strip drifting along). Played on its own clock, never scrubbed, so scroll speed can't rush it.
      var PLUS_IN = 1.3, PLUS_OUT = 1;
      var plusTl = null;
      var buildPlus = function () { // (rebuilt on resize: its start sits by the text, which reflows)
        var at = plusTl ? plusTl.progress() : 0;
        if (plusTl) plusTl.kill();
        plusTl = gsap.timeline({ paused: true })
          .fromTo(plus,
            { x: function () { return plusStart().x; }, y: function () { return plusStart().y; }, scale: function () { return plusStart().scale; } },
            { x: 0, y: 0, scale: 1, ease: 'power2.inOut', duration: 0.7 }, 0)
          .fromTo(plus, { rotate: 0 }, { rotate: -360, ease: 'power2.inOut', duration: 0.85 }, 0)
          .fromTo('.h-plus i.h', { scaleX: 5, scaleY: 1 }, { scaleX: 1, scaleY: 1, ease: 'power2.inOut', duration: 0.35 }, 0.5)
          .fromTo('.h-plus i.v', { scaleX: 1, scaleY: 5 }, { scaleX: 1, scaleY: 1, ease: 'power2.inOut', duration: 0.35 }, 0.5)
          .fromTo('.h-strip-track', { xPercent: 0 }, { xPercent: -15, ease: 'power2.inOut', duration: 0.85 }, 0);
        plusTl.progress(at);
      };
      buildPlus();
      var handOver = function (self) {
        // (and not in the moment after a release: un-pausing can nudge the scroll a pixel)
        if (locked || state !== 'closed' || performance.now() - releasedAt < 300) return;
        state = 'opening';
        root.classList.add('is-handover'); // header ignores this scroll…
        document.dispatchEvent(new CustomEvent('ccc:hide-header')); // …and steps out of the way
        // drop the wheel's pending momentum where the screen is now and hold the scroll (the glide below
        // then carries it on from there, even if a flick has the screen still short of the intro)
        smoother.scrollTop(Math.min(visualScroll(), self.end));
        hold();
        // The plus makes its way to the centre at its own pace while the scroll glides to the end of the
        // intro underneath (unseen: the intro is pinned and the work section still hidden). The opening
        // only starts once both have landed: the work section opens out of the square in its own
        // coordinates, so it must be standing still where the square is, or the two come apart.
        var d = PLUS_IN * (1 - plusTl.progress());
        gsap.timeline({ onComplete: function () {
            if (state !== 'opening') return;
            if (!reveal) reveal = buildReveal();
            else reveal.invalidate(); // (re-measures the square where it is now)
            reveal.timeScale(1).play(0);
            // (scroll comes back after 1s, while the title is still falling — no dead stretch after it)
            gsap.delayedCall(1, release);
          } })
          .to(plusTl, { progress: 1, duration: d, ease: 'none' }, 0)
          .to(smoother, { scrollTop: Math.ceil(self.end), duration: Math.max(d, 0.5), ease: 'power2.inOut', overwrite: true }, 0);
      };
      var handBack = function (self) {
        if (locked || state === 'closed' || state === 'closing' || !reveal) return;
        state = 'closing';
        // close back into the square at the centre with the scroll parked at the end of the intro, then
        // (unfold, below) the plus makes its way back to the text while the scroll glides to the intro's
        // top, and only then let go
        smoother.scrollTop(self.end - 1);
        hold();
        reveal.timeScale(2.2).reverse();
      };
      var unfold = function () {
        gsap.to(plusTl, { progress: 0, duration: PLUS_OUT * plusTl.progress(), ease: 'none', overwrite: true });
        gsap.to(smoother, { scrollTop: Math.ceil(introSt.start) + 1, duration: PLUS_OUT, ease: 'power2.inOut', overwrite: true,
          onComplete: function () { state = 'closed'; release(); } });
      };
      var introSt = ScrollTrigger.create({
        trigger: intro, start: 'top top', end: '+=80%', pin: true, invalidateOnRefresh: true,
        // starts after a little scroll into the intro (so it can be read first), and closes only on a real
        // scroll back up into it (8px+), never on a pixel of rounding
        onUpdate: function (self) {
          if (self.direction > 0 && self.progress > 0.1) handOver(self);
          else if (self.direction < 0 && self.scroll() < self.end - 8) handBack(self);
        },
        onLeave: handOver,
        onRefresh: function () { if (state === 'closed' || state === 'open') buildPlus(); }
      });
      // Arriving below the intro without scrolling through it (a #work link, a resize): just open up.
      ScrollTrigger.addEventListener('refresh', function () {
        if (smoother.scrollTop() > introSt.end + 1 && state === 'closed') {
          if (!reveal) reveal = buildReveal();
          plusTl.progress(1);
          reveal.progress(1); // (onComplete marks it open)
        }
      });
      // The work section is pulled up under the intro's last screen, so it opens in place.
      var overlapWork = function () { work.style.marginTop = -intro.offsetHeight + 'px'; };
      overlapWork();
      ScrollTrigger.addEventListener('refreshInit', overlapWork);

      // Full-bleed photo drifts against the scroll.
      gsap.fromTo('.h-full-bg', { yPercent: 4 }, { yPercent: -4, ease: 'none', scrollTrigger: { trigger: '.h-full', start: 'top bottom', end: 'bottom top', scrub: true } });

      // End panel (Contact + footer): it lies beneath the page and is uncovered as the light section
      // above slides up off it — drifting up from 60% of a screen higher, so it reads as further back,
      // and coming out of a black veil, so it isn't bright from the first pixel. (The light sections
      // keep their colour throughout.)
      var end = document.querySelector('.h-end');
      if (end) {
        // The inner layer moves; the outer box stays put and is what the scroll is measured against
        // (measured while shifted up, the panel would put the whole range 60% of a screen too early).
        gsap.timeline({ scrollTrigger: { trigger: end, start: 'top bottom', end: 'top top', scrub: true, invalidateOnRefresh: true } })
          .fromTo(end.querySelector('.h-end-in'), { yPercent: -60 }, { yPercent: 0, ease: 'none' }, 0)
          .fromTo(end.querySelector('.h-end-veil'), { opacity: 0.9 }, { opacity: 0, ease: 'power1.in' }, 0);
      }
    }
  }

  // ---- Split text into letter spans (giant titles, CTA labels) ----
  var splitChars = function (el) {
    if (el.getAttribute('data-split')) return el.querySelectorAll('.ch');
    var text = el.textContent;
    el.setAttribute('aria-label', text);
    el.textContent = '';
    Array.prototype.forEach.call(text, function (c) {
      if (c === ' ') { el.appendChild(document.createTextNode(' ')); return; }
      var s = document.createElement('span'); s.className = 'ch'; s.setAttribute('aria-hidden', 'true'); s.textContent = c; el.appendChild(s);
    });
    el.setAttribute('data-split', '1');
    return el.querySelectorAll('.ch');
  };
  var motionOK = window.gsap && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---- Giant titles: letters fall in, each trailing two copies of itself ----
  document.querySelectorAll('[data-title]').forEach(function (t) {
    var chars = splitChars(t);
    if (!motionOK || !window.ScrollTrigger) return;
    // falls as part of the home intro's hand-over (which only exists with the smoother)
    if (t.getAttribute('data-title-start') === 'intro' && document.documentElement.classList.contains('has-smoother')) return;
    gsap.fromTo(chars,
      { y: function (i) { return -(2.5 + 0.8 * i) + 'em'; }, rotate: -12,
        textShadow: '-0.3em 0.8em 0 currentColor, -0.6em 1.6em 0 currentColor' },
      { y: '0em', rotate: 0, textShadow: '0em 0.8em 0 currentColor, 0em 1.6em 0 currentColor',
        duration: 1.5, stagger: 0.01, ease: 'power3.out',
        // (as accordion.net.au: falls as the title comes up into view, once — scrolling back up leaves it be)
        scrollTrigger: { trigger: t.parentElement, start: 'top bottom', toggleActions: 'play none none none' } });
  });

  // ---- How-we-work rows: word rises letter by letter, keywords and notes follow ----
  document.querySelectorAll('.h-step').forEach(function (row) {
    var chars = splitChars(row.querySelector('.h-step-word'));
    if (!motionOK || !window.ScrollTrigger) return;
    gsap.timeline({ scrollTrigger: { trigger: row, start: 'top 85%', toggleActions: 'play none none reverse' } })
      .fromTo(chars, { yPercent: 110, rotate: 6 }, { yPercent: 0, rotate: 0, duration: 1, stagger: 0.04, ease: 'power4.out' })
      .fromTo(row.querySelectorAll('.h-step-side p'), { y: 24, opacity: 0 }, { y: 0, opacity: 1, duration: 0.8, stagger: 0.08, ease: 'power3.out' }, 0.25);
    // The word glides in with the scroll and settles exactly on the grid line by reading position.
    // (Animated on the head, not the word: GSAP would reset the word's CSS translate used for hover.)
    gsap.fromTo(row.querySelector('.h-step-head'), { x: function () { return dpx(48); } }, {
      x: 0, ease: 'none', scrollTrigger: { trigger: row, start: 'top bottom', end: 'top 55%', scrub: true, invalidateOnRefresh: true }
    });
  });

  // ---- How-we-work icons: each one builds itself when its row is hovered, unbuilds on leave ----
  // Think: the eye opens and its plus pupil leans toward the cursor. Direct: lines climb into the
  // diamond. Create: the hexagon line draws itself. Produce: the ball rises out of the hand.
  if (motionOK && window.matchMedia('(hover: hover)').matches) document.querySelectorAll('.h-step').forEach(function (row) {
    var svg = row.querySelector('.h-step-icon svg');
    if (!svg) return;
    var kind = svg.getAttribute('data-icon');
    var tl = gsap.timeline({ paused: true });
    var draw = function (els, opts, at) {
      // attr, not CSS: GSAP rounds CSS px values, which would snap a pathLength=1 line straight to drawn
      gsap.set(els, { attr: { 'stroke-dasharray': '1 2', 'stroke-dashoffset': 1 } });
      tl.to(els, Object.assign({ attr: { 'stroke-dashoffset': 0 }, ease: 'power2.inOut' }, opts), at);
    };

    if (kind === 'think') {
      var lid = svg.querySelector('.eye-lid'), clip = svg.querySelector('.eye-clip'), eye = { o: 0 };
      var shape = function () {
        // Almond outline whose lids part around the centre line as o goes 0 → 1
        var f = function (k) { return (50 - k * eye.o).toFixed(2); }, b = function (k) { return (50 + k * eye.o).toFixed(2); };
        var d = 'M8 50L26 ' + f(14.5) + 'C33 ' + f(20.5) + ' 41 ' + f(24) + ' 50 ' + f(24) + 'C59 ' + f(24) + ' 67 ' + f(20.5) + ' 74 ' + f(14.5) +
                'L92 50L74 ' + b(14.5) + 'C67 ' + b(20.5) + ' 59 ' + b(24) + ' 50 ' + b(24) + 'C41 ' + b(24) + ' 33 ' + b(20.5) + ' 26 ' + b(14.5) + 'Z';
        lid.setAttribute('d', d); clip.setAttribute('d', d);
      };
      shape();
      tl.to(eye, { o: 1, duration: 0.65, ease: 'power2.inOut', onUpdate: shape }, 0.15);
      // Pupil follows the pointer, but only a few units — a glance, not a chase
      var pupil = svg.querySelector('.eye-pupil');
      var px = gsap.quickTo(pupil, 'x', { duration: 0.6, ease: 'power3.out' });
      var py = gsap.quickTo(pupil, 'y', { duration: 0.6, ease: 'power3.out' });
      row.addEventListener('mousemove', function (e) {
        var r = svg.getBoundingClientRect();
        var dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
        var d = Math.hypot(dx, dy) || 1, m = Math.min(d / 320, 1) * 8;
        px(dx / d * m); py(dy / d * m);
      });
    } else if (kind === 'direct') {
      var p = svg.querySelectorAll('.draw');
      // Every line grows at the same speed, so the two inner ones meet at the fork and carry on as the stem
      draw([p[0], p[1]], { duration: 0.62, ease: 'none' }, 0);
      draw(p[2], { duration: 0.75, ease: 'none' }, 0);
      draw(p[3], { duration: 0.4, ease: 'none' }, 0);
      draw(svg.querySelectorAll('.tip'), { duration: 0.4, ease: 'power2.out' }, 0.75);
      tl.set(svg.querySelectorAll('.tip'), { opacity: 0 }).set(svg.querySelector('.tip-full'), { opacity: 1 });
    } else if (kind === 'create') {
      draw(svg.querySelectorAll('.draw'), { duration: 1 }, 0);
      tl.set(svg.querySelectorAll('.draw'), { attr: { 'stroke-dasharray': 'none' } });
    } else if (kind === 'produce') {
      tl.fromTo(svg.querySelector('.ball'), { y: 38 }, { y: 0, duration: 0.7, ease: 'power3.out' }, 0.1);
    }

    row.addEventListener('mouseenter', function () { tl.timeScale(1).play(); });
    row.addEventListener('mouseleave', function () { tl.timeScale(1.8).reverse(); });
  });

  // ---- Typographic CTAs: letters roll on hover, corner pluses turn ----
  document.querySelectorAll('.h-cta').forEach(function (a) {
    var base = splitChars(a.querySelector('.h-cta-t:not(.dup)'));
    var dup = splitChars(a.querySelector('.h-cta-t.dup'));
    if (!motionOK) return;
    var sec = a.parentElement;
    a.addEventListener('mouseenter', function () {
      gsap.fromTo(dup, { y: function (i) { return -(1.25 + 0.2 * i) + 'em'; } }, { y: '0em', stagger: 0.02, duration: 0.6, ease: 'power3.inOut', overwrite: true });
      gsap.fromTo(base, { y: '0em' }, { y: function (i) { return (1.25 + 0.2 * i) + 'em'; }, stagger: 0.02, duration: 0.6, ease: 'power3.inOut', overwrite: true });
      gsap.fromTo(sec.querySelectorAll('.corner.tl, .corner.br'), { rotate: 0 }, { rotate: 90, duration: 0.6, ease: 'power3.inOut' });
      gsap.fromTo(sec.querySelectorAll('.corner.tr, .corner.bl'), { rotate: 0 }, { rotate: -90, duration: 0.6, ease: 'power3.inOut' });
    });
    a.addEventListener('mouseleave', function () {
      gsap.to(base, { y: '0em', stagger: 0.02, duration: 0.6, ease: 'power3.inOut', overwrite: true });
      gsap.to(dup, { y: function (i) { return -(1.25 + 0.2 * i) + 'em'; }, stagger: 0.02, duration: 0.6, ease: 'power3.inOut', overwrite: true });
    });
  });

  // ---- Project slider (accordion.net.au-style) ----
  // Nothing is open and the counter reads 01 until the box comes into view; then it opens to full
  // width, the middle project opens and the counter rolls to it. A strip opens on click; the open
  // slide is the link to its project.
  document.querySelectorAll('.h-slider').forEach(function (slider) {
    var box = slider.querySelector('.h-slider-box');
    var slides = Array.prototype.slice.call(slider.querySelectorAll('.h-slide'));
    var col = slider.querySelector('.h-count-col');
    var cur = -1;
    var activate = function (i) {
      cur = i;
      slides.forEach(function (s, k) { s.classList.toggle('is-active', k === i); });
      if (col) col.style.transform = 'translateY(' + (-100 * i / slides.length) + '%)';
    };
    // Opening the open slide: its photo grows to fill the screen just as the project page's hero
    // shows it, holds a beat, then the page changes (and cross-fades onto that same picture).
    var leaving = false;
    var stop = function (e) { e.preventDefault(); };
    var openProject = function (s) {
      if (leaving) return;
      leaving = true;
      var href = s.href, img = s.querySelector('.h-slide-bg');
      var sr = s.getBoundingClientRect(), ir = img.getBoundingClientRect();
      var vw = window.innerWidth, vh = window.innerHeight;
      var zoom = document.createElement('div'), pic = img.cloneNode();
      var dim = document.createElement('span'), shade = document.createElement('span');
      zoom.className = 'h-zoom'; pic.className = 'h-zoom-img'; dim.className = 'h-zoom-dim'; shade.className = 'h-zoom-shade';
      zoom.appendChild(pic); zoom.appendChild(dim); zoom.appendChild(shade);
      document.body.appendChild(zoom);
      gsap.set(zoom, { left: sr.left, top: sr.top, width: sr.width, height: sr.height });
      gsap.set(pic, { left: ir.left - sr.left, top: ir.top - sr.top, width: ir.width, height: ir.height });
      window.addEventListener('wheel', stop, { passive: false });
      window.addEventListener('touchmove', stop, { passive: false });
      gsap.timeline({ defaults: { duration: 1.1, ease: 'power3.inOut' },
          onComplete: function () {
            // tell the project page it's arriving under its own hero, so it skips the page fade
            try { sessionStorage.setItem('ccc-zoom', '1'); } catch (e) {}
            setTimeout(function () { location.href = href; }, 250);
          } })
        .to(zoom, { left: 0, top: 0, width: vw, height: vh }, 0)
        .to(pic, { left: 0, top: 0, width: vw, height: vh * 1.18 }, 0) // as .pstory-bg img: 118% tall, from the top
        .to(dim, { opacity: 0 }, 0)
        .to(shade, { opacity: 1 }, 0);
      // Back from the project (page restored from the back/forward cache): put everything back.
      window.addEventListener('pageshow', function (e) {
        if (!e.persisted) return;
        zoom.remove(); leaving = false;
        window.removeEventListener('wheel', stop, { passive: false });
        window.removeEventListener('touchmove', stop, { passive: false });
      }, { once: true });
    };
    slides.forEach(function (s, i) {
      s.addEventListener('click', function (e) {
        if (i !== cur) { e.preventDefault(); activate(i); }
        else if (motionOK) { e.preventDefault(); openProject(s); }
      });
    });
    // The open slide's title says it can be clicked: with the cursor on it, its letters roll over to
    // a copy rising from below (as the CTA's do) and the photo leans in a touch. Pointers that hover only.
    if (motionOK && window.matchMedia('(hover: hover)').matches) slides.forEach(function (s, i) {
      var t = s.querySelector('.h-slide-title'), body = s.querySelector('.h-slide-body'), img = s.querySelector('.h-slide-bg');
      var text = t.textContent, chars = function () {
        return text.split('').map(function (c) { return c === ' ' ? ' ' : '<span class="ch">' + c + '</span>'; }).join('');
      };
      t.setAttribute('aria-label', text);
      t.innerHTML = '<span class="h-roll" aria-hidden="true"><span class="h-roll-a">' + chars() + '</span><span class="h-roll-b">' + chars() + '</span></span>';
      var lines = t.querySelectorAll('.h-roll-a .ch, .h-roll-b .ch'), a = t.querySelectorAll('.h-roll-a .ch'), bb = t.querySelectorAll('.h-roll-b .ch');
      var roll = function (on) {
        var to = { yPercent: on ? -100 : 0, duration: 0.55, ease: 'power3.inOut', stagger: 0.022, overwrite: true };
        gsap.to(a, to); gsap.to(bb, to);
        gsap.to(img, { scale: on ? 1.035 : 1, duration: 0.9, ease: 'power3.out', overwrite: 'auto' });
      };
      body.addEventListener('mouseenter', function () { if (i === cur && !leaving) roll(true); });
      body.addEventListener('mouseleave', function () { roll(false); });
      s.addEventListener('mouseleave', function () { if (lines.length) roll(false); });
    });
    var open = function () { box.classList.add('is-open'); activate(Math.floor(slides.length / 2)); };
    if (motionOK && window.ScrollTrigger) ScrollTrigger.create({ trigger: box, start: 'top 75%', once: true, onEnter: open });
    else open();
  });

  // ---- Opening loader (home, once per session) and hero entrance ----
  (function () {
    var hero = document.querySelector('.h-hero');
    if (!hero) return;
    var root = document.documentElement;
    var navItems = document.querySelectorAll('.site-header > *');
    var entrance = function () {
      if (!motionOK) return;
      gsap.fromTo(['.h-hero-title', '.h-hero-sub'], { opacity: 0, y: '2.5rem' }, { opacity: 1, y: '0rem', duration: 0.9, ease: 'power3.out', stagger: 0.12 });
      gsap.fromTo(navItems, { opacity: 0, yPercent: -100 }, { opacity: 1, yPercent: 0, duration: 0.5, stagger: 0.1, clearProps: 'opacity,transform' });
    };
    if (!root.classList.contains('is-loading')) { entrance(); return; }
    var done = function () {
      root.classList.remove('is-loading');
      try { sessionStorage.setItem('ccc-loader', '1'); } catch (e) {}
      if (smoother) smoother.paused(false);
      entrance();
    };
    if (!motionOK) { done(); return; }
    clearTimeout(window.cccLoadFallback); // (the head's safety net, should this script never run)
    if (smoother) smoother.paused(true);
    var stop = function (e) { e.preventDefault(); };
    window.addEventListener('wheel', stop, { passive: false });
    window.addEventListener('touchmove', stop, { passive: false });
    var word = document.querySelector('.h-load-word'), box = document.querySelector('.h-load-box');
    var pics = box.querySelectorAll('img');
    // letters in their own boxes, for the rise
    var chars = [];
    document.querySelectorAll('.h-load-text').forEach(function (t) {
      t.innerHTML = t.textContent.split('').map(function (c) {
        return c === ' ' ? ' ' : '<span class="ch">' + c + '</span>';
      }).join('');
      chars = chars.concat(Array.prototype.slice.call(t.querySelectorAll('.ch')));
    });
    var em = parseFloat(getComputedStyle(word).fontSize);
    var show = function (k) { return function () { pics.forEach(function (p, j) { p.style.visibility = j === k ? 'visible' : 'hidden'; }); }; };
    var tl = gsap.timeline({ delay: 0.3, onComplete: function () {
      window.removeEventListener('wheel', stop, { passive: false });
      window.removeEventListener('touchmove', stop, { passive: false });
      done();
    } });
    // 1. the name rises in, letter by letter
    tl.fromTo(chars, { yPercent: 110 }, { yPercent: 0, duration: 0.9, ease: 'power4.out', stagger: 0.035 }, 0);
    // 2. a window opens between its words and flicks through the work, landing on the hero picture
    tl.call(show(0), null, 1.45)
      .to(box, { width: 1.3 * em, duration: 0.8, ease: 'power3.inOut' }, 1.45);
    for (var k = 1; k < pics.length; k++) tl.call(show(k), null, 2.25 + (k - 1) * 0.42);
    // 3. it opens out to the whole screen, pushing the words off either side, and becomes the hero
    var wide = 2.25 + (pics.length - 1) * 0.42 + 0.45;
    tl.to(box, { width: function () { return window.innerWidth; }, height: function () { return window.innerHeight; },
        duration: 1.2, ease: 'power4.inOut' }, wide)
      .to(box, { '--shade': 1, duration: 0.6, ease: 'power2.out' }, wide + 0.6);
  })();

  // ---- Header: hides on the way down, returns on the way up ----
  (function () {
    if (!motionOK) return;
    var items = document.querySelectorAll('.site-header > *');
    var last = 0, hidden = false;
    var setHidden = function (down) {
      hidden = down;
      gsap.to(items, { autoAlpha: down ? 0 : 1, y: down ? '-75%' : '0%', ease: 'power3', overwrite: 'auto', stagger: { each: 0.03, from: 'center' } });
    };
    // the home intro's hand-over tucks the header away for its full-screen moment
    document.addEventListener('ccc:hide-header', function () { if (!hidden) setHidden(true); });
    window.addEventListener('scroll', function () {
      var y = window.scrollY || document.documentElement.scrollTop;
      if (document.documentElement.classList.contains('is-handover')) { last = y; return; } // scripted scroll
      if (Math.abs(y - last) < 25 || document.documentElement.classList.contains('menu-open')) return;
      var down = y > last && y > 120;
      if (down !== hidden) setHidden(down);
      last = y <= 0 ? 0 : y;
    }, { passive: true });
  })();

  window.addEventListener('resize', fitTitles);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () {
    fitTitles();
    if (window.ScrollTrigger) ScrollTrigger.refresh();
  });

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
    document.querySelectorAll('.page-hero h1, .ptitle').forEach(function (h) {
      h.classList.add('anim-text');
      var inners = []; wrapWords(h, inners);
      inners.forEach(function (wi, i) { wi.style.transitionDelay = (0.045 * i) + 's'; });
    });

    // Hero / page-hero entrance fade-ups (staggered)
    var fades = document.querySelectorAll('.page-hero .eyebrow, .page-hero .lead, .page-hero .facts');
    fades.forEach(function (e, i) { e.classList.add('reveal'); e.style.transitionDelay = (0.12 + 0.08 * i) + 's'; });

    // First-screen elements sitting at the very bottom never cross the scroll trigger line,
    // so they enter on load together with the title instead of waiting for a scroll.
    document.querySelectorAll('.pstory .pmeta').forEach(function (e) {
      e.classList.add('reveal');
      e.style.transitionDelay = '0.35s';
      requestAnimationFrame(function () { requestAnimationFrame(function () { e.classList.add('in'); }); });
    });

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

  // ---- Work index: Service / Industry lists. Hovering (or focusing) an entry shows a project from it
  // beside its list. Clicking one filters the grid: the title and the grid fade out, the title comes
  // back as the chosen entry, and the matching projects slide up and fade in, one after another.
  // Clicking it again (or the chip above the grid) goes back to All Work. ----
  document.querySelectorAll('.work-head').forEach(function (head) {
    var cards = Array.prototype.slice.call(document.querySelectorAll('[data-tags]'));
    var btns = head.querySelectorAll('button[data-filter]');
    var title = head.querySelector('.work-title');
    var chip = document.querySelector('.wf-chip');
    var active = null, tl = null;
    var apply = function (b) {
      active = b;
      btns.forEach(function (x) { x.setAttribute('aria-pressed', x === active ? 'true' : 'false'); });
      var key = active && active.getAttribute('data-filter');
      var label = active ? active.textContent : 'All Work';
      var match = function (c) { return !key || (c.getAttribute('data-tags') || '').split(' ').indexOf(key) > -1; };
      var swap = function () {
        title.textContent = label;
        cards.forEach(function (c) { c.style.display = match(c) ? '' : 'none'; });
        if (chip) { chip.querySelector('.t').textContent = active ? label : ''; chip.hidden = !active; }
        if (window.ScrollTrigger) ScrollTrigger.refresh();
      };
      if (!motionOK) { swap(); return; }
      if (tl) tl.kill();
      var shown = cards.filter(function (c) { return c.style.display !== 'none'; });
      gsap.set(cards, { transition: 'none' }); // the cards' CSS reveal transition would fight these tweens
      tl = gsap.timeline()
        .to([title, chip], { opacity: 0, duration: 0.25, ease: 'power2.in' }, 0)
        .to(shown, { opacity: 0, duration: 0.3, ease: 'power2.in' }, 0)
        .add(swap)
        .fromTo([title, chip], { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.5, ease: 'power3.out' })
        .add(function () {
          gsap.fromTo(cards.filter(match), { opacity: 0, y: dpx(48) },
            { opacity: 1, y: 0, duration: 0.9, ease: 'power3.out', stagger: 0.07, overwrite: true });
        }, '<');
    };
    btns.forEach(function (b) {
      var thumb = b.closest('.wf-group').querySelector('.wf-thumb'), img = thumb.querySelector('img');
      var show = function () {
        var src = b.getAttribute('data-thumb');
        if (!src) { thumb.classList.remove('is-on'); return; }
        if (img.getAttribute('src') !== src) img.setAttribute('src', src);
        thumb.classList.add('is-on');
      };
      var hide = function () { thumb.classList.remove('is-on'); };
      b.addEventListener('mouseenter', show);
      b.addEventListener('focus', show);
      b.addEventListener('mouseleave', hide);
      b.addEventListener('blur', hide);
      b.addEventListener('click', function () { apply(active === b ? null : b); });
    });
    if (chip) chip.querySelector('button').addEventListener('click', function () { apply(null); });
  });

  // ---- Journal index (accordion.net.au/work-style) ----
  // Held at the left: filters and the List / Grid switch. Each entry card: its title's words rise as it
  // comes in (reset once it's back below the fold), its picture drifts, and on hover the picture greys
  // and blurs while the summary rises in. Right: the thumb strip travels with the scroll so the current
  // entry's thumb sits between the pluses, widened and lit. Grid: the cards slide off left and the thumbs
  // fly into a three-up grid of squares (and back).
  document.querySelectorAll('.jl').forEach(function (jl) {
    var list = jl.querySelector('.jl-list'), grid = jl.querySelector('.jl-grid');
    var side = jl.querySelector('.jl-side'), rail = jl.querySelector('.jl-rail'), track = jl.querySelector('.jl-thumbs');
    var items = Array.prototype.slice.call(jl.querySelectorAll('.jl-item'));
    var tiles = Array.prototype.slice.call(jl.querySelectorAll('.jl-tile'));
    var thumbs = Array.prototype.slice.call(jl.querySelectorAll('.jl-thumb'));
    var pluses = jl.querySelectorAll('.jl-plus');
    var shown = function (el) { return el.style.display !== 'none'; };
    var arriving = true; // during the arrival the cards on screen raise their words as they land (below)
    var thumbTls = []; // each thumb's scroll-driven widen-and-light, paused while thumbs fly (List / Grid)

    // words of each title (and its eyebrow) in masks, for the rise
    items.forEach(function (it) {
      var h = it.querySelector('h2'), text = h.textContent;
      h.setAttribute('aria-label', text);
      h.innerHTML = text.split(' ').map(function (w) { return '<span class="w" aria-hidden="true"><span class="wi">' + w + '</span></span>'; }).join(' ');
      var eb = it.querySelector('.jl-eyebrow');
      eb.innerHTML = '<span class="wi">' + eb.innerHTML + '</span>';
    });
    if (!motionOK || !window.ScrollTrigger) { return; }

    var desktop = window.matchMedia('(min-width: 761px)').matches;
    if (desktop && smoother) {
      // position: sticky can't work inside the smoothed page, so hold the side columns with pins
      [side, rail].forEach(function (el) {
        ScrollTrigger.create({ trigger: jl, start: 'top top', end: 'bottom bottom', pin: el, pinSpacing: false });
      });
    }

    items.forEach(function (it, i) {
      var rise = gsap.timeline({ paused: true })
        .fromTo(it.querySelectorAll('.jl-title .wi'), { yPercent: 200 }, { yPercent: 0, duration: 0.8, ease: 'power3.out', stagger: 0.04 });
      it._rise = rise;
      ScrollTrigger.create({ trigger: it, start: 'top 95%', onEnter: function () { if (!arriving) rise.play(); } });
      ScrollTrigger.create({ trigger: it, start: 'top bottom', onLeaveBack: function () { rise.pause(0); } });
      gsap.fromTo(it.querySelector('.jl-media'), { yPercent: -4 }, { yPercent: 4, ease: 'none',
        scrollTrigger: { trigger: it, start: 'top bottom', end: 'bottom top', scrub: true } });
      // the words drift the other way, so title and picture visibly part as the card passes
      gsap.fromTo(it.querySelector('.jl-title'), { y: function () { return dpx(70); } }, { y: function () { return dpx(-70); }, ease: 'none',
        scrollTrigger: { trigger: it, start: 'top bottom', end: 'bottom top', scrub: true, invalidateOnRefresh: true } });
      // its thumb widens and lights up while the card crosses the screen
      if (thumbs[i]) thumbTls[i] = gsap.timeline({ scrollTrigger: { trigger: it, start: 'top bottom', end: 'bottom top', scrub: 1 } })
        .fromTo(thumbs[i], { width: '3.056vw', opacity: 0.45 }, { width: '3.889vw', opacity: 1, ease: 'none', duration: 0.5 })
        .to(thumbs[i], { width: '3.056vw', opacity: 0.45, ease: 'none', duration: 0.5 });
      var details = it.querySelector('.jl-details');
      it.addEventListener('mouseenter', function () { gsap.fromTo(details, { autoAlpha: 0, yPercent: 25 }, { autoAlpha: 1, yPercent: 0, duration: 0.6, overwrite: true }); });
      it.addEventListener('mouseleave', function () { gsap.to(details, { autoAlpha: 0, yPercent: 25, duration: 0.6, overwrite: true }); });
    });

    // Opening an entry (as accordion.net.au opens a project): the card comes to the middle of the screen
    // while everything else fades and its veil and words clear; a beat on the bare picture; then the
    // picture widens out into the entry page's full-width hero (the same box that page opens with, from
    // the shared --ar-top / --ar-h) and the page changes underneath it.
    var opening = false;
    var stopScroll = function (e) { e.preventDefault(); };
    var openEntry = function (it) {
      if (opening) return;
      opening = true;
      window.addEventListener('wheel', stopScroll, { passive: false });
      window.addEventListener('touchmove', stopScroll, { passive: false });
      it.classList.add('is-opening');
      gsap.to([side, rail].concat(items.filter(function (x) { return x !== it; })), { autoAlpha: 0, duration: 0.5, ease: 'power2.out' });
      var r = it.getBoundingClientRect();
      var from = smoother ? smoother.scrollTop() : window.scrollY;
      var to = from + r.top + r.height / 2 - window.innerHeight / 2;
      var pos = { y: from };
      var grow = function () {
        var media = it.querySelector('.jl-media');
        var cr = it.getBoundingClientRect();
        var probe = document.createElement('div');
        probe.style.cssText = 'position:fixed;left:0;right:0;top:var(--ar-top);height:var(--ar-h);visibility:hidden;pointer-events:none';
        document.body.appendChild(probe);
        var hr = probe.getBoundingClientRect();
        probe.remove();
        var box = document.createElement('div'), pic = media.firstElementChild.cloneNode(true);
        box.className = 'jl-zoom';
        box.appendChild(pic);
        document.body.appendChild(box);
        gsap.set(box, { left: cr.left, top: cr.top, width: cr.width, height: cr.height });
        var tl = gsap.timeline({ defaults: { duration: 0.9, ease: 'power3.inOut' }, onComplete: function () {
            try { sessionStorage.setItem('ccc-zoom', '1'); } catch (e) {} // the entry page skips its fade
            setTimeout(function () { location.href = it.href; }, 120);
          } })
          .to(box, { left: hr.left, top: hr.top, width: hr.width, height: hr.height }, 0);
        if (pic.tagName === 'IMG') {
          // the photo keeps its size and only slides from where it sat in the card to the hero's centre
          var ir = media.querySelector('img').getBoundingClientRect();
          gsap.set(pic, { translate: 'none', left: ir.left - cr.left, top: ir.top - cr.top, width: ir.width, height: ir.height });
          tl.to(pic, { left: (hr.width - ir.width) / 2, top: (hr.height - ir.height) / 2 }, 0);
        } else {
          gsap.set(pic, { left: 0, top: 0, width: '100%', height: '100%' }); // a placeholder simply fills the frame
        }
        it.style.visibility = 'hidden';
        // back from the entry (page restored from the back/forward cache): put everything back
        window.addEventListener('pageshow', function (e) {
          if (!e.persisted) return;
          box.remove(); opening = false; it.style.visibility = ''; it.classList.remove('is-opening');
          gsap.set([side, rail].concat(items), { autoAlpha: 1 });
          window.removeEventListener('wheel', stopScroll, { passive: false });
          window.removeEventListener('touchmove', stopScroll, { passive: false });
        }, { once: true });
      };
      gsap.timeline({ onComplete: grow })
        .to(pos, { y: to, duration: 0.8, ease: 'power2.inOut', onUpdate: function () {
          if (smoother) smoother.scrollTop(pos.y); else window.scrollTo(0, pos.y);
        } })
        .to({}, { duration: 0.35 });
    };
    items.forEach(function (it) {
      it.addEventListener('click', function (e) {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button > 0) return; // new tab etc.: leave it be
        e.preventDefault();
        openEntry(it);
      });
    });

    // Opening from the grid: the square lifts out and glides to the middle of the screen while the rest
    // fades, holds a beat, then widens into the entry page's full-width hero (the same --ar-top / --ar-h
    // box), its picture growing from the square's crop into the hero's, all on one in-out curve.
    var heroBox = function () {
      var probe = document.createElement('div');
      probe.style.cssText = 'position:fixed;left:0;right:0;top:var(--ar-top);height:var(--ar-h);visibility:hidden;pointer-events:none';
      document.body.appendChild(probe);
      var r = probe.getBoundingClientRect();
      probe.remove();
      return r;
    };
    var openTile = function (tile) {
      if (opening) return;
      opening = true;
      window.addEventListener('wheel', stopScroll, { passive: false });
      window.addEventListener('touchmove', stopScroll, { passive: false });
      var media = tile.querySelector('.jl-tile-media'), src = media.firstElementChild;
      var mr = media.getBoundingClientRect(), hr = heroBox();
      var box = document.createElement('div'), pic = src.cloneNode(true);
      box.className = 'jl-zoom';
      box.appendChild(pic);
      document.body.appendChild(box);
      // the picture's size in the hero, as the entry page's CSS has it (a placeholder simply fills it)
      var W = hr.width, H = hr.height;
      if (pic.tagName === 'IMG') {
        gsap.set(box, { left: hr.left, top: hr.top, width: hr.width, height: hr.height });
        H = pic.getBoundingClientRect().height;
        W = src.naturalWidth ? Math.max(window.innerWidth, H * src.naturalWidth / src.naturalHeight) : pic.getBoundingClientRect().width;
      }
      var cx = (window.innerWidth - mr.width) / 2, cy = (window.innerHeight - mr.height) / 2;
      gsap.set(box, { left: mr.left, top: mr.top, width: mr.width, height: mr.height });
      gsap.set(pic, { translate: 'none', minWidth: 0, left: 0, top: 0, width: mr.width, height: mr.height });
      tile.style.visibility = 'hidden';
      gsap.to([side].concat(tiles.filter(function (t) { return t !== tile; })), { autoAlpha: 0, duration: 0.5, ease: 'power2.out' });
      gsap.timeline({ defaults: { ease: 'power3.inOut' }, onComplete: function () {
          try { sessionStorage.setItem('ccc-zoom', '1'); } catch (e) {} // the entry page skips its fade
          setTimeout(function () { location.href = tile.href; }, 120);
        } })
        .to(box, { left: cx, top: cy, duration: 0.8 })
        .to(box, { left: hr.left, top: hr.top, width: hr.width, height: hr.height, duration: 1 }, '+=0.25')
        .to(pic, { left: (hr.width - W) / 2, top: (hr.height - H) / 2, width: W, height: H, duration: 1 }, '<');
      // back from the entry (page restored from the back/forward cache): put everything back
      window.addEventListener('pageshow', function (e) {
        if (!e.persisted) return;
        box.remove(); opening = false; tile.style.visibility = '';
        gsap.set([side].concat(tiles), { autoAlpha: 1 });
        window.removeEventListener('wheel', stopScroll, { passive: false });
        window.removeEventListener('touchmove', stopScroll, { passive: false });
      }, { once: true });
    };
    tiles.forEach(function (tile) {
      tile.addEventListener('click', function (e) {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button > 0) return;
        if (busy || filtering) { e.preventDefault(); return; }
        e.preventDefault();
        openTile(tile);
      });
    });

    // The strip travels so the thumb of whichever card is centred on screen sits at the centre line.
    var travel = null;
    var buildTravel = function () {
      if (travel) { travel.scrollTrigger && travel.scrollTrigger.kill(); travel.kill(); travel = null; }
      var vis = items.filter(shown), th = thumbs.filter(shown);
      if (!desktop || vis.length < 1) return;
      var at = function (t) { return -(t.offsetTop + t.offsetHeight / 2); };
      travel = gsap.fromTo(track, { y: function () { return at(th[0]); } }, { y: function () { return at(th[th.length - 1]); }, ease: 'none',
        scrollTrigger: { trigger: vis[0], start: 'center center', endTrigger: vis[vis.length - 1], end: 'center center', scrub: 1, invalidateOnRefresh: true } });
    };
    buildTravel();

    // Arrival: the entry cards slide up into place one after another, eased in and out, while the side
    // columns fade in. (Positions are re-measured once they've landed: the scroll triggers above were
    // measured with the cards still lowered.)
    gsap.fromTo(items.filter(shown).map(function (it) { return it.querySelector('.jl-in'); }), { yPercent: 35, autoAlpha: 0 }, {
      yPercent: 0, autoAlpha: 1, duration: 1.3, ease: 'power3.inOut', stagger: 0.12, delay: 0.1,
      clearProps: 'transform,opacity,visibility', onComplete: function () {
        arriving = false;
        ScrollTrigger.refresh();
        // anything scrolled into view meanwhile catches up
        items.forEach(function (it) { if (it._rise.progress() === 0 && it.getBoundingClientRect().top < window.innerHeight * 0.95) it._rise.play(); });
      }
    });
    gsap.fromTo([side, rail], { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.9, ease: 'power2.inOut', delay: 0.35 });
    // the cards already on screen bring their words up as they land (not while still invisible)
    items.filter(shown).forEach(function (it, k) {
      if (it.offsetTop < window.innerHeight * 1.2) gsap.delayedCall(0.1 + k * 0.12 + 0.75, function () { it._rise.play(); });
    });
    var goTo = function (el) { if (smoother) smoother.scrollTo(el, true, 'center center'); else el.scrollIntoView({ behavior: 'smooth', block: 'center' }); };
    thumbs.forEach(function (t, i) { t.addEventListener('click', function () { goTo(items[i]); }); });

    // Filters: what's on screen lifts away and fades, the page goes back to the top (unseen), and the
    // matching entries slide up into place one after another, eased in and out, as on arrival.
    var fbtns = jl.querySelectorAll('[data-jf]');
    var cat = 'all', filtering = false;
    var syncScrubs = function () { // scrubbed with lag: put them straight where the scroll says
      thumbTls.concat(travel ? [travel] : []).forEach(function (t) {
        var st = t && t.scrollTrigger, tw = st && st.getTween && st.getTween();
        if (tw) tw.progress(1);
        if (st) t.progress(st.progress);
      });
    };
    var inners = function () { return items.filter(shown).map(function (it) { return it.querySelector('.jl-in'); }); };
    fbtns.forEach(function (b) {
      b.addEventListener('click', function () {
        var c = b.getAttribute('data-jf');
        if (c === cat || filtering || busy) return;
        cat = c; filtering = true;
        fbtns.forEach(function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
        lockScroll(true);
        var match = function (el) { return cat === 'all' || el.getAttribute('data-cat') === cat; };
        var isGrid = view === 'grid';
        var all = isGrid ? tiles.filter(shown) : inners();
        var onScreen = function (el) { var r = el.getBoundingClientRect(); return r.bottom > 0 && r.top < window.innerHeight; };
        var out = all.filter(onScreen);
        gsap.set(all.filter(function (el) { return !onScreen(el); }), { autoAlpha: 0 });
        gsap.to(track, { autoAlpha: 0, duration: 0.35, ease: 'power2.in' });
        gsap.to(out.length ? out : {}, { y: -dpx(40), autoAlpha: 0, duration: 0.4, ease: 'power2.in', stagger: 0.04, onComplete: function () {
          gsap.set(all, { clearProps: 'transform,opacity,visibility' });
          items.forEach(function (el, i) {
            var on = match(el);
            el.style.display = on ? '' : 'none'; tiles[i].style.display = on ? '' : 'none'; thumbs[i].style.display = on ? '' : 'none';
          });
          if (smoother) smoother.scrollTop(0); else window.scrollTo(0, 0); // unseen, so straight there
          arriving = true;
          items.forEach(function (it) { it._rise.pause(0); });
          var inc = isGrid ? tiles.filter(shown) : inners();
          gsap.set(inc, isGrid ? { y: dpx(70), autoAlpha: 0 } : { yPercent: 35, autoAlpha: 0 });
          ScrollTrigger.refresh();
          buildTravel();
          syncScrubs();
          var finish = function () {
            arriving = false; filtering = false; lockScroll(false);
            ScrollTrigger.refresh();
            items.forEach(function (it) { if (shown(it) && it._rise.progress() === 0 && it.getBoundingClientRect().top < window.innerHeight * 0.95) it._rise.play(); });
          };
          if (isGrid) {
            gsap.to(inc, { y: 0, autoAlpha: 1, duration: 0.9, ease: 'power2.inOut', stagger: 0.06, clearProps: 'transform,opacity,visibility', onComplete: finish });
          } else {
            gsap.to(inc, { yPercent: 0, autoAlpha: 1, duration: 1, ease: 'power2.inOut', stagger: 0.1, clearProps: 'transform,opacity,visibility', onComplete: finish });
            // the cards on screen bring their words up as they land
            items.filter(shown).forEach(function (it, k) {
              if (it.offsetTop < window.innerHeight * 1.2) gsap.delayedCall(k * 0.1 + 0.5, function () { it._rise.play(); });
            });
          }
          // (the strip's own y belongs to its travel: the thumbs rise inside it instead)
          gsap.to(track, { autoAlpha: 1, duration: 0.6, ease: 'power2.out', delay: 0.2 });
          gsap.fromTo(thumbs.filter(shown), { y: 24 }, { y: 0, duration: 0.9, ease: 'power3.inOut', stagger: 0.05, delay: 0.15, clearProps: 'transform' });
        } });
      });
    });

    // List / Grid (as accordion.net.au's work index). The page first settles at the top (scroll held
    // throughout). To grid: the cards grey and slide off to the left one after another while the thumbs
    // fly out of the strip and grow into the grid's squares. Back: the squares grey, the cards slide in
    // from the left and the squares shrink back into the strip. One in-out curve for all of it.
    var vbtns = jl.querySelectorAll('[data-jv]');
    var caps = jl.querySelectorAll('.jl-tile-cap');
    var view = 'list', busy = false;
    var E = 'power3.inOut';
    var medias = function (els) { return els.filter(shown).map(function (t) { return t.firstElementChild; }); };
    var settleTop = function (done) {
      var y = smoother ? smoother.scrollTop() : window.scrollY;
      if (y < 2) { done(); return; }
      var p = { y: y };
      gsap.to(p, { y: 0, duration: Math.min(0.9, 0.35 + y / 4000), ease: 'power2.inOut', onComplete: done,
        onUpdate: function () { if (smoother) smoother.scrollTop(p.y); else window.scrollTo(0, p.y); } });
    };
    var lockScroll = function (on) {
      var f = on ? 'addEventListener' : 'removeEventListener';
      window[f]('wheel', stopScroll, { passive: false });
      window[f]('touchmove', stopScroll, { passive: false });
    };
    var toGrid = function (flip, done) {
      var vis = items.filter(shown);
      var state = flip ? Flip.getState(medias(thumbs)) : null;
      // (an absolutely placed grid item is positioned within its own grid area: 0,0 keeps it exactly where it was)
      gsap.set(list, { position: 'absolute', top: 0, left: 0, width: list.offsetWidth, pointerEvents: 'none' });
      gsap.to(vis, { xPercent: -175, filter: 'saturate(0)', duration: 1, stagger: 0.1, ease: E });
      gsap.to(pluses[0], { rotate: -180, autoAlpha: 0, duration: 0.6, ease: E });
      gsap.to(pluses[1], { rotate: 180, autoAlpha: 0, duration: 0.6, ease: E });
      gsap.set(caps, { autoAlpha: 0 }); // captions only once the squares have landed
      jl.classList.add('is-grid');
      rail.style.visibility = 'hidden';
      if (flip) {
        var tm = medias(tiles);
        gsap.set(tm, { transition: 'none' }); // the squares' hover transitions would drag on every frame
        // each picture flies from the strip, far outside its own square: let it out of the square's clip
        gsap.set(tiles, { overflow: 'visible', zIndex: 2 });
        Flip.from(state, { targets: tm, duration: 1, ease: E, stagger: 0.05, absolute: true, prune: true,
          onComplete: function () { gsap.set(tm, { clearProps: 'transition' }); gsap.set(tiles, { clearProps: 'overflow,zIndex' }); } });
      }
      else gsap.fromTo(tiles.filter(shown), { autoAlpha: 0, y: 30 }, { autoAlpha: 1, y: 0, duration: 0.8, stagger: 0.05, ease: E });
      gsap.to(caps, { autoAlpha: 1, duration: 0.4, delay: 1.1 });
      gsap.delayedCall(1.2, function () { list.style.display = 'none'; ScrollTrigger.refresh(); done(); });
    };
    var toList = function (flip, done) {
      var vis = items.filter(shown);
      gsap.to(caps, { autoAlpha: 0, duration: 0.25 });
      gsap.to(tiles.filter(shown), { filter: 'saturate(0)', duration: 0.35, ease: 'power2.out' });
      gsap.delayedCall(0.35, function () {
        var state = flip ? Flip.getState(medias(tiles)) : null;
        var tv = thumbs.filter(shown), tmv = medias(thumbs);
        // the list comes back (its cards parked off to the left) and everything is measured now, before
        // anything moves: in grid view it was measured hidden, so its cards' drift and the strip's
        // lighting were stale and only caught up once landed (the card jumped, the thumbs blinked)
        list.style.display = '';
        gsap.set(list, { clearProps: 'position,top,left,width,pointerEvents' });
        gsap.set(vis, { xPercent: -175, filter: 'saturate(0)' });
        rail.style.visibility = '';
        jl.classList.remove('is-grid');
        gsap.set(tiles, { clearProps: 'filter' });
        ScrollTrigger.refresh();
        buildTravel();
        // scrubbed with lag: jump straight to where the scroll says they belong
        thumbTls.concat(travel ? [travel] : []).forEach(function (t) {
          var st = t && t.scrollTrigger, tw = st && st.getTween && st.getTween();
          if (tw) tw.progress(1);
          if (st) t.progress(st.progress);
        });
        // each thumb takes off looking exactly like its square (full strength, grey) and turns into its
        // strip self on the way (dims and takes its colour back)
        var rest = tv.map(function (t) { return +getComputedStyle(t).opacity; });
        thumbTls.forEach(function (t) { if (t && t.scrollTrigger) t.scrollTrigger.disable(false); }); // hold their scroll styling still
        gsap.set(tv, { opacity: 1, overflow: 'visible' });
        gsap.to(vis, { xPercent: 0, filter: 'saturate(1)', duration: 1, stagger: 0.1, ease: E, clearProps: 'filter' });
        gsap.to(pluses, { rotate: 0, autoAlpha: 1, duration: 0.6, delay: 0.5, ease: E });
        var land = function () {
          // hand the dimming back to the strip (already measured: nothing re-lays out here)
          tv.forEach(function (t, k) { gsap.set(t, { opacity: rest[k], clearProps: 'overflow' }); });
          gsap.set(tmv, { clearProps: 'opacity,filter' });
          thumbTls.forEach(function (t) { if (t && t.scrollTrigger) t.scrollTrigger.enable(false, false); });
          done();
        };
        if (flip) {
          // the dimming rides on the thumb itself, not on the flying picture (Flip resets the picture's
          // inline styles when it lets go, which flashed it back to full strength for a frame)
          tmv.forEach(function (m, k) {
            gsap.fromTo(m, { filter: 'saturate(0)' }, { filter: 'saturate(1)', duration: 1, delay: k * 0.05, ease: E });
            gsap.fromTo(tv[k], { opacity: 1 }, { opacity: rest[k], duration: 1, delay: k * 0.05, ease: E });
          });
          // land in the same tick Flip lets go of the pictures (it resets their inline styles as it does)
          Flip.from(state, { targets: tmv, duration: 1, ease: E, stagger: 0.05, absolute: true, prune: true, onComplete: land });
        } else {
          gsap.delayedCall(1.2, land);
        }
      });
    };
    vbtns.forEach(function (b) {
      b.addEventListener('click', function () {
        var v = b.getAttribute('data-jv');
        if (v === view || busy || filtering) return;
        busy = true; view = v;
        vbtns.forEach(function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
        lockScroll(true);
        var flip = !!(window.Flip && desktop);
        var done = function () { busy = false; lockScroll(false); };
        settleTop(function () { (v === 'grid' ? toGrid : toList)(flip, done); });
      });
    });
  });

  // ---- Journal entry page: under the full-width picture, the title, meta and back link rise in ----
  if (motionOK && document.querySelector('.ar-head')) {
    gsap.from(['.ar-title', '.ar-meta', '.ar-back'], { y: 18, opacity: 0, duration: 0.8, stagger: 0.08, ease: 'power3.out', delay: 0.15 });
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

  // ---- Project prev/next: photo preview follows the cursor ----
  if (window.matchMedia('(hover: hover) and (pointer: fine)').matches && document.querySelector('.pnav')) {
    // Lives on <body>: position:fixed breaks inside the transformed smooth-scroll content.
    var pv = document.createElement('div');
    pv.className = 'pnav-preview';
    pv.setAttribute('aria-hidden', 'true');
    var pvImg = document.createElement('img');
    pvImg.alt = '';
    pv.appendChild(pvImg);
    document.body.appendChild(pv);
    var px = 0, py = 0, tx = 0, ty = 0, pvRaf = null, pvOn = false;
    var pvLoop = function () {
      px += (tx - px) * 0.18; py += (ty - py) * 0.18;
      pv.style.transform = 'translate(' + px.toFixed(1) + 'px,' + py.toFixed(1) + 'px)';
      pvRaf = (pvOn || Math.abs(tx - px) > 0.5 || Math.abs(ty - py) > 0.5) ? requestAnimationFrame(pvLoop) : null;
    };
    document.querySelectorAll('.pnav a').forEach(function (a) {
      var right = a.classList.contains('pnav-next');
      var aim = function (e) {
        tx = right ? e.clientX - pv.offsetWidth - 24 : e.clientX + 24;
        ty = e.clientY - pv.offsetHeight / 2;
      };
      a.addEventListener('mouseenter', function (e) {
        var src = a.getAttribute('data-preview');
        pv.classList.toggle('is-empty', !src);
        if (src) pvImg.src = src;
        aim(e); px = tx; py = ty;
        pvOn = true; pv.classList.add('is-on');
        if (!pvRaf) pvRaf = requestAnimationFrame(pvLoop);
      });
      a.addEventListener('mousemove', aim);
      a.addEventListener('mouseleave', function () { pvOn = false; pv.classList.remove('is-on'); });
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
      if (!a || e.defaultPrevented) return; // e.g. a slider strip that opens instead of navigating
      var href = a.getAttribute('href') || '';
      var dest = a.href;
      if (!href || href.charAt(0) === '#' || href.indexOf('mailto:') === 0 || href.indexOf('tel:') === 0 ||
          a.target === '_blank' || (a.host && a.host !== location.host)) return;
      e.preventDefault();
      document.body.classList.remove('pt-in');
      document.body.classList.add('pt-out');
      setTimeout(function () { location.href = dest; }, 320);
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
      status.textContent = "Thanks, we've received your note and will be in touch soon.";
      form.reset();
      if (typeRow) { typeRow.querySelectorAll('button').forEach(function (x, i) { x.setAttribute('aria-pressed', i === 0 ? 'true' : 'false'); }); }
    });
  }
})();
