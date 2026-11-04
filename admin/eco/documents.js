/* Documents: the index of project files in Google Drive (quotes, invoices, receipts, contracts, briefs). Penawaran,
   invoice and kwitansi are finance kinds, so only people with money access see them. Files open in Drive. */
(function () {
  'use strict';
  var A = window.cccAdmin, E = window.eco, h = A.h;
  var panel = A.$('[data-panel="documents"]'), ui = null, got = null;
  var KINDS = [['penawaran', 'Penawaran'], ['invoice', 'Invoice'], ['kwitansi', 'Kwitansi'], ['contract', 'Contract'], ['brief', 'Brief'], ['other', 'Other']];
  var MONEY_KINDS = ['penawaran', 'invoice', 'kwitansi'];
  var label = function (k) { return (KINDS.filter(function (x) { return x[0] === k; })[0] || [k, k])[1]; };
  var COLS = ['Type', 'Number', 'Project', 'Client', 'Made', ''];

  function build() {
    if (ui) return;
    var kinds = KINDS.filter(function (k) { return A.canMoney() || MONEY_KINDS.indexOf(k[0]) < 0; });
    ui = { kind: A.select([['', 'Every type']].concat(kinds), '', { 'aria-label': 'Type' }),
      project: A.select([['', 'Every project']], '', { 'aria-label': 'Project' }),
      q: h('input', { type: 'search', placeholder: 'Search number, client, project', 'aria-label': 'Search documents' }),
      count: h('span', { class: 'adm-count' }), tbody: h('tbody') };
    ui.kind.addEventListener('change', draw);
    ui.project.addEventListener('change', draw);
    ui.q.addEventListener('input', E.debounce(draw, 150));
    A.add(panel, [
      h('div', { class: 'adm-bar' }, ui.q, ui.kind, ui.project, ui.count,
        h('button', { class: 'btn ghost', type: 'button', disabled: true, 'aria-describedby': 'eco-docs-blocked' }, 'Find older PDFs')),
      h('p', { class: 'eco-note eco-bar-note', text: 'Files open in Google Drive with the owner\u2019s account.' }),
      h('div', { class: 'adm-table-wrap' }, h('table', { class: 'adm-table is-stack' }, E.thead(COLS), ui.tbody)),
      h('p', { class: 'eco-note', id: 'eco-docs-blocked', text: 'Find older PDFs looks through Google Drive with the Sheet\u2019s Apps Script web app. That connection isn\u2019t set up yet, so the button is off.' })
    ]);
  }
  function draw() {
    if (!got) return;
    var t = E.words(E.search(ui.q.value)), k = ui.kind.value, pid = ui.project.value;
    var list = got.docs.filter(function (d) {
      if (k && d.kind !== k) return false;
      if (pid && d.project_id !== pid) return false;
      var p = got.projects[d.project_id], c = got.clients[d.client_id || (p && p.client_id)];
      return !t || [d.doc_no, d.title, p && E.pname(p), c && c.name, c && c.code].some(function (v) { return E.words(v).indexOf(t) > -1; });
    });
    ui.tbody.innerHTML = '';
    list.forEach(function (d) {
      var p = got.projects[d.project_id], c = got.clients[d.client_id || (p && p.client_id)];
      var tr = h('tr', {},
        h('td', {}, label(d.kind)),
        h('td', { class: 'hide-s' }, d.doc_no || '', h('span', { class: 'sub', text: d.title })),
        h('td', { class: 'hide-s' }, p ? h('a', { class: 'eco-open', href: '#projects/' + p.id, text: E.short(p) }) : E.quiet('No project')),
        h('td', { class: 'hide-s' }, c ? c.name || c.code : ''),
        h('td', { class: 'hide-s' }, A.date(d.file_created_at || d.created_at)),
        h('td', { class: 'num' }, E.ext(d.url, 'Open')),
        h('td', { class: 'only-s' }, [d.doc_no || d.title, p ? E.short(p) : null, A.date(d.file_created_at || d.created_at)].filter(Boolean).join(' \u00b7 ')));
      tr.style.cursor = 'default';
      ui.tbody.appendChild(tr);
    });
    if (!list.length) E.fullRow(ui.tbody, COLS.length, got.docs.length ? 'No documents match these filters.' : 'PDFs you make from a project appear here.');
    ui.count.textContent = E.plural(list.length, 'document');
  }
  A.loaders.documents = function () {
    build();
    E.waitRow(ui.tbody, COLS.length);
    Promise.all([E.data.docs(), E.data.projects(), E.settle(E.data.clients())]).then(function (r) {
      var byId = function (list) { var o = {}; (list || []).forEach(function (x) { o[x.id] = x; }); return o; };
      got = { docs: r[0], projects: byId(r[1]), clients: byId(r[2].v) };
      var keep = ui.project.value, used = {};
      r[0].forEach(function (d) { if (d.project_id) used[d.project_id] = true; });
      ui.project.length = 1;
      r[1].filter(function (p) { return used[p.id]; }).forEach(function (p) { ui.project.appendChild(h('option', { value: p.id, selected: p.id === keep }, E.pname(p))); });
      ui.project.hidden = ui.project.length < 2;
      draw();
    }, function (e) { got = null; E.errRow(ui.tbody, COLS.length, e); });
  };
})();
