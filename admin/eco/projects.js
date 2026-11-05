/* Projects: every RAB in the Sheet (a Rekap Project row and its tab) and the Briefs not in the Sheet yet, sorted by
   what needs doing. The drawer shows one project end to end. In this version what the admin keeps itself (shoot and
   deliver dates, notes) changes here, and so does the net profit share of the split, which is written to the RAB tab;
   everything else from the Sheet is read only. */
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
  function open(id) {
    if (!E.isId(id)) return gone();
    var money = A.canMoney();
    Promise.all([
      sb.from('projects').select('*').eq('id', id).maybeSingle(),
      money ? sb.from('project_money').select('*').eq('project_id', id).maybeSingle() : Promise.resolve({ data: null }),
      E.settle(E.data.values()), E.settle(E.data.docs()), E.settle(E.data.kas()), E.settle(E.data.portfolio()),
      money ? E.settle(E.rows(sb.from('sync_changes').select('at, source, actor_email, field, old_value, new_value').eq('entity_id', id).order('at', { ascending: false }).limit(50)))
        : Promise.resolve({ v: [] }),
      E.settle(E.rows(sb.from('activity_log').select('at, actor_email, action, source').eq('entity', 'project').eq('entity_id', id).order('at', { ascending: false }).limit(20)))
    ]).then(function (r) {
      if (r[0].error) return E.failed(r[0].error);
      if (!r[0].data) return gone();
      var p = r[0].data, lead = A.canEdit() ? p.inquiry_id || p.manual_lead_id : null; // leads are for owners and admins
      (lead ? E.settle(E.rows(sb.from('lead_inbox').select('id, name, status').eq('id', lead))) : Promise.resolve({ v: [] })).then(function (lr) {
        show({ p: p, m: r[1].data || null, mErr: r[1].error || null, values: r[2], docs: r[3], kas: r[4], port: r[5], changes: r[6], acts: r[7], lead: lr });
      });
    }).catch(E.failed);
  }

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

  function show(d) {
    var p = d.p, m = d.m, money = A.canMoney(), ph = E.phase(p), vals = d.values.v || {}, brief = p.sheet_state === 'none';
    var rab = m && m.rab && typeof m.rab === 'object' ? m.rab : null, meta = (rab && rab.meta) || {};
    var url = p.sheet_state === 'present' ? E.sheetUrl(vals, p.sheet_gid) : null, drive = A.safeUrl(p.drive_folder_url);
    var edit = A.canEdit() && p.sheet_state !== 'removed';
    var kasRows = (d.kas.v || []).filter(function (k) { return k.project_id === p.id || (p.tab_name && k.project_tab === p.tab_name); });
    var step = E.nextStep(p, m, E.stepContext(d.docs.v, d.kas.v, d.port.v)(p));
    var inputs = {};

    // header and the next step
    var top = [
      h('h2', { text: (brief ? p.plan_title : p.title || p.tab_name) || 'Project' }),
      h('p', { class: 'lead-line eco-lead' }, h('span', { text: [E.short(p), p.invoice_no].filter(Boolean).join(' \u00b7 ') }), E.pill(ph),
        p.layout === 'v1' ? E.quiet('Old layout') : null, p.sheet_state === 'removed' ? E.quiet('Removed from the Sheet') : null),
      url || drive ? h('div', { class: 'eco-top-actions' }, url ? newTab(url, 'Open RAB', 'btn ghost') : null, drive ? newTab(drive, 'Drive folder', 'btn ghost') : null) : null,
      h('p', { class: 'eco-from', text: brief ? 'A Brief: kept in the admin until its RAB is made in the Sheet.' : E.fromSheet(vals, p.rab_seen_at || p.sheet_seen_at) })
    ];
    var stepBtn = step === 'Set the shoot date' && edit ? h('button', { class: 'eco-btn is-primary', type: 'button', onclick: function () { inputs.shoot_date.focus(); } }, 'Set date')
      : url && /RAB|gear|Shoot on/.test(step) ? newTab(url, 'Open RAB', 'eco-btn is-primary') : null;
    var next = h('div', { class: 'eco-next' }, h('span', { class: 't' }, h('span', { class: 'k', text: 'Next step' }), h('span', { class: 's', text: step })), stepBtn);

    var status = brief ? E.section('Status', null, blank('A Brief: there is no RAB for it in the Sheet yet.'))
      : E.section('Status', 'Rekap Project',
        E.seg([['Draft', 'Draft'], ['Dikirim', 'Dikirim'], ['Deal', 'Deal'], ['Lunas', 'Lunas']].concat(ph === 'Batal' ? [['Batal', 'Batal']] : []), ph, null, { 'aria-label': 'Status' }),
        h('p', { class: 'eco-note', text: 'Read only in this version: the status follows Rekap Project in the Sheet.' }));

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
    var dates = E.section('Dates', null, E.kv([
      brief ? null : ['Quote date', p.quote_date ? E.day(p.quote_date) : E.quiet('Not set')],
      ['Shoot starts', dateField('shoot_date')], ['Shoot ends', dateField('shoot_end')], ['Deliver by', dateField('deliver_by')],
      brief ? null : ['Files delivered', p.final_file_date ? E.day(p.final_file_date) : E.quiet('Not yet')],
      brief ? null : ['Payment due', p.payment_due ? E.day(p.payment_due) : E.quiet(tempo != null ? E.plural(tempo, 'day') + ' after the files are delivered' : 'Not set')]
    ]), edit ? h('p', { class: 'eco-note', text: 'Shoot and deliver dates are kept in the admin and save as you change them. The other dates come from the Sheet.' }) : null);

    // money (owners and people with money access)
    var pays = null, costs = null, split = null, cash = null;
    if (money && !brief) {
      if (d.mErr || !m) {
        pays = E.section('Invoice and payments', null, d.mErr ? oops(d.mErr) : blank('No figures for this project in the Sheet yet.'));
      } else {
        var paid = function (amt, dt) { return E.n(amt) > 0 ? E.rp(amt) + (dt ? ' on ' + E.day(dt) : '') : E.quiet('Not yet'); };
        var payNote = { Draft: 'Nothing to collect while the quote is a Draft.', Dikirim: 'Nothing to collect until the client agrees (Deal).', Batal: 'Cancelled: nothing to collect.' }[ph];
        pays = E.section('Invoice and payments', 'Rekap Project',
          h('div', { class: 'eco-figs' }, E.money('Grand total', m.grand_total), E.money('DP' + (E.n(m.dp_pct) != null ? ' ' + E.pct(m.dp_pct) : ''), m.dp_amount),
            E.money('Pelunasan', m.final_amount), E.money('Received', m.paid_total)),
          E.kv([['DP received', paid(m.dp_received, m.dp_date)], ['Pelunasan received', paid(m.final_received, m.final_date)],
            ['Outstanding', m.outstanding != null ? E.rp(m.outstanding) : E.quiet(ph === 'Deal' || ph === 'Lunas' ? 'Not in the Sheet' : 'Not billed yet')],
            ['Pay status', m.pay_status === 'Telat' || m.pay_status === 'Lunas' ? E.pill(m.pay_status) : m.pay_status]]),
          payNote ? h('p', { class: 'eco-note', text: payNote }) : null);

        var cats = Array.isArray(m.categories) ? m.categories : [];
        var sum = function (k) { var any = false, t = 0; cats.forEach(function (c) { var v = E.n(c[k]); if (v != null) { any = true; t += v; } }); return any ? t : null; };
        var unbilled = cats.filter(function (c) { return !(E.n(c.total) > 0) && E.n(c.estimate) > 0; });
        var gap = unbilled.reduce(function (t, c) { return t + E.n(c.estimate); }, 0);
        var catTable = cats.length ? h('table', { class: 'eco-table' }, E.thead(['Category', ['Billed', 'num'], ['Estimate', 'num'], ['Actual', 'num hide-s']]),
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
          catTable,
          unbilled.length ? h('p', { class: 'eco-note' }, h('span', { class: 'eco-warn', text: unbilled.map(function (c) { return c.label + ' costs ' + E.rp(c.estimate); }).join(', ')
            + (unbilled.length === 1 ? ' but isn\u2019t' : ' but aren\u2019t') + ' billed to the client.' }),
            E.n(m.profit) < 0 && gap >= -E.n(m.profit) ? ' That\u2019s where the loss comes from.' : '') : null,
          m.cost_override != null ? h('p', { class: 'eco-note', text: 'The cost is set by hand in Rekap Project (' + E.rp(m.cost_override) + '), so the Sheet uses it instead of the RAB.' }) : null);
        var al = rab && rab.internal && rab.internal.alloc;
        if (al && typeof al === 'object') split = allocation(p, al, edit && p.sheet_state === 'present');
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
    var docs = brief ? null : E.section('Documents', null,
      d.docs.e ? oops(d.docs.e) : !mine.length ? blank('No PDFs for this project yet.')
        : h('ul', { class: 'eco-list' }, mine.map(function (x) {
          return h('li', {}, h('span', { class: 't' }, E.ext(x.url, x.doc_no || x.title), h('span', { class: 'sub', text: (DOC[x.kind] || x.kind) + ' \u00b7 ' + A.date(x.created_at) })));
        })),
      before.length && (ph === 'Draft' || ph === 'Deal') ? h('p', { class: 'eco-note', text: 'Before the ' + (ph === 'Draft' ? 'quote' : 'invoice') + ' PDF: ' + before.join(', and ') + '.' }) : null);

    // the RAB header and its lines (money)
    var quote = null, budget = null;
    if (money && m && !brief) {
      var pc = function (v) { return v == null ? '0%' : E.pct(v); };
      if (rab && rab.meta) {
        quote = E.section('Quote settings', 'RAB header', E.kv([
          ['Document type', meta.doc_type || p.doc_type], ['Title', meta.title], ['Client on the invoice', meta.client_label], ['Product', meta.product],
          ['Photographer', meta.photographer ? (holders.indexOf(String(meta.photographer).trim()) > -1 ? E.quiet(meta.photographer) : meta.photographer) : null],
          ['Locations \u00b7 days', [E.n(meta.locations) != null ? E.plural(E.n(meta.locations), 'location') : null,
            E.n(meta.shooting_days) != null ? E.plural(E.n(meta.shooting_days), 'shooting day') : null].filter(Boolean).join(' \u00b7 ')],
          ['Location', meta.location], ['Usage \u00b7 language', [meta.usage, meta.language].filter(Boolean).join(' \u00b7 ')],
          ['Diskon \u00b7 PPN \u00b7 DP \u00b7 PPh 23', [m.discount_pct, m.ppn_pct, m.dp_pct, m.pph23_pct].map(pc).join(' \u00b7 ')]
        ]));
      }
      if (rab && Array.isArray(rab.sections)) {
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
    var noteBox = null, noteNote = h('span', { class: 'eco-saved', role: 'status' }), sent = p.notes || null;
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

    E.drawer('projects', p.id, top.concat([next, status, dates, pays, costs, split, cash, crew, docs, quote, budget, notes, history, bar]));
    if (noteBox) A.guard(function () { return (noteBox.value.trim() || null) !== sent; });
  }
  A.openers.projects = open;
})();
