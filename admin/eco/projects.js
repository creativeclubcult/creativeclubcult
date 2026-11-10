/* Projects: every RAB in the Sheet (a Rekap Project row and its tab) and the Briefs not in the Sheet yet. The list
   shows the active projects by stage, then every project, the most urgent first. A project opens as a page of its own
   (#projects/<id>): its stage, its money, the RAB's lines, the crew, the quote and what needs doing next. What the
   admin keeps itself (shoot and deliver dates, notes) saves to the database. The stage, the delivery date, payments,
   the quote settings, locking gear prices, the PDFs, the RAB's lines and its actual costs (rab.js) are written to the
   Sheet through sheets-write, which checks the role and every value again; a new RAB is made in the Sheet from a
   Brief. RAB 001 to 009 (the old tabs) stay read only. */
(function () {
  'use strict';
  if (!window.cccAdmin) return; // admin.js stopped early: the sign in library didn't load
  var A = window.cccAdmin, E = window.eco, sb = A.sb, h = A.h, I = A.icon;
  var panel = A.$('[data-panel="projects"]'), ui = null, got = null, turn = 0, lturn = 0;
  // the project whose last change the Sheet queued: its page says so once, as it doesn't show the change yet
  var queued = null;
  var FIELD = { shoot_date: 'Shoot starts', shoot_end: 'Shoot ends', deliver_by: 'Deliver by', notes: 'Notes', status: 'Status', plan_title: 'Name',
    archived_at: 'Archived', portfolio_skip: 'Not for the portfolio', final_file_date: 'Files delivered', payment_due: 'Payment due', quote_date: 'Quote date' };
  var VIEWS = {
    active: E.isActive,
    done: function (p) { return p.sheet_state === 'present' && p.status === 'Lunas'; },
    cancelled: function (p) { return E.phase(p) === 'Batal' || (p.sheet_state === 'none' && !!p.archived_at); },
    all: function () { return true; }
  };
  var TABS = [['active', 'Active'], ['done', 'Done'], ['cancelled', 'Cancelled'], ['all', 'All']];
  var EMPTY = { active: 'No active projects right now.', done: 'No finished projects yet.', cancelled: 'No cancelled projects.', all: 'No projects here.' };
  // the active stages, and what a stage is worth when every project in it has its total in the Sheet
  var STAGES = ['Brief', 'Draft', 'Dikirim', 'Deal'];
  var PLAIN = { Brief: 'No RAB yet', Draft: 'Quote not sent yet', Dikirim: 'Waiting for the client', Deal: 'Agreed with the client' };
  var WORTH = { Draft: 'quoted', Dikirim: 'waiting', Deal: 'won' };
  var DOC_TYPES = [['PENAWARAN', 'Penawaran'], ['INVOICE', 'Invoice'], ['KWITANSI', 'Kwitansi']];
  var docType = function (v) { v = String(v || '').trim().toUpperCase(); return DOC_TYPES.some(function (o) { return o[0] === v; }) ? v : ''; };
  var paneOf = {}; // the part of a project's page that was open last, by project
  var gone = function () { A.toast('That project isn’t there any more.', true); };
  var newTab = function (href, kids, cls) { return h('a', { class: cls || null, href: href, target: '_blank', rel: 'noopener noreferrer' }, kids); };
  var idOf = function () { var m = /^#projects\/(.+)$/.exec(location.hash); return m ? m[1] : null; };
  var crumb = function () { return h('p', { class: 'crumb' }, h('a', { href: '#projects' }, I('chev'), 'Projects')); };
  var paneH = function (title, right) { return h('div', { class: 'pane-h' }, h('h3', { text: title }), right); };
  var src = function (t) { return h('span', { class: 'src' }, I('sheet'), t); };
  var empty = function (t, err) { return h('p', { class: 'empty' + (err ? ' is-err' : ''), text: t }); };
  var smooth = function () { return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'; };

  // ---------- the list ----------
  function build() {
    if (ui) return;
    ui = { view: 'active', stage: null, last: null,
      list: h('div', { class: 'pj-list' }), page: h('div', { class: 'pj-page', hidden: true }),
      pipe: h('section', { class: 'card pipe', 'aria-label': 'Active projects by stage', hidden: true }),
      tabs: h('div', { class: 'tabs', role: 'group', 'aria-label': 'Show' }),
      q: h('input', { type: 'search', placeholder: 'Search project, client, invoice no.', 'aria-label': 'Search projects' }),
      client: A.select([['', 'All clients']], '', { class: 'field', 'aria-label': 'Client' }),
      count: h('span', { class: 'muted' }),
      pick: h('p', { class: 'lnote', hidden: true }),
      note: h('p', { class: 'lnote', hidden: true, text: 'Some next steps leave out a check, because the documents, the Kas or the portfolio couldn’t be loaded.' }),
      state: h('div', { class: 'pj-state', hidden: true }),
      table: h('table', { class: 'tbl cards', hidden: true }) };
    ui.tabBtns = TABS.map(function (t) {
      var c = h('span', { class: 'c' });
      return { key: t[0], c: c, btn: h('button', { type: 'button', 'aria-pressed': String(t[0] === ui.view), onclick: function () { ui.view = t[0]; ui.stage = null; draw(); } }, t[1], c) };
    });
    A.add(ui.tabs, ui.tabBtns.map(function (t) { return t.btn; }));
    ui.stBtns = STAGES.map(function (s, i) {
      var b = h('b'), v = h('span', { class: 'v' });
      return { key: s, b: b, v: v, btn: h('button', { class: 'st', type: 'button', 'aria-pressed': 'false', onclick: function () { pickStage(s); } },
        h('span', { class: 'row' }, E.stage(s), i < STAGES.length - 1 ? I('chev', 's flow') : null), b, v) };
    });
    A.add(ui.pipe, ui.stBtns.map(function (s) { return s.btn; }));
    ui.q.addEventListener('input', E.debounce(draw, 150));
    ui.client.addEventListener('change', draw);
    A.add(ui.list, [ui.pipe, h('section', { class: 'card tablecard', 'aria-label': 'Project list' },
      h('div', { class: 'bar' }, ui.tabs, h('label', { class: 'field' }, I('search', 's'), ui.q), ui.client, ui.count),
      ui.pick, ui.note, ui.state, ui.table)]);
    // where focus was on a project's page, so a page drawn again after a save puts it back near there
    ui.page.addEventListener('focusin', function (e) { var k = e.target.closest && e.target.closest('[data-k]'); if (k) ui.last = k.getAttribute('data-k'); });
    // whether someone has clicked or typed yet: a page opened that way takes focus, a page loaded from its address doesn't
    var touch = function () { ui.touched = true; };
    document.addEventListener('pointerdown', touch, true);
    document.addEventListener('keydown', touch, true);
    panel.innerHTML = '';
    A.add(panel, [ui.list, ui.page]);
  }
  // the list, or one project on a page of its own (the page title row above the list belongs to the list)
  function mode(page) {
    ui.list.hidden = page; ui.page.hidden = !page;
    panel.classList.toggle('is-page', page);
    A.$('[data-head]').hidden = page;
    if (!page) { ++turn; ui.page.innerHTML = ''; ui.last = null; A.pageGuard(null); }
  }
  function state(text, err, retry) {
    ui.state.innerHTML = ''; ui.state.hidden = !text;
    if (text) A.add(ui.state, [empty(text, err), retry ? h('button', { class: 'btn sm', type: 'button', onclick: retry }, 'Try again') : null]);
  }
  function pickStage(s) {
    if (ui.stage === s) ui.stage = null;
    else { ui.stage = s; ui.view = 'active'; }
    draw();
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
    var t = E.words(E.search(ui.q.value)), cid = ui.client.value, money = A.canMoney();
    var base = got.projects.filter(function (p) {
      if (cid && p.client_id !== cid && p.plan_client_id !== cid) return false;
      return !t || [E.pname(p), p.invoice_no, p.tab_name, p.client_label, p.client_code].some(function (v) { return E.words(v).indexOf(t) > -1; });
    });
    // the stages follow the search and the client too; a stage with nothing in it can't be picked
    var act = base.filter(VIEWS.active);
    ui.pipe.hidden = !got.projects.some(VIEWS.active);
    ui.stBtns.forEach(function (s) {
      var mine = act.filter(function (p) { return E.phase(p) === s.key; }), on = ui.stage === s.key;
      var whole = money && !!WORTH[s.key] && mine.length > 0 && mine.every(function (p) { var m = got.money[p.id]; return !!m && E.n(m.grand_total) != null; });
      s.b.textContent = String(mine.length);
      s.v.textContent = !mine.length ? 'None' : whole ? E.rp(mine.reduce(function (a, p) { return a + E.n(got.money[p.id].grand_total); }, 0)) + ' ' + WORTH[s.key] : PLAIN[s.key];
      s.btn.setAttribute('aria-pressed', String(on));
      s.btn.disabled = !mine.length && !on && document.activeElement !== s.btn;
    });
    ui.tabBtns.forEach(function (b) {
      b.c.textContent = String(base.filter(VIEWS[b.key]).length);
      b.btn.setAttribute('aria-pressed', String(b.key === ui.view));
    });
    var list = E.byUrgency(base.filter(VIEWS[ui.view]).filter(function (p) { return !ui.stage || E.phase(p) === ui.stage; }), got.money, E.today());
    ui.pick.innerHTML = ''; ui.pick.hidden = !ui.stage;
    if (ui.stage) A.add(ui.pick, [h('span', { text: 'Showing ' + E.plural(list.length, 'project') + ' at ' + ui.stage + '. ' }),
      h('button', { class: 'link', type: 'button', onclick: function () { ui.stage = null; draw(); } }, 'Show all active projects')]);
    var tb = h('tbody');
    list.forEach(function (p) { tb.appendChild(E.projectCard(p, got.money[p.id], got.ctx(p), '#projects/' + p.id)); });
    ui.table.innerHTML = ''; ui.table.hidden = !list.length;
    if (list.length) A.add(ui.table, [E.cardHead(), tb]);
    state(list.length ? null : !got.projects.length ? 'No projects yet. They come from Rekap Project in the Sheet.'
      : t ? 'No project matches that search.' : cid ? 'No projects for that client here.' : EMPTY[ui.view]);
    ui.count.textContent = E.plural(list.length, 'project');
    ui.note.hidden = !got.partial;
  }
  // the line under the page title, as the mockup has it: how many projects are active and how many there are in all
  // (blank while they load, when they couldn't be loaded, or when there are none)
  function sub() {
    if (panel.hidden || !ui.page.hidden) return;
    var all = got ? got.projects.length : 0;
    A.$('[data-page-sub]').textContent = all ? got.projects.filter(VIEWS.active).length + ' active, ' + all + ' in all' : '';
  }
  function load() {
    var mine = ++lturn;
    // a first visit waits; a return keeps the last list on screen until the new one is here
    if (!got) { ui.table.hidden = true; ui.pick.hidden = true; ui.note.hidden = true; ui.count.textContent = ''; state('Loading projects…'); }
    Promise.all([E.data.projects(), E.data.money(), E.data.clients(), E.data.docs(), E.data.kas(), E.data.portfolio()].map(E.settle)).then(function (r) {
      if (mine !== lturn) return;
      if (r[0].e || r[1].e) {
        got = null; ui.pipe.hidden = true; ui.table.hidden = true; ui.pick.hidden = true; ui.note.hidden = true; ui.count.textContent = '';
        ui.tabBtns.forEach(function (b) { b.c.textContent = ''; });
        sub();
        return state(E.ecoError(r[0].e || r[1].e), true, function () { E.forget(); load(); });
      }
      got = { projects: r[0].v, money: r[1].v, clients: r[2].v || [], ctx: E.stepContext(r[3].v, r[4].v, r[5].v), partial: !!(r[3].e || r[4].e || r[5].e) };
      fillClients(); draw(); sub();
    });
  }
  A.loaders.projects = function () {
    build();
    var id = idOf();
    if (id && !E.isId(id)) { history.replaceState(null, '', '#projects'); gone(); id = null; }
    if (id) return mode(true); // the opener draws it
    mode(false);
    sub();
    load();
  };

  // ---------- one project, on a page of its own ----------
  var current = function (mine, id) { return mine === turn && idOf() === id && !panel.hidden && !ui.page.hidden; };
  function pageState(text, err, retry) {
    A.pageGuard(null);
    ui.page.innerHTML = '';
    A.add(ui.page, [crumb(), h('section', { class: 'card pj-state' }, empty(text, err), retry ? h('button', { class: 'btn sm', type: 'button', onclick: retry }, 'Try again') : null)]);
  }
  // focus goes back to the part of the page it was in (a region that isn't a control takes it for the moment), or to
  // the project's name on a page just opened
  function refocus(k) {
    var el = (k && A.$('[data-k="' + k + '"]', ui.page)) || A.$('#pj-h', ui.page);
    if (!el) return;
    if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
    el.focus({ preventScroll: true });
  }
  // keep: drawn again after a save, where it was
  function open(id, keep) {
    if (!E.isId(id)) return;
    build();
    var mine = ++turn, money = A.canMoney(), y = keep ? window.scrollY : 0;
    var a = document.activeElement, inPage = a && ui.page.contains(a) && a.closest('[data-k]');
    var at = keep ? (inPage ? inPage.getAttribute('data-k') : ui.last) : null;
    var lead = keep || !!ui.touched;
    mode(true);
    if (!keep) { pageState('Loading the project…'); window.scrollTo(0, 0); }
    Promise.all([
      sb.from('projects').select('*').eq('id', id).maybeSingle(),
      money ? sb.from('project_money').select('*').eq('project_id', id).maybeSingle() : Promise.resolve({ data: null }),
      E.settle(E.data.values()), E.settle(E.data.docs()), E.settle(E.data.kas()), E.settle(E.data.portfolio()),
      money ? E.settle(E.rows(sb.from('sync_changes').select('at, source, actor_email, field, old_value, new_value').eq('entity_id', id).order('at', { ascending: false }).limit(50)))
        : Promise.resolve({ v: [] }),
      E.settle(E.rows(sb.from('activity_log').select('at, actor_email, action, source').eq('entity', 'project').eq('entity_id', id).order('at', { ascending: false }).limit(20))),
      E.settle(E.data.clients())
    ]).then(function (r) {
      if (!current(mine, id)) return;
      if (r[0].error) return pageState(E.ecoError(r[0].error), true, function () { open(id); });
      if (!r[0].data) return pageState('That project isn’t there any more.');
      var p = r[0].data, lid = A.canEdit() ? p.inquiry_id || p.manual_lead_id : null; // leads are for owners and admins
      (lid ? E.settle(E.rows(sb.from('lead_inbox').select('id, name, status').eq('id', lid))) : Promise.resolve({ v: [] })).then(function (lr) {
        if (!current(mine, id)) return;
        show({ p: p, m: r[1].data || null, mErr: r[1].error || null, values: r[2], docs: r[3], kas: r[4], port: r[5], changes: r[6], acts: r[7], lead: lr, clients: r[8] });
        if (keep) window.scrollTo(0, y);
        if (lead) refocus(at);
      });
    }).catch(function (e) { if (current(mine, id)) pageState(E.ecoError(e), true, function () { open(id); }); });
  }
  // a change the Sheet took (200) or queued (202): the page again with what the Sheet holds now
  function saved(id, r, text) {
    A.toast(r.status === 202 ? E.writeText(r) : text);
    queued = r.status === 202 ? id : null;
    E.forget();
    open(id, true);
  }
  // a change that wasn't written because its line changed in the Sheet: the RAB tab is read again (a refresh that is
  // busy or fails leaves the next scheduled read to it), then the page shows it as the Sheet has it
  function reread(p, text) {
    var again = function () { A.toast(text, true); E.forget(); open(p.id, true); };
    sb.functions.invoke('sheets-sync', { body: { tabs: [p.sheet_gid] } }).then(again, again);
  }

  // a date or the notes, kept by the admin: saved as soon as it is whole
  function save(p, field, v, input, note, onFail, onOk) {
    var start = field === 'shoot_date' ? v : p.shoot_date, end = field === 'shoot_end' ? v : p.shoot_end;
    var undo = function (msg) {
      note.textContent = msg; note.classList.add('is-err');
      if (input.type === 'date') input.value = p[field] || '';
      if (onFail) onFail();
    };
    if (start && end && end < start) return undo('The shoot can’t end before it starts.');
    note.textContent = 'Saving…'; note.classList.remove('is-err');
    var patch = {}; patch[field] = v;
    sb.from('projects').update(patch).eq('id', p.id).select('id').then(function (r) {
      if (r.error) return undo(E.ecoError(r.error));
      if (!r.data || !r.data.length) return undo('Your account isn’t allowed to change this.');
      p[field] = v; note.textContent = 'Saved';
      E.forget();
      if (onOk) onOk();
    }, function (e) { undo(E.ecoError(e)); });
  }

  // The split of the project price: the ALOKASI DANA block of the RAB tab. The PR and internal fees come off first,
  // net profit and the Kas share are taken from what is left, and the rest is the production budget. Net profit
  // (0% to 25%) is the one rate that changes here; it is written to the RAB tab like any other RAB setting.
  var SPLIT = [['Project price (Omset)', 'price'], ['PR fee', 'pr'], ['Internal fee', 'internal'], ['After fees', 'shared', 'mid'],
    ['Net profit', 'net_profit'], ['Kas CCC', 'kas'], ['Production budget', 'budget', 'sum'],
    ['Production cost in the RAB', 'production_cost', 'mid', true], ['Left in the budget', 'left', 'sum', true]];
  function allocation(p, a, canSet) {
    var tb = h('tbody'), cur = E.n(a.net_profit_pct), msg = h('span', { class: 'fmsg', role: 'status' }), pick = null;
    if (canSet) {
      var rates = [];
      for (var i = 0; i <= 25; i++) rates.push(i / 100);
      // a rate typed in the Sheet that isn't a whole percent stays visible, in its place in the list
      if (cur != null && rates.indexOf(cur) < 0) rates.push(cur);
      rates.sort(function (x, y) { return x - y; });
      var opts = rates.map(function (r) { return [String(r), E.pct(r)]; });
      // an empty or unreadable rate shows as Not set, never as the first rate in the list (0%), and can't be picked
      if (cur == null) opts.unshift(['', 'Not set']);
      pick = A.select(opts, cur == null ? '' : String(cur), { class: 'field', 'aria-label': 'Net profit' });
      if (cur == null) pick.options[0].disabled = true;
      pick.addEventListener('change', function () {
        if (pick.value === '') return;
        var v = Number(pick.value), before = cur;
        pick.disabled = true; msg.textContent = 'Saving to the Sheet…'; msg.classList.remove('is-err');
        var undo = function (t) { pick.disabled = false; pick.value = before == null ? '' : String(before); msg.textContent = t; msg.classList.add('is-err'); };
        E.sheetWrite('rab_meta', { project_id: p.id, set: { net_profit_pct: v }, expect: { net_profit_pct: before } }).then(function (r) {
          if (r.status === 202) { pick.disabled = false; msg.textContent = E.writeText(r); return; }
          if (r.status !== 200) return undo(E.writeText(r));
          pick.disabled = false; cur = v; msg.textContent = 'Saved to the Sheet';
          // the Sheet's answer carries the tab as it reads now, with the split worked out again
          var rab = r.body.record && r.body.record.rab && r.body.record.rab.data;
          if (rab && rab.internal && rab.internal.alloc) paint(rab.internal.alloc);
          E.forget();
        }, function (e) { undo(E.ecoError(e)); });
      });
    }
    // the rows are made once and their figures filled in, so the net profit picker keeps focus when they change
    var cells = SPLIT.map(function (s) {
      var pc = h('td', { class: 'num pc' }), amt = h('td', { class: 'num' });
      if (s[1] === 'net_profit' && pick) pc.appendChild(pick);
      tb.appendChild(h('tr', { class: s[2] || null }, h('td', { text: s[0] }), pc, amt));
      return { key: s[1], pc: pc, amt: amt, plain: !!s[3] };
    });
    function paint(x) {
      cells.forEach(function (c) {
        if (!(c.key === 'net_profit' && pick)) c.pc.textContent = c.plain || E.n(x[c.key + '_pct']) == null ? '' : E.pct(x[c.key + '_pct']);
        var v = E.n(x[c.key]);
        c.amt.textContent = E.num(v); c.amt.classList.toggle('neg', v != null && v < 0);
      });
    }
    paint(a);
    return [paneH('Allocation', src('RAB internal summary')),
      h('div', { class: 'scrollx' }, h('table', { class: 'tbl compact alloc' }, E.thead(['Split of the project price', ['%', 'num'], ['Rp', 'num']]), tb)),
      canSet ? h('p', { class: 'help' }, 'Net profit can be 0% to 25%. Changing it saves to the RAB tab in the Sheet. ', msg) : null];
  }

  function show(d) {
    var p = d.p, m = d.m, money = A.canMoney(), ph = E.phase(p), vals = d.values.v || {}, brief = p.sheet_state === 'none';
    var rab = m && m.rab && typeof m.rab === 'object' ? m.rab : null, meta = (rab && rab.meta) || {};
    var url = p.sheet_state === 'present' ? E.sheetUrl(vals, p.sheet_gid) : null, drive = A.safeUrl(p.drive_folder_url);
    var edit = A.canEdit() && p.sheet_state !== 'removed';
    // what goes to the Sheet: Sheet writes on, the project's tab there, and never an old RAB (001 to 009)
    var on = E.writesOn(vals), write = edit && on && p.sheet_state === 'present' && !E.frozen(p), writeMoney = write && money;
    // settings that couldn't be loaded aren't read as writes being paused: the page says what really happened
    var vErr = !!d.values.e, wait = queued === p.id;
    queued = null;
    var why = !edit || p.sheet_state !== 'present' ? null : E.frozen(p) ? 'An old RAB (001 to 009): change it in the Sheet.'
      : !on ? (vErr ? 'The Sheet settings couldn’t be loaded. Until you reload, only the dates and notes can change here.'
        : 'Sheet writes are paused. Until they’re back on, only the dates and notes can change here.') : null;
    var v2 = p.layout === 'v2', title = (brief ? p.plan_title : p.title || p.tab_name) || 'Project';
    var who = E.clientName(p), cid = p.client_id || p.plan_client_id;
    var kasRows = (d.kas.v || []).filter(function (k) { return k.project_id === p.id || (p.tab_name && k.project_tab === p.tab_name); });
    var ctx = E.stepContext(d.docs.v, d.kas.v, d.port.v);
    var forms = [], panes = [], jumpTo = {}, editors = {}, pdfBtn = null, noteBox = null, sent = (p.notes || '').trim() || null;

    // a portfolio item started from this project: its title, client and year filled in, and linked to it
    var startPortfolio = function () {
      A.newPortfolioFor({ id: p.id, title: p.title || p.tab_name || '', client: p.client_label || '', year: +String(p.shoot_date || p.quote_date || '').slice(0, 4) || null });
    };
    // Not for the portfolio: the step to add it there goes away, and Undo brings it back
    var portDd = null, portPaint = null;
    function setSkip(v, b) {
      var from = b && (todo.contains(b) ? 'todo' : 'det');
      if (b) b.disabled = true;
      var back = function (t) { if (b) b.disabled = false; A.toast(t, true); };
      sb.from('projects').update({ portfolio_skip: v }).eq('id', p.id).select('id').then(function (r) {
        if (r.error) return back(E.ecoError(r.error));
        if (!r.data || !r.data.length) return back('Your account isn’t allowed to change this.');
        p.portfolio_skip = v; E.forget();
        A.toast(v ? 'Marked as not for the portfolio.' : 'Undone. It can go in the portfolio again.');
        refreshNeeds(); if (portPaint) portPaint();
        // the button pressed is gone, so focus goes to what replaced it
        var to = from === 'todo' ? A.$('h2', todo) : from === 'det' ? portDd : null;
        if (to) { to.tabIndex = -1; to.focus(); }
      }, function (e) { back(E.ecoError(e)); });
    }

    // what the Needs you card and the panes both read
    var cats = m && Array.isArray(m.categories) ? m.categories : [];
    var unbilled = cats.filter(function (c) { return !(E.n(c.total) > 0) && E.n(c.estimate) > 0; });
    var gap = unbilled.reduce(function (t, c) { return t + E.n(c.estimate); }, 0);
    var loss = !!m && E.n(m.profit) < 0 && unbilled.length > 0 && gap >= -E.n(m.profit);
    var holders = Object.keys(meta).map(function (k) { return typeof meta[k] === 'string' ? meta[k].trim() : ''; }).filter(function (v) { return /^\[.+\]$/.test(v); });
    var crewLines = m && Array.isArray(m.crew_lines) ? m.crew_lines : [];
    var heads = crewLines.reduce(function (t, l) { return t + (E.n(l.qty) || 1); }, 0);
    var eq = rab && rab.equipment && typeof rab.equipment === 'object' && Array.isArray(rab.equipment.groups) ? rab.equipment : null;
    var gearLines = eq ? [].concat.apply([], eq.groups.map(function (g) { return Array.isArray(g.lines) ? g.lines : []; })) : [];

    // locking gear prices (the Sheet's own lock: each unlocked equipment price is fixed at what it is now)
    var lockSend = E.writer(), canLock = write && v2 && p.unlocked_gear > 0;
    function lockPrices(e) {
      var btn = e.currentTarget, k = p.unlocked_gear;
      A.ask('Lock ' + E.plural(k, 'gear price') + '?', 'Each equipment price in the RAB tab that isn’t locked yet is fixed at its current price.', 'Lock prices').then(function (go) {
        if (!go) return;
        btn.disabled = true; btn.lastChild.textContent = 'Locking…';
        var back = function (t) { btn.disabled = false; btn.lastChild.textContent = 'Lock prices'; A.toast(t, true); };
        lockSend('lock_prices', { project_id: p.id }).then(function (r) {
          if (r.status !== 200 && r.status !== 202) return back(E.writeText(r));
          var n = r.body.record && E.n(r.body.record.locked);
          saved(p.id, r, n != null ? 'Locked ' + E.plural(n, 'gear price') + ' in the Sheet.' : 'Prices locked in the Sheet.');
        }, function (err) { back(E.ecoError(err)); });
      });
    }

    // ---- the stage: picked here, asked once, written to Rekap Project ----
    var steps = null, stepNote = null, stepBtns = [];
    function pickStatus(v) {
      if (v === ph || !write) return;
      var batal = v === 'Batal';
      A.ask(batal ? 'Mark this project Batal?' : 'Change the stage to ' + v + '?',
        'Rekap Project in the Sheet goes from ' + (ph || 'empty') + ' to ' + v + '.' + (batal ? ' Nothing is deleted, and it can be changed back.' : ''),
        batal ? 'Mark Batal' : 'Change to ' + v, batal).then(function (go) {
        if (!go) return;
        var lock = function (x) { stepBtns.forEach(function (b) { b.disabled = x; }); };
        lock(true); stepNote.textContent = 'Saving to the Sheet…'; stepNote.classList.remove('is-err');
        var back = function (t) { lock(false); stepNote.textContent = t; stepNote.classList.add('is-err'); };
        statusSend('project_set', { project_id: p.id, set: { status: v }, expect: { status: p.status } }).then(function (r) {
          if (r.status === 200 || r.status === 202) return saved(p.id, r, 'Stage saved to the Sheet: ' + v + '.');
          back(E.writeText(r));
        }, function (e) { back(E.ecoError(e)); });
      });
    }
    var statusSend = E.writer();
    if (!brief) {
      var opts = write || ph === 'Batal' ? ['Draft', 'Dikirim', 'Deal', 'Lunas', 'Batal'] : ['Draft', 'Dikirim', 'Deal', 'Lunas'];
      stepBtns = opts.map(function (v) {
        return h('button', { class: 'step' + (v === 'Batal' ? ' cancel' : ''), type: 'button', 'aria-pressed': String(v === ph), disabled: !write,
          onclick: function () { pickStatus(v); } }, v === 'Batal' ? null : h('span', { class: 'o' }), v);
      });
      steps = h('div', { class: 'steps' + (opts.length === 4 ? ' n4' : ''), role: 'group', 'data-k': 'steps',
        'aria-label': write ? 'Stage, saved to Rekap Project in the Sheet' : 'Stage' }, stepBtns);
      stepNote = h('p', { class: 'ph-note' + (!write && vErr && why ? ' is-err' : ''), role: 'status',
        text: write ? (wait ? 'Your last change is queued. It goes into the Sheet by itself and shows here after that.' : '') : why || '' });
    }

    // ---- the header ----
    var acts = [];
    if (writeMoney && !brief) acts.push(h('button', { class: 'btn', type: 'button', onclick: function () { jump('quote', pdfBtn); } }, I('docs', 's'), 'Make PDF'));
    if (url) acts.push(newTab(url, [I('ext', 's'), 'Open RAB'], 'btn'));
    if (drive) acts.push(newTab(drive, [I('ext', 's'), 'Drive folder'], 'btn'));
    var li = function (icon, kids) { return h('li', {}, I(icon), kids); };
    var head = h('section', { class: 'card ph', 'aria-labelledby': 'pj-h', 'data-k': 'head' },
      h('div', { class: 'ph-top' },
        h('span', { class: 'ph-av', 'aria-hidden': 'true', text: E.initial(who) }),
        h('div', { class: 'ph-t' }, h('h1', { id: 'pj-h', text: title }),
          h('ul', { class: 'ph-meta' },
            li('clients', cid ? h('a', { href: '#clients/' + cid, text: who }) : who),
            p.invoice_no ? li('docs', p.invoice_no) : null,
            li('sheet', brief ? 'Brief, not in the Sheet yet' : p.sheet_row ? 'Rekap Project row ' + p.sheet_row : 'Rekap Project'),
            p.layout === 'v1' ? h('li', {}, h('span', { class: 'tag', text: 'Old layout' })) : null,
            p.sheet_state === 'removed' ? h('li', {}, h('span', { class: 'tag red', text: 'Removed from the Sheet' })) : null)),
        acts.length ? h('div', { class: 'ph-acts' }, acts) : null),
      steps, stepNote);

    // ---- the four figures (money) ----
    var tiles = null;
    var tile = function (icon, label, value, sub, cls, tag) {
      return h('article', { class: 'tile' }, h('p', { class: 'k' }, I(icon), h('span', { text: label }), tag || null),
        h('p', { class: 'v' + (cls ? ' ' + cls : ''), text: value }), sub ? h('p', { class: 'c', text: sub }) : null);
    };
    if (money && !brief) {
      if (d.mErr) tiles = h('p', { class: 'note red' }, I('alert'), h('span', { text: E.ecoError(d.mErr) }));
      else if (!m) tiles = h('p', { class: 'note' }, I('sheet'), h('span', { text: 'No figures for this project in the Sheet yet.' }));
      else {
        var gt = E.n(m.grand_total), cost = E.n(m.cost), pr = E.n(m.profit), mg = E.margin(m.profit, m.revenue, m.margin);
        var owe = E.n(m.outstanding), late = m.pay_status === 'Telat' && owe > 0;
        var col = ph === 'Batal' ? ['Cancelled', 'Nothing to collect', 'soft']
          : ph === 'Deal' || ph === 'Lunas' ? (owe == null ? ['Not in the Sheet', null, 'soft']
            : [E.rp(owe), owe === 0 ? 'Paid in full' : p.payment_due ? 'Due ' + E.when(p.payment_due) : 'No due date yet', late ? 'neg' : null])
          : ['Not billed yet', ph === 'Draft' ? 'Nothing to collect on a Draft' : 'Nothing to collect until the Deal', 'soft'];
        tiles = h('section', { class: 'tiles', 'aria-label': 'Money on this project' },
          tile('docs', 'Quote total', gt == null ? 'Not in the RAB' : E.rp(gt),
            E.n(m.dp_amount) != null && E.n(m.dp_pct) != null ? 'DP ' + E.pct(m.dp_pct) + ' is ' + E.rp(m.dp_amount) : null, gt == null ? 'soft' : null),
          tile('out', 'Cost', cost == null ? 'Not in the Sheet' : E.rp(cost),
            m.cost_override != null ? 'Set by hand in Rekap Project' : cost == null ? null : 'From the RAB', cost == null ? 'soft' : null),
          tile('trend', 'Profit', pr == null ? 'Not in the Sheet' : E.rp(pr), mg != null ? 'Margin ' + E.pct(mg) : null, pr == null ? 'soft' : pr < 0 ? 'neg' : null),
          tile('in', 'To collect', col[0], col[1], col[2], late ? h('span', { class: 'tag red', text: 'Telat' }) : null));
      }
    }

    // ---- the parts of the page: Budget, Money, Crew and Quote with money access; Crew and Documents without ----
    var pane = function (key, label, count, nodes) { panes.push({ key: key, label: label, count: count, nodes: nodes }); };
    if (brief) pane('rab', 'Make the RAB', null, makeRabPane());
    else {
      if (money) {
        pane('budget', 'Budget', rab && Array.isArray(rab.sections) ? lineCount() : null, budgetPane());
        pane('money', 'Money', null, moneyPane());
      }
      pane('crew', 'Crew', money && m ? (crewLines.length ? heads : null) : (p.crew_names || []).length || null, crewPane());
      pane(money ? 'quote' : 'docs', money ? 'Quote' : 'Documents', null, docsPane());
    }

    function lineCount() {
      var n = 0;
      rab.sections.forEach(function (s) { n += Array.isArray(s.lines) ? s.lines.length : 0; });
      return n + gearLines.length;
    }
    function budgetPane() {
      if (d.mErr) return [empty(E.ecoError(d.mErr), true)];
      if (!m) return [empty('No figures for this project in the Sheet yet.')];
      if (!rab || !Array.isArray(rab.sections)) {
        return [paneH('Lines on the quote'), empty(p.layout === 'v1' ? 'This RAB uses the old layout. See its lines in the Sheet.' : 'The lines of this RAB aren’t in the admin yet.'),
          url ? h('p', { class: 'src' }, I('ext'), newTab(url, 'Open RAB')) : null];
      }
      // line by line: change, add and remove lines in the RAB tab (rab.js); otherwise the lines to read
      var lines = writeMoney && v2;
      return E.rabBudget({ p: p, rab: rab, edit: lines, forms: forms,
        note: lines ? null : why || (p.layout === 'v1' ? 'This RAB uses the old layout, so its lines change in the Sheet.' : E.fromSheet(vals, p.rab_seen_at || p.sheet_seen_at) + '.'),
        link: url ? newTab(url, 'Open RAB') : null,
        saved: function (r, t) { saved(p.id, r, t); }, refresh: function (t) { reread(p, t); } });
    }

    function moneyPane() {
      if (d.mErr) return [empty(E.ecoError(d.mErr), true)];
      if (!m) return [empty('No figures for this project in the Sheet yet.')];
      var out = [], billed = ph === 'Deal' || ph === 'Lunas';
      var payb = function (k, tag, v, none) {
        var x = E.n(v);
        return h('div', { class: 'payb' }, h('span', { class: 'k' }, h('span', { text: k }), tag), h('b', { class: x == null ? 'soft' : null, text: x == null ? none || 'Not in the Sheet' : E.rp(x) }));
      };
      var got = function (amt) { return E.n(amt) > 0 ? h('span', { class: 'tag lime', text: 'Received' }) : h('span', { class: 'tag', text: 'Not yet' }); };
      out.push(paneH('Invoice and payments', src('Rekap Project')),
        h('div', { class: 'pay' }, payb('Grand total', null, m.grand_total, 'Not in the RAB'),
          payb('DP' + (E.n(m.dp_pct) != null ? ' ' + E.pct(m.dp_pct) : ''), got(m.dp_received), m.dp_amount),
          payb('Pelunasan', got(m.final_received), m.final_amount)));
      // what came in, typed here and written to Rekap Project (Deal and Lunas only: before that nothing is billed)
      if (writeMoney && billed) {
        var pf = E.sheetForm({ label: 'Save payments', op: 'project_set', look: 'mock',
          args: function (set, expect) { return { project_id: p.id, set: set, expect: expect }; },
          check: function (set) { return ['dp_received', 'final_received'].some(function (k) { return set[k] > 1e12; }) ? 'That amount is too large.' : ''; },
          done: function (r) { saved(p.id, r, 'Payments saved to the Sheet.'); } });
        forms.push(pf);
        jumpTo.dp = pf.field('dp_received', E.amountInput(m.dp_received, 'DP received'), m.dp_received, E.amount);
        out.push(h('div', { class: 'fgrid' },
          h('label', { class: 'f' }, 'DP received (Rp)', jumpTo.dp),
          h('label', { class: 'f' }, 'DP date', pf.field('dp_date', h('input', { type: 'date', value: E.isoDay(m.dp_date) }), m.dp_date, E.dayOf)),
          h('label', { class: 'f' }, 'Pelunasan received (Rp)', pf.field('final_received', E.amountInput(m.final_received, 'Pelunasan received'), m.final_received, E.amount)),
          h('label', { class: 'f' }, 'Pelunasan date', pf.field('final_date', h('input', { type: 'date', value: E.isoDay(m.final_date) }), m.final_date, E.dayOf))), pf.bar);
      } else if (billed) {
        var paid = function (amt, dt) { return E.n(amt) > 0 ? E.rp(amt) + (dt ? ' on ' + E.day(dt) : '') : E.quiet('Not yet'); };
        out.push(E.props([['DP received', paid(m.dp_received, m.dp_date)], ['Pelunasan received', paid(m.final_received, m.final_date)],
          ['Pay status', m.pay_status === 'Telat' || m.pay_status === 'Lunas' ? E.stage(m.pay_status) : m.pay_status]]));
      }
      var owe = E.n(m.outstanding), recv = E.n(m.paid_total), late = m.pay_status === 'Telat' && owe > 0;
      // before the Deal only what that stage means (and money that came in anyway); from the Deal what came in and what is left
      var said = (billed ? [recv != null ? 'Received so far: ' + E.rp(recv) + '.' : null,
        owe != null ? (owe > 0 ? E.rp(owe) + ' still to collect' + (late ? ', and it’s late (Telat).' : '.') : owe === 0 ? 'Nothing left to collect.' : null) : null]
        : [{ Draft: 'Nothing to collect while the quote is a Draft.', Dikirim: 'Nothing to collect until the client agrees (Deal).', Batal: 'Cancelled: nothing to collect.' }[ph],
          recv > 0 ? 'Received so far: ' + E.rp(recv) + '.' : null]).filter(Boolean).join(' ');
      if (said) out.push(h('p', { class: 'note' + (late ? ' red' : '') }, I(late ? 'alert' : 'clock'), h('span', { text: said })));

      // costs: typed here when the RAB can be written to (the ten categories of the v2 summary), otherwise to read
      out.push(paneH('Costs and profit', [E.n(m.revenue) != null ? h('span', { class: 'cnt', text: 'Omset ' + E.rp(m.revenue) }) : null, src(rab ? 'RAB internal summary' : 'Rekap Project')]));
      var act = writeMoney && v2 && rab && cats.length === 10 ? E.rabActuals({ p: p, rab: rab, cats: cats, forms: forms, saved: function (r, t) { saved(p.id, r, t); } }) : null;
      if (act) out.push(act.table, act.bar);
      else if (cats.length) out = out.concat(costsToRead());
      else out.push(empty(p.layout === 'v1' ? 'This RAB uses the old layout, so its cost breakdown is only in the Sheet.' : 'The cost breakdown of this RAB isn’t in the admin yet.'));
      if (unbilled.length) {
        out.push(h('p', { class: 'note ' + (loss ? 'red' : 'amber') }, I('alert'), h('span', { text: unbilled.map(function (c) { return c.label + ' costs ' + E.rp(c.estimate); }).join(', ')
          + (unbilled.length === 1 ? ' but isn’t' : ' but aren’t') + ' billed to the client.' + (loss ? ' That’s where the loss comes from.' : '') })));
      }
      if (m.cost_override != null) out.push(h('p', { class: 'note' }, I('sheet'), h('span', { text: 'The cost is set by hand in Rekap Project (' + E.rp(m.cost_override) + '), so the Sheet uses it instead of the RAB.' })));
      var al = rab && rab.internal && rab.internal.alloc;
      if (al && typeof al === 'object') out = out.concat(allocation(p, al, write));

      out.push(paneH('Cash entries', src('Kas')));
      out.push(d.kas.e ? empty(E.ecoError(d.kas.e), true) : !kasRows.length ? empty('No cash entries for this project yet.')
        : h('div', { class: 'scrollx' }, h('table', { class: 'tbl compact' }, E.thead(['Date', ['Kategori', 'hide-s'], ['Keterangan', 'hide-s'], 'To or from', ['Nominal', 'num'], 'Status']),
          h('tbody', {}, kasRows.map(function (k) {
            return h('tr', {}, h('td', { text: E.day(k.entry_date, { year: false }) }), h('td', { class: 'hide-s', text: k.category || '' }), h('td', { class: 'hide-s', text: k.description || '' }),
              h('td', { text: k.counterparty || '' }), h('td', { class: 'num' }, k.amount == null ? '' : (k.kind === 'Keluar' ? '−' : '') + E.num(k.amount)),
              h('td', {}, k.paid ? h('span', { class: 'pill ' + (k.paid === 'Belum' ? 'no' : 'yes'), text: k.paid }) : null));
          })))));
      return out;
    }
    // read only: the costs outside the RAB too, and the totals as the Sheet has them (an empty actual counts as its estimate)
    function costsToRead() {
      var inn = (rab && rab.internal) || {}, tot = E.rabCostTotals(rab, cats);
      var sum = function (k) { var any = false, t = 0; cats.forEach(function (c) { var v = E.n(c[k]); if (v != null) { any = true; t += v; } }); return any ? t : null; };
      var oth = E.n(inn.other_estimate) != null || E.n(inn.other_actual) != null
        ? [{ label: 'Other costs outside the RAB', estimate: inn.other_estimate, actual: inn.other_actual, other: true }] : [];
      var tb = h('tbody', {}, cats.concat(oth).map(function (c) {
        var billedV = E.n(c.total), est = E.n(c.estimate), hot = !c.other && est > 0 && !(billedV > 0);
        return h('tr', { class: hot ? 'hot' : null, 'data-zero': !billedV && !est && !E.n(c.actual) ? '' : null },
          h('td', {}, hot ? I('alert') : null, c.label || ''), h('td', { class: 'num hide-s' }, c.other ? '' : E.num(c.total)),
          h('td', { class: 'num' }, E.num(c.estimate)), h('td', { class: 'num' }, E.num(c.actual)));
      }), h('tr', { class: 'sum' }, h('td', { text: 'Total' }), h('td', { class: 'num hide-s' }, E.num(sum('total'))),
        h('td', { class: 'num' }, E.num(tot.estimate)), h('td', { class: 'num' }, E.num(tot.actual))));
      var toggle = E.zeroToggle(tb, p.id + ' read');
      return [h('div', { class: 'scrollx' }, h('table', { class: 'tbl compact' },
        E.thead(['Category', ['Billed', 'num hide-s'], ['Estimate', 'num'], ['Actual', 'num']]), tb)), toggle ? h('div', { class: 'formacts' }, toggle) : null];
    }

    // crew: names for everyone, fees and payments with money access
    function crewPane() {
      if (money && m) {
        var paidTo = {};
        kasRows.forEach(function (k) {
          var name = E.words(k.counterparty).trim();
          if (k.kind === 'Keluar' && name && k.paid === 'Sudah') paidTo[name] = (paidTo[name] || 0) + (E.n(k.amount) || 0);
        });
        return [paneH('Crew in the RAB', crewLines.length ? h('span', { class: 'cnt', text: E.plural(heads, 'person', 'people') }) : null),
          !crewLines.length ? empty(rab ? 'No crew lines in the RAB yet.' : 'The crew lines of this RAB aren’t in the admin yet.')
          : h('ul', { class: 'plist' }, crewLines.map(function (l) {
            var out = l.person ? paidTo[E.words(l.person).trim()] || 0 : 0, fee = E.n(l.total) || 0;
            var st = d.kas.e ? ['off', 'Couldn’t check'] : out > 0 && out >= fee ? ['yes', 'Sudah'] : out > 0 ? ['busy', 'Partly, ' + E.rp(out)] : ['no', 'Belum'];
            return h('li', {}, h('span', { class: 'av', 'aria-hidden': 'true' }, I('crew')),
              h('div', {}, h('b', { text: l.desc || 'No role named' }), h('span', { text: l.person || 'No name yet' })),
              h('span', { class: 'fee', text: E.num(l.total) }), h('span', { class: 'pill ' + st[0], text: st[1] }));
          }))];
      }
      var names = p.crew_names || [];
      return [paneH('Crew in the RAB', names.length ? h('span', { class: 'cnt', text: E.plural(names.length, 'person', 'people') }) : null),
        names.length ? h('ul', { class: 'plist' }, names.map(function (n) {
          return h('li', {}, h('span', { class: 'av', 'aria-hidden': 'true' }, I('crew')), h('div', {}, h('b', { text: n })));
        })) : empty('No names in the RAB yet.')];
    }

    // the documents made for this project; with money access also the next PDF and the RAB header it is made from
    function docsPane() {
      var mine = (d.docs.v || []).filter(function (x) { return x.project_id === p.id; });
      var out = [paneH('Documents'), d.docs.e ? empty(E.ecoError(d.docs.e), true) : !mine.length ? empty('No PDFs for this project yet.')
        : h('ul', { class: 'docs' }, mine.map(function (x) { return E.docItem(x); }))];
      if (!money || !m) return out;
      // what still blocks the next PDF
      var before = [];
      if (holders.length) before.push(holders.join(', ') + (holders.length === 1 ? ' is still a placeholder' : ' are still placeholders'));
      if (p.unlocked_gear > 0) before.push(E.plural(p.unlocked_gear, 'gear price') + (p.unlocked_gear === 1 ? ' isn’t' : ' aren’t') + ' locked');
      if (before.length && (ph === 'Draft' || ph === 'Deal')) out.push(h('p', { class: 'note amber' }, I('alert'), h('span', { text: 'Before the ' + (ph === 'Draft' ? 'quote' : 'invoice') + ' PDF: ' + before.join(', and ') + '.' })));
      // a PDF of the RAB tab, made by the Sheet into the client's Drive folder; it asks before locking prices or
      // keeping [placeholder] text, the same two checks the Sheet's own export makes
      if (writeMoney) {
        var kind = docType(meta.doc_type || p.doc_type) || 'PENAWARAN';
        var typeBtns = DOC_TYPES.map(function (o) {
          return h('button', { type: 'button', 'aria-pressed': String(o[0] === kind), onclick: function () {
            kind = o[0];
            typeBtns.forEach(function (b, i) { b.setAttribute('aria-pressed', String(DOC_TYPES[i][0] === kind)); });
          } }, o[1]);
        });
        var pdfNote = h('span', { class: 'fmsg', role: 'status' }), pdfSend = E.writer();
        pdfBtn = h('button', { class: 'btn lime', type: 'button', onclick: function () {
          var ok = { lock: false, accept_placeholders: false }, type = kind;
          var say = function (t, err) { pdfNote.textContent = t || ''; pdfNote.classList.toggle('is-err', !!err); };
          var busy = function (x) { pdfBtn.disabled = x; typeBtns.forEach(function (b) { b.disabled = x; }); };
          var stop = function (t, err) { busy(false); say(t, err); };
          busy(true);
          (function go() {
            say('Making the PDF in the Sheet…');
            pdfSend('export_pdf', { project_id: p.id, doc_type: type, lock: ok.lock, accept_placeholders: ok.accept_placeholders }).then(function (r) {
              if (r.status === 200 || r.status === 202) {
                var f = r.body.record && r.body.record.file;
                return saved(p.id, r, f && f.name ? 'PDF saved to Drive: ' + f.name : 'PDF saved to Drive.');
              }
              if (!(r.status === 409 && r.body.needs_confirm)) return stop(E.writeText(r), true);
              var det = r.body.detail || {}, k = E.n(det.unlocked);
              var q = k ? ['Lock the gear prices?', E.plural(k, 'equipment price') + (k === 1 ? ' isn’t' : ' aren’t') + ' locked yet. Lock at the current prices, then make the PDF?', 'Lock and make PDF', 'lock']
                // the placeholders by what they say (as the quote shows them), the Sheet's cells only when they aren't known here
                : ['Make the PDF with placeholders?', 'The top of the document still has ' + (holders.length ? holders.join(', ')
                  : '[placeholder] text' + (Array.isArray(det.placeholders) && det.placeholders.length ? ' in ' + det.placeholders.slice(0, 8).join(', ') : ''))
                  + '. Make the PDF anyway?', 'Make PDF anyway', 'accept_placeholders'];
              // the refused attempt is cleared first, so it doesn't wait in the Sheet's list
              E.sheetWrite('outbox_discard', { op_id: r.op_id }).catch(function () {}).then(function () { return A.ask(q[0], q[1], q[2]); }).then(function (yes) {
                if (!yes) return stop('');
                ok[q[3]] = true; go();
              });
            }, function (e) { stop(E.ecoError(e), true); });
          })();
        } }, I('docs', 's'), 'Make PDF');
        out.push(h('div', { class: 'formacts' }, h('div', { class: 'tabs', role: 'group', 'aria-label': 'Document to make' }, typeBtns), pdfBtn, pdfNote));
      }
      if (rab && rab.meta && writeMoney && v2) out = out.concat(quoteForm());
      else if (rab && rab.meta) {
        var pc = function (v) { return v == null ? '0%' : E.pct(v); };
        out.push(paneH('Quote settings', src('RAB header')), E.props([
          ['Document type', meta.doc_type || p.doc_type], ['Title', meta.title], ['Client on the invoice', meta.client_label], ['Product', meta.product],
          ['Photographer', meta.photographer ? (holders.indexOf(String(meta.photographer).trim()) > -1 ? E.quiet(meta.photographer) : meta.photographer) : null],
          ['Locations and days', [E.n(meta.locations) != null ? E.plural(E.n(meta.locations), 'location') : null,
            E.n(meta.shooting_days) != null ? E.plural(E.n(meta.shooting_days), 'shooting day') : null].filter(Boolean).join(', ')],
          ['Location', meta.location], ['Usage and language', [meta.usage, meta.language].filter(Boolean).join(', ')],
          ['Diskon, PPN, DP, PPh 23', [m.discount_pct, m.ppn_pct, m.dp_pct, m.pph23_pct].map(pc).join(', ')]
        ]));
      }
      return out;
    }
    // the RAB header and its percentages, written to the RAB tab (the Sheet works out the totals again)
    function quoteForm() {
      var qf = E.sheetForm({ label: 'Save quote settings', op: 'rab_meta', look: 'mock',
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
      // text still in [brackets] is the template's placeholder: marked until it is replaced
      var text = function (key, label, max, full, hint) {
        var raw = meta[key] == null ? '' : String(meta[key]), held = /^\[.+\]$/.test(raw.trim());
        var input = h('input', { type: 'text', maxlength: max || 200, autocomplete: 'off', placeholder: hint || '', value: raw });
        var tip = h('span', { class: 'hint', hidden: !held, text: 'Placeholder from the template. Replace it before the PDF goes out.' });
        var lab = h('label', { class: 'f' + (full ? ' full' : '') + (held ? ' warn' : '') }, label, qf.field(key, input, meta[key]), tip);
        if (held) {
          if (!jumpTo.quote) jumpTo.quote = input;
          input.addEventListener('input', function () { var still = /^\[.+\]$/.test(input.value.trim()); lab.classList.toggle('warn', still); tip.hidden = !still; });
        }
        return lab;
      };
      var pcField = function (key, label) { return h('label', { class: 'f' }, label, qf.field(key, E.shareInput(m[key], label), m[key], E.share)); };
      var types = docType(meta.doc_type) ? DOC_TYPES : [['', 'Not set']].concat(DOC_TYPES);
      return [paneH('Quote settings', src('RAB header')), h('div', { class: 'fgrid' },
        h('label', { class: 'f' }, 'Document type', qf.field('doc_type', A.select(types, docType(meta.doc_type)), meta.doc_type)),
        h('label', { class: 'f' }, 'Quote date', qf.field('quote_date', h('input', { type: 'date', value: E.isoDay(meta.quote_date) }), meta.quote_date, E.dayOf)),
        text('title', 'Title', 200, true), text('client_label', 'Client on the invoice'), text('product', 'Product'),
        text('photographer', 'Photographer'), text('location', 'Location'),
        text('locations', 'Number of locations', 200, false, '1'), text('shooting_days', 'Shooting days', 200, false, '1'),
        text('usage', 'Usage'), text('language', 'Language'),
        pcField('discount_pct', 'Diskon (%)'), pcField('ppn_pct', 'PPN (%)'), pcField('dp_pct', 'DP (%)'), pcField('pph23_pct', 'PPh 23 (%)')), qf.bar];
    }

    // a Brief becomes a RAB in the Sheet: a new tab from the template, its Rekap Project row, and the client if it's new
    function makeRabPane() {
      if (edit && !p.archived_at && on) return makeRab(p, d.clients, jumpTo, function (r, t) { saved(p.id, r, t); });
      return [paneH('Make the RAB'), empty(!edit || p.archived_at ? 'A Brief: there is no RAB for it in the Sheet yet.'
        : vErr ? 'The Sheet settings couldn’t be loaded, so the RAB can’t be made from here yet. Reload to try again.'
        : 'Sheet writes are paused, so the RAB can’t be made from here for now.', edit && !p.archived_at && vErr)];
    }

    // ---- the parts as tabs (one part shows at a time) ----
    var main = h('section', { class: 'card pg-main', 'aria-label': 'Project work' }), tabBtns = {}, paneEls = {};
    var cur = paneOf[p.id];
    if (!panes.some(function (x) { return x.key === cur; })) cur = panes[0].key;
    if (panes.length > 1) {
      main.appendChild(h('div', { class: 'tabs', role: 'group', 'aria-label': 'Project sections', 'data-k': 'tabs' }, panes.map(function (x) {
        tabBtns[x.key] = h('button', { type: 'button', 'aria-pressed': String(x.key === cur), 'aria-controls': 'pj-pane-' + x.key, onclick: function () { setPane(x.key); } },
          x.label, x.count != null ? h('span', { class: 'c', text: String(x.count) }) : null);
        return tabBtns[x.key];
      })));
    }
    panes.forEach(function (x) {
      paneEls[x.key] = h('div', { class: 'pane', id: 'pj-pane-' + x.key, 'data-k': 'pane-' + x.key, hidden: x.key !== cur }, x.nodes);
      main.appendChild(paneEls[x.key]);
    });
    function setPane(k) {
      if (!paneEls[k]) return;
      paneOf[p.id] = cur = k;
      Object.keys(paneEls).forEach(function (j) {
        paneEls[j].hidden = j !== k;
        if (tabBtns[j]) tabBtns[j].setAttribute('aria-pressed', String(j === k));
      });
    }
    // a button elsewhere on the page that opens a part, and the field to start in
    function jump(k, el) {
      setPane(k);
      main.scrollIntoView({ behavior: smooth(), block: 'start' });
      if (el) el.focus({ preventScroll: true });
    }

    // ---- Needs you: the next step, and what else is open on this project ----
    function needsCard() {
      var step = E.nextStep(p, m, ctx(p)), items = [], k = p.unlocked_gear || 0, collect = money && A.canEdit() ? h('a', { class: 'btn sm', href: '#finance/' + p.id }, 'Collect') : null;
      var add = function (icon, tone, t, sub, act) { items.push({ icon: icon, tone: tone, title: t, sub: sub, act: act }); };
      var btn = function (label, fn, lime, icon) { return h('button', { class: 'btn sm' + (lime ? ' lime' : ''), type: 'button', onclick: fn }, icon ? I(icon, 's') : null, label); };
      var link = function (label, href) { return h('a', { class: 'btn sm', href: href }, label); };
      // an old layout RAB is changed in the Sheet: its items there get the RAB link instead of a button
      var inSheet = function () { return p.layout === 'v1' && url && edit ? newTab(url, [I('ext', 's'), 'Open RAB'], 'btn sm') : null; };
      var quoteAge = function () {
        var n = p.quote_date ? E.days(p.quote_date, E.today()) : null;
        return p.quote_date ? 'Quote dated ' + E.day(p.quote_date, { year: false }) + (n > 0 ? ', ' + E.plural(n, 'day') + ' ago' : '') : null;
      };
      var gear = function () {
        var open = gearLines.filter(function (l) { return E.n(l.manual_price) == null; });
        var from = open.map(function (l) { return l.vendor; }).filter(function (v, i, all) { return v && all.indexOf(v) === i; });
        var dates = open.map(function (l) { return l.price_date; }).filter(Boolean).sort();
        add('lock', 'amber', 'Lock ' + E.plural(k, 'gear price'),
          from.length ? 'Prices from ' + from.join(', ') + (dates.length ? ', ' + E.day(dates[dates.length - 1], { year: false }) : '') : 'Each is fixed at its current price',
          canLock ? btn('Lock prices', lockPrices, true, 'lock') : inSheet());
      };
      var isGear = /^Lock \d+ gear price/.test(step);
      if (brief && p.archived_at) step = '';
      if (step === 'Make the RAB') add('rab', null, 'Make the RAB', 'A new RAB tab in the Sheet, made from this Brief', jumpTo.code ? btn('Make the RAB', function () { jumpTo.code.focus(); }) : null);
      else if (step === 'Fill the RAB') add('rab', null, 'Fill the RAB', 'The quote total is still empty',
        rab && Array.isArray(rab.sections) ? btn('See the budget', function () { jump('budget'); }) : url ? newTab(url, [I('ext', 's'), 'Open RAB'], 'btn sm') : null);
      else if (isGear) gear();
      else if (step === 'Make the quote PDF') add('docs', null, 'Make the quote PDF', 'A Penawaran from the RAB tab, saved to Drive', pdfBtn ? btn('Make PDF', function () { jump('quote', pdfBtn); }) : null);
      else if (step === 'Send the quote, then mark it sent') add('send', 'violet', 'Send the quote', 'Then mark it Dikirim.', write ? btn('Mark Dikirim', function () { pickStatus('Dikirim'); }) : null);
      else if (step === 'Follow up with the client') add('chat', 'amber', 'Follow up with the client', quoteAge(), cid ? link('Open the client', '#clients/' + cid) : null);
      else if (step === 'Waiting for the client') add('clock', null, 'Waiting for the client', quoteAge(), null);
      else if (step === 'Record the DP') add('in', null, 'Record the DP', E.n(m && m.dp_amount) != null ? 'DP ' + E.rp(m.dp_amount) : null, jumpTo.dp ? btn('Record payments', function () { jump('money', jumpTo.dp); }) : null);
      else if (step === 'Set the shoot date') add('cal', null, 'Set the shoot date', null, editors.shoot && edit ? btn('Set date', function () { editors.shoot.open(); }) : null);
      else if (/^Shoot on /.test(step)) add('camera', 'lime', step, money && m ? (crewLines.length ? E.plural(heads, 'person', 'people') + ' in the RAB' : null)
        : (p.crew_names || []).length ? E.plural(p.crew_names.length, 'person', 'people') + ' in the RAB' : null, null);
      else if (step === 'Deliver final files, then mark delivered') add('send', null, 'Deliver the final files', 'Then mark them delivered.', write && editors.delivered ? btn('Mark delivered', function () { editors.delivered.open(); }) : null);
      else if (step === 'Waiting for the payment') add('clock', null, 'Waiting for the payment', p.payment_due ? 'Due ' + E.when(p.payment_due) : null, null);
      else if (/^Overdue: collect /.test(step)) add('alert', 'red', step, p.payment_due ? 'Was due ' + E.when(p.payment_due) : null, collect);
      else if (/^Collect /.test(step)) add('in', null, step, null, collect);
      else if (step === 'Paid in full: mark Lunas') add('check', 'lime', 'Paid in full', 'Mark it Lunas.', write ? btn('Mark Lunas', function () { pickStatus('Lunas'); }) : null);
      else if (/^Pay crew: /.test(step)) add('wallet', 'amber', step, 'Marked Belum in the Kas', money ? link('Open Finance', '#finance') : null);
      else if (step === 'Add to the portfolio') add('image', null, 'Add to the portfolio', 'A case study for the Work page', edit
        ? h('div', { class: 'acts' }, btn('Start a portfolio item', startPortfolio, true, 'plus'),
          h('button', { class: 'btn sm quiet', type: 'button', onclick: function (e) { setSkip(true, e.currentTarget); } }, 'Not for the portfolio'))
        : link('Open the portfolio', '#portfolio'));
      // what else is open: unlocked prices, placeholders in the quote, costs that aren't billed
      if (!isGear && k > 0 && (ph === 'Draft' || ph === 'Deal')) gear();
      if (money && holders.length && (ph === 'Draft' || ph === 'Dikirim' || ph === 'Deal')) {
        add('edit', 'amber', 'Replace ' + holders[0] + (holders.length > 1 ? ' and ' + (holders.length - 1) + ' more' : ''), 'Still a placeholder in the quote',
          jumpTo.quote ? btn('Open quote settings', function () { jump('quote', jumpTo.quote); }) : inSheet());
      }
      if (money && m && unbilled.length) {
        add('alert', loss ? 'red' : 'amber', unbilled.length === 1 ? unbilled[0].label + ' isn’t billed' : E.plural(unbilled.length, 'cost') + ' aren’t billed',
          (unbilled.length === 1 ? 'It costs ' : 'Together they cost ') + E.rp(gap) + '.' + (loss ? ' That’s where the loss comes from.' : ''),
          btn('See costs', function () { jump('money'); }));
      }
      return h('section', { class: 'card pg-todo', 'aria-labelledby': 'todo-h', 'data-k': 'todo' },
        h('header', { class: 'card-h' }, h('h2', { id: 'todo-h', text: 'Needs you' }), items.length ? h('span', { class: 'badge', text: String(items.length) }) : null),
        items.length ? h('ul', { class: 'todo' }, items.map(function (t) {
          return h('li', {}, h('span', { class: 'nic' + (t.tone ? ' ' + t.tone : '') }, I(t.icon)), h('b', { text: t.title }), t.sub ? h('span', { text: t.sub }) : null, t.act);
        })) : empty('Nothing needs you on this project.'));
    }

    // ---- Details: who and when; the dates the admin keeps open in place ----
    // a date field that saves once the typed date is whole: a date field reports every finished part while typing (a
    // year like 0202 must never be saved), so a change waits a moment, and is saved at once when the field is left
    var dateField = function (label, value, commit) {
      return function (note, done) {
        var st = { busy: false, bad: false }, wait = null, input = h('input', { type: 'date', value: value() || '' });
        var go = function () {
          clearTimeout(wait); wait = null;
          var v = input.value || null;
          if (v === (value() || null) || (v && !/^20\d\d-\d\d-\d\d$/.test(v))) { st.busy = false; return done(); }
          st.bad = false;
          commit(v, input, note, function (ok) { st.busy = false; st.bad = !ok; done(); });
        };
        input.addEventListener('change', function () { clearTimeout(wait); st.busy = true; wait = setTimeout(go, 1200); });
        input.addEventListener('blur', function () { if (wait) go(); });
        return { el: h('label', { class: 'f' }, label, input), input: input, st: st };
      };
    };
    var kept = function (field) {
      return function (v, input, note, cb) { save(p, field, v, input, note, function () { cb(false); }, function () { cb(true); refreshNeeds(); }); };
    };
    // the day the final files went out: Rekap Project
    var deliveredSend = E.writer();
    var toSheet = function (v, input, note, cb) {
      input.disabled = true; note.textContent = 'Saving to the Sheet…'; note.classList.remove('is-err');
      var back = function (t) { input.disabled = false; input.value = p.final_file_date || ''; note.textContent = t; note.classList.add('is-err'); cb(false); };
      deliveredSend('project_set', { project_id: p.id, set: { final_file_date: v }, expect: { final_file_date: p.final_file_date } }).then(function (r) {
        if (r.status === 200 || r.status === 202) return saved(p.id, r, v ? 'Files delivered on ' + E.day(v) + ', saved to the Sheet.' : 'Delivery date cleared in the Sheet.');
        back(E.writeText(r));
      }, function (e) { back(E.ecoError(e)); });
    };
    // shown as text with a button; the button opens the date fields in place, and they fold back to text once focus
    // has left them and nothing is saving or wrong
    function editor(key, what, makers, text, addText, can, none) {
      var dd = h('dd', { class: 'dd-ed' }), note = h('span', { class: 'fmsg', role: 'status' }), made = null, box = null;
      var paint = function () {
        made = null; box = null; dd.innerHTML = '';
        var t = text();
        if (t) dd.appendChild(h('span', { text: t }));
        if (can) dd.appendChild(h('button', { class: 'add', type: 'button', 'aria-label': (t ? 'Change ' : 'Add ') + what, onclick: unfold }, t ? 'Change' : addText));
        else if (!t) dd.appendChild(E.quiet(none || 'Not set'));
      };
      var fold = function () {
        if (!box || box.contains(document.activeElement)) return;
        if (made.some(function (x) { return x.st.busy || x.st.bad; })) return;
        paint();
      };
      function unfold() {
        if (!box) {
          dd.innerHTML = ''; note.textContent = ''; note.classList.remove('is-err');
          made = makers.map(function (mk) { return mk(note, function () { setTimeout(fold, 0); }); });
          box = h('div', { class: 'dedit' }, made.map(function (x) { return x.el; }), note);
          box.addEventListener('focusout', function () { setTimeout(fold, 0); });
          dd.appendChild(box);
        }
        made[0].input.focus();
      }
      paint();
      if (can) editors[key] = { open: unfold };
      return dd;
    }
    var todo = needsCard();
    function refreshNeeds() { var next = needsCard(); todo.replaceWith(next); todo = next; }
    function details() {
      var dl = h('dl', { class: 'props' });
      var row = function (dt, dd) {
        if (dd == null || dd === '') return;
        dl.appendChild(typeof dt === 'string' ? h('dt', { text: dt }) : dt);
        dl.appendChild(dd.nodeType === 1 && dd.tagName === 'DD' ? dd : h('dd', {}, dd));
      };
      var rs = money && vals.rekap_summary ? vals.rekap_summary.value : null, tempo = rs ? E.n(rs.tempo_days) : null;
      var items = (d.port.v || []).filter(function (it) { return it.project_id === p.id; });
      row('Client', cid ? h('a', { href: '#clients/' + cid, text: who }) : who);
      row('Lead', d.lead.e ? E.quiet('Couldn’t load') : d.lead.v[0] ? h('a', { href: '#leads/' + d.lead.v[0].id, text: d.lead.v[0].name }) : null);
      if (!brief) row('Quote date', p.quote_date ? E.day(p.quote_date) : E.quiet('Not set'));
      row('Shoot', editor('shoot', 'the shoot dates', [dateField('Starts', function () { return p.shoot_date; }, kept('shoot_date')),
        dateField('Ends', function () { return p.shoot_end; }, kept('shoot_end'))], function () { return E.shootText(p); }, 'Add dates', edit));
      row('Deliver by', editor('deliver', 'the deliver by date', [dateField('Deliver by', function () { return p.deliver_by; }, kept('deliver_by'))],
        function () { return p.deliver_by ? E.day(p.deliver_by) : ''; }, 'Add a date', edit));
      if (!brief) {
        row(h('dt', {}, 'Files delivered', write ? [I('sheet', 'sh'), h('span', { class: 'sr', text: ', saved to Rekap Project in the Sheet' })] : null),
          editor('delivered', 'the files delivered date', [dateField('Files delivered', function () { return p.final_file_date; }, toSheet)],
            function () { return p.final_file_date ? E.day(p.final_file_date) : ''; }, 'Add a date', write, 'Not yet'));
        row('Payment due', p.payment_due ? E.day(p.payment_due) : E.quiet(tempo != null ? E.plural(tempo, 'day') + ' after the files are delivered' : 'Not set'));
      }
      // the portfolio: the items linked to it, or Not for the portfolio (Undo brings its step back), or not in it yet
      var word = { draft: 'Draft', published: 'Live', archived: 'Archived' };
      portDd = h('dd', {});
      portPaint = function () {
        portDd.innerHTML = '';
        if (d.port.e) return portDd.appendChild(E.quiet('Couldn’t check'));
        if (items.length) return A.add(portDd, items.map(function (it, i) { return [i ? ', ' : '', h('a', { href: '#portfolio/' + it.id, text: it.title }), ' (' + (word[it.status] || it.status) + ')']; }));
        portDd.appendChild(E.quiet(p.portfolio_skip ? 'Not for the portfolio' : 'Not in the portfolio'));
        if (p.portfolio_skip && edit) portDd.appendChild(h('button', { class: 'add', type: 'button', 'aria-label': 'Undo Not for the portfolio', onclick: function (e) { setSkip(false, e.currentTarget); } }, 'Undo'));
      };
      portPaint();
      row('Portfolio', portDd);
      var sheetNote = p.note_text && p.note_text.trim() !== 'Folder project' ? p.note_text : null;
      var block = function (k, t) { return h('div', { class: 'dnote' }, h('p', { class: 'k', text: k }), h('p', { class: 'pre', text: t })); };
      var notes = null, noteMsg = h('span', { class: 'fmsg', role: 'status' });
      if (edit) {
        noteBox = h('textarea', { value: p.notes || '', maxlength: 4000, placeholder: 'Notes for the team' });
        noteBox.addEventListener('change', function () {
          var before = sent;
          sent = noteBox.value.trim() || null;
          save(p, 'notes', sent, noteBox, noteMsg, function () { sent = before; });
        });
        notes = [h('label', { class: 'f dnote' }, 'Notes', noteBox), noteMsg];
      } else if (p.notes) notes = block('Notes', p.notes);
      return h('section', { class: 'card pg-det', 'aria-labelledby': 'det-h', 'data-k': 'det' },
        h('header', { class: 'card-h' }, h('h2', { id: 'det-h', text: 'Details' })), dl,
        sheetNote ? block('Note in the Sheet', sheetNote) : null, notes,
        h('p', { class: 'src' }, I('sheet'), h('span', { text: write ? 'Files delivered is saved to Rekap Project. Dates and notes save as you change them.'
          : edit ? 'Dates and notes save as you change them.' : brief ? 'Kept in the admin until its RAB is made in the Sheet.' : E.fromSheet(vals, p.rab_seen_at || p.sheet_seen_at) + '.' })));
    }

    // ---- History: where it came from, then every recorded change ----
    function history() {
      var told = function (v) {
        if (v == null || v === '') return 'empty';
        if (typeof v === 'number') return E.num(v);
        if (typeof v === 'string') return /^\d{4}-\d{2}-\d{2}$/.test(v) ? E.day(v) : '“' + E.clip(v, 60) + '”';
        return E.clip(JSON.stringify(v), 60);
      };
      var list = [{ at: p.created_at, icon: p.origin === 'sheet' ? 'sheet' : 'plus', text: p.origin === 'sheet' ? 'Came in from the Sheet' : 'Added in the admin',
        sub: p.origin === 'sheet' && p.sheet_row ? 'Rekap Project row ' + p.sheet_row : null }];
      (d.changes.v || []).forEach(function (c) {
        list.push({ at: c.at, icon: c.source === 'sheet' ? 'sheet' : 'edit', text: (FIELD[c.field] || c.field.replace(/_/g, ' ')) + ': ' + told(c.old_value) + ' to ' + told(c.new_value),
          sub: c.source === 'sheet' ? 'In the Sheet' : c.actor_email });
      });
      (d.acts.v || []).forEach(function (a) {
        if (a.action !== 'created') list.push({ at: a.at, icon: a.source === 'sheet' ? 'sheet' : 'edit', text: (a.actor_email || 'Someone') + ' ' + a.action + ' this project', sub: a.source === 'sheet' ? 'In the Sheet' : null });
      });
      list.sort(function (a, b) { return new Date(b.at) - new Date(a.at); });
      var SHOW = 6, all = false;
      var ul = h('ul', { class: 'hist' }, list.map(function (it, i) {
        return h('li', { hidden: i >= SHOW }, h('span', { class: 'av', 'aria-hidden': 'true' }, I(it.icon)), h('p', {}, it.text, it.sub ? h('span', { text: it.sub }) : null),
          h('time', { datetime: it.at || null, title: E.stamp(it.at), text: E.shortStamp(it.at) }));
      }));
      var more = list.length > SHOW ? h('button', { class: 'link', type: 'button', 'aria-expanded': 'false', onclick: function () {
        all = !all;
        A.$$('li', ul).forEach(function (x, i) { x.hidden = !all && i >= SHOW; });
        more.textContent = all ? 'Show the latest ' + SHOW : 'Show all ' + list.length;
        more.setAttribute('aria-expanded', String(all));
      } }, 'Show all ' + list.length) : null;
      return h('section', { class: 'card pg-hist', 'aria-labelledby': 'hist-h', 'data-k': 'hist' },
        h('header', { class: 'card-h' }, h('h2', { id: 'hist-h', text: 'History' })), ul, more,
        d.changes.e || d.acts.e ? empty('Part of the history couldn’t be loaded. Reload to try again.', true) : null);
    }

    var det = details();
    // Needs you reads the date editors (made with Details) and the jump targets (made with the parts)
    todo = needsCard();
    ui.page.innerHTML = '';
    A.add(ui.page, [crumb(), head, tiles, h('div', { class: 'pgrid' }, main, todo, det, history())]);
    A.pageGuard(function () { return (!!noteBox && (noteBox.value.trim() || null) !== sent) || forms.some(function (f) { return f.dirty(); }); });
  }

  // the client code picks the client in the Client tab; a code that isn't there yet adds the client with the RAB
  function makeRab(p, cl, jumpTo, done) {
    var list = cl.v || [], pc = p.plan_client && typeof p.plan_client === 'object' ? p.plan_client : {};
    var known = p.plan_client_id ? list.filter(function (c) { return c.id === p.plan_client_id; })[0] : null;
    var input = function (max, ph, v) { return h('input', { type: 'text', maxlength: max, autocomplete: 'off', placeholder: ph || '', value: v || '' }); };
    var f = {
      code: input(5, 'HOMI', (known && known.code) || pc.code || ''),
      project: input(80, 'Photoshoot Campaign', String(p.plan_title || '').slice(0, 80)),
      doc: A.select(DOC_TYPES, 'PENAWARAN'),
      name: input(200, 'Client name', known ? '' : pc.name), pic: input(200, '', known ? '' : pc.pic),
      phone: input(60, '', known ? '' : pc.phone), email: input(254, '', known ? '' : pc.email)
    };
    jumpTo.code = f.code;
    var byCode = function (code) { return list.filter(function (c) { return String(c.code || '').toUpperCase() === code && c.sheet_state !== 'missing'; })[0] || null; };
    var who = h('p', { class: 'help full', role: 'status' });
    var fresh = [h('label', { class: 'f full' }, 'Client name', f.name), h('label', { class: 'f' }, 'PIC', f.pic), h('label', { class: 'f' }, 'Phone', f.phone),
      h('label', { class: 'f full' }, 'Email', f.email)];
    function refresh() {
      var code = f.code.value.trim().toUpperCase(), c = byCode(code), isNew = /^[A-Z]{2,5}$/.test(code) && !c;
      fresh.forEach(function (x) { x.hidden = !isNew; });
      who.textContent = c ? code + ' is ' + (c.name || code) + ' in the Client tab.' : isNew ? code + ' is a new client code: the client is added to the Client tab with the RAB.'
        : cl.e ? 'The client list couldn’t be loaded, so a new code can’t be checked. Reload to try again.' : 'Two to five capital letters, used in the invoice number.';
    }
    f.code.addEventListener('input', function () {
      var v = f.code.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 5);
      if (v !== f.code.value) f.code.value = v;
      refresh();
    });
    refresh();
    var send = E.writer(), msg = h('span', { class: 'fmsg', role: 'status' });
    var say = function (t, err) { msg.textContent = t || ''; msg.classList.toggle('is-err', !!err); };
    var all = [f.code, f.project, f.doc, f.name, f.pic, f.phone, f.email];
    // a field that needs fixing is marked and takes focus, with the reason beside the button
    var bad = function (el, t) { say(t, true); if (el) { el.setAttribute('aria-invalid', 'true'); el.focus(); } };
    var btn = h('button', { class: 'btn lime', type: 'button', onclick: function () {
      var code = f.code.value.trim().toUpperCase(), project = f.project.value.trim(), c = byCode(code), client = null;
      all.forEach(function (x) { x.removeAttribute('aria-invalid'); });
      if (!/^[A-Z]{2,5}$/.test(code)) return bad(f.code, 'The client code is 2 to 5 capital letters, like HOMI.');
      if (cl.e) return say('The client list couldn’t be loaded. Reload to try again.', true);
      if (!project) return bad(f.project, 'Give the project a short name.');
      if (!c) {
        if (!f.name.value.trim()) return bad(f.name, code + ' is a new code: give the client a name.');
        client = { name: f.name.value.trim() };
        ['pic', 'phone', 'email'].forEach(function (k) { var v = f[k].value.trim(); if (v) client[k] = v; });
        if (client.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(client.email)) return bad(f.email, 'Check the email address.');
      }
      say('');
      A.ask('Make the RAB in the Sheet?', 'A new RAB tab for ' + (c ? c.name || code : client.name) + ' is added to the Sheet from the template, with its row in Rekap Project'
        + (client ? ' and ' + code + ' in the Client tab' : '') + '. It starts as a Draft.', 'Make the RAB').then(function (go) {
        if (!go) return;
        all.forEach(function (x) { x.disabled = true; }); btn.disabled = true; say('Making the RAB in the Sheet…');
        var back = function (t) { all.forEach(function (x) { x.disabled = false; }); btn.disabled = false; say(t, true); };
        send('create_rab', { project_id: p.id, code: code, project: project, doc_type: f.doc.value, client: client }).then(function (r) {
          if (r.status !== 200 && r.status !== 202) return back(E.writeText(r));
          var tab = r.body.record && r.body.record.tab;
          done(r, tab && tab.name ? 'RAB made in the Sheet: ' + tab.name + '.' : 'RAB made in the Sheet.');
        }, function (e) { back(E.ecoError(e)); });
      });
    } }, 'Make the RAB');
    return [paneH('Make the RAB', src('In the Sheet')),
      h('div', { class: 'fgrid' }, h('label', { class: 'f' }, 'Client code', f.code), h('label', { class: 'f' }, 'Document type', f.doc), who, fresh,
        h('label', { class: 'f full' }, 'Project name in the RAB', f.project)),
      h('div', { class: 'formacts' }, btn, msg)];
  }

  // ---------- a new project: a Brief in the admin, until its RAB is made in the Sheet ----------
  // pre.lead: a Brief started from a lead takes its company (an existing client when the name matches) and what they asked for
  function newBrief(pre) {
    if (!A.canEdit()) return;
    var lead = pre && pre.lead && E.isId(pre.lead.id) ? pre.lead : null;
    E.data.clients().then(function (c) { briefForm(c, lead); }, function () { briefForm(null, lead); });
  }
  function briefForm(clients, lead) {
    var live = (clients || []).filter(function (c) { return c.sheet_state !== 'missing'; });
    var opts = [['', 'Pick a client']].concat(live.map(function (c) { return [c.id, (c.name || c.code) + ', ' + c.code]; }), [['new', 'A new client']]);
    var whom = lead ? String(lead.company || lead.name || '').trim() : '';
    var match = whom ? live.filter(function (c) { return E.words(c.name).trim() === E.words(whom); })[0] : null;
    var start = { cname: match ? '' : whom, notes: lead && lead.description ? String(lead.description).slice(0, 4000) : '' };
    var f = {
      title: h('input', { type: 'text', maxlength: 120, autocomplete: 'off', placeholder: 'Photoshoot Campaign' }),
      client: A.select(opts, match ? match.id : clients && !lead ? '' : 'new'),
      cname: h('input', { type: 'text', maxlength: 200, autocomplete: 'off', value: start.cname }),
      shoot_date: h('input', { type: 'date' }), shoot_end: h('input', { type: 'date' }), deliver_by: h('input', { type: 'date' }),
      notes: h('textarea', { maxlength: 4000, placeholder: 'What the client asked for', value: start.notes })
    };
    var nameRow = h('label', { class: 'f full' }, 'Client name', f.cname);
    var pick = function () { nameRow.hidden = f.client.value !== 'new'; };
    f.client.addEventListener('change', pick); pick();
    var msg = h('span', { class: 's', role: 'status' });
    var say = function (t, err) { msg.textContent = t || ''; msg.classList.toggle('neg', !!err); };
    var dirty = function () {
      return !!(f.title.value.trim() || f.cname.value.trim() !== start.cname.trim() || f.shoot_date.value || f.shoot_end.value || f.deliver_by.value ||
        f.notes.value.trim() !== start.notes.trim());
    };
    var btn = h('button', { class: 'btn lime', type: 'button', onclick: function () {
      var row = { plan_title: f.title.value.trim(), shoot_date: f.shoot_date.value || null, shoot_end: f.shoot_end.value || null,
        deliver_by: f.deliver_by.value || null, notes: f.notes.value.trim() || null };
      // a failed check names the field and puts the cursor in it
      var bad = function (el, t) { say(t, true); el.setAttribute('aria-invalid', 'true'); el.focus(); };
      [f.title, f.client, f.cname, f.shoot_end].forEach(function (el) { el.removeAttribute('aria-invalid'); });
      if (!row.plan_title) return bad(f.title, 'Give the project a name.');
      if (!f.client.value) return bad(f.client, 'Pick a client from the list.');
      if (f.client.value === 'new') {
        if (!f.cname.value.trim()) return bad(f.cname, 'Give the new client a name.');
        row.plan_client = { name: f.cname.value.trim() };
      } else {
        // the id links the Brief to the client; the name and code show it in lists before the RAB exists
        var c = (clients || []).filter(function (x) { return x.id === f.client.value; })[0];
        row.plan_client_id = f.client.value;
        if (c && c.name) row.plan_client = /^[A-Z]{2,5}$/.test(c.code || '') ? { name: c.name, code: c.code } : { name: c.name };
      }
      if (row.shoot_date && row.shoot_end && row.shoot_end < row.shoot_date) return bad(f.shoot_end, 'The shoot can’t end before it starts.');
      if (lead) row[lead.kind === 'website' ? 'inquiry_id' : 'manual_lead_id'] = lead.id;
      btn.disabled = true; say('Saving…');
      sb.from('projects').insert(row).select('id').single().then(function (r) {
        if (r.error || !r.data) { btn.disabled = false; return say(r.error ? E.ecoError(r.error) : 'Your account isn’t allowed to do this.', true); }
        A.guard(null); E.forget();
        A.toast('Brief saved. Make its RAB when the quote is ready.');
        // the new project's own page, wherever the Brief was started (the list, a lead, the search)
        location.hash = '#projects/' + r.data.id;
      }, function (e) { btn.disabled = false; say(E.ecoError(e), true); });
    } }, 'Save brief');
    E.drawer(null, null, [
      E.dhead(h('span', { class: 'av', 'aria-hidden': 'true' }, I('plus')), 'New project',
        (lead ? 'From the lead ' + lead.name + '. ' : '') + 'It starts as a Brief. Its RAB is made in the Sheet when the quote is ready.'),
      h('div', { class: 'dr-body' }, h('div', { class: 'fgrid' },
        h('label', { class: 'f full' }, 'Project name', f.title), h('label', { class: 'f full' }, 'Client', f.client), nameRow,
        h('label', { class: 'f' }, 'Shoot starts', f.shoot_date), h('label', { class: 'f' }, 'Shoot ends', f.shoot_end),
        h('label', { class: 'f' }, 'Deliver by', f.deliver_by), h('label', { class: 'f full' }, 'Notes', f.notes))),
      h('div', { class: 'eco-actionbar' }, msg, btn)
    ]);
    A.guard(dirty);
    f.title.focus();
  }
  A.actions.projects = function () {
    return A.canEdit() ? h('button', { class: 'btn lime inline', type: 'button', onclick: function () { newBrief(); } }, I('plus', 's'), 'New project') : null;
  };
  E.newProject = function (pre) { if (A.canEdit()) newBrief(pre && pre.lead ? pre : null); };
  A.openers.projects = open;
})();
