/* Documents: the index of project files in Google Drive (quotes, invoices, receipts, contracts, briefs), one card per
   file as the mockup has it. Penawaran, invoice and kwitansi are finance kinds: the database shows them only to people
   with money access, and their tabs are left out for everyone else. Files open in Drive. */
(function () {
  'use strict';
  if (!window.cccAdmin) return; // admin.js stopped early: the sign in library didn't load
  var A = window.cccAdmin, E = window.eco, h = A.h, I = A.icon;
  var panel = A.$('[data-panel="documents"]'), ui = null, got = null, turn = 0, kind = '', shown = 0;
  var KINDS = [['penawaran', 'Penawaran'], ['invoice', 'Invoice'], ['kwitansi', 'Kwitansi'], ['contract', 'Contract'], ['brief', 'Brief'], ['other', 'Other']];
  var MONEY_KINDS = ['penawaran', 'invoice', 'kwitansi'];
  // the tile colour per kind, as in the mockup (quotes violet, invoices lime, receipts full lime, the rest grey)
  var TY = { penawaran: 'pen', invoice: 'inv', kwitansi: 'kw' };
  var STEP = 60;
  var empty = function (t, err) { return h('p', { class: 'empty' + (err ? ' is-err' : ''), text: t }); };
  var when = function (d) { return d.file_created_at || d.created_at; };

  function build() {
    if (ui) return;
    var kinds = [['', 'Every type']].concat(KINDS.filter(function (k) { return A.canMoney() || MONEY_KINDS.indexOf(k[0]) < 0; }));
    ui = { tabs: h('div', { class: 'tabs', role: 'group', 'aria-label': 'Type' }), tab: {},
      q: h('input', { type: 'search', placeholder: 'Search number, client, project', 'aria-label': 'Search documents', autocomplete: 'off' }),
      project: A.select([['', 'Every project']], '', { class: 'field', 'aria-label': 'Project' }),
      note: h('p', { class: 'lnote', hidden: true, text: 'The projects couldn’t be loaded, so each document’s project is left out. Reload to try again.' }),
      state: h('div', { class: 'lstate', hidden: true }),
      grid: h('section', { class: 'dgrid', 'aria-label': 'Document list' }),
      more: h('button', { class: 'btn adm-more', type: 'button', hidden: true, onclick: more }) };
    kinds.forEach(function (k) {
      ui.tab[k[0]] = h('button', { type: 'button', 'aria-pressed': String(k[0] === kind), onclick: function () {
        if (kind === k[0]) return;
        kind = k[0]; press(); draw();
      } }, k[1], h('span', { class: 'c' }));
      ui.tabs.appendChild(ui.tab[k[0]]);
    });
    ui.q.addEventListener('input', E.debounce(draw, 150));
    ui.project.addEventListener('change', draw);
    panel.innerHTML = '';
    A.add(panel, [h('div', { class: 'bar dbar' }, ui.tabs, h('label', { class: 'field' }, I('search', 's'), ui.q), ui.project),
      ui.note, ui.state, ui.grid, ui.more,
      h('p', { class: 'src pnote', id: 'eco-docs-off' }, I('ext'), h('span', {}, 'Files open in Google Drive with the owner’s account.',
        A.canEdit() ? h('span', { class: 'wide-only' }, ' Find older PDFs isn’t set up yet.') : null))]);
  }
  function press() {
    Object.keys(ui.tab).forEach(function (k) { ui.tab[k].setAttribute('aria-pressed', String(k === kind)); });
  }
  function state(text, err, retry) {
    ui.state.innerHTML = ''; ui.state.hidden = !text;
    if (text) A.add(ui.state, [empty(text, err), retry ? h('button', { class: 'btn sm', type: 'button', onclick: retry }, 'Try again') : null]);
  }

  // one document: its kind and client, the day it was made, its number (or title), its project and a link to Drive
  function card(d) {
    var p = got.projects && got.projects[d.project_id], c = got.clients[d.client_id || (p && p.client_id)];
    var u = A.safeUrl(d.url), label = E.DOC_KIND[d.kind] || 'Document', name = d.doc_no || d.title;
    var who = c ? c.name || c.code : p ? E.clientName(p) : null;
    return h('article', { class: 'dcard' },
      h('div', { class: 'dk' }, h('span', { class: 'ty' + (TY[d.kind] ? ' ' + TY[d.kind] : ''), 'aria-hidden': 'true' }, I('docs')),
        h('div', {}, h('b', { text: label }), who ? h('span', { text: who }) : null),
        h('time', { datetime: E.jkt(when(d)), text: E.day(E.jkt(when(d))) })),
      h('div', { class: 'dno' }, h('b', { text: name }), d.doc_no && d.title ? h('span', { text: d.title }) : null),
      h('div', { class: 'dfoot' },
        p ? h('a', { class: 'pjl', href: '#projects/' + p.id, text: E.projectLine(p) })
          : h('span', { class: 'pjl', text: got.projects ? 'No project' : '' }),
        u ? h('a', { class: 'btn sm', href: u, target: '_blank', rel: 'noopener noreferrer', 'aria-label': 'Open ' + name + ' in Google Drive' }, I('ext', 's'), 'Open in Drive') : null));
  }
  // the search and the project apply first; the tabs count what is left in each kind
  function matches() {
    var t = E.words(E.search(ui.q.value)), pid = ui.project.value;
    return got.docs.filter(function (d) {
      if (pid && d.project_id !== pid) return false;
      if (!t) return true;
      var p = got.projects && got.projects[d.project_id], c = got.clients[d.client_id || (p && p.client_id)];
      return [d.doc_no, d.title, p && E.pname(p), p && E.projectLine(p), c && c.name, c && c.code].some(function (v) { return E.words(v).indexOf(t) > -1; });
    });
  }
  function draw(keep) {
    if (!got) return;
    var hits = matches(), n = {};
    hits.forEach(function (d) { n[d.kind] = (n[d.kind] || 0) + 1; });
    Object.keys(ui.tab).forEach(function (k) { A.$('.c', ui.tab[k]).textContent = String(k ? n[k] || 0 : hits.length); });
    var list = kind ? hits.filter(function (d) { return d.kind === kind; }) : hits;
    if (keep !== true) shown = STEP;
    ui.grid.innerHTML = '';
    A.add(ui.grid, list.slice(0, shown).map(card));
    ui.grid.hidden = !list.length;
    ui.more.hidden = list.length <= shown;
    ui.more.textContent = 'Show ' + Math.min(STEP, list.length - shown) + ' more';
    var filtered = ui.q.value.trim() || ui.project.value;
    state(list.length ? null
      : filtered ? 'No documents match these filters.'
      : kind ? 'No ' + E.DOC_KIND[kind] + ' yet.'
      : got.docs.length ? null
      : A.canMoney() ? 'No documents yet. PDFs you make from a project appear here.' : 'No contracts or briefs yet.');
  }
  // the next cards, with focus on the first of them
  function more() {
    var from = shown;
    shown += STEP; draw(true);
    var first = A.$$('.dcard', ui.grid)[from];
    var link = first && A.$('a', first);
    if (link) link.focus();
  }
  A.loaders.documents = function () {
    build();
    var mine = ++turn;
    // a first visit waits; a return keeps the last cards on screen until the new ones are here
    if (!got) { ui.grid.hidden = true; ui.more.hidden = true; state('Loading documents…'); }
    Promise.all([E.data.docs(), E.data.projects(), E.data.clients()].map(E.settle)).then(function (r) {
      if (mine !== turn) return;
      if (r[0].e) {
        got = null; ui.grid.hidden = true; ui.more.hidden = true; ui.note.hidden = true;
        Object.keys(ui.tab).forEach(function (k) { A.$('.c', ui.tab[k]).textContent = ''; });
        return state(E.ecoError(r[0].e), true, function () { E.forget(); A.loaders.documents(); });
      }
      var byId = function (list) { var o = {}; (list || []).forEach(function (x) { o[x.id] = x; }); return o; };
      var docs = r[0].v.slice().sort(function (a, b) { return when(a) < when(b) ? 1 : when(a) > when(b) ? -1 : 0; });
      got = { docs: docs, projects: r[1].e ? null : byId(r[1].v), clients: byId(r[2].v) };
      ui.note.hidden = !r[1].e;
      // the project filter lists the projects that have documents, newest number first
      var keep = ui.project.value, used = {};
      docs.forEach(function (d) { if (d.project_id) used[d.project_id] = true; });
      ui.project.length = 1;
      (r[1].v || []).filter(function (p) { return used[p.id]; }).sort(function (a, b) { return (b.seq || 0) - (a.seq || 0); }).forEach(function (p) {
        ui.project.appendChild(h('option', { value: p.id, selected: p.id === keep }, E.short(p)));
      });
      // with one project or none there is nothing to choose between
      ui.project.hidden = ui.project.length < 3;
      if (ui.project.hidden) ui.project.value = '';
      draw();
    });
  };
  A.actions.documents = function () {
    // Find older PDFs would look through Google Drive with the Sheet's Apps Script web app, which isn't set up yet
    // (on a phone the switched off button would take a whole row, so it shows from laptop widths)
    return A.canEdit() ? h('button', { class: 'btn wide-only', type: 'button', disabled: true, 'aria-describedby': 'eco-docs-off' }, I('search', 's'), 'Find older PDFs') : null;
  };
})();
