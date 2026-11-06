/* Search: one box for the whole admin. It opens from the sidebar, the top bar, the Overview, the / key or Cmd K (Ctrl K)
   and finds pages, quick actions, projects, clients, leads and documents. It reads what the pages read, so the database
   draws the same lines: leads only for owners and admins, finance documents only with money access. */
(function () {
  'use strict';
  if (!window.cccAdmin) return; // admin.js stopped early: the sign in library didn't load
  var A = window.cccAdmin, E = window.eco, h = A.h, sb = A.sb;
  var MONEY_KINDS = ['penawaran', 'invoice', 'kwitansi'];
  var KIND = { penawaran: 'Penawaran', invoice: 'Invoice', kwitansi: 'Kwitansi', contract: 'Contract', brief: 'Brief', other: 'File' };
  var LEAD = { 'new': 'New lead', replied: 'Replied', 'in progress': 'Talking', quoted: 'Quote sent', won: 'Won', lost: 'Lost' };
  // other words people use for a page (English and Indonesian)
  var ALSO = {
    leads: 'inquiry inbox prospect calon klien', clients: 'customer klien brand', projects: 'rab job shoot proyek',
    calendar: 'schedule jadwal shoot deadline', crew: 'vendor freelancer network kru', documents: 'pdf drive file penawaran kwitansi',
    finance: 'kas money owed payment tagihan piutang', reports: 'revenue omset profit year laporan', portfolio: 'website work page publish',
    careers: 'jobs applicants lowongan internship', settings: 'team people sheet bank backup akun'
  };
  var MAX = 5;
  var ui = null, from = null, got = null, leads = null, leadTerm = '', leadTurn = 0, opts = [], at = -1;

  function build() {
    if (ui) return;
    ui = {
      input: h('input', { type: 'text', role: 'combobox', 'aria-expanded': 'true', 'aria-controls': 'find-list', 'aria-autocomplete': 'list',
        autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', enterkeyhint: 'go', placeholder: 'Search projects, clients, leads',
        'aria-label': 'Search the admin' }),
      list: h('div', { id: 'find-list', class: 'find-list', role: 'listbox', 'aria-label': 'Results' }),
      live: h('p', { class: 'sr', 'aria-live': 'polite' })
    };
    ui.box = h('dialog', { class: 'find', 'aria-label': 'Search' },
      h('div', { class: 'find-bar' }, A.icon('search'), ui.input,
        h('button', { class: 'ib find-x', type: 'button', 'aria-label': 'Close search', onclick: function () { close(); } }, A.icon('x'))),
      ui.list, ui.live);
    document.body.appendChild(ui.box);
    ui.input.addEventListener('input', function () { askLeads(); draw(true); });
    ui.input.addEventListener('keydown', key);
    // Escape closes the box only (not a drawer open behind it); a press on the dim backdrop closes it too
    ui.box.addEventListener('keydown', function (e) { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } });
    ui.box.addEventListener('cancel', function (e) { e.preventDefault(); close(); });
    ui.box.addEventListener('mousedown', function (e) { if (e.target === ui.box) close(); });
  }

  function open(q) {
    if (!A.me()) return;
    var other = document.querySelector('dialog[open]');
    if (other && (!ui || other !== ui.box)) return;          // a question is waiting for an answer first
    build();
    from = document.activeElement;
    var side = A.$('[data-side]');
    // on a phone the sidebar slides away; focus then comes back to the Menu button
    if (side.classList.contains('is-open')) { A.sideOpen(false); from = A.$('[data-action="menu"]'); }
    if (!ui.box.open) ui.box.showModal();
    ui.input.value = typeof q === 'string' ? q : '';
    at = -1;
    load();
    askLeads();
    draw(true);
    ui.input.focus();
  }
  function close(moving) {
    if (!ui || !ui.box.open) return;
    ui.box.close();
    leadTurn++;
    if (!moving && from && document.contains(from) && from.focus) from.focus();
  }

  // ---------- what can be found ----------
  function load() {
    var mine = got = { projects: null, clients: null, docs: null };
    ['projects', 'clients', 'docs'].forEach(function (k) {
      E.settle(E.data[k]()).then(function (r) { mine[k] = r; if (got === mine && ui.box.open) draw(); });
    });
  }
  var leadSoon = E.debounce(function () {
    var t = leadTerm, mine = ++leadTurn;
    if (!t) return;
    E.settle(E.rows(sb.from('lead_inbox').select('id, name, company, email, status, created_at').neq('status', 'spam')
      .or(['name', 'company', 'email', 'phone'].map(function (c) { return c + '.ilike."*' + t + '*"'; }).join(','))
      .order('created_at', { ascending: false }).limit(MAX))).then(function (r) {
      if (mine !== leadTurn || !ui.box.open) return;      // a newer search is on its way
      leads = r; draw();
    });
  }, 200);
  function askLeads() {
    var t = E.search(ui.input.value);
    leadTurn++;
    if (!A.canEdit() || t.length < 2) { leads = null; leadTerm = ''; return; }
    leads = { wait: true }; leadTerm = t; leadSoon();
  }

  function pages() {
    return Array.prototype.slice.call(document.querySelectorAll('.adm-side a[data-tab]')).filter(function (a) { return !a.closest('[hidden]'); }).map(function (a) {
      var use = a.querySelector('use'), label = '';
      Array.prototype.forEach.call(a.childNodes, function (c) { if (c.nodeType === 3) label += c.textContent; });
      var tab = a.getAttribute('data-tab');
      return { key: 'g' + tab, icon: use ? use.getAttribute('href').replace('#i-', '') : 'overview', title: label.trim(), sub: 'Page',
        href: a.getAttribute('href'), words: [label, tab, ALSO[tab] || ''] };
    });
  }
  function actions() {
    if (!A.canEdit()) return [];
    return [
      E.addLead && { key: 'a-lead', icon: 'chat', tone: 'lime', title: 'Add lead', sub: 'A lead from WhatsApp, Instagram or a call', run: function () { E.addLead(); },
        words: ['add lead', 'new lead tambah lead whatsapp instagram'] },
      E.newProject && { key: 'a-project', icon: 'plus', tone: 'lime', title: 'New project', sub: 'Starts as a brief, before the RAB', run: function () { E.newProject(); },
        words: ['new project', 'add project brief project baru'] }
    ].filter(Boolean);
  }
  var projectItem = function (p) {
    return { key: 'p' + p.id, icon: 'projects', title: E.clientName(p), sub: [E.projectLine(p), E.phase(p)].filter(Boolean).join(', '), href: '#projects/' + p.id };
  };
  var clientItem = function (c) {
    return { key: 'c' + c.id, icon: 'clients', title: c.name || c.code || 'Client', sub: [c.code, c.pic].filter(Boolean).join(', ') || 'Client', href: '#clients/' + c.id };
  };
  var leadItem = function (l) {
    return { key: 'l' + l.id, icon: 'leads', title: l.name || l.email || 'No name',
      sub: [l.company, LEAD[l.status] || l.status, A.date(l.created_at)].filter(Boolean).join(', '), href: '#leads/' + l.id };
  };

  // how well the words match: 0 a field starts with them, 1 a word inside does, 2 they sit inside a word, -1 no match.
  // Every word typed has to be found somewhere.
  function score(q, fields) {
    var hay = fields.map(E.words).filter(Boolean), worst = 0, parts = q.split(' ');
    for (var k = 0; k < parts.length; k++) {
      var best = -1;
      for (var j = 0; j < hay.length; j++) {
        var i = hay[j].indexOf(parts[k]);
        if (i < 0) continue;
        var r = i === 0 ? 0 : /[^a-z0-9]/.test(hay[j].charAt(i - 1)) ? 1 : 2;
        if (best < 0 || r < best) best = r;
      }
      if (best < 0) return -1;
      if (best > worst) worst = best;
    }
    return worst;
  }
  function pick(list, q, fields, tie) {
    return list.map(function (x) { return { x: x, s: score(q, fields(x)) }; }).filter(function (o) { return o.s > -1; })
      .sort(function (a, b) { return a.s - b.s || (tie ? tie(a.x, b.x) : 0); }).map(function (o) { return o.x; });
  }
  var byId = function (r) { var o = {}; ((r && r.v) || []).forEach(function (x) { o[x.id] = x; }); return o; };

  // ---------- drawing ----------
  function groups(q) {
    var out = [], g = got || {};
    var state = function (r, what) { return !r ? { note: 'Loading ' + what + '…' } : r.e ? { note: 'Couldn’t search ' + what + '. Close this and try again.', err: true } : null; };
    if (!q) {
      out.push({ title: 'Quick actions', items: actions() });
      var ps = state(g.projects, 'projects');
      out.push({ title: 'Active projects', state: ps, items: ps ? [] : E.byUrgency(g.projects.v.filter(E.isActive), {}, E.today()).slice(0, 4).map(projectItem) });
      out.push({ title: 'Pages', items: pages().map(function (x) { x.sub = ''; return x; }) });
      return out;
    }
    out.push({ title: 'Pages and actions', items: pick(actions().concat(pages()), q, function (x) { return [x.title].concat(x.words); }).slice(0, MAX) });
    var pState = state(g.projects, 'projects');
    out.push({ title: 'Projects', state: pState, items: pState ? [] : pick(g.projects.v.filter(function (p) { return p.sheet_state !== 'removed'; }), q, function (p) {
      return [E.clientName(p), p.title, p.tab_name, p.plan_title, p.invoice_no, p.seq != null ? E.pad3(p.seq) : ''];
    }, function (a, b) { return (E.isActive(b) ? 1 : 0) - (E.isActive(a) ? 1 : 0) || (b.seq == null ? 1e6 : b.seq) - (a.seq == null ? 1e6 : a.seq); }).slice(0, MAX).map(projectItem) });
    var cState = state(g.clients, 'clients');
    out.push({ title: 'Clients', state: cState, items: cState ? [] : pick(g.clients.v, q, function (c) { return [c.name, c.code, c.pic, c.email, c.phone]; }).slice(0, MAX).map(clientItem) });
    if (A.canEdit() && leads) {
      var lState = leads.wait ? { note: 'Looking through leads…' } : leads.e ? { note: 'Couldn’t search leads. Close this and try again.', err: true } : null;
      out.push({ title: 'Leads', state: lState, items: lState ? [] : leads.v.map(leadItem) });
    }
    var dState = state(g.docs, 'documents');
    var projects = byId(g.projects), clients = byId(g.clients);
    out.push({ title: 'Documents', state: dState, items: dState ? [] : pick(g.docs.v.filter(function (d) {
      return (A.canMoney() || MONEY_KINDS.indexOf(d.kind) < 0) && (A.safeUrl(d.url) || d.project_id);
    }), q, function (d) {
      var p = projects[d.project_id], c = clients[d.client_id || (p && p.client_id)];
      return [d.doc_no, d.title, KIND[d.kind], p && E.clientName(p), p && E.projectLine(p), c && c.name, c && c.code];
    }).slice(0, MAX).map(function (d) {
      var p = projects[d.project_id], url = A.safeUrl(d.url);
      return { key: 'd' + d.id, icon: 'docs', title: d.doc_no || d.title || KIND[d.kind] || 'Document',
        sub: [KIND[d.kind] || 'File', p ? E.short(p) : null, url ? 'opens in Google Drive' : 'opens the project'].filter(Boolean).join(', '),
        url: url, href: url ? null : '#projects/' + d.project_id };
    }) });
    return out;
  }
  function draw(typed) {
    if (!ui || !ui.box.open) return;
    var q = E.words(E.search(ui.input.value)), keep = !typed && at > -1 && opts[at] ? opts[at].key : null;
    var list = groups(q), n = 0;
    ui.list.innerHTML = '';
    opts = [];
    list.forEach(function (g, gi) {
      if (!g.items.length && !g.state) return;
      var id = 'find-g' + gi, box = h('div', { class: 'find-g', role: 'group', 'aria-labelledby': id }, h('p', { class: 'find-h', id: id, text: g.title }));
      if (g.state) box.appendChild(h('p', { class: 'find-note' + (g.state.err ? ' is-err' : ''), text: g.state.note }));
      g.items.forEach(function (it) {
        var i = opts.length;
        it.el = h('div', { class: 'find-o', role: 'option', id: 'find-o' + i, 'aria-selected': 'false' },
          h('span', { class: 'find-ic' + (it.tone ? ' ' + it.tone : '') }, A.icon(it.icon)),
          h('span', { class: 'find-t' }, h('b', { text: it.title }), h('span', { text: it.sub })),
          it.url ? A.icon('ext', 's find-ext') : null);
        it.el.addEventListener('mousemove', function () { if (at !== i) { at = i; mark(false); } });
        it.el.addEventListener('click', function () { run(it); });
        opts.push(it); box.appendChild(it.el); n++;
      });
      ui.list.appendChild(box);
    });
    if (q && !n && !ui.list.querySelector('.find-note')) {
      ui.list.appendChild(h('p', { class: 'find-empty', text: 'Nothing matches “' + ui.input.value.trim() + '”. Try a client name, a project number or an invoice number.' }));
    }
    at = -1;
    if (keep) opts.forEach(function (o, i) { if (o.key === keep) at = i; });
    if (at < 0 && opts.length) at = 0;
    mark(true);
    ui.live.textContent = !q ? '' : n ? E.plural(n, 'result') : ui.list.querySelector('.find-note') ? '' : 'No results';
  }
  function mark(scroll) {
    opts.forEach(function (o, i) { o.el.setAttribute('aria-selected', i === at ? 'true' : 'false'); o.el.classList.toggle('is-on', i === at); });
    if (at > -1) {
      ui.input.setAttribute('aria-activedescendant', opts[at].el.id);
      if (scroll) opts[at].el.scrollIntoView({ block: 'nearest' });
    } else ui.input.removeAttribute('aria-activedescendant');
  }
  function key(e) {
    if (e.isComposing) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!opts.length) return;
      at = (at + (e.key === 'ArrowDown' ? 1 : -1) + opts.length) % opts.length;
      mark(true);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (at > -1 && opts[at]) run(opts[at]);
    }
  }

  // ---------- going somewhere ----------
  function run(it) {
    if (it.url) { close(); window.open(it.url, '_blank', 'noopener'); return; }
    close(true);
    if (it.run) { it.run(); return; }
    if (location.hash === it.href) { settle(); return; }
    location.hash = it.href;
    settle();
  }
  // focus lands on the new page's title, unless a drawer opened and took it
  function settle() {
    setTimeout(function () {
      if (!A.$('[data-drawer]').hidden) return;
      var head = A.$('[data-head]'), t = head && !head.hidden ? A.$('[data-page-title]') : A.$('.hero-hi');
      if (t) { t.setAttribute('tabindex', '-1'); t.focus({ preventScroll: true }); }
    }, 0);
  }

  // ---------- ways in ----------
  Array.prototype.forEach.call(document.querySelectorAll('[data-action="find"]'), function (b) { b.addEventListener('click', function () { open(); }); });
  var typing = function (el) { return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)); };
  document.addEventListener('keydown', function (e) {
    if (!A.me() || e.isComposing) return;
    if ((e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey) {
      e.preventDefault();
      if (ui && ui.box.open) close(); else open();
    } else if (e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey && !typing(e.target) && !document.querySelector('dialog[open]')) {
      e.preventDefault();
      open();
    }
  });
  E.find = open;
})();
