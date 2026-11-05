/* Crew & Vendors: the crew list (the Crew tab of the Sheet, money access only: rates and what each person is owed)
   next to the creative network (admin.js, the Network tab). Owners and admins with money access change a person's
   details and add people here; each change is written to the Crew tab through sheets-write. The name is the key
   (Kas entries and RAB lines find people by it), so it never changes from the admin. */
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

  // the Crew tab's own fields (Owed and Paid this year are the Sheet's formulas)
  var FIELDS = [['role', 'Role', 120], ['phone', 'Phone', 60], ['rate', 'Rate (Rp)', 0], ['rate_unit', 'Per', 40], ['note', 'Note', 1000, true]];
  var fieldEl = function (f, v) {
    if (f[0] === 'rate') return E.amountInput(v, 'Rate');
    if (f[3]) return h('textarea', { maxlength: f[2], value: v == null ? '' : String(v) });
    return h('input', { type: 'text', maxlength: f[2], autocomplete: 'off', placeholder: f[0] === 'rate_unit' ? 'day' : '', value: v == null ? '' : String(v) });
  };
  var readOf = function (f) { return f[0] === 'rate' ? E.amount : undefined; };
  var canWrite = function () { return A.canEdit() && A.canMoney(); };

  // keep: drawn again after a save, at the same scroll position
  function open(id, keep) {
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
      var edit = canWrite() && c.sheet_state !== 'missing', on = E.writesOn(vals), form = null, details;
      if (edit && on) {
        form = E.sheetForm({ label: 'Save details', op: 'crew_upsert',
          args: function (set, expect) { return { name: c.name, set: set, expect: expect }; },
          check: function (set) { return set.rate > 1e12 ? 'That rate is too large.' : ''; },
          done: function (res) {
            A.toast(res.status === 202 ? E.writeText(res) : 'Saved to the Crew tab.');
            E.forget(); open(c.id, true);
            if (ui && !panel.hidden) A.loaders.crew();
          } });
        details = E.section('Details', 'Crew tab', h('div', { class: 'eco-form' }, h('div', { class: 'adm-controls' }, FIELDS.map(function (f) {
          return h('label', { class: f[3] ? 'wide' : null }, f[1], form.field(f[0], fieldEl(f, c[f[0]]), c[f[0]], readOf(f)));
        })), form.bar), E.kv([
          ['Owed', E.n(c.unpaid) == null ? E.quiet('Not in the Sheet') : E.rp(c.unpaid)],
          ['Paid this year', E.n(c.paid_this_year) == null ? E.quiet('Not in the Sheet') : E.rp(c.paid_this_year)],
          ['Network profile', c.network_profile_id ? h('a', { href: '#network/' + c.network_profile_id, text: 'Open the profile' }) : E.quiet('Not linked')]
        ]), h('p', { class: 'eco-note', text: 'Changes are written to the Crew tab of the Sheet. The name stays as it is, because the Kas and the RAB lines find people by it.' }));
      } else {
        details = E.section('Details', 'Crew tab', E.kv([
          ['Role', c.role || E.quiet('Not set')], ['Rate', rate(c) || E.quiet('Not set')], ['Phone', E.phoneLink(c.phone) || E.quiet('Not set')],
          ['Note', c.note ? h('span', { class: 'adm-text', text: c.note }) : null],
          ['Owed', E.n(c.unpaid) == null ? E.quiet('Not in the Sheet') : E.rp(c.unpaid)],
          ['Paid this year', E.n(c.paid_this_year) == null ? E.quiet('Not in the Sheet') : E.rp(c.paid_this_year)],
          ['Network profile', c.network_profile_id ? h('a', { href: '#network/' + c.network_profile_id, text: 'Open the profile' }) : E.quiet('Not linked')]
        ]), edit ? h('p', { class: 'eco-note', text: 'Sheet writes are paused, so this is read only for now.' }) : null);
      }
      E.drawer('crew', c.id, [
        h('h2', { text: c.name }),
        h('p', { class: 'lead-line', text: [c.role, c.sheet_state === 'missing' ? 'No longer in the Sheet' : null].filter(Boolean).join(' \u00b7 ') || 'Crew list' }),
        h('p', { class: 'eco-from', text: E.fromSheet(vals, c.sheet_seen_at) }),
        details,
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
      ], keep);
      A.guard(function () { return !!form && form.dirty(); });
    }).catch(E.failed);
  }

  // ---------- a new person, added to the Crew tab ----------
  function newPerson() {
    if (!canWrite()) return;
    Promise.all([E.data.values(), E.rows(sb.from('crew').select('name').limit(2000))]).then(function (r) {
      if (!E.writesOn(r[0])) { A.toast('Sheet writes are paused, so people can\u2019t be added from the admin yet.', true); return; }
      personForm(r[1].map(function (c) { return E.words(c.name).trim(); }));
    }, E.failed);
  }
  function personForm(names) {
    var name = h('input', { type: 'text', maxlength: 120, autocomplete: 'off', placeholder: 'Full name' });
    var els = {};
    FIELDS.forEach(function (f) { els[f[0]] = fieldEl(f, null); });
    var msg = h('span', { class: 's', role: 'status' });
    var say = function (t, err) { msg.textContent = t || ''; msg.classList.toggle('neg', !!err); };
    var send = E.writer();
    var all = [name].concat(FIELDS.map(function (f) { return els[f[0]]; }));
    var dirty = function () { return all.some(function (x) { return !!x.value.trim(); }); };
    var btn = h('button', { class: 'btn', type: 'button', onclick: function () {
      var n = name.value.trim().replace(/\s+/g, ' '), set = {};
      FIELDS.forEach(function (f) {
        var v = f[0] === 'rate' ? E.amount(els.rate) : els[f[0]].value.trim() || null;
        if (v != null) set[f[0]] = v;
      });
      if (!n) return say('Give the person a name.', true);
      if (names.indexOf(n.toLowerCase()) > -1) return say(n + ' is already on the crew list.', true);
      if (set.rate > 1e12) return say('That rate is too large.', true);
      all.forEach(function (x) { x.disabled = true; }); btn.disabled = true; say('Saving to the Sheet\u2026');
      var back = function (t) { all.forEach(function (x) { x.disabled = false; }); btn.disabled = false; say(t, true); };
      send('crew_upsert', { name: n, create: true, set: set }).then(function (r) {
        if (r.status !== 200 && r.status !== 202) return back(E.writeText(r));
        A.guard(null); E.forget();
        A.toast(r.status === 202 ? E.writeText(r) : 'Added to the Crew tab: ' + n + '.');
        if (ui && !panel.hidden) A.loaders.crew();
        if (r.status !== 200) { A.closeDrawer(true); return; }
        E.rows(sb.from('crew').select('id, name').limit(2000)).then(function (cs) {
          var made = cs.filter(function (c) { return E.words(c.name).trim() === n.toLowerCase(); })[0];
          if (made) open(made.id); else A.closeDrawer(true);
        }, function () { A.closeDrawer(true); });
      }, function (e) { back(E.ecoError(e)); });
    } }, 'Add person');
    E.drawer(null, null, [
      h('h2', { text: 'New person' }),
      h('p', { class: 'lead-line', text: 'Added to the Crew tab of the Sheet. Kas entries and RAB lines find people by name, so it can\u2019t be changed from the admin later.' }),
      h('div', { class: 'adm-sec eco-form' }, h('div', { class: 'adm-controls' }, h('label', { class: 'wide' }, 'Name', name),
        FIELDS.map(function (f) { return h('label', { class: f[3] ? 'wide' : null }, f[1], els[f[0]]); }))),
      h('div', { class: 'eco-actionbar' }, msg, btn)
    ]);
    A.guard(dirty);
    name.focus();
  }
  A.actions.crew = function () {
    return canWrite() ? h('button', { class: 'btn', type: 'button', onclick: newPerson }, 'New person') : null;
  };
  A.openers.crew = open;
})();
