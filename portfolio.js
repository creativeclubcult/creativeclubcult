/* Creative Club Cult: projects published from the admin.
   Loaded instead of app.js on the Work page and on work/view.html. It puts the published projects on the
   page first (as text, never as HTML), then starts app.js, so motion, filters and reveals see them like
   the built-in projects. If the database is slow or down, the page carries on with the built-in work. */
(function () {
  'use strict';

  // local preview reads the development database, never the live one
  var DEV = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  var SB_URL = DEV ? 'https://jvhhcehzhgpcphtpynnx.supabase.co' : 'https://zneckeqsvwbavqxpolri.supabase.co';
  var SB_KEY = DEV ? 'sb_publishable_4h3nPS3LkYpy8xOe2vEM_A_y9ffqKEY' : 'sb_publishable_-h0k4-TWYPa03dqcdAg4Eg_53_s0dFU';
  var COLS = 'id,slug,title,client,year,services,industries,summary,brief,approach,outcome,cover_path,cover_alt,cover_w,cover_h,'
    + 'gallery,video_url,credits,seo_title,seo_description,featured,sort_order,published_at,status';
  var SERVICES = { 'creative-direction': 'Creative Direction', branding: 'Branding', 'visual-identity': 'Visual Identity',
    campaign: 'Campaign', photography: 'Photography', film: 'Film', motion: 'Motion', illustration: 'Illustration',
    experience: 'Experience', production: 'Production', experimental: 'Experimental' };
  var WAIT = 2500;

  var appSrc = document.currentScript.src.replace(/portfolio\.js(\?.*)?$/, 'app.js');
  var started = false;
  function start() {
    if (started) return; started = true;
    var s = document.createElement('script');
    s.src = appSrc;
    // app.js refreshes its scroll measurements on window load; if that has passed, do it once it's running
    s.onload = function () { if (document.readyState === 'complete' && window.ScrollTrigger) window.ScrollTrigger.refresh(); };
    document.body.appendChild(s);
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  var publicUrl = function (path) { return SB_URL + '/storage/v1/object/public/portfolio/' + path.split('/').map(encodeURIComponent).join('/'); };
  var tagLine = function (p) { return (p.services || []).slice(0, 3).map(function (k) { return SERVICES[k] || k; }).join(' · '); };
  var href = function (p) { return 'work/view.html?p=' + encodeURIComponent(p.slug); };
  // featured first, then the order set in the admin, newest first
  var byOrder = function (a, b) {
    return (b.featured - a.featured) || (a.sort_order - b.sort_order) || String(b.published_at).localeCompare(String(a.published_at));
  };

  function get(path, token) {
    var headers = { apikey: SB_KEY };
    if (token) headers.Authorization = 'Bearer ' + token;
    var ctl = window.AbortController ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctl) ctl.abort(); }, WAIT);
    return fetch(SB_URL + path, { headers: headers, signal: ctl ? ctl.signal : undefined }).then(function (r) {
      clearTimeout(timer);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }
  var published = function () {
    return get('/rest/v1/portfolio_items?select=' + COLS + '&status=eq.published&order=featured.desc,sort_order.asc,published_at.desc');
  };

  // ---------- Work page: published projects join the grid ----------
  var grid = document.querySelector('.work-grid .cards');
  if (grid) {
    published().then(function (list) {
      list.sort(byOrder);
      var first = grid.firstElementChild;
      list.forEach(function (p) {
        var a = el('a', 'card reveal');
        a.setAttribute('data-tags', (p.services || []).concat(p.industries || []).join(' '));
        a.href = href(p);
        var media = el('div', 'media'), img = el('img');
        img.src = publicUrl(p.cover_path); img.alt = p.cover_alt || ''; img.loading = 'lazy';
        if (p.cover_w) { img.width = p.cover_w; img.height = p.cover_h; }
        media.appendChild(img);
        var meta = el('div', 'meta');
        meta.appendChild(el('h3', null, p.title));
        meta.appendChild(el('span', 'y', p.year));
        a.appendChild(media); a.appendChild(meta); a.appendChild(el('p', 'eyebrow', tagLine(p)));
        // featured projects lead the archive; the rest follow the built-in ones
        if (p.featured && first) grid.insertBefore(a, first); else grid.appendChild(a);
      });
      if (grid.children.length > 4) grid.classList.remove('two');
    }).catch(function () { /* the built-in projects stay; nothing to show the visitor */ }).then(start);
    return;
  }

  // ---------- Project page (work/view.html?p=<slug>) ----------
  var story = document.querySelector('[data-pf-story]');
  if (!story) { start(); return; }
  var q = new URLSearchParams(location.search);
  var slug = (q.get('p') || '').toLowerCase();
  var preview = q.get('preview') === '1';

  // A preview shows a draft to a signed-in team member: their admin session (same site) is sent along, and
  // the database decides whether they may see it. Draft images come from the private bucket, signed briefly.
  var token = null;
  if (preview) {
    try {
      var saved = JSON.parse(localStorage.getItem('sb-' + SB_URL.slice(8).split('.')[0] + '-auth-token') || 'null');
      token = saved && saved.access_token;
    } catch (e) { token = null; }
  }

  function setMeta(name, value, prop) {
    var m = document.querySelector('meta[' + (prop ? 'property' : 'name') + '="' + name + '"]');
    if (m) m.setAttribute('content', value);
  }
  function notFound(text) {
    document.title = 'Project not found · Creative Club Cult';
    var r = document.createElement('meta'); r.name = 'robots'; r.content = 'noindex'; document.head.appendChild(r);
    var main = document.querySelector('main');
    main.textContent = '';
    var sec = el('section', 'page-hero'), wrap = el('div', 'wrap');
    wrap.appendChild(el('p', 'eyebrow', 'Work'));
    wrap.appendChild(el('h1', 'display', 'Not here.'));
    var lead = el('p', 'lead', text + ' ');
    var back = el('a', null, 'See all work'); back.href = 'work.html';
    lead.appendChild(back); wrap.appendChild(lead); sec.appendChild(wrap); main.appendChild(sec);
    var nav = document.querySelector('.pnav'); if (nav) nav.remove();
  }

  function paragraphs(text) {
    return String(text || '').split(/\n\s*\n/).map(function (t) { return t.trim(); }).filter(Boolean);
  }
  function videoEmbed(u) {
    var m = /(?:youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]{6,20})/.exec(u || '');
    if (m) return 'https://www.youtube-nocookie.com/embed/' + m[1];
    // vimeo.com/<id>, vimeo.com/<id>/<hash> (unlisted) or player.vimeo.com/video/<id>?h=<hash>;
    // an unlisted video only plays when the hash travels with it
    m = /vimeo\.com\/(?:video\/)?([0-9]{4,12})(?:\/([0-9a-f]{6,20}))?/.exec(u || '');
    if (!m) return null;
    var hash = m[2] || (/[?&]h=([0-9a-f]{6,20})/.exec(u) || [])[1];
    return 'https://player.vimeo.com/video/' + m[1] + '?' + (hash ? 'h=' + hash + '&' : '') + 'dnt=1';
  }

  function render(p, src) {
    var title = p.seo_title || p.title;
    document.title = title + ' · Creative Club Cult';
    var desc = p.seo_description || p.summary || '';
    setMeta('description', desc); setMeta('og:description', desc, true); setMeta('og:title', title, true);
    setMeta('og:url', 'https://creativeclubcult.com/work/view?p=' + encodeURIComponent(p.slug), true);
    if (!preview) {
      var c = document.createElement('link'); c.rel = 'canonical';
      c.href = 'https://creativeclubcult.com/work/view?p=' + encodeURIComponent(p.slug); document.head.appendChild(c);
    }

    var hero = story.querySelector('[data-pf-hero]');
    hero.src = src(p.cover_path);
    if (p.cover_w) { hero.width = p.cover_w; hero.height = p.cover_h; }
    story.querySelector('[data-pf-title]').textContent = p.title;
    story.querySelector('[data-pf-tags]').textContent = tagLine(p);
    story.querySelector('[data-pf-year]').textContent = p.year || '';

    var descEl = story.querySelector('[data-pf-desc]'), facts = story.querySelector('[data-pf-facts]');
    var paras = [].concat(paragraphs(p.brief), paragraphs(p.approach), paragraphs(p.outcome));
    if (!paras.length) paras = paragraphs(p.summary);
    paras.forEach(function (t) { descEl.insertBefore(el('p', null, t), facts); });
    var fact = function (label, value, cls) {
      if (!value) return;
      var d = el('div', cls || null); d.appendChild(el('dt', null, label));
      var dd = el('dd'); if (typeof value === 'string') dd.textContent = value; else dd.appendChild(value);
      d.appendChild(dd); facts.appendChild(d);
    };
    fact('Client', p.client);
    fact('Year', p.year ? String(p.year) : '');
    var scope = document.createDocumentFragment();
    (p.services || []).forEach(function (k, i) { if (i) scope.appendChild(el('br')); scope.appendChild(document.createTextNode(SERVICES[k] || k)); });
    if ((p.services || []).length) fact('Scope', scope);
    if ((p.credits || []).length) {
      var cr = document.createDocumentFragment();
      p.credits.forEach(function (c) { cr.appendChild(el('span', null, c.role)); cr.appendChild(el('span', null, c.name)); });
      fact('Credits', cr, 'credits-row');
    }

    var gallery = document.querySelector('[data-pf-gallery]');
    var embed = videoEmbed(p.video_url);
    if (embed) {
      var vrow = el('div', 'pfull pvideo reveal'), frame = document.createElement('iframe');
      frame.src = embed; frame.title = p.title + ' film'; frame.loading = 'lazy';
      frame.allow = 'autoplay; fullscreen; picture-in-picture; encrypted-media';
      vrow.appendChild(frame); gallery.appendChild(vrow);
    }
    // images in the order set in the admin; neighbours of the same size share a row (one, two or three across)
    var per = { full: 1, half: 2, third: 3 }, row = null, rowSize = null;
    (p.gallery || []).forEach(function (g) {
      if (!row || rowSize !== g.size || row.children.length >= per[g.size]) {
        row = el('div', { full: 'pfull', half: 'duo', third: 'trio' }[g.size] + ' reveal'); rowSize = g.size; gallery.appendChild(row);
      }
      var img = el('img'); img.src = src(g.path); img.alt = g.alt || ''; img.loading = 'lazy';
      if (g.w) { img.width = +g.w; img.height = +g.h; }
      row.appendChild(img);
    });
    if (!gallery.children.length) gallery.remove();

    if (preview) {
      var bar = el('p', 'pf-preview', p.status === 'published' ? 'Preview · this project is live' : 'Preview · ' + p.status + ', not public');
      bar.setAttribute('role', 'status');
      document.body.appendChild(bar);
    }
  }

  // prev / next run through every project on the Work page, in its order
  function neighbours(list, p) {
    var nav = document.querySelector('.pnav');
    if (!nav) return;
    var statics = [];
    try { statics = JSON.parse(nav.getAttribute('data-pf-static') || '[]'); } catch (e) { statics = []; }
    var mine = list.slice().sort(byOrder).map(function (x) { return { title: x.title, href: href(x), thumb: x.cover_path ? publicUrl(x.cover_path) : '', featured: x.featured, slug: x.slug }; });
    var all = mine.filter(function (x) { return x.featured; })
      .concat(statics.map(function (s) { return { title: s[0], href: s[1], thumb: s[2] }; }))
      .concat(mine.filter(function (x) { return !x.featured; }));
    var at = -1;
    all.forEach(function (x, i) { if (x.slug === p.slug) at = i; });
    if (at < 0) return;
    var set = function (a, x) { a.href = x.href; a.setAttribute('data-preview', x.thumb); a.querySelector('u').textContent = x.title; };
    set(nav.querySelector('.pnav-prev'), all[(at - 1 + all.length) % all.length]);
    set(nav.querySelector('.pnav-next'), all[(at + 1) % all.length]);
  }

  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) { notFound('This project could not be found.'); start(); return; }

  var one = get('/rest/v1/portfolio_items?select=' + COLS + '&slug=eq.' + encodeURIComponent(slug) + (preview && token ? '' : '&status=eq.published'), preview ? token : null);
  Promise.all([one, published().catch(function () { return []; })]).then(function (res) {
    var p = res[0][0];
    if (!p) { notFound(preview && !token ? 'Sign in to the admin on this browser to preview drafts.' : 'This project could not be found.'); return; }
    if (p.status === 'published' && !preview) { render(p, publicUrl); neighbours(res[1], p); return; }
    // a preview: images are signed from the private drafts bucket for ten minutes
    var paths = [p.cover_path].concat((p.gallery || []).map(function (g) { return g.path; })).filter(Boolean);
    return fetch(SB_URL + '/storage/v1/object/sign/portfolio-drafts', {
      method: 'POST', headers: { apikey: SB_KEY, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ expiresIn: 600, paths: paths })
    }).then(function (r) { return r.ok ? r.json() : []; }).then(function (signed) {
      var map = {};
      (signed || []).forEach(function (s) { if (s.signedURL) map[s.path] = SB_URL + '/storage/v1' + s.signedURL; });
      render(p, function (path) { return map[path] || publicUrl(path); });
      neighbours(res[1], p);
    });
  }).catch(function () {
    notFound('This project could not be loaded right now. Please try again in a moment.');
  }).then(start);
})();
