/* Clients: the Client tab of the Sheet (key: Kode), each with its projects, leads and documents. Owners and admins
   change a client's details and add new clients here; each change is written to the Client tab through sheets-write.
   The code itself never changes from the admin: invoice numbers and RAB tabs are made from it. */
(function () {
  'use strict';
  var A = window.cccAdmin, E = window.eco, sb = A.sb, h = A.h;
  var panel = A.$('[data-panel="clients"]'), ui = null, got = null;
  var DEAL = ['Deal', 'Lunas'];

  function cols() {
    return ['Client', 'PIC', 'Phone', ['Projects', 'num']].concat(A.canMoney() ? [['Billed this year', 'num']] : [], ['Last project']);
  }
  function build() {
    if (ui) return;
    ui = { q: h('input', { type: 'search', placeholder: 'Search name, code, PIC, phone', 'aria-label': 'Search clients' }),
      count: h('span', { class: 'adm-count' }), table: h('table', { class: 'adm-table is-stack' }), tbody: h('tbody') };
    ui.q.addEventListener('input', E.debounce(draw, 150));
    A.add(panel, [h('div', { class: 'adm-bar' }, ui.q, ui.count), h('div', { class: 'adm-table-wrap' }, ui.table)]);
  }
  // per client: projects (open and all), the newest one, and what was billed this year (Deal and Lunas, by quote date)
  function stats(c, projects, money) {
    var mine = projects.filter(function (p) { return p.client_id === c.id || p.plan_client_id === c.id; });
    var year = E.today().slice(0, 4), billed = 0;
    mine.forEach(function (p) {
      var m = money[p.id];
      if (m && DEAL.indexOf(p.status) > -1 && p.sheet_state === 'present' && (p.quote_date || '').slice(0, 4) === year) billed += E.n(m.grand_total) || 0;
    });
    var last = mine.filter(function (p) { return p.sheet_state !== 'removed'; })
      .sort(function (a, b) { return (b.quote_date || b.created_at || '') < (a.quote_date || a.created_at || '') ? -1 : 1; })[0];
    return { list: mine, open: mine.filter(E.isActive).length, billed: billed, last: last };
  }
  function draw() {
    if (!got) return;
    var t = E.words(ui.q.value.trim()), c = cols(), money = A.canMoney();
    ui.table.innerHTML = ''; ui.tbody = h('tbody');
    ui.table.appendChild(E.thead(c)); ui.table.appendChild(ui.tbody);
    var list = got.clients.filter(function (x) {
      return !t || [x.name, x.code, x.pic, x.phone, x.email].some(function (v) { return E.words(v).indexOf(t) > -1; });
    }).sort(function (a, b) {
      return (a.sheet_state === 'missing') - (b.sheet_state === 'missing') || E.words(a.name || a.code).localeCompare(E.words(b.name || b.code));
    });
    list.forEach(function (x) {
      var s = stats(x, got.projects, got.money);
      var counts = s.open ? s.open + ' open of ' + s.list.length : String(s.list.length);
      ui.tbody.appendChild(h('tr', { onclick: function () { open(x.id); } },
        h('td', {}, x.name || x.code, h('span', { class: 'sub', text: x.code + (x.sheet_state === 'missing' ? ' \u00b7 No longer in the Sheet' : '') })),
        h('td', { class: 'hide-s' }, x.pic || ''),
        h('td', { class: 'hide-s' }, x.phone || ''),
        h('td', { class: 'num hide-s' }, counts),
        money ? h('td', { class: 'num' }, s.billed ? E.rp(s.billed) : E.quiet(E.rp(0))) : null,
        h('td', { class: 'hide-s' }, s.last ? E.pad3(s.last.seq) + (s.last.title ? ' \u00b7 ' + s.last.title : '') : E.quiet('None yet')),
        h('td', { class: 'only-s' }, [E.plural(s.list.length, 'project') + (s.open ? ', ' + s.open + ' open' : ''), x.pic].filter(Boolean).join(' \u00b7 '))));
    });
    if (!list.length) E.fullRow(ui.tbody, c.length, t ? 'No clients match this search.' : 'No clients yet. They come from the Client tab of the Sheet.');
    ui.count.textContent = E.plural(list.length, 'client');
  }

  A.loaders.clients = function () {
    build();
    ui.table.innerHTML = ''; ui.tbody = h('tbody'); ui.table.appendChild(E.thead(cols())); ui.table.appendChild(ui.tbody);
    E.waitRow(ui.tbody, cols().length);
    Promise.all([E.data.clients(), E.data.projects(), E.data.money()]).then(function (r) {
      got = { clients: r[0], projects: r[1], money: r[2] }; draw();
    }, function (e) { got = null; E.errRow(ui.tbody, cols().length, e); });
  };

  // ---------- one client ----------
  // keep: drawn again after a save, at the same scroll position
  function open(id, keep) {
    if (!E.isId(id)) return A.toast('That client isn\u2019t there any more.', true);
    Promise.all([
      sb.from('clients').select('*').eq('id', id).maybeSingle(),
      E.settle(E.data.projects()), E.settle(E.data.money()), E.settle(E.data.docs()), E.settle(E.data.values())
    ]).then(function (r) {
      if (r[0].error) return E.failed(r[0].error);
      if (!r[0].data) return A.toast('That client isn\u2019t there any more.', true);
      var c = r[0].data, money = A.canMoney();
      var s = r[1].e || r[2].e ? null : stats(c, r[1].v, r[2].v);
      // leads are for owners and admins: anyone else gets no Leads section at all
      var leadIds = s && A.canEdit() ? s.list.map(function (p) { return p.inquiry_id || p.manual_lead_id; }).filter(Boolean) : [];
      var leads = leadIds.length ? E.settle(E.rows(sb.from('lead_inbox').select('id, name, status, created_at, kind, source').in('id', leadIds))) : Promise.resolve({ v: [] });
      leads.then(function (lr) { show(c, s, r[1].e || r[2].e, r[3], r[4], lr, money ? r[2].v || {} : null, keep); });
    }).catch(E.failed);
  }
  // the Client tab's own fields, as the Sheet holds them
  var FIELDS = [['name', 'Name', 200, 'wide'], ['pic', 'PIC', 200], ['phone', 'Phone', 60], ['email', 'Email', 254, 'wide'], ['npwp', 'NPWP', 60, 'wide'],
    ['address', 'Address', 500, 'wide', true], ['note', 'Note', 1000, 'wide', true]];
  var fieldEl = function (f, v) {
    return f[4] ? h('textarea', { maxlength: f[2], value: v == null ? '' : String(v) })
      : h('input', { type: f[0] === 'email' ? 'email' : 'text', maxlength: f[2], autocomplete: 'off', value: v == null ? '' : String(v) });
  };
  var EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  function show(c, s, pErr, docs, values, leads, moneyMap, keep) {
    var money = !!moneyMap;
    var vals = values.v || {};
    var projects = pErr ? h('p', { class: 'eco-err', text: E.ecoError(pErr) })
      : !s.list.length ? h('p', { class: 'adm-note', text: 'No projects yet.' })
      : h('table', { class: 'eco-table' }, E.thead(['Project', 'Phase'].concat(money ? [['Total', 'num']] : [])),
        h('tbody', {}, s.list.map(function (p) {
          var m = money ? moneyMap[p.id] : null;
          return h('tr', {}, h('td', {}, h('a', { href: '#projects/' + p.id, text: E.pname(p) })), h('td', {}, E.pill(E.phase(p))),
            money ? h('td', { class: 'num' }, m && m.grand_total != null ? E.num(m.grand_total) : '') : null);
        })));
    var leadList = leads.e ? h('p', { class: 'eco-err', text: E.ecoError(leads.e) })
      : !leads.v.length ? h('p', { class: 'adm-note', text: 'No leads linked to this client yet.' })
      : h('ul', { class: 'eco-list' }, leads.v.map(function (l) {
        return h('li', {}, h('a', { class: 't', href: '#leads/' + l.id }, l.name, h('span', { class: 'sub', text: A.date(l.created_at) })), h('span', { class: 'adm-pill', text: l.status }));
      }));
    var ids = s ? s.list.map(function (p) { return p.id; }) : [];
    var myDocs = (docs.v || []).filter(function (d) { return d.client_id === c.id || ids.indexOf(d.project_id) > -1; });
    var docList = docs.e ? h('p', { class: 'eco-err', text: E.ecoError(docs.e) })
      : !myDocs.length ? h('p', { class: 'adm-note', text: 'No documents yet.' })
      : h('ul', { class: 'eco-list' }, myDocs.map(function (d) {
        return h('li', {}, h('span', { class: 't' }, E.ext(d.url, d.doc_no || d.title), h('span', { class: 'sub', text: d.title + ' \u00b7 ' + A.date(d.created_at) })));
      }));
    var any = c.pic || c.phone || c.email || c.npwp || c.address || c.note;
    var tab = E.sheetUrl(vals);
    var edit = A.canEdit() && c.sheet_state !== 'missing', on = E.writesOn(vals), form = null;
    var details;
    if (edit && on) {
      // each change goes to the client's row in the Client tab; the Sheet refuses it if that cell changed meanwhile
      form = E.sheetForm({ label: 'Save details', op: 'client_upsert',
        args: function (set, expect) { return { code: c.code, set: set, expect: expect }; },
        check: function (set) {
          if ('name' in set && !set.name) return 'The client needs a name.';
          return set.email && !EMAIL.test(set.email) ? 'Check the email address.' : '';
        },
        done: function (r) {
          A.toast(r.status === 202 ? E.writeText(r) : 'Saved to the Client tab.');
          E.forget(); open(c.id, true);
          if (ui && !panel.hidden) A.loaders.clients();
        } });
      details = E.section('Details', 'Client tab', h('div', { class: 'eco-form' }, h('div', { class: 'adm-controls' }, FIELDS.map(function (f) {
        return h('label', { class: f[3] || null }, f[1], form.field(f[0], fieldEl(f, c[f[0]]), c[f[0]]));
      })), form.bar), h('p', { class: 'eco-note', text: 'Changes are written to the Client tab of the Sheet. The code (' + c.code + ') stays as it is.' }));
    } else {
      details = E.section('Details', 'Client tab', any ? E.kv([
        ['PIC', c.pic], ['Phone', E.phoneLink(c.phone)], ['Email', E.mailLink(c.email)], ['NPWP', c.npwp],
        ['Address', c.address ? h('span', { class: 'adm-text', text: c.address }) : null], ['Note', c.note ? h('span', { class: 'adm-text', text: c.note }) : null]
      ]) : h('p', { class: 'adm-note', text: 'No contact details in the Sheet yet.' }),
        edit ? h('p', { class: 'eco-note' }, 'Sheet writes are paused, so this is read only for now', tab ? [' (', h('a', { href: tab, target: '_blank', rel: 'noopener noreferrer', text: 'open the Sheet' }), ').'] : '.') : null);
    }
    E.drawer('clients', c.id, [
      h('h2', { text: c.name || c.code }),
      h('p', { class: 'lead-line', text: [c.code + ', used in invoice numbers', c.sheet_state === 'missing' ? 'No longer in the Sheet' : null].filter(Boolean).join(' \u00b7 ') }),
      h('p', { class: 'eco-from', text: E.fromSheet(vals, c.sheet_seen_at) }),
      details,
      E.section('Projects', s ? E.plural(s.list.length, 'project') : null, projects),
      A.canEdit() ? E.section('Leads', null, leadList) : null,
      E.section('Documents', null, docList)
    ], keep);
    A.guard(function () { return !!form && form.dirty(); });
  }

  // ---------- a new client, added to the Client tab ----------
  function newClient() {
    if (!A.canEdit()) return;
    Promise.all([E.data.values(), E.data.clients()]).then(function (r) {
      if (!E.writesOn(r[0])) { A.toast('Sheet writes are paused, so clients can\u2019t be added from the admin yet.', true); return; }
      clientForm(r[1]);
    }, E.failed);
  }
  function clientForm(list) {
    var code = h('input', { type: 'text', maxlength: 5, autocomplete: 'off', placeholder: 'HOMI' });
    var els = {};
    FIELDS.forEach(function (f) { els[f[0]] = fieldEl(f, ''); });
    code.addEventListener('input', function () { var v = code.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 5); if (v !== code.value) code.value = v; });
    var msg = h('span', { class: 's', role: 'status' });
    var say = function (t, err) { msg.textContent = t || ''; msg.classList.toggle('neg', !!err); };
    var send = E.writer();
    var all = [code].concat(FIELDS.map(function (f) { return els[f[0]]; }));
    var dirty = function () { return all.some(function (x) { return !!x.value.trim(); }); };
    var btn = h('button', { class: 'btn', type: 'button', onclick: function () {
      var k = code.value.trim().toUpperCase(), set = {};
      FIELDS.forEach(function (f) { var v = els[f[0]].value.trim(); if (v) set[f[0]] = v; });
      if (!/^[A-Z]{2,5}$/.test(k)) return say('The code is 2 to 5 capital letters, like HOMI.', true);
      var taken = list.filter(function (c) { return String(c.code || '').toUpperCase() === k; })[0];
      if (taken) return say(k + ' is already used by ' + (taken.name || k) + '.', true);
      if (!set.name) return say('Give the client a name.', true);
      if (set.email && !EMAIL.test(set.email)) return say('Check the email address.', true);
      all.forEach(function (x) { x.disabled = true; }); btn.disabled = true; say('Saving to the Sheet\u2026');
      var back = function (t) { all.forEach(function (x) { x.disabled = false; }); btn.disabled = false; say(t, true); };
      send('client_upsert', { code: k, create: true, set: set }).then(function (r) {
        if (r.status !== 200 && r.status !== 202) return back(E.writeText(r));
        A.guard(null); E.forget();
        A.toast(r.status === 202 ? E.writeText(r) : 'Added to the Client tab: ' + set.name + ' (' + k + ').');
        if (ui && !panel.hidden) A.loaders.clients();
        if (r.status !== 200) { A.closeDrawer(true); return; }
        E.data.clients(true).then(function (cs) {
          var made = cs.filter(function (c) { return c.code === k; })[0];
          if (made) open(made.id); else A.closeDrawer(true);
        }, function () { A.closeDrawer(true); });
      }, function (e) { back(E.ecoError(e)); });
    } }, 'Add client');
    E.drawer(null, null, [
      h('h2', { text: 'New client' }),
      h('p', { class: 'lead-line', text: 'Added to the Client tab of the Sheet. The code goes into invoice numbers and can\u2019t be changed from the admin later.' }),
      h('div', { class: 'adm-sec eco-form' }, h('div', { class: 'adm-controls' }, h('label', {}, 'Code', code),
        FIELDS.map(function (f) { return h('label', { class: f[0] === 'name' ? null : f[3] || null }, f[1], els[f[0]]); }))),
      h('div', { class: 'eco-actionbar' }, msg, btn)
    ]);
    A.guard(dirty);
    code.focus();
  }
  A.actions.clients = function () {
    return A.canEdit() ? h('button', { class: 'btn', type: 'button', onclick: newClient }, 'New client') : null;
  };
  A.openers.clients = open;
})();
