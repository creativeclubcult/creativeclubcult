/* Creative Club Cult: projects published from the admin.
   Loaded instead of app.js on the Work page and on work/view.html. It puts the published projects on the
   page first (as text, never as HTML), then starts app.js, so motion, filters and reveals see them like
   the built-in projects. If the database is slow or down, the page carries on with the built-in work. */
(function () {
  'use strict';
  window.cccPortfolio = true; // (the page starts app.js itself if this file never arrives)

  // local preview reads the development database, never the live one
  var DEV = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  var SB_URL = DEV ? 'https://jvhhcehzhgpcphtpynnx.supabase.co' : 'https://zneckeqsvwbavqxpolri.supabase.co';
  var SB_KEY = DEV ? 'sb_publishable_4h3nPS3LkYpy8xOe2vEM_A_y9ffqKEY' : 'sb_publishable_-h0k4-TWYPa03dqcdAg4Eg_53_s0dFU';
  var COLS = 'id,slug,title,client,year,services,industries,services_custom,industries_custom,summary,brief,approach,outcome,cover_path,cover_alt,cover_w,cover_h,'
    + 'gallery,video_url,video_path,video_poster_path,video_w,video_h,credits,seo_title,seo_description,featured,sort_order,published_at,status';
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
  // a file in a public bucket: photos and posters live in portfolio, films in portfolio-video
  var bucketUrl = function (bucket) {
    return function (path) { return SB_URL + '/storage/v1/object/public/' + bucket + '/' + path.split('/').map(encodeURIComponent).join('/'); };
  };
  var publicUrl = bucketUrl('portfolio'), videoUrl = bucketUrl('portfolio-video');
  // Services and industries of the owner's own (20261112_portfolio_categories) come as typed, after the fixed ones.
  // On the Work page each filters by a key kept apart from the fixed keys and from the other kind: Music Video typed as
  // a service is service:music-video (its key as the database's private.category_key makes it)
  var catKey = function (t) {
    var s = String(t || '').toLowerCase(), slug = function (x) { return x.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); };
    return slug(s.replace(/\band\b/g, '-')) || slug(s);
  };
  var own = function (p, kind) { return (p[kind + '_custom'] || []).filter(function (t) { return typeof t === 'string' && catKey(t); }); };
  var services = function (p) { return (p.services || []).map(function (k) { return SERVICES[k] || k; }).concat(own(p, 'services')); };
  var tagLine = function (p) { return services(p).slice(0, 3).join(' · '); };
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
    // the time limit covers the whole answer, not just its first bytes: a reply that stalls halfway on a
    // weak mobile signal must not keep the page waiting
    return fetch(SB_URL + path, { headers: headers, signal: ctl ? ctl.signal : undefined }).then(function (r) {
      if (r.ok) return r.json();
      // a failure keeps the database's error code, when it sent one (items() looks for 42703 and 42501)
      return r.json().catch(function () { return null; }).then(function (b) {
        var e = new Error('HTTP ' + r.status); e.code = b && b.code; throw e;
      });
    }).then(function (d) { clearTimeout(timer); return d; }, function (e) { clearTimeout(timer); throw e; });
  }
  // Projects, with every column above. A database from before a migration (or after its rollback) can't give some of
  // them, and the whole query fails: 42703 when a column isn't there, 42501 when it is there but the public may not read
  // it (the rollback of 20261112_portfolio_categories keeps its two columns). The query is then asked again without the
  // services and industries of your own, and then also without the uploaded film's columns, so a site release that runs
  // ahead of the database still shows every project with what that database holds. Any other failure, and a failed
  // last try, still fails as before.
  var without = function (cols, re) { return cols.split(',').filter(function (c) { return !re.test(c); }).join(','); };
  var TRIES = [COLS, without(COLS, /_custom$/), without(without(COLS, /_custom$/), /^video_(path|poster_path|w|h)$/)];
  function items(query, token) {
    var go = function (i) {
      return get('/rest/v1/portfolio_items?select=' + TRIES[i] + query, token).catch(function (e) {
        if (!e || (e.code !== '42703' && e.code !== '42501') || i + 1 >= TRIES.length) throw e;
        return go(i + 1);
      });
    };
    return go(0);
  }
  var published = function () {
    return items('&status=eq.published&order=featured.desc,sort_order.asc,published_at.desc');
  };

  // ---------- Work page: published projects join the grid ----------
  var grid = document.querySelector('.work-grid .cards');
  if (grid) {
    published().then(function (list) {
      list.sort(byOrder);
      var first = grid.firstElementChild;
      list.forEach(function (p) {
        var a = el('a', 'card reveal');
        a.setAttribute('data-tags', (p.services || []).concat(p.industries || [],
          own(p, 'services').map(function (t) { return 'service:' + catKey(t); }),
          own(p, 'industries').map(function (t) { return 'industry:' + catKey(t); })).join(' '));
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
      // a service or industry of your own joins its list after the fixed entries, in alphabetical order, while a
      // published project has it; hovering it shows the cover of the first such project, as the fixed entries do.
      // Made before app.js starts, so its filters and hover work on them like on the others
      [['services', 'service', '.wf-service .wf-list'], ['industries', 'industry', '.wf-industry .wf-list']].forEach(function (g) {
        var ul = document.querySelector(g[2]), seen = {}, found = [];
        if (!ul) return;
        list.forEach(function (p) {
          own(p, g[0]).forEach(function (t) {
            var key = g[1] + ':' + catKey(t);
            if (seen[key]) return;
            seen[key] = true;
            found.push({ key: key, label: t, thumb: p.cover_path ? publicUrl(p.cover_path) : '' });
          });
        });
        found.sort(function (x, y) { return x.label.localeCompare(y.label, 'en', { sensitivity: 'base' }); }).forEach(function (f) {
          var b = el('button', null, f.label);
          b.type = 'button'; b.setAttribute('data-filter', f.key); b.setAttribute('aria-pressed', 'false');
          if (f.thumb) b.setAttribute('data-thumb', f.thumb);
          var li = el('li'); li.appendChild(b); ul.appendChild(li);
        });
      });
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
  // a film uploaded to the site plays in the browser's own player. It never starts by itself and loads
  // nothing until the visitor presses play (only the poster shows), which spares the free storage traffic
  function film(p, src, vsrc) {
    var box = el('div', 'pfull pvideo pf-film reveal'), v = document.createElement('video');
    var w = +p.video_w, h = +p.video_h;
    if (w > 0 && h > 0) {
      box.style.setProperty('--ar', w + ' / ' + h); // the film's own shape (16:9 when it isn't known)
      if (h >= w) box.classList.add('is-tall'); // upright or square: kept within the screen height
    }
    v.controls = true; v.preload = 'none'; v.setAttribute('playsinline', '');
    if (p.video_poster_path) v.poster = src(p.video_poster_path);
    v.setAttribute('aria-label', p.title + ' film');
    v.src = vsrc(p.video_path);
    box.appendChild(v);
    return box;
  }

  function render(p, src, vsrc) {
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
    services(p).forEach(function (t, i) { if (i) scope.appendChild(el('br')); scope.appendChild(document.createTextNode(t)); });
    if (services(p).length) fact('Scope', scope);
    if ((p.credits || []).length) {
      var cr = document.createDocumentFragment();
      p.credits.forEach(function (c) { cr.appendChild(el('span', null, c.role)); cr.appendChild(el('span', null, c.name)); });
      fact('Credits', cr, 'credits-row');
    }

    var gallery = document.querySelector('[data-pf-gallery]');
    gallery.setAttribute('data-pf-rows', ''); // styles.css sizes these rows only, never the built-in pages' rows
    if (p.video_path) {
      gallery.appendChild(film(p, src, vsrc));
    } else {
      var embed = videoEmbed(p.video_url);
      if (embed) {
        var vrow = el('div', 'pfull pvideo reveal'), frame = document.createElement('iframe');
        frame.src = embed; frame.title = p.title + ' film'; frame.loading = 'lazy';
        frame.allow = 'autoplay; fullscreen; picture-in-picture; encrypted-media';
        vrow.appendChild(frame); gallery.appendChild(vrow);
      }
    }
    // images in the order set in the admin; neighbours of the same size share a row (up to one, two or three
    // across) and an unknown size counts as full. A photo left alone in its row runs the full width. In a
    // shared row each column is as wide as its photo's shape (width over height), so the photos end at one
    // height and nothing is cropped; a row with a photo of unknown shape keeps equal columns. On phones every
    // photo stacks, as before (styles.css)
    var rows = [], run = null;
    (p.gallery || []).forEach(function (g) {
      var across = g.size === 'half' ? 2 : g.size === 'third' ? 3 : 1;
      if (!run || run.across !== across || run.photos.length >= across) { run = { across: across, photos: [] }; rows.push(run); }
      run.photos.push(g);
    });
    rows.forEach(function (r) {
      var row = el('div', ['pfull', 'duo', 'trio'][r.photos.length - 1] + ' reveal');
      var shapes = r.photos.map(function (g) { return +g.w > 0 && +g.h > 0 ? g.w / g.h : 0; });
      if (shapes.length > 1 && shapes.every(Boolean)) {
        // scaled so the narrowest is 1fr: the shares then add up to more than 1fr and always fill the row
        var least = Math.min.apply(Math, shapes);
        row.style.setProperty('--cols', shapes.map(function (s) { return 'minmax(0, ' + (s / least).toFixed(4) + 'fr)'; }).join(' '));
      }
      r.photos.forEach(function (g) {
        var img = el('img'); img.src = src(g.path); img.alt = g.alt || ''; img.loading = 'lazy';
        if (g.w) { img.width = +g.w; img.height = +g.h; }
        row.appendChild(img);
      });
      gallery.appendChild(row);
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

  var one = items('&slug=eq.' + encodeURIComponent(slug) + (preview && token ? '' : '&status=eq.published'), preview ? token : null);
  Promise.all([one, published().catch(function () { return []; })]).then(function (res) {
    var p = res[0][0];
    if (!p) { notFound(preview && !token ? 'Sign in to the admin on this browser to preview drafts.' : 'This project could not be found.'); return; }
    if (p.status === 'published' && !preview) { render(p, publicUrl, videoUrl); neighbours(res[1], p); return; }
    // a preview: images and the film's poster are signed from the private drafts bucket for ten minutes, the
    // film from its own private drafts bucket for an hour, as nothing of it loads until play is pressed
    var sign = function (bucket, paths, secs) {
      return fetch(SB_URL + '/storage/v1/object/sign/' + bucket, {
        method: 'POST', headers: { apikey: SB_KEY, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ expiresIn: secs, paths: paths })
      }).then(function (r) { return r.ok ? r.json() : []; }).then(function (signed) {
        var map = {};
        (signed || []).forEach(function (s) { if (s.signedURL) map[s.path] = SB_URL + '/storage/v1' + s.signedURL; });
        return map;
      });
    };
    var paths = [p.cover_path, p.video_poster_path].concat((p.gallery || []).map(function (g) { return g.path; })).filter(Boolean);
    return Promise.all([sign('portfolio-drafts', paths, 600), p.video_path ? sign('portfolio-video-drafts', [p.video_path], 3600) : {}]).then(function (maps) {
      render(p, function (path) { return maps[0][path] || publicUrl(path); }, function (path) { return maps[1][path] || videoUrl(path); });
      neighbours(res[1], p);
    });
  }).catch(function () {
    notFound('This project could not be loaded right now. Please try again in a moment.');
  }).then(start);
})();
