/* Projects: every RAB in the Sheet (a Rekap Project row and its tab) and the Briefs not in the Sheet yet, sorted by
   what needs doing. The drawer shows one project end to end. What the admin keeps itself (shoot and deliver dates,
   notes) saves to the database. The status, the delivery date, payments, the quote settings, locking gear prices,
   the PDFs, the RAB's lines and its actual costs (rab.js) are written to the Sheet through sheets-write, which checks
   the role and every value again; a new RAB is made in the Sheet from a Brief. RAB 001 to 009 (the old tabs) stay
   read only. */
(function () {
  'use strict';
  var A = window.cccAdmin, E = window.eco, sb = A.sb, h = A.h;
  var panel = A.$('[data-panel="projects"]'), ui = null, got = null;
  var SECTION = { pre: 'Pre-Production', talent: 'Talent & Model', crew: 'Production Crew', location: 'Location & Permit',
    art: 'Art, Property & Wardrobe', transport: 'Transportation & Accommodation', catering: 'Konsumsi / Catering', post: 'Post Production', others: 'Lain-lain' };
  var DOC = { penawaran: 'Penawaran', invoice: 'Invoice', kwitansi: 'Kwitansi', contract: 'Contract', brief: 'Brief', other: 'Other' };
  var FIELD = { shoot_date: 'Shoot starts', shoot_end: 'Shoot ends', deliver_by: 'Deliver by', notes: 'Notes', status: 'Status', plan_title: 'Name',
    archived_at: 'Archived', portfolio_skip: 'Not for the portfolio', final_file_date: 'Files delivered', payment_due: 'Payment due', quote_date: 'Quote date' };
  var VIEWS = {
    active: E.isActive,
    done: function (p) { return p.sheet_state === 'present' && p.status === 'Lunas'; },
    cancelled: function (p) { return E.phase(p) === 'Batal' || (p.sheet_state === 'none' && !!p.archived_at); },
    all: function () { return true; }
  };
  var gone = function () { A.toast('That project isn\u2019t there any more.', true); };
  var blank = function (t) { return h('p', { class: 'adm-note', text: t }); };
  var oops = function (e) { return h('p', { class: 'eco-err', text: E.ecoError(e) }); };
  var newTab = function (href, text, cls) { return h('a', { class: cls || null, href: href, target: '_blank', rel: 'noopener noreferrer' }, text); };

  // ---------- the list ----------
  function build() {
    if (ui) return;
    ui = { view: 'active', count: h('span', { class: 'adm-count' }), table: h('table', { class: 'adm-table is-stack' }), tbody: h('tbody'),
      q: h('input', { type: 'search', placeholder: 'Search project, client, invoice no.', 'aria-label': 'Search projects' }),
      client: A.select([['', 'All clients']], '', { 'aria-label': 'Client' }),
      note: h('p', { class: 'eco-note', hidden: true, text: 'Some next steps leave out a check, because the documents, the Kas or the portfolio couldn\u2019t be loaded.' }) };
    ui.seg = E.seg([['active', 'Active'], ['done', 'Done'], ['cancelled', 'Cancelled'], ['all', 'All']], 'active', function (v) { ui.view = v; draw(); }, { 'aria-label': 'Show' });
    ui.q.addEventListener('input', E.debounce(draw, 150));
    ui.client.addEventListener('change', draw);
    A.add(panel, [h('div', { class: 'adm-bar' }, ui.seg, ui.q, ui.client, ui.count), h('div', { class: 'adm-table-wrap' }, ui.table), ui.note]);
  }
  function head() {
    var cols = E.projectCols();
    ui.table.innerHTML = ''; ui.tbody = h('tbody');
    ui.table.appendChild(E.thead(cols)); ui.table.appendChild(ui.tbody);
    return cols.length;
  }
  function fillClients() {
    var keep = ui.client.value, seen = {};
    got.projects.forEach(function (p) { var c = p.client_id || p.plan_client_id; if (c) seen[c] = true; });
    var opts = got.clients.filter(function (c) { return seen[c.id]; }).map(function (c) { return [c.id, c.name || c.code]; });
    ui.client.length = 1;
    opts.forEach(function (o) { ui.client.appendChild(h('option', { value: o[0], selected: o[0] === keep }, o[1])); });
    ui.client.hidden = !opts.length;
  }
  function draw() {
    if (!got) return;
    var n = head(), t = E.words(E.search(ui.q.value)), cid = ui.client.value;
    var list = got.projects.filter(VIEWS[ui.view]).filter(function (p) {
      if (cid && p.client_id !== cid && p.plan_client_id !== cid) return false;
      return !t || [E.pname(p), p.invoice_no, p.tab_name, p.client_label, p.client_code].some(function (v) { return E.words(v).indexOf(t) > -1; });
    });
    E.byUrgency(list, got.money, E.today()).forEach(function (p) {
      ui.tbody.appendChild(E.projectRow(p, got.money[p.id], got.ctx(p), function () { open(p.id); }));
    });
    if (!list.length) E.fullRow(ui.tbody, n, got.projects.length ? 'No projects here.' : 'No projects yet. They come from Rekap Project in the Sheet.');
    ui.count.textContent = E.plural(list.length, 'project');
    ui.note.hidden = !got.partial;
  }
  A.loaders.projects = function () {
    build();
    var n = head(); // head() makes a new tbody, so it runs before ui.tbody is read
    E.waitRow(ui.tbody, n);
    Promise.all([E.data.projects(), E.data.money(), E.data.clients(), E.data.docs(), E.data.kas(), E.data.portfolio()].map(E.settle)).then(function (r) {
      if (r[0].e || r[1].e) { got = null; n = head(); return E.errRow(ui.tbody, n, r[0].e || r[1].e); }
      got = { projects: r[0].v, money: r[1].v, clients: r[2].v || [], ctx: E.stepContext(r[3].v, r[4].v, r[5].v), partial: !!(r[3].e || r[4].e || r[5].e) };
      fillClients(); draw();
    });
  };

  // ---------- one project ----------
  // keep: drawn again after a save, at the same scroll position
  function open(id, keep) {
    if (!E.isId(id)) return gone();
    var money = A.canMoney();
    Promise.all([
      sb.from('projects').select('*').eq('id', id).maybeSingle(),
      money ? sb.from('project_money').select('*').eq('project_id', id).maybeSingle() : Promise.resolve({ data: null }),
      E.settle(E.data.values()), E.settle(E.data.docs()), E.settle(E.data.kas()), E.settle(E.data.portfolio()),
      money ? E.settle(E.rows(sb.from('sync_changes').select('at, source, actor_email, field, old_value, new_value').eq('entity_id', id).order('at', { ascending: false }).limit(50)))
        : Promise.resolve({ v: [] }),
      E.settle(E.rows(sb.from('activity_log').select('at, actor_email, action, source').eq('entity', 'project').eq('entity_id', id).order('at', { ascending: false }).limit(20))),
      E.settle(E.data.clients())
    ]).then(function (r) {
      if (r[0].error) return E.failed(r[0].error);
      if (!r[0].data) return gone();
      var p = r[0].data, lead = A.canEdit() ? p.inquiry_id || p.manual_lead_id : null; // leads are for owners and admins
      (lead ? E.settle(E.rows(sb.from('lead_inbox').select('id, name, status').eq('id', lead))) : Promise.resolve({ v: [] })).then(function (lr) {
        show({ p: p, m: r[1].data || null, mErr: r[1].error || null, values: r[2], docs: r[3], kas: r[4], port: r[5], changes: r[6], acts: r[7], lead: lr, clients: r[8] }, keep);
      });
    }).catch(E.failed);
  }
  // a change the Sheet took (200) or queued (202): the drawer again with what the Sheet holds now, and the list behind it
  function saved(id, r, text) {
    A.toast(r.status === 202 ? E.writeText(r) : text);
    E.forget();
    open(id, true);
    if (ui && !panel.hidden) A.loaders.projects();
  }
  // a change that wasn't written because its line changed in the Sheet: the RAB tab is read again (a refresh that is
  // busy or fails leaves the next scheduled read to it), then the drawer shows it as the Sheet has it
  function reread(p, text) {
    var again = function () { A.toast(text, true); E.forget(); open(p.id, true); };
    sb.functions.invoke('sheets-sync', { body: { tabs: [p.sheet_gid] } }).then(again, again);
  }
  var DOC_TYPES = [['PENAWARAN', 'Penawaran'], ['INVOICE', 'Invoice'], ['KWITANSI', 'Kwitansi']];
  var docType = function (v) { v = String(v || '').trim().toUpperCase(); return DOC_TYPES.some(function (o) { return o[0] === v; }) ? v : ''; };
  var field = function (label, el, cls) { return h('label', { class: cls || null }, label, el); };
  // a seg's pressed button, set from outside (a status that wasn't saved goes back)
  var press = function (box, v) { A.$$('button', box).forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-v') === v)); }); };
  var lockSeg = function (box, on) { A.$$('button', box).forEach(function (b) { b.disabled = on; }); };

  // a date or the notes, kept by the admin: saved as soon as it changes
  function save(p, field, v, input, note, onFail) {
    var start = field === 'shoot_date' ? v : p.shoot_date, end = field === 'shoot_end' ? v : p.shoot_end;
    var undo = function (msg) {
      note.textContent = msg; note.classList.add('is-err');
      if (input.type === 'date') input.value = p[field] || '';
      if (onFail) onFail();
    };
    if (start && end && end < start) return undo('The shoot can\u2019t end before it starts.');
    note.textContent = 'Saving\u2026'; note.classList.remove('is-err');
    var patch = {}; patch[field] = v;
    sb.from('projects').update(patch).eq('id', p.id).select('id').then(function (r) {
      if (r.error) return undo(E.ecoError(r.error));
      if (!r.data || !r.data.length) return undo('Your account isn\u2019t allowed to change this.');
      p[field] = v; note.textContent = 'Saved';
      E.forget();
      if (ui && !panel.hidden) A.loaders.projects();
    });
  }

  // The split of the project price: the ALOKASI DANA block of the RAB tab. The PR and internal fees come off first,
  // net profit and the Kas share are taken from what is left, and the rest is the production budget. Net profit
  // (10% to 25%) is the one rate that changes here; it is written to the RAB tab like any other RAB setting.
  function allocation(p, a, canSet) {
    var tb = h('tbody'), ft = h('tfoot'), cur = E.n(a.net_profit_pct);
    var saved = h('span', { class: 'eco-saved', role: 'status' });
    var pick = null;
    if (canSet) {
      var opts = [];
      for (var i = 10; i <= 25; i++) opts.push([String(i / 100), i + '%']);
      // a rate typed in the Sheet that isn't a whole percent stays visible
      if (cur != null && !opts.some(function (o) { return Number(o[0]) === cur; })) opts.push([String(cur), E.pct(cur)]);
      pick = A.select(opts, cur == null ? '' : String(cur), { 'aria-label': 'Net profit' });
      pick.addEventListener('change', function () {
        var v = Number(pick.value), before = cur;
        pick.disabled = true; saved.textContent = 'Saving to the Sheet…'; saved.classList.remove('is-err');
        var undo = function (t) { pick.disabled = false; pick.value = before == null ? '' : String(before); saved.textContent = t; saved.classList.add('is-err'); };
        E.sheetWrite('rab_meta', { project_id: p.id, set: { net_profit_pct: v }, expect: { net_profit_pct: before } }).then(function (r) {
          if (r.status === 202) { pick.disabled = false; saved.textContent = E.writeText(r); return; }
          if (r.status !== 200) return undo(E.writeText(r));
          pick.disabled = false; cur = v; saved.textContent = 'Saved to the Sheet';
          // the Sheet's answer carries the tab as it reads now, with the split worked out again
          var rab = r.body.record && r.body.record.rab && r.body.record.rab.data;
          if (rab && rab.internal && rab.internal.alloc) paint(rab.internal.alloc);
          E.forget();
        }, function (e) { undo(E.ecoError(e)); });
      });
    }
    function paint(x) {
      var row = function (label, pc, amt, cls) {
        var v = E.n(amt);
        return h('tr', { class: cls || null }, h('td', { text: label }), h('td', { class: 'num pc' }, pc),
          h('td', { class: 'num' + (v < 0 ? ' neg' : '') }, E.num(v)));
      };
      var pc = function (v) { return E.n(v) == null ? '' : E.pct(v); };
      tb.innerHTML = ''; ft.innerHTML = '';
      A.add(tb, [row('Project price (Omset)', pc(x.price_pct), x.price), row('PR fee', pc(x.pr_pct), x.pr),
        row('Internal fee', pc(x.internal_pct), x.internal), row('After fees', pc(x.shared_pct), x.shared, 'is-sub'),
        row('Net profit', pick || pc(x.net_profit_pct), x.net_profit), row('Kas CCC', pc(x.kas_pct), x.kas),
        row('Production budget', pc(x.budget_pct), x.budget, 'is-total')]);
      A.add(ft, [row('Production cost in the RAB', '', x.production_cost), row('Left in the budget', '', x.left)]);
    }
    paint(a);
    return E.section('Allocation', 'RAB internal summary',
      h('table', { class: 'eco-table eco-alloc' }, E.thead(['Split of the project price', ['%', 'num'], ['Rp', 'num']]), tb, ft),
      canSet ? h('p', { class: 'eco-note' }, 'Net profit can be 10% to 25%. Changing it saves to the RAB tab in the Sheet.', saved) : null);
  }

  function show(d, keep) {
    var p = d.p, m = d.m, money = A.canMoney(), ph = E.phase(p), vals = d.values.v || {}, brief = p.sheet_state === 'none';
    var rab = m && m.rab && typeof m.rab === 'object' ? m.rab : null, meta = (rab && rab.meta) || {};
    var url = p.sheet_state === 'present' ? E.sheetUrl(vals, p.sheet_gid) : null, drive = A.safeUrl(p.drive_folder_url);
    var edit = A.canEdit() && p.sheet_state !== 'removed';
    // what goes to the Sheet: Sheet writes on, the project's tab there, and never an old RAB (001 to 009)
    var on = E.writesOn(vals), write = edit && on && p.sheet_state === 'present' && !E.frozen(p), writeMoney = write && money;
    var why = !edit || p.sheet_state !== 'present' ? null : E.frozen(p) ? 'An old RAB (001 to 009): change it in the Sheet.'
      : !on ? 'Sheet writes are paused, so this is read only for now.' : null;
    var kasRows = (d.kas.v || []).filter(function (k) { return k.project_id === p.id || (p.tab_name && k.project_tab === p.tab_name); });
    var step = E.nextStep(p, m, E.stepContext(d.docs.v, d.kas.v, d.port.v)(p));
    var inputs = {}, forms = [];

    // header and the next step
    var top = [
      h('h2', { text: (brief ? p.plan_title : p.title || p.tab_name) || 'Project' }),
      h('p', { class: 'lead-line eco-lead' }, h('span', { text: [E.short(p), p.invoice_no].filter(Boolean).join(' \u00b7 ') }), E.pill(ph),
        p.layout === 'v1' ? E.quiet('Old layout') : null, p.sheet_state === 'removed' ? E.quiet('Removed from the Sheet') : null),
      url || drive ? h('div', { class: 'eco-top-actions' }, url ? newTab(url, 'Open RAB', 'btn ghost') : null, drive ? newTab(drive, 'Drive folder', 'btn ghost') : null) : null,
      h('p', { class: 'eco-from', text: brief ? 'A Brief: kept in the admin until its RAB is made in the Sheet.' : E.fromSheet(vals, p.rab_seen_at || p.sheet_seen_at) })
    ];

    // locking gear prices (the Sheet's own lock: each unlocked equipment price is fixed at what it is now)
    var lockSend = E.writer();
    function lockPrices(e) {
      var btn = e.currentTarget, k = p.unlocked_gear;
      A.ask('Lock ' + E.plural(k, 'gear price') + '?', 'Each equipment price in the RAB tab that isn\u2019t locked yet is fixed at its current price.', 'Lock prices').then(function (go) {
        if (!go) return;
        btn.disabled = true; btn.textContent = 'Locking\u2026';
        var back = function (t) { btn.disabled = false; btn.textContent = 'Lock prices'; A.toast(t, true); };
        lockSend('lock_prices', { project_id: p.id }).then(function (r) {
          if (r.status !== 200 && r.status !== 202) return back(E.writeText(r));
          var n = r.body.record && E.n(r.body.record.locked);
          saved(p.id, r, n != null ? 'Locked ' + E.plural(n, 'gear price') + ' in the Sheet.' : 'Prices locked in the Sheet.');
        }, function (err) { back(E.ecoError(err)); });
      });
    }
    var canLock = write && p.layout === 'v2' && p.unlocked_gear > 0;
    var stepBtn = step === 'Set the shoot date' && edit ? h('button', { class: 'eco-btn is-primary', type: 'button', onclick: function () { inputs.shoot_date.focus(); } }, 'Set date')
      : canLock && /gear price/.test(step) ? h('button', { class: 'eco-btn is-primary', type: 'button', onclick: lockPrices }, 'Lock prices')
      : step === 'Make the RAB' && edit && on && !p.archived_at ? h('button', { class: 'eco-btn is-primary', type: 'button', onclick: function () { if (inputs.code) inputs.code.focus(); } }, 'Make the RAB')
      : url && /RAB|gear|Shoot on/.test(step) ? newTab(url, 'Open RAB', 'eco-btn is-primary') : null;
    var next = h('div', { class: 'eco-next' }, h('span', { class: 't' }, h('span', { class: 'k', text: 'Next step' }), h('span', { class: 's', text: step })), stepBtn);

    // the status: picked here, asked once, written to Rekap Project
    var status = null;
    if (brief) status = E.section('Status', null, blank('A Brief: there is no RAB for it in the Sheet yet.'));
    else {
      var OPTS = [['Draft', 'Draft'], ['Dikirim', 'Dikirim'], ['Deal', 'Deal'], ['Lunas', 'Lunas'], ['Batal', 'Batal']];
      var statusSend = E.writer(), statusNote = h('span', { class: 'eco-saved', role: 'status' });
      var statusBox = E.seg(write || ph === 'Batal' ? OPTS : OPTS.slice(0, 4), ph, write ? function (v) {
        if (v === ph) return;
        var batal = v === 'Batal';
        A.ask(batal ? 'Mark this project Batal?' : 'Change the status to ' + v + '?',
          'Rekap Project in the Sheet goes from ' + (ph || 'empty') + ' to ' + v + '.' + (batal ? ' Nothing is deleted, and it can be changed back.' : ''),
          batal ? 'Mark Batal' : 'Change to ' + v, batal).then(function (go) {
          if (!go) return press(statusBox, ph);
          lockSeg(statusBox, true); statusNote.textContent = 'Saving to the Sheet\u2026'; statusNote.classList.remove('is-err');
          var back = function (t) { lockSeg(statusBox, false); press(statusBox, ph); statusNote.textContent = t; statusNote.classList.add('is-err'); };
          statusSend('project_set', { project_id: p.id, set: { status: v }, expect: { status: p.status } }).then(function (r) {
            if (r.status === 200 || r.status === 202) return saved(p.id, r, 'Status saved to the Sheet: ' + v + '.');
            back(E.writeText(r));
          }, function (e) { back(E.ecoError(e)); });
        });
      } : null, { 'aria-label': 'Status' });
      status = E.section('Status', 'Rekap Project', h('div', {}, statusBox, statusNote),
        h('p', { class: 'eco-note', text: write ? 'A new status is written to Rekap Project in the Sheet.' : why || 'The status follows Rekap Project in the Sheet.' }));
    }

    // dates: the Sheet's are read only, the plan dates save as they change
    var rs = money && vals.rekap_summary ? vals.rekap_summary.value : null, tempo = rs ? E.n(rs.tempo_days) : null;
    var LABEL = { shoot_date: 'Shoot starts', shoot_end: 'Shoot ends', deliver_by: 'Deliver by' };
    var dateField = function (field) {
      if (!edit) return p[field] ? E.day(p[field]) : E.quiet('Not set');
      var note = h('span', { class: 'eco-saved', role: 'status' });
      var input = h('input', { type: 'date', value: p[field] || '', 'aria-label': LABEL[field] });
      input.addEventListener('change', function () { save(p, field, input.value || null, input, note); });
      inputs[field] = input;
      return [input, note];
    };
    // the day the final files went out: Rekap Project, written once the typed date is whole (a date field reports
    // every finished part while typing, and a year like 0202 must never reach the Sheet)
    var delivered = function () {
      if (!write) return p.final_file_date ? E.day(p.final_file_date) : E.quiet('Not yet');
      var note = h('span', { class: 'eco-saved', role: 'status' }), send = E.writer(), wait = null;
      var input = h('input', { type: 'date', value: p.final_file_date || '', 'aria-label': 'Files delivered' });
      var back = function (t) { input.disabled = false; input.value = p.final_file_date || ''; note.textContent = t; note.classList.add('is-err'); };
      var go = function () {
        clearTimeout(wait); wait = null;
        var v = input.value || null;
        if (v === (p.final_file_date || null) || (v && !/^20\d\d-\d\d-\d\d$/.test(v))) return;
        input.disabled = true; note.textContent = 'Saving to the Sheet…'; note.classList.remove('is-err');
        send('project_set', { project_id: p.id, set: { final_file_date: v }, expect: { final_file_date: p.final_file_date } }).then(function (r) {
          if (r.status === 200 || r.status === 202) return saved(p.id, r, v ? 'Files delivered on ' + E.day(v) + ', saved to the Sheet.' : 'Delivery date cleared in the Sheet.');
          back(E.writeText(r));
        }, function (e) { back(E.ecoError(e)); });
      };
      input.addEventListener('change', function () { clearTimeout(wait); wait = setTimeout(go, 1200); });
      input.addEventListener('blur', function () { if (wait) go(); });
      inputs.final_file_date = input;
      return [input, note];
    };
    var dates = E.section('Dates', null, E.kv([
      brief ? null : ['Quote date', p.quote_date ? E.day(p.quote_date) : E.quiet('Not set')],
      ['Shoot starts', dateField('shoot_date')], ['Shoot ends', dateField('shoot_end')], ['Deliver by', dateField('deliver_by')],
      brief ? null : ['Files delivered', delivered()],
      brief ? null : ['Payment due', p.payment_due ? E.day(p.payment_due) : E.quiet(tempo != null ? E.plural(tempo, 'day') + ' after the files are delivered' : 'Not set')]
    ]), edit ? h('p', { class: 'eco-note', text: write ? 'Shoot and deliver dates are kept in the admin; Files delivered is written to Rekap Project in the Sheet. They save as you change them.'
      : 'Shoot and deliver dates are kept in the admin and save as you change them. The other dates come from the Sheet.' }) : null);

    // money (owners and people with money access)
    var pays = null, costs = null, split = null, cash = null;
    if (money && !brief) {
      if (d.mErr || !m) {
        pays = E.section('Invoice and payments', null, d.mErr ? oops(d.mErr) : blank('No figures for this project in the Sheet yet.'));
      } else {
        var paid = function (amt, dt) { return E.n(amt) > 0 ? E.rp(amt) + (dt ? ' on ' + E.day(dt) : '') : E.quiet('Not yet'); };
        var payNote = { Draft: 'Nothing to collect while the quote is a Draft.', Dikirim: 'Nothing to collect until the client agrees (Deal).', Batal: 'Cancelled: nothing to collect.' }[ph];
        // what came in, typed here and written to Rekap Project (Deal and Lunas only: before that nothing is billed)
        var payForm = null;
        if (writeMoney && (ph === 'Deal' || ph === 'Lunas')) {
          var pf = E.sheetForm({ label: 'Save payments', op: 'project_set',
            args: function (set, expect) { return { project_id: p.id, set: set, expect: expect }; },
            check: function (set) { return ['dp_received', 'final_received'].some(function (k) { return set[k] > 1e12; }) ? 'That amount is too large.' : ''; },
            done: function (r) { saved(p.id, r, 'Payments saved to the Sheet.'); } });
          forms.push(pf);
          payForm = h('div', { class: 'eco-form' }, h('div', { class: 'adm-controls' },
            field('DP received (Rp)', pf.field('dp_received', E.amountInput(m.dp_received, 'DP received'), m.dp_received, E.amount)),
            field('DP date', pf.field('dp_date', h('input', { type: 'date', value: E.isoDay(m.dp_date) }), m.dp_date, E.dayOf)),
            field('Pelunasan received (Rp)', pf.field('final_received', E.amountInput(m.final_received, 'Pelunasan received'), m.final_received, E.amount)),
            field('Pelunasan date', pf.field('final_date', h('input', { type: 'date', value: E.isoDay(m.final_date) }), m.final_date, E.dayOf))), pf.bar);
        }
        pays = E.section('Invoice and payments', 'Rekap Project',
          h('div', { class: 'eco-figs' }, E.money('Grand total', m.grand_total), E.money('DP' + (E.n(m.dp_pct) != null ? ' ' + E.pct(m.dp_pct) : ''), m.dp_amount),
            E.money('Pelunasan', m.final_amount), E.money('Received', m.paid_total)),
          E.kv([payForm ? null : ['DP received', paid(m.dp_received, m.dp_date)], payForm ? null : ['Pelunasan received', paid(m.final_received, m.final_date)],
            ['Outstanding', m.outstanding != null ? E.rp(m.outstanding) : E.quiet(ph === 'Deal' || ph === 'Lunas' ? 'Not in the Sheet' : 'Not billed yet')],
            ['Pay status', m.pay_status === 'Telat' || m.pay_status === 'Lunas' ? E.pill(m.pay_status) : m.pay_status]]),
          payForm, payNote ? h('p', { class: 'eco-note', text: payNote }) : null);

        var cats = Array.isArray(m.categories) ? m.categories : [];
        var sum = function (k) { var any = false, t = 0; cats.forEach(function (c) { var v = E.n(c[k]); if (v != null) { any = true; t += v; } }); return any ? t : null; };
        var unbilled = cats.filter(function (c) { return !(E.n(c.total) > 0) && E.n(c.estimate) > 0; });
        var gap = unbilled.reduce(function (t, c) { return t + E.n(c.estimate); }, 0);
        // the actual costs are typed here when the RAB can be written to (the ten categories of the v2 summary)
        var act = writeMoney && p.layout === 'v2' && rab && cats.length === 10
          ? E.rabActuals({ p: p, rab: rab, cats: cats, forms: forms, saved: function (r, t) { saved(p.id, r, t); } }) : null;
        var catTable = act ? act.table : cats.length ? h('table', { class: 'eco-table' }, E.thead(['Category', ['Billed', 'num'], ['Estimate', 'num'], ['Actual', 'num hide-s']]),
          h('tbody', {}, cats.map(function (c) {
            var billed = E.n(c.total), est = E.n(c.estimate);
            return h('tr', { class: billed || est || E.n(c.actual) ? null : 'is-zero' }, h('td', { text: c.label || '' }),
              h('td', { class: 'num' + (billed ? '' : ' muted') }, E.num(c.total)),
              h('td', { class: 'num' + (est > 0 && !(billed > 0) ? ' neg' : '') }, E.num(c.estimate)),
              h('td', { class: 'num hide-s' }, E.num(c.actual)));
          })),
          h('tfoot', {}, h('tr', {}, h('td', { text: 'Total' }), h('td', { class: 'num' }, E.num(sum('total'))), h('td', { class: 'num' }, E.num(sum('estimate'))),
            h('td', { class: 'num hide-s' }, E.num(sum('actual'))))))
          : blank(p.layout === 'v1' ? 'This RAB uses the old layout, so its cost breakdown is only in the Sheet.' : 'The cost breakdown of this RAB isn\u2019t in the admin yet.');
        costs = E.section('Costs and profit', rab ? 'RAB internal summary' : 'Rekap Project',
          h('div', { class: 'eco-figs' }, E.money('Omset', m.revenue), E.money('Cost', m.cost), E.money('Profit', m.profit), E.money('Margin', m.margin, { fmt: E.pct })),
          catTable, act ? act.bar : null,
          unbilled.length ? h('p', { class: 'eco-note' }, h('span', { class: 'eco-warn', text: unbilled.map(function (c) { return c.label + ' costs ' + E.rp(c.estimate); }).join(', ')
            + (unbilled.length === 1 ? ' but isn\u2019t' : ' but aren\u2019t') + ' billed to the client.' }),
            E.n(m.profit) < 0 && gap >= -E.n(m.profit) ? ' That\u2019s where the loss comes from.' : '') : null,
          m.cost_override != null ? h('p', { class: 'eco-note', text: 'The cost is set by hand in Rekap Project (' + E.rp(m.cost_override) + '), so the Sheet uses it instead of the RAB.' }) : null);
        var al = rab && rab.internal && rab.internal.alloc;
        if (al && typeof al === 'object') split = allocation(p, al, write);
      }
      cash = E.section('Cash entries', 'Kas', d.kas.e ? oops(d.kas.e) : !kasRows.length ? blank('No cash entries for this project yet.')
        : h('table', { class: 'eco-table' }, E.thead(['Date', 'Kategori', ['Keterangan', 'hide-s'], 'To or from', ['Nominal', 'num'], 'Status']),
          h('tbody', {}, kasRows.map(function (k) {
            return h('tr', {}, h('td', { text: E.day(k.entry_date, { year: false }) }), h('td', { text: k.category || '' }), h('td', { class: 'hide-s', text: k.description || '' }),
              h('td', { text: k.counterparty || '' }), h('td', { class: 'num' }, k.amount == null ? '' : (k.kind === 'Keluar' ? '\u2212' : '') + E.num(k.amount)),
              h('td', { class: k.paid === 'Belum' ? null : 'muted', text: k.paid || '' }));
          }))));
    }

    // crew: names for everyone, fees and payments with money access
    var crew = null, lines = m && Array.isArray(m.crew_lines) ? m.crew_lines : [];
    if (money && m && !brief) {
      var paidTo = {};
      kasRows.forEach(function (k) {
        var who = E.words(k.counterparty).trim();
        if (k.kind === 'Keluar' && who && k.paid === 'Sudah') paidTo[who] = (paidTo[who] || 0) + (E.n(k.amount) || 0);
      });
      var heads = lines.reduce(function (t, l) { return t + (E.n(l.qty) || 1); }, 0);
      crew = E.section('Crew', lines.length ? E.plural(heads, 'person', 'people') + ' in the RAB' : null,
        !lines.length ? blank(rab ? 'No crew lines in the RAB yet.' : 'The crew lines of this RAB aren\u2019t in the admin yet.')
        : h('table', { class: 'eco-table' }, E.thead(['Role', 'Person', ['Fee', 'num'], ['Paid', 'hide-s']]),
          h('tbody', {}, lines.map(function (l) {
            var out = l.person ? paidTo[E.words(l.person).trim()] || 0 : 0, fee = E.n(l.total) || 0;
            var state = d.kas.e ? E.quiet('Couldn\u2019t check') : out > 0 && out >= fee ? 'Sudah' : out > 0 ? 'Partly, ' + E.rp(out) : E.quiet('Belum');
            return h('tr', {}, h('td', { text: l.desc || '' }), h('td', {}, l.person || E.quiet('No name yet')), h('td', { class: 'num' }, E.num(l.total)), h('td', { class: 'hide-s' }, state));
          }))));
    } else if (!brief) {
      crew = E.section('Crew', null, (p.crew_names || []).length ? h('p', { class: 'adm-text', text: p.crew_names.join(', ') }) : blank('No names in the RAB yet.'));
    }

    // documents, and what still blocks the next PDF
    var mine = (d.docs.v || []).filter(function (x) { return x.project_id === p.id; });
    var holders = Object.keys(meta).map(function (k) { return typeof meta[k] === 'string' ? meta[k].trim() : ''; }).filter(function (v) { return /^\[.+\]$/.test(v); });
    var before = [];
    if (holders.length) before.push(holders.join(', ') + (holders.length === 1 ? ' is still a placeholder' : ' are still placeholders'));
    if (p.unlocked_gear > 0) before.push(E.plural(p.unlocked_gear, 'gear price') + (p.unlocked_gear === 1 ? ' isn\u2019t' : ' aren\u2019t') + ' locked');
    // a PDF of the RAB tab, made by the Sheet into the client's Drive folder; it asks before locking prices or
    // keeping [placeholder] text, the same two checks the Sheet's own export makes
    var pdfRow = null;
    if (writeMoney) {
      var pdfType = A.select(DOC_TYPES, docType(meta.doc_type || p.doc_type) || 'PENAWARAN', { 'aria-label': 'Document type' });
      var pdfNote = h('span', { class: 'eco-saved', role: 'status' }), pdfSend = E.writer();
      var pdfBtn = h('button', { class: 'eco-btn is-primary', type: 'button', onclick: function () {
        var ok = { lock: false, accept_placeholders: false };
        var say = function (t, err) { pdfNote.textContent = t || ''; pdfNote.classList.toggle('is-err', !!err); };
        var stop = function (t, err) { pdfBtn.disabled = false; pdfType.disabled = false; say(t, err); };
        pdfBtn.disabled = true; pdfType.disabled = true;
        (function go() {
          say('Making the PDF in the Sheet\u2026');
          pdfSend('export_pdf', { project_id: p.id, doc_type: pdfType.value, lock: ok.lock, accept_placeholders: ok.accept_placeholders }).then(function (r) {
            if (r.status === 200 || r.status === 202) {
              var f = r.body.record && r.body.record.file;
              return saved(p.id, r, f && f.name ? 'PDF saved to Drive: ' + f.name : 'PDF saved to Drive.');
            }
            if (!(r.status === 409 && r.body.needs_confirm)) return stop(E.writeText(r), true);
            var det = r.body.detail || {}, k = E.n(det.unlocked);
            var q = k ? ['Lock the gear prices?', E.plural(k, 'equipment price') + (k === 1 ? ' isn\u2019t' : ' aren\u2019t') + ' locked yet. Lock at the current prices, then make the PDF?', 'Lock and make PDF', 'lock']
              : ['Make the PDF with placeholders?', 'The top of the document still has [placeholder] text'
                + (Array.isArray(det.placeholders) && det.placeholders.length ? ' in ' + det.placeholders.slice(0, 8).join(', ') : '') + '. Make the PDF anyway?', 'Make PDF anyway', 'accept_placeholders'];
            // the refused attempt is cleared first, so it doesn't wait in the Sheet's list
            E.sheetWrite('outbox_discard', { op_id: r.op_id }).catch(function () {}).then(function () { return A.ask(q[0], q[1], q[2]); }).then(function (yes) {
              if (!yes) return stop('');
              ok[q[3]] = true; go();
            });
          }, function (e) { stop(E.ecoError(e), true); });
        })();
      } }, 'Make PDF');
      pdfRow = h('div', { class: 'eco-row' }, pdfType, pdfBtn, pdfNote);
    }
    var docs = brief ? null : E.section('Documents', null,
      d.docs.e ? oops(d.docs.e) : !mine.length ? blank('No PDFs for this project yet.')
        : h('ul', { class: 'eco-list' }, mine.map(function (x) {
          return h('li', {}, h('span', { class: 't' }, E.ext(x.url, x.doc_no || x.title), h('span', { class: 'sub', text: (DOC[x.kind] || x.kind) + ' \u00b7 ' + A.date(x.created_at) })));
        })),
      before.length && (ph === 'Draft' || ph === 'Deal') ? h('p', { class: 'eco-note', text: 'Before the ' + (ph === 'Draft' ? 'quote' : 'invoice') + ' PDF: ' + before.join(', and ') + '.' }) : null,
      pdfRow);

    // the RAB header and its lines (money)
    var quote = null, budget = null;
    if (money && m && !brief) {
      var pc = function (v) { return v == null ? '0%' : E.pct(v); };
      if (rab && rab.meta && writeMoney && p.layout === 'v2') {
        // the RAB header and its percentages, written to the RAB tab (the Sheet works out the totals again)
        var qf = E.sheetForm({ label: 'Save quote settings', op: 'rab_meta',
          args: function (set, expect) { return { project_id: p.id, set: set, expect: expect }; },
          check: function (set) {
            if ('doc_type' in set && !set.doc_type) return 'Pick the document type.';
            if ('title' in set && !set.title) return 'The title can’t be empty.';
            if ('client_label' in set && !set.client_label) return 'The client on the invoice can’t be empty.';
            if ('quote_date' in set && !set.quote_date) return 'The quote date can’t be empty: the invoice number is made from it.';
            var badPct = ['discount_pct', 'ppn_pct', 'dp_pct', 'pph23_pct'].some(function (k) { return k in set && set[k] !== null && !(set[k] >= 0 && set[k] <= 1); });
            return badPct ? 'Type percentages as numbers from 0 to 100, like 11 or 2,5.' : '';
          },
          done: function (r) { saved(p.id, r, 'Quote settings saved to the Sheet.'); } });
        forms.push(qf);
        var text = function (key, label, max, cls, hint) {
          return field(label, qf.field(key, h('input', { type: 'text', maxlength: max || 200, autocomplete: 'off', placeholder: hint || '', value: meta[key] == null ? '' : String(meta[key]) }), meta[key]), cls);
        };
        var pcField = function (key, label) { return field(label, qf.field(key, E.shareInput(m[key], label), m[key], E.share)); };
        var types = docType(meta.doc_type) ? DOC_TYPES : [['', 'Not set']].concat(DOC_TYPES);
        quote = E.section('Quote settings', 'RAB header', h('div', { class: 'eco-form' }, h('div', { class: 'adm-controls' },
          field('Document type', qf.field('doc_type', A.select(types, docType(meta.doc_type)), meta.doc_type)),
          field('Quote date', qf.field('quote_date', h('input', { type: 'date', value: E.isoDay(meta.quote_date) }), meta.quote_date, E.dayOf)),
          text('title', 'Title', 200, 'wide'), text('client_label', 'Client on the invoice'), text('product', 'Product'),
          text('photographer', 'Photographer'), text('location', 'Location'),
          text('locations', 'Number of locations', 200, null, '1'), text('shooting_days', 'Shooting days', 200, null, '1'),
          text('usage', 'Usage'), text('language', 'Language'),
          pcField('discount_pct', 'Diskon (%)'), pcField('ppn_pct', 'PPN (%)'), pcField('dp_pct', 'DP (%)'), pcField('pph23_pct', 'PPh 23 (%)')), qf.bar),
          holders.length ? h('p', { class: 'eco-note', text: 'Text in [brackets] is a placeholder from the template. Replace it before the PDF goes to the client.' }) : null);
      } else if (rab && rab.meta) {
        quote = E.section('Quote settings', 'RAB header', E.kv([
          ['Document type', meta.doc_type || p.doc_type], ['Title', meta.title], ['Client on the invoice', meta.client_label], ['Product', meta.product],
          ['Photographer', meta.photographer ? (holders.indexOf(String(meta.photographer).trim()) > -1 ? E.quiet(meta.photographer) : meta.photographer) : null],
          ['Locations \u00b7 days', [E.n(meta.locations) != null ? E.plural(E.n(meta.locations), 'location') : null,
            E.n(meta.shooting_days) != null ? E.plural(E.n(meta.shooting_days), 'shooting day') : null].filter(Boolean).join(' \u00b7 ')],
          ['Location', meta.location], ['Usage \u00b7 language', [meta.usage, meta.language].filter(Boolean).join(' \u00b7 ')],
          ['Diskon \u00b7 PPN \u00b7 DP \u00b7 PPh 23', [m.discount_pct, m.ppn_pct, m.dp_pct, m.pph23_pct].map(pc).join(' \u00b7 ')]
        ]));
      }
      if (rab && Array.isArray(rab.sections) && writeMoney && p.layout === 'v2') {
        // line by line: change, add and remove lines in the RAB tab (rab.js)
        budget = E.rabBudget({ p: p, rab: rab, link: url ? newTab(url, 'Open RAB') : null, forms: forms,
          saved: function (r, t) { saved(p.id, r, t); }, refresh: function (t) { reread(p, t); } });
      } else if (rab && Array.isArray(rab.sections)) {
        var tb = h('tbody');
        var group = function (t) { tb.appendChild(h('tr', {}, h('td', { class: 'eco-group', colspan: 3, text: t }))); };
        var line = function (desc, sub, qd, total, quietDesc) {
          tb.appendChild(h('tr', {}, h('td', { class: quietDesc ? 'muted' : null }, desc, sub ? h('span', { class: 'sub', text: sub }) : null),
            h('td', { class: 'num hide-s' }, qd), h('td', { class: 'num' }, total)));
        };
        var qd = function (l) {
          var q = E.n(l.qty), dd = E.n(l.days);
          return q != null && dd != null ? E.num(q) + ' \u00d7 ' + E.num(dd) : q != null ? E.num(q) : dd != null ? E.plural(dd, 'day') : '';
        };
        rab.sections.forEach(function (s) {
          var ls = Array.isArray(s.lines) ? s.lines : [];
          if (!ls.length) return;
          if (s.key === 'crew') {
            group(SECTION.crew + ' \u00b7 ' + E.plural(ls.reduce(function (t, l) { return t + (E.n(l.qty) || 1); }, 0), 'person', 'people'));
            line(ls.map(function (l) { return l.desc; }).filter(Boolean).join(', ') || 'No roles named', null, '', E.num(s.subtotal));
            return;
          }
          group(SECTION[s.key] || s.title || '');
          ls.forEach(function (l) { line(l.desc || 'No description', l.person || null, qd(l), E.num(l.total), !l.desc); });
        });
        var eq = rab.equipment && typeof rab.equipment === 'object' ? rab.equipment : null;
        var gearLines = eq && Array.isArray(eq.groups) ? [].concat.apply([], eq.groups.map(function (g) { return Array.isArray(g.lines) ? g.lines : []; })) : [];
        if (gearLines.length) {
          group('Equipment' + (p.unlocked_gear > 0 ? ' \u00b7 ' + E.plural(p.unlocked_gear, 'price') + ' not locked' : ''));
          gearLines.forEach(function (l) {
            line(l.desc || l.item || 'No description', [l.vendor, l.price_date ? E.day(l.price_date, { year: false }) : null].filter(Boolean).join(' \u00b7 ') || null, qd(l), E.num(l.total), !(l.desc || l.item));
          });
          if (E.n(eq.ppn_bsm) > 0) line('Subtotal ' + E.num(eq.subtotal) + ' \u00b7 PPN BSM ' + E.num(eq.ppn_bsm), null, '', E.num(eq.total), true);
        }
        budget = E.section('Budget', ['Line items: edit in the Sheet', url ? [' \u00b7 ', newTab(url, 'Open RAB')] : null],
          tb.children.length ? h('table', { class: 'eco-table' }, E.thead(['Item', ['Qty \u00d7 days', 'num hide-s'], ['Total', 'num']]), tb) : blank('The RAB has no lines yet.'));
      } else {
        budget = E.section('Budget', null, blank(p.layout === 'v1' ? 'This RAB uses the old layout. See its lines in the Sheet.' : 'The lines of this RAB aren\u2019t in the admin yet.'));
      }
    }

    // notes and links
    var noteBox = null, noteNote = h('span', { class: 'eco-saved', role: 'status' }), sent = (p.notes || '').trim() || null;
    if (edit) {
      noteBox = h('textarea', { value: p.notes || '', maxlength: 4000, placeholder: 'Notes for the team', 'aria-label': 'Notes' });
      noteBox.addEventListener('change', function () {
        var before = sent;
        sent = noteBox.value.trim() || null;
        save(p, 'notes', sent, noteBox, noteNote, function () { sent = before; });
      });
    }
    var sheetNote = p.note_text && p.note_text.trim() !== 'Folder project' ? p.note_text : null;
    var cid = p.client_id || p.plan_client_id, items = (d.port.v || []).filter(function (it) { return it.project_id === p.id; });
    var leadRow = d.lead.e ? E.quiet('Couldn\u2019t load') : d.lead.v[0] ? h('a', { href: '#leads/' + d.lead.v[0].id, text: d.lead.v[0].name }) : null;
    var notes = E.section('Notes and links', null,
      edit ? h('div', { class: 'eco-form' }, noteBox, h('p', {}, noteNote)) : p.notes ? h('p', { class: 'adm-text', text: p.notes }) : blank('No notes.'),
      E.kv([
        ['Note in the Sheet', sheetNote ? h('span', { class: 'adm-text', text: sheetNote }) : null],
        ['Client', cid ? h('a', { href: '#clients/' + cid, text: p.client_label || (p.plan_client && p.plan_client.name) || 'Open the client' }) : null],
        ['Lead', leadRow],
        ['Portfolio', d.port.e ? E.quiet('Couldn\u2019t check') : items.length
          ? items.map(function (it, i) { return [i ? ', ' : '', h('a', { href: '#portfolio/' + it.id, text: it.title + ' (' + it.status + ')' })]; })
          : E.quiet(p.portfolio_skip ? 'Not for the portfolio' : 'Not in the portfolio')]
      ]));

    // history: where it came from, then every recorded change
    var told = function (v) {
      if (v == null || v === '') return 'empty';
      if (typeof v === 'number') return E.num(v);
      if (typeof v === 'string') return /^\d{4}-\d{2}-\d{2}$/.test(v) ? E.day(v) : '\u201c' + E.clip(v, 60) + '\u201d';
      return E.clip(JSON.stringify(v), 60);
    };
    var hist = [{ at: p.created_at, text: p.origin === 'sheet' ? 'Came in from the Sheet' : 'Added in the admin', sub: p.origin === 'sheet' && p.sheet_row ? 'Rekap Project row ' + p.sheet_row : null }];
    (d.changes.v || []).forEach(function (c) {
      hist.push({ at: c.at, text: (FIELD[c.field] || c.field.replace(/_/g, ' ')) + ': ' + told(c.old_value) + ' to ' + told(c.new_value), sub: c.source === 'sheet' ? 'In the Sheet' : c.actor_email });
    });
    (d.acts.v || []).forEach(function (a) { if (a.action !== 'created') hist.push({ at: a.at, text: (a.actor_email || 'Someone') + ' ' + a.action + ' this project', sub: a.source === 'sheet' ? 'In the Sheet' : null }); });
    hist.sort(function (a, b) { return new Date(b.at) - new Date(a.at); });
    var history = E.section('History', null, h('ul', { class: 'eco-list' }, hist.map(function (it) {
      return h('li', {}, h('span', { class: 't' }, it.text, it.sub ? h('span', { class: 'sub', text: it.sub }) : null), h('span', { class: 'w', text: E.shortStamp(it.at), title: E.stamp(it.at) }));
    })), d.changes.e || d.acts.e ? h('p', { class: 'eco-err', text: 'Part of the history couldn\u2019t be loaded. Reload to try again.' }) : null);

    var bar = url ? h('div', { class: 'eco-actionbar' }, h('span', { class: 's', text: [ph, money && m && m.grand_total != null ? E.rp(m.grand_total) : null].filter(Boolean).join(' \u00b7 ') }),
      newTab(url, 'Open RAB', 'btn')) : null;

    // a Brief becomes a RAB in the Sheet: a new tab from the template, its Rekap Project row, and the client if it's new
    var make = brief && edit && !p.archived_at ? (on ? makeRab(p, d.clients, inputs) : E.section('Make the RAB', null, blank('Sheet writes are paused, so the RAB can\u2019t be made from here yet.'))) : null;

    E.drawer('projects', p.id, top.concat([next, make || status, dates, pays, costs, split, cash, crew, docs, quote, budget, notes, history, bar]), keep);
    A.guard(function () {
      return (!!noteBox && (noteBox.value.trim() || null) !== sent) || forms.some(function (f) { return f.dirty(); });
    });
  }

  // the client code picks the client in the Client tab; a code that isn't there yet adds the client with the RAB
  function makeRab(p, cl, inputs) {
    var list = cl.v || [], pc = p.plan_client && typeof p.plan_client === 'object' ? p.plan_client : {};
    var known = p.plan_client_id ? list.filter(function (c) { return c.id === p.plan_client_id; })[0] : null;
    var input = function (max, ph, v, label) { return h('input', { type: 'text', maxlength: max, autocomplete: 'off', placeholder: ph || '', value: v || '', 'aria-label': label || null }); };
    var f = {
      code: input(5, 'HOMI', (known && known.code) || pc.code || ''),
      project: input(80, 'Photoshoot Campaign', String(p.plan_title || '').slice(0, 80)),
      doc: A.select(DOC_TYPES, 'PENAWARAN'),
      name: input(200, 'Client name', known ? '' : pc.name), pic: input(200, '', known ? '' : pc.pic),
      phone: input(60, '', known ? '' : pc.phone), email: input(254, '', known ? '' : pc.email)
    };
    inputs.code = f.code;
    var byCode = function (code) { return list.filter(function (c) { return String(c.code || '').toUpperCase() === code && c.sheet_state !== 'missing'; })[0] || null; };
    var who = h('p', { class: 'eco-note wide' });
    var fresh = [field('Client name', f.name, 'wide'), field('PIC', f.pic), field('Phone', f.phone), field('Email', f.email, 'wide')];
    function refresh() {
      var code = f.code.value.trim().toUpperCase(), c = byCode(code), isNew = /^[A-Z]{2,5}$/.test(code) && !c;
      fresh.forEach(function (x) { x.hidden = !isNew; });
      who.textContent = c ? code + ' is ' + (c.name || code) + ' in the Client tab.' : isNew ? code + ' is a new client code: the client is added to the Client tab with the RAB.'
        : cl.e ? 'The client list couldn\u2019t be loaded, so a new code can\u2019t be checked. Reload to try again.' : 'Two to five capital letters, used in the invoice number.';
    }
    f.code.addEventListener('input', function () {
      var v = f.code.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 5);
      if (v !== f.code.value) f.code.value = v;
      refresh();
    });
    refresh();
    var send = E.writer(), msg = h('span', { class: 'eco-saved', role: 'status' });
    var say = function (t, err) { msg.textContent = t || ''; msg.classList.toggle('is-err', !!err); };
    var all = [f.code, f.project, f.doc, f.name, f.pic, f.phone, f.email];
    var btn = h('button', { class: 'eco-btn is-primary', type: 'button', onclick: function () {
      var code = f.code.value.trim().toUpperCase(), project = f.project.value.trim(), c = byCode(code), client = null;
      if (!/^[A-Z]{2,5}$/.test(code)) return say('The client code is 2 to 5 capital letters, like HOMI.', true);
      if (cl.e) return say('The client list couldn\u2019t be loaded. Reload to try again.', true);
      if (!project) return say('Give the project a short name.', true);
      if (!c) {
        if (!f.name.value.trim()) return say(code + ' is a new code: give the client a name.', true);
        client = { name: f.name.value.trim() };
        ['pic', 'phone', 'email'].forEach(function (k) { var v = f[k].value.trim(); if (v) client[k] = v; });
        if (client.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(client.email)) return say('Check the email address.', true);
      }
      A.ask('Make the RAB in the Sheet?', 'A new RAB tab for ' + (c ? c.name || code : client.name) + ' is added to the Sheet from the template, with its row in Rekap Project'
        + (client ? ' and ' + code + ' in the Client tab' : '') + '. It starts as a Draft.', 'Make the RAB').then(function (go) {
        if (!go) return;
        all.forEach(function (x) { x.disabled = true; }); btn.disabled = true; say('Making the RAB in the Sheet\u2026');
        var back = function (t) { all.forEach(function (x) { x.disabled = false; }); btn.disabled = false; say(t, true); };
        send('create_rab', { project_id: p.id, code: code, project: project, doc_type: f.doc.value, client: client }).then(function (r) {
          if (r.status !== 200 && r.status !== 202) return back(E.writeText(r));
          var tab = r.body.record && r.body.record.tab;
          saved(p.id, r, tab && tab.name ? 'RAB made in the Sheet: ' + tab.name + '.' : 'RAB made in the Sheet.');
        }, function (e) { back(E.ecoError(e)); });
      });
    } }, 'Make the RAB');
    return E.section('Make the RAB', 'In the Sheet', h('div', { class: 'eco-form' }, h('div', { class: 'adm-controls' },
      field('Client code', f.code), field('Document type', f.doc), who, fresh, field('Project name in the RAB', f.project, 'wide')),
      h('div', { class: 'eco-formbar' }, msg, btn)));
  }

  // ---------- a new project: a Brief in the admin, until its RAB is made in the Sheet ----------
  function newBrief() {
    if (!A.canEdit()) return;
    E.data.clients().then(briefForm, function () { briefForm(null); });
  }
  function briefForm(clients) {
    var opts = [['', 'Pick a client']].concat((clients || []).filter(function (c) { return c.sheet_state !== 'missing'; })
      .map(function (c) { return [c.id, (c.name || c.code) + ' \u00b7 ' + c.code]; }), [['new', 'A new client']]);
    var f = {
      title: h('input', { type: 'text', maxlength: 120, autocomplete: 'off', placeholder: 'Photoshoot Campaign' }),
      client: A.select(opts, clients ? '' : 'new'),
      cname: h('input', { type: 'text', maxlength: 200, autocomplete: 'off' }),
      shoot_date: h('input', { type: 'date' }), shoot_end: h('input', { type: 'date' }), deliver_by: h('input', { type: 'date' }),
      notes: h('textarea', { maxlength: 4000, placeholder: 'What the client asked for' })
    };
    var nameRow = field('Client name', f.cname, 'wide');
    var pick = function () { nameRow.hidden = f.client.value !== 'new'; };
    f.client.addEventListener('change', pick); pick();
    var msg = h('span', { class: 's', role: 'status' });
    var say = function (t, err) { msg.textContent = t || ''; msg.classList.toggle('neg', !!err); };
    var dirty = function () { return !!(f.title.value.trim() || f.cname.value.trim() || f.shoot_date.value || f.shoot_end.value || f.deliver_by.value || f.notes.value.trim()); };
    var btn = h('button', { class: 'btn', type: 'button', onclick: function () {
      var row = { plan_title: f.title.value.trim(), shoot_date: f.shoot_date.value || null, shoot_end: f.shoot_end.value || null,
        deliver_by: f.deliver_by.value || null, notes: f.notes.value.trim() || null };
      if (!row.plan_title) return say('Give the project a name.', true);
      if (!f.client.value) return say('Pick the client, or A new client.', true);
      if (f.client.value === 'new') {
        if (!f.cname.value.trim()) return say('Give the new client a name.', true);
        row.plan_client = { name: f.cname.value.trim() };
      } else {
        // the id links the Brief to the client; the name and code show it in lists before the RAB exists
        var c = (clients || []).filter(function (x) { return x.id === f.client.value; })[0];
        row.plan_client_id = f.client.value;
        if (c && c.name) row.plan_client = /^[A-Z]{2,5}$/.test(c.code || '') ? { name: c.name, code: c.code } : { name: c.name };
      }
      if (row.shoot_date && row.shoot_end && row.shoot_end < row.shoot_date) return say('The shoot can\u2019t end before it starts.', true);
      btn.disabled = true; say('Saving\u2026');
      sb.from('projects').insert(row).select('id').single().then(function (r) {
        if (r.error || !r.data) { btn.disabled = false; return say(r.error ? E.ecoError(r.error) : 'Your account isn\u2019t allowed to do this.', true); }
        A.guard(null); E.forget();
        if (ui && !panel.hidden) A.loaders.projects();
        A.toast('Brief saved. Make its RAB when the quote is ready.');
        open(r.data.id);
      }, function (e) { btn.disabled = false; say(E.ecoError(e), true); });
    } }, 'Save brief');
    E.drawer(null, null, [
      h('h2', { text: 'New project' }),
      h('p', { class: 'lead-line', text: 'Starts as a Brief in the admin. Its RAB is made in the Sheet from the Brief when the quote is ready.' }),
      h('div', { class: 'adm-sec eco-form' }, h('div', { class: 'adm-controls' },
        field('Project name', f.title, 'wide'), field('Client', f.client, 'wide'), nameRow,
        field('Shoot starts', f.shoot_date), field('Shoot ends', f.shoot_end), field('Deliver by', f.deliver_by),
        field('Notes', f.notes, 'wide'))),
      h('div', { class: 'eco-actionbar' }, msg, btn)
    ]);
    A.guard(dirty);
    f.title.focus();
  }
  A.actions.projects = function () {
    return A.canEdit() ? h('button', { class: 'btn', type: 'button', onclick: newBrief }, 'New project') : null;
  };
  A.openers.projects = open;
})();
