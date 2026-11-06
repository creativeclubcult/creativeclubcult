/* Clients: the Client tab of the Sheet (key: Kode), each with its projects, leads and documents. Owners and admins
   change a client's details and add new clients here; each change is written to the Client tab through sheets-write.
   The code itself never changes from the admin: invoice numbers and RAB tabs are made from it. */
(function () {
  'use strict';
  if (!window.cccAdmin) return; // admin.js stopped early: the sign in library didn't load
  var A = window.cccAdmin, E = window.eco, sb = A.sb, h = A.h, I = A.icon;
  var panel = A.$('[data-panel="clients"]'), ui = null, got = null, turn = 0;
  var DEAL = ['Deal', 'Lunas'];
  // a lead's status as the Leads page shows it
  var LEAD = { 'new': ['New', 'new'], replied: ['Replied', 'draft'], 'in progress': ['In progress', 'busy'], quoted: ['Quote sent', 'sent'],
    won: ['Won', 'deal'], lost: ['Lost', 'off'], spam: ['Spam', 'off'] };
  var empty = function (t, err) { return h('p', { class: 'empty' + (err ? ' is-err' : ''), text: t }); };
  // a plain click opens the client over the list; a click with a modifier opens it in a new tab as a link does
  var go = function (id) {
    return function (e) {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button) return;
      e.preventDefault(); open(id);
    };
  };

  // ---------- the list: one card per client, as the mockup has it ----------
  function build() {
    if (ui) return;
    ui = { q: h('input', { type: 'search', placeholder: 'Search name, code, PIC, phone', 'aria-label': 'Search clients', autocomplete: 'off' }),
      count: h('span', { class: 'muted' }),
      note: h('p', { class: 'lnote', hidden: true, text: 'The amounts couldn’t be loaded, so what each client was billed is left out. Reload to try again.' }),
      state: h('div', { class: 'lstate', hidden: true }),
      grid: h('section', { class: 'cgrid', 'aria-label': 'Client list' }) };
    ui.q.addEventListener('input', E.debounce(draw, 150));
    panel.innerHTML = '';
    A.add(panel, [h('div', { class: 'bar cbar' }, h('label', { class: 'field' }, I('search', 's'), ui.q), ui.count), ui.note, ui.state, ui.grid]);
  }
  function state(text, err, retry) {
    ui.state.innerHTML = ''; ui.state.hidden = !text;
    if (text) A.add(ui.state, [empty(text, err), retry ? h('button', { class: 'btn sm', type: 'button', onclick: retry }, 'Try again') : null]);
  }
  // per client: projects (open and all), the newest one, and what was billed this year (Deal and Lunas, by quote date)
  var newest = function (a, b) { return (b.quote_date || b.created_at || '') < (a.quote_date || a.created_at || '') ? -1 : 1; };
  function stats(c, projects, money) {
    var mine = projects.filter(function (p) { return p.client_id === c.id || p.plan_client_id === c.id; }).sort(newest);
    var year = E.today().slice(0, 4), billed = 0;
    mine.forEach(function (p) {
      var m = money && money[p.id];
      if (m && DEAL.indexOf(p.status) > -1 && p.sheet_state === 'present' && (p.quote_date || '').slice(0, 4) === year) billed += E.n(m.grand_total) || 0;
    });
    return { list: mine, open: mine.filter(E.isActive).length, billed: billed, last: mine.filter(function (p) { return p.sheet_state !== 'removed'; })[0] };
  }
  function card(x) {
    var s = stats(x, got.projects, got.money), gone = x.sheet_state === 'missing';
    var count = s.list.length ? E.plural(s.list.length, 'project') : 'No projects yet';
    return h('a', { class: 'cc', href: '#clients/' + x.id, onclick: go(x.id) },
      h('div', { class: 'cc-top' }, h('span', { class: 'code', 'aria-hidden': 'true', text: x.code }),
        h('div', {}, h('b', { text: x.name || x.code }), h('span', { text: gone ? count + ', no longer in the Sheet' : count }))),
      // what was billed, for money access only; amounts that couldn't be loaded are left out, never shown as Rp 0
      got.money ? h('div', { class: 'cc-amt' }, h('span', { text: 'Billed this year' }), h('b', { class: s.billed ? null : 'zero', text: E.rp(s.billed) })) : null,
      s.last ? h('div', { class: 'cc-last' }, I('projects'), h('span', { text: E.projectLine(s.last) }), s.open ? h('span', { class: 'tag lime', text: s.open + ' open' }) : null) : null);
  }
  function draw() {
    if (!got) return;
    var t = E.words(E.search(ui.q.value));
    var list = got.clients.filter(function (x) {
      return !t || [x.name, x.code, x.pic, x.phone, x.email].some(function (v) { return E.words(v).indexOf(t) > -1; });
    }).sort(function (a, b) {
      return (a.sheet_state === 'missing') - (b.sheet_state === 'missing') || E.words(a.name || a.code).localeCompare(E.words(b.name || b.code));
    });
    ui.grid.innerHTML = '';
    A.add(ui.grid, list.map(card));
    ui.grid.hidden = !list.length;
    state(list.length ? null : got.clients.length ? 'No client matches that search.' : 'No clients yet. They come from the Client tab of the Sheet.');
    ui.count.textContent = E.plural(list.length, 'client');
    ui.note.hidden = !got.moneyErr;
  }
  A.loaders.clients = function () {
    build();
    var mine = ++turn;
    // a first visit waits; a return keeps the last list on screen until the new one is here
    if (!got) { ui.grid.hidden = true; ui.note.hidden = true; ui.count.textContent = ''; state('Loading clients…'); }
    Promise.all([E.data.clients(), E.data.projects(), E.data.money()].map(E.settle)).then(function (r) {
      if (mine !== turn) return;
      if (r[0].e || r[1].e) {
        got = null; ui.grid.hidden = true; ui.note.hidden = true; ui.count.textContent = '';
        return state(E.ecoError(r[0].e || r[1].e), true, function () { E.forget(); A.loaders.clients(); });
      }
      var money = A.canMoney();
      got = { clients: r[0].v, projects: r[1].v, money: money && !r[2].e ? r[2].v || {} : null, moneyErr: money && !!r[2].e };
      draw();
    });
  };

  // ---------- one client ----------
  // keep: drawn again after a save, at the same scroll position; then: the data-k of the control that gets focus once it is drawn
  function open(id, keep, then) {
    if (!E.isId(id)) return A.toast('That client isn’t there any more.', true);
    Promise.all([
      sb.from('clients').select('*').eq('id', id).maybeSingle(),
      E.settle(E.data.projects()), E.settle(E.data.money()), E.settle(E.data.docs()), E.settle(E.data.values())
    ]).then(function (r) {
      if (r[0].error) return E.failed(r[0].error);
      if (!r[0].data) return A.toast('That client isn’t there any more.', true);
      var c = r[0].data, money = A.canMoney();
      var s = r[1].e ? null : stats(c, r[1].v, money && !r[2].e ? r[2].v : null);
      // leads are for owners and admins: anyone else gets no Leads section at all
      var leadIds = s && A.canEdit() ? s.list.map(function (p) { return p.inquiry_id || p.manual_lead_id; }).filter(Boolean) : [];
      var leads = leadIds.length ? E.settle(E.rows(sb.from('lead_inbox').select('id, name, status, created_at, kind, source').in('id', leadIds))) : Promise.resolve({ v: [] });
      leads.then(function (lr) {
        show({ c: c, s: s, pErr: r[1].e, money: money ? (r[2].e ? { e: r[2].e } : { v: r[2].v || {} }) : null, docs: r[3], values: r[4], leads: lr }, keep);
        var b = then && A.$('[data-drawer] [data-k="' + then + '"]');
        if (b) b.focus();
      });
    }).catch(E.failed);
  }
  // the Client tab's own fields, as the Sheet holds them; name, address and note take the whole width of the form
  var FIELDS = [['name', 'Name', 200, true], ['pic', 'PIC', 200], ['phone', 'Phone', 60], ['email', 'Email', 254], ['npwp', 'NPWP', 60],
    ['address', 'Address', 500, true, true], ['note', 'Note', 1000, true, true]];
  var fieldEl = function (f, v) {
    return f[4] ? h('textarea', { maxlength: f[2], value: v == null ? '' : String(v) })
      : h('input', { type: f[0] === 'email' ? 'email' : f[0] === 'phone' ? 'tel' : 'text', maxlength: f[2], autocomplete: 'off', value: v == null ? '' : String(v) });
  };
  var EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  // d = {c, s (null when the projects couldn't be loaded), pErr, money ({v} or {e}, null without money access), docs, values, leads}
  function show(d, keep) {
    var c = d.c, s = d.s, vals = d.values.v || {}, gone = c.sheet_state === 'missing';
    var money = d.money ? d.money.v || null : null;

    // the figures: how many projects, how many open, and with money access what was billed this year
    var figs = !s ? null : h('div', { class: 'stats3' + (d.money ? '' : ' two') },
      h('div', {}, h('span', { text: 'Projects' }), h('b', { text: String(s.list.length) })),
      h('div', {}, h('span', { text: 'Open' }), h('b', { text: String(s.open) })),
      d.money ? h('div', {}, h('span', { text: 'Billed this year' }), money ? h('b', { text: E.rp(s.billed) }) : h('b', { class: 'muted', text: 'Couldn’t load' })) : null);

    var projects = !s ? empty(E.ecoError(d.pErr), true) : !s.list.length ? empty('No projects yet.')
      : h('ul', { class: 'rlist' }, s.list.map(function (p) {
        var gt = money && money[p.id] ? E.n(money[p.id].grand_total) : null;
        return h('li', {}, h('a', { class: 'r', href: '#projects/' + p.id }, h('div', {}, h('b', { text: E.projectLine(p) })), E.stage(E.phase(p)),
          money ? h('span', { class: 'amt', text: gt == null ? '' : E.rp(gt) }) : I('chev', 's')));
      }));

    var ids = s ? s.list.map(function (p) { return p.id; }) : [];
    var mine = (d.docs.v || []).filter(function (x) { return x.client_id === c.id || ids.indexOf(x.project_id) > -1; });
    var docList = d.docs.e ? empty(E.ecoError(d.docs.e), true) : !mine.length ? empty(d.money ? 'No documents yet.' : 'No contracts or briefs yet.') : h('ul', { class: 'docs' }, mine.map(function (x) { return E.docItem(x); }));

    var leadList = d.leads.e ? empty(E.ecoError(d.leads.e), true) : !d.leads.v.length ? empty('No leads linked to this client yet.')
      : h('ul', { class: 'rlist' }, d.leads.v.map(function (l) {
        var st = LEAD[l.status] || [l.status, 'off'];
        return h('li', {}, h('a', { class: 'r', href: '#leads/' + l.id }, h('div', {}, h('b', { text: l.name }), h('span', { text: 'Came in ' + E.shortStamp(l.created_at) })),
          h('span', { class: 'pill ' + st[1], text: st[0] }), I('chev', 's')));
      }));

    // details: what the Client tab holds, and for owners and admins a form that writes to it
    var value = function (f) { var v = c[f[0]]; return v == null ? '' : String(v).trim(); };
    var filled = FIELDS.filter(value), blank = FIELDS.filter(function (f) { return !value(f); }).map(function (f) { return f[1]; });
    var view = h('div', { class: 'cdet' },
      filled.length ? E.props(filled.map(function (f) {
        var v = value(f);
        return [f[1], f[0] === 'phone' ? E.phoneLink(v) : f[0] === 'email' ? E.mailLink(v) : f[4] ? h('span', { class: 'pre', text: v }) : v];
      })) : null,
      blank.length ? empty('Not filled in yet: ' + blank.join(', ')) : null);
    var tab = E.sheetUrl(vals), edit = A.canEdit() && !gone, on = E.writesOn(vals), vErr = !!d.values.e, form = null, formBox = null;
    if (edit && on) {
      // each change goes to the client's row in the Client tab; the Sheet refuses it if that cell changed meanwhile
      form = E.sheetForm({ label: 'Save details', look: 'mock sm', op: 'client_upsert',
        args: function (set, expect) { return { code: c.code, set: set, expect: expect }; },
        check: function (set) {
          if ('name' in set && !set.name) return 'The client needs a name.';
          return set.email && !EMAIL.test(set.email) ? 'Check the email address.' : '';
        },
        done: function (r) {
          A.toast(r.status === 202 ? E.writeText(r) : 'Saved to the Client tab.');
          E.forget(); open(c.id, true, 'edit-details');
          if (ui && !panel.hidden) A.loaders.clients();
        } });
      var first = null;
      formBox = h('div', { class: 'cform', hidden: true },
        h('div', { class: 'fgrid' }, FIELDS.map(function (f) {
          var el = form.field(f[0], fieldEl(f, c[f[0]]), c[f[0]]);
          first = first || el;
          return h('label', { class: 'f' + (f[3] ? ' full' : '') }, f[1], el);
        })),
        form.bar,
        h('p', { class: 'src' }, I('sheet'), h('span', { text: 'Saved to the Client tab in the Sheet. The code ' + c.code + ' stays the same.' })));
      // Cancel draws the client again as the Sheet has it, and puts the cursor back on Edit details
      form.bar.insertBefore(h('button', { class: 'btn sm quiet', type: 'button', onclick: function () {
        show(d, true);
        var b = A.$('[data-drawer] [data-k="edit-details"]'); if (b) b.focus();
      } }, 'Cancel'), form.bar.children[1]);
      view.appendChild(h('div', { class: 'formacts' }, h('button', { class: 'btn sm', type: 'button', 'data-k': 'edit-details', onclick: function () {
        view.hidden = true; formBox.hidden = false; first.focus();
      } }, I('edit', 's'), 'Edit details')));
    } else if (edit) {
      view.appendChild(h('p', { class: 'src' + (vErr ? ' is-err' : '') }, I('sheet'), h('span', {},
        vErr ? 'The Sheet settings couldn’t be loaded, so the details can’t be changed here yet. Reload to try again.'
          : 'Sheet writes are paused, so the details can’t be changed here for now. ',
        !vErr && tab ? h('a', { href: tab, target: '_blank', rel: 'noopener noreferrer', text: 'Open the Sheet' }) : null)));
    }

    E.drawer('clients', c.id, [
      E.dhead(h('span', { class: 'code', 'aria-hidden': 'true', text: c.code }), c.name || c.code, 'Code ' + c.code + ', used in invoice numbers',
        gone ? ['No longer in the Sheet'] : null),
      h('div', { class: 'dr-body' },
        h('p', { class: 'src' }, I('sheet'), h('span', { text: E.fromSheet(vals, c.sheet_seen_at) })),
        figs,
        E.dsec('Projects', null, projects),
        E.dsec('Documents', null, docList),
        A.canEdit() ? E.dsec('Leads', null, leadList) : null,
        E.dsec('Details', h('span', { class: 'src' }, I('sheet'), 'Client tab'), view, formBox))
    ], keep);
    A.guard(function () { return !!form && form.dirty(); });
  }

  // ---------- a new client, added to the Client tab ----------
  function newClient() {
    if (!A.canEdit()) return;
    Promise.all([E.data.values(), E.data.clients()]).then(function (r) {
      if (!E.writesOn(r[0])) { A.toast('Sheet writes are paused, so clients can’t be added from the admin for now.', true); return; }
      clientForm(r[1]);
    }, E.failed);
  }
  function clientForm(list) {
    var code = h('input', { type: 'text', maxlength: 5, autocomplete: 'off', placeholder: 'HOMI', 'aria-describedby': 'nc-code' });
    var els = {};
    FIELDS.forEach(function (f) { els[f[0]] = fieldEl(f, ''); });
    code.addEventListener('input', function () { var v = code.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 5); if (v !== code.value) code.value = v; });
    var msg = h('span', { class: 's', role: 'status' });
    var say = function (t, err) { msg.textContent = t || ''; msg.classList.toggle('neg', !!err); };
    var send = E.writer();
    var all = [code].concat(FIELDS.map(function (f) { return els[f[0]]; }));
    var dirty = function () { return all.some(function (x) { return !!x.value.trim(); }); };
    // a failed check names the field and puts the cursor in it
    var bad = function (el, t) { say(t, true); el.setAttribute('aria-invalid', 'true'); el.focus(); };
    var btn = h('button', { class: 'btn lime', type: 'button', onclick: function () {
      var k = code.value.trim().toUpperCase(), set = {};
      all.forEach(function (x) { x.removeAttribute('aria-invalid'); });
      FIELDS.forEach(function (f) { var v = els[f[0]].value.trim(); if (v) set[f[0]] = v; });
      if (!/^[A-Z]{2,5}$/.test(k)) return bad(code, 'The code is 2 to 5 capital letters, like HOMI.');
      var taken = list.filter(function (c) { return String(c.code || '').toUpperCase() === k; })[0];
      if (taken) return bad(code, k + ' is already used by ' + (taken.name || k) + '.');
      if (!set.name) return bad(els.name, 'Give the client a name.');
      if (set.email && !EMAIL.test(set.email)) return bad(els.email, 'Check the email address.');
      all.forEach(function (x) { x.disabled = true; }); btn.disabled = true; say('Saving to the Sheet…');
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
      E.dhead(h('span', { class: 'av', 'aria-hidden': 'true' }, I('plus')), 'New client', 'Added to the Client tab of the Sheet.'),
      h('div', { class: 'dr-body' }, h('div', { class: 'fgrid' },
        h('label', { class: 'f' }, 'Code', code),
        h('p', { class: 'src', id: 'nc-code' }, h('span', { text: 'Goes into invoice numbers, and can’t be changed from the admin later.' })),
        FIELDS.map(function (f) { return h('label', { class: 'f' + (f[3] ? ' full' : '') }, f[1], els[f[0]]); }))),
      h('div', { class: 'eco-actionbar' }, msg, btn)
    ]);
    A.guard(dirty);
    code.focus();
  }
  A.actions.clients = function () {
    return A.canEdit() ? h('button', { class: 'btn lime', type: 'button', onclick: newClient }, I('plus', 's'), 'New client') : null;
  };
  A.openers.clients = open;
})();
