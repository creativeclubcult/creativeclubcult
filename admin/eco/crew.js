/* Crew & Vendors: the crew list (the Crew tab of the Sheet, money access only: rates and what each person is owed)
   next to the creative network (admin.js, the Network tab). Read only in this version. */
(function () {
  'use strict';
  var A = window.cccAdmin, E = window.eco, sb = A.sb, h = A.h;
  var panel = A.$('[data-panel="crew"]'), ui = null, got = null;
  var COLS = ['Name', 'Role', ['Rate', 'num'], 'Phone', ['Owed', 'num'], ['Paid this year', 'num']];

  function build() {
    if (ui) return;
    ui = { q: h('input', { type: 'search', placeholder: 'Search name, role, phone', 'aria-label': 'Search the crew list' }),
      count: h('span', { class: 'adm-count' }), tbody: h('tbody') };
    ui.q.addEventListener('input', E.debounce(draw, 150));
    A.add(panel, [h('div', { class: 'adm-bar' }, ui.q, ui.count),
      h('div', { class: 'adm-table-wrap' }, h('table', { class: 'adm-table is-stack' }, E.thead(COLS), ui.tbody))]);
  }
  var rate = function (c) { return E.n(c.rate) == null ? '' : E.rp(c.rate) + (c.rate_unit ? ' / ' + c.rate_unit : ''); };
  function draw() {
    if (!got) return;
    var t = E.words(ui.q.value.trim());
    var list = got.crew.filter(function (c) { return !t || [c.name, c.role, c.phone].some(function (v) { return E.words(v).indexOf(t) > -1; }); })
      .sort(function (a, b) { return (a.sheet_state === 'missing') - (b.sheet_state === 'missing') || E.words(a.name).localeCompare(E.words(b.name)); });
    ui.tbody.innerHTML = '';
    list.forEach(function (c) {
      ui.tbody.appendChild(h('tr', { onclick: function () { open(c.id); } },
        h('td', {}, c.name, c.sheet_state === 'missing' ? h('span', { class: 'sub', text: 'No longer in the Sheet' }) : null),
        h('td', { class: 'hide-s' }, c.role || ''),
        h('td', { class: 'num hide-s' }, rate(c)),
        h('td', { class: 'hide-s' }, c.phone || ''),
        h('td', { class: 'num' }, E.n(c.unpaid) > 0 ? E.rp(c.unpaid) : E.quiet(E.n(c.unpaid) == null ? '' : E.rp(0))),
        h('td', { class: 'num hide-s' }, E.n(c.paid_this_year) == null ? '' : E.rp(c.paid_this_year)),
        h('td', { class: 'only-s' }, [c.role, rate(c)].filter(Boolean).join(' \u00b7 '))));
    });
    if (!list.length) E.fullRow(ui.tbody, COLS.length, t ? 'Nobody matches this search.' : 'Nobody on the crew list yet. The Crew tab of the Sheet fills this list.');
    ui.count.textContent = E.plural(list.length, 'person', 'people');
  }
  A.loaders.crew = function () {
    build();
    E.waitRow(ui.tbody, COLS.length);
    E.rows(sb.from('crew').select('*').order('name').limit(2000)).then(function (crew) { got = { crew: crew }; draw(); },
      function (e) { got = null; E.errRow(ui.tbody, COLS.length, e); });
  };

  function open(id) {
    if (!E.isId(id)) return A.toast('That person isn\u2019t on the crew list any more.', true);
    Promise.all([
      sb.from('crew').select('*').eq('id', id).maybeSingle(),
      E.settle(E.data.projects()), E.settle(E.rows(sb.from('project_money').select('project_id, crew_lines').limit(2000))), E.settle(E.data.kas()), E.settle(E.data.values())
    ]).then(function (r) {
      if (r[0].error) return E.failed(r[0].error);
      if (!r[0].data) return A.toast('That person isn\u2019t on the crew list any more.', true);
      var c = r[0].data, key = E.words(c.name).trim(), vals = r[4].v || {};
      // the RAB crew lines with this name, and the Kas entries paid to them
      var lines = [];
      if (!r[1].e && !r[2].e) {
        var byId = {}; r[1].v.forEach(function (p) { byId[p.id] = p; });
        r[2].v.forEach(function (m) {
          (Array.isArray(m.crew_lines) ? m.crew_lines : []).forEach(function (l) {
            if (l.person && E.words(l.person).trim() === key && byId[m.project_id]) lines.push({ p: byId[m.project_id], l: l });
          });
        });
      }
      var pays = (r[3].v || []).filter(function (k) { return k.crew_id === c.id || E.words(k.counterparty).trim() === key; });
      E.drawer('crew', c.id, [
        h('h2', { text: c.name }),
        h('p', { class: 'lead-line', text: [c.role, c.sheet_state === 'missing' ? 'No longer in the Sheet' : null].filter(Boolean).join(' \u00b7 ') || 'Crew list' }),
        h('p', { class: 'eco-from', text: E.fromSheet(vals, c.sheet_seen_at) }),
        E.section('Details', 'Crew tab', E.kv([
          ['Role', c.role || E.quiet('Not set')], ['Rate', rate(c) || E.quiet('Not set')], ['Phone', E.phoneLink(c.phone) || E.quiet('Not set')],
          ['Note', c.note ? h('span', { class: 'adm-text', text: c.note }) : null],
          ['Owed', E.n(c.unpaid) == null ? E.quiet('Not in the Sheet') : E.rp(c.unpaid)],
          ['Paid this year', E.n(c.paid_this_year) == null ? E.quiet('Not in the Sheet') : E.rp(c.paid_this_year)],
          ['Network profile', c.network_profile_id ? h('a', { href: '#network/' + c.network_profile_id, text: 'Open the profile' }) : E.quiet('Not linked')]
        ]), h('p', { class: 'eco-note', text: 'Read only in this version. Change crew details in the Crew tab of the Sheet.' })),
        E.section('Projects', 'RAB crew lines', r[1].e || r[2].e ? h('p', { class: 'eco-err', text: E.ecoError(r[1].e || r[2].e) })
          : !lines.length ? h('p', { class: 'adm-note', text: 'Not named in any RAB yet.' })
          : h('table', { class: 'eco-table' }, E.thead(['Project', 'Role', ['Fee', 'num']]), h('tbody', {}, lines.map(function (x) {
            return h('tr', {}, h('td', {}, h('a', { href: '#projects/' + x.p.id, text: E.short(x.p) })), h('td', { text: x.l.desc || '' }), h('td', { class: 'num' }, E.num(x.l.total)));
          })))),
        E.section('Payments', 'Kas', r[3].e ? h('p', { class: 'eco-err', text: E.ecoError(r[3].e) })
          : !pays.length ? h('p', { class: 'adm-note', text: 'No payments in the Kas yet.' })
          : h('table', { class: 'eco-table' }, E.thead(['Date', ['Project', 'hide-s'], ['Nominal', 'num'], 'Status']), h('tbody', {}, pays.map(function (k) {
            return h('tr', {}, h('td', { text: E.day(k.entry_date) }), h('td', { class: 'hide-s', text: k.project_tab || 'Operasional' }),
              h('td', { class: 'num' }, E.num(k.amount)), h('td', { class: k.paid === 'Belum' ? null : 'muted', text: k.paid || '' }));
          }))))
      ]);
    }).catch(E.failed);
  }
  A.openers.crew = open;
})();
