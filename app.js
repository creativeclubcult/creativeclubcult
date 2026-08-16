/* Creative Club Cult — shared interactions (prototype) */
(function () {
  'use strict';

  // ---- Mobile menu ----
  var btn = document.querySelector('.menu-btn');
  var menu = document.getElementById('menu');
  if (btn && menu) {
    btn.addEventListener('click', function () {
      var open = menu.classList.toggle('open');
      btn.textContent = open ? 'Close' : 'Menu';
      btn.setAttribute('aria-expanded', open);
    });
    menu.addEventListener('click', function (e) {
      if (e.target.tagName === 'A') {
        menu.classList.remove('open');
        btn.textContent = 'Menu';
        btn.setAttribute('aria-expanded', 'false');
      }
    });
  }

  // ---- Scroll reveal ----
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var els = document.querySelectorAll('.reveal');
  if (reduce || !('IntersectionObserver' in window)) {
    els.forEach(function (e) { e.classList.add('in'); });
  } else {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
    els.forEach(function (e) { io.observe(e); });
  }

  // ---- Work archive filters ----
  var filterBar = document.querySelector('.filters');
  if (filterBar) {
    var items = document.querySelectorAll('[data-cat]');
    filterBar.addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      filterBar.querySelectorAll('button').forEach(function (x) { x.classList.remove('active'); });
      b.classList.add('active');
      var cat = b.getAttribute('data-filter');
      items.forEach(function (it) {
        var show = cat === 'all' || (it.getAttribute('data-cat') || '').split(' ').indexOf(cat) > -1;
        it.style.display = show ? '' : 'none';
      });
    });
  }

  // ---- Contact form ----
  var form = document.querySelector('form.inquiry');
  if (form) {
    var typeRow = form.querySelector('.type-row');
    if (typeRow) {
      typeRow.addEventListener('click', function (e) {
        var b = e.target.closest('button');
        if (!b) return;
        e.preventDefault();
        typeRow.querySelectorAll('button').forEach(function (x) { x.classList.remove('active'); });
        b.classList.add('active');
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
      var active = typeRow && typeRow.querySelector('button.active');
      if (typeRow) { typeRow.querySelectorAll('button').forEach(function (x, i) { x.classList.toggle('active', i === 0); }); }
    });
  }
})();
