/* Crew & Vendors: the crew list (the Crew tab of the Sheet, money access only: rates and what each person is owed)
   next to the creative network (the Network tab, drawn by people.js). As in the mockup both tabs sit under the same
   figures: what the crew is still owed (the Kas), what they were paid this year (the Crew tab) and who is new in the
   network. Owners and admins with money access change a person's details and add people here; each change is written
   to the Crew tab through sheets-write. The name is the key (Kas entries and RAB lines find people by it), so it never
   changes from the admin. */
(function () {
  'use strict';
  if (!window.cccAdmin) return; // admin.js stopped early: the sign in library didn't load
  var A = window.cccAdmin, E = window.eco, sb = A.sb, h = A.h, I = A.icon;
  var panel = A.$('[data-panel="crew"]'), netPanel = A.$('[data-panel="network"]'), ui = null, got = null, turn = 0;
  var empty = function (t, err) { return h('p', { class: 'empty' + (err ? ' is-err' : ''), text: t }); };
  var key = function (s) { return E.words(s).trim(); };
  var canWrite = function () { return A.canEdit() && A.canMoney(); };
  // a plain click opens the person over the list; a click with a modifier opens it in a new tab as a link does
  var go = function (id) {
    return function (e) {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button) return;
      e.preventDefault(); open(id);
    };
  };

  // the crew list, read again at most every 30 seconds (the list and the figures above both tabs use it)
  var cache = null;
  function crewList(fresh) {
    if (!fresh && cache && Date.now() - cache.at < 30000) return cache.p;
    var p = E.rows(sb.from('crew').select('*').order('name').limit(2000));
    cache = { at: Date.now(), p: p };
    p.catch(function () { if (cache && cache.p === p) cache = null; });
    return p;
  }
  var forget = function () { cache = null; E.forget(); };

  // ---------- above both tabs: the figures, and the two tabs for those who see both ----------
  // owed and paid need money access, the network figure an owner or admin; a figure that can't be loaded says so, never 0
  var tile = function (icon, label, tag, v, sub) {
    return h('article', { class: 'tile' }, h('p', { class: 'k' }, I(icon), h('span', { text: label }), tag),
      h('p', { class: 'v' + (v.soft ? ' soft' : ''), text: v.text }), h('p', { class: 'c', text: sub }));
  };
  var amountOf = function (x, failed) {
    return failed ? { text: 'Couldn’t load', soft: true } : E.n(x) == null ? { text: 'Not in the Sheet', soft: true } : { text: E.rp(x) };
  };
  function newInNetwork() {
    return sb.from('network_profiles').select('name, created_at', { count: 'exact' }).eq('status', 'new').order('created_at', { ascending: false }).limit(1)
      .then(function (r) { if (r.error) throw r.error; return { count: r.count || 0, top: (r.data || [])[0] || null }; });
  }
  function networkCount() {
    return sb.from('network_profiles').select('id', { count: 'exact', head: true }).then(function (r) { if (r.error) throw r.error; return r.count || 0; });
  }
  // which: the tab on screen ('crew' or 'network'); box: {tiles, tabs} on that tab
  function top(which, box) {
    var money = A.canMoney(), both = money && A.canEdit();
    var count = function (n) { return h('span', { class: 'c', text: n == null ? '' : String(n) }); };
    var tab = function (id, label, n) { return h('a', { href: '#' + id, 'data-sub': id, 'aria-current': which === id ? 'page' : null }, label, count(n)); };
    var tabs = function (crewN, netN) { box.tabs.innerHTML = ''; A.add(box.tabs, [tab('crew', 'Crew list', crewN), tab('network', 'Network', netN)]); };
    box.tabs.hidden = !both;
    if (both && !box.tabs.children.length) tabs(null, null);
    if (!money) { box.tiles.hidden = true; return; }
    Promise.all([E.settle(crewList()), E.settle(E.data.kas()), E.settle(E.data.values()),
      both ? E.settle(newInNetwork()) : null, both ? E.settle(networkCount()) : null]).then(function (r) {
      var crew = r[0], vals = r[2], fresh = r[3];
      var ks = vals.v && vals.v.kas_summary ? vals.v.kas_summary.value || {} : {};
      var owe = E.crewOwed(r[1].e ? null : r[1].v);
      var paid = (crew.v || []).filter(function (c) { return c.sheet_state !== 'missing' && E.n(c.paid_this_year) != null; });
      var list = [
        tile('out', 'Owed to crew', owe.tag, amountOf(ks.owed, !!vals.e), owe.sub),
        tile('check', 'Paid this year', null, amountOf(paid.length ? paid.reduce(function (t, c) { return t + E.n(c.paid_this_year); }, 0) : null, !!crew.e), 'From the Crew tab')];
      if (both) {
        var f = fresh.v;
        list.push(tile('crew', 'New in the network', null, fresh.e ? { text: 'Couldn’t load', soft: true } : { text: String(f.count) },
          fresh.e ? 'Reload to try again' : !f.count ? 'Nobody new' : (f.count > 1 ? 'Newest: ' : '') + f.top.name + ', ' + E.shortStamp(f.top.created_at)));
        tabs(crew.v ? crew.v.length : null, r[4].e ? null : r[4].v);
      }
      box.tiles.className = 'tiles ' + (both ? 't3' : 't2');
      box.tiles.innerHTML = ''; A.add(box.tiles, list); box.tiles.hidden = false;
    });
  }

  // ---------- the crew list ----------
  function build() {
    if (ui) return;
    ui = {
      tiles: h('section', { class: 'tiles t3', 'aria-label': 'Crew figures', hidden: true }),
      tabs: h('nav', { class: 'tabs', 'aria-label': 'Crew & Vendors' }),
      q: h('input', { type: 'search', placeholder: 'Search name, role, phone', 'aria-label': 'Search the crew list', autocomplete: 'off' }),
      src: h('span', { class: 'src r' }),
      note: h('p', { class: 'lnote', hidden: true, text: 'The Kas entries couldn’t be loaded, so how long each person has waited is left out. Reload to try again.' }),
      state: h('div', { class: 'lstate', hidden: true }),
      body: h('tbody')
    };
    ui.tbl = h('table', { class: 'tbl people' }, h('thead', {}, h('tr', {}, ['Person', 'Rate', 'Owed', 'Paid this year'].map(function (t) { return h('th', { text: t }); }),
      h('th', {}, h('span', { class: 'sr', text: 'Open' })))), ui.body);
    ui.q.addEventListener('input', E.debounce(draw, 150));
    panel.innerHTML = '';
    A.add(panel, [ui.tiles, h('section', { class: 'card tablecard', 'aria-label': 'Crew list' },
      h('div', { class: 'bar' }, ui.tabs, h('label', { class: 'field sm' }, I('search', 's'), ui.q), ui.src), ui.note, ui.state, ui.tbl)]);
  }
  function state(text, err, retry) {
    ui.state.innerHTML = ''; ui.state.hidden = !text;
    if (text) A.add(ui.state, [empty(text, err), retry ? h('button', { class: 'btn sm', type: 'button', onclick: retry }, 'Try again') : null]);
  }
  // how long each person's oldest unpaid Kas entry has waited, by crew id (an entry finds its person by the crew link or the name)
  function waits(crew, kas) {
    var out = {}, td = E.today();
    var unpaid = (kas || []).filter(function (k) { return k.kind === 'Keluar' && k.paid === 'Belum' && k.entry_date; });
    crew.forEach(function (c) {
      var k = key(c.name), mine = unpaid.filter(function (x) { return x.crew_id === c.id || key(x.counterparty) === k; });
      if (!mine.length) return;
      var d = E.days(mine.reduce(function (a, b) { return a.entry_date <= b.entry_date ? a : b; }).entry_date, td);
      if (d != null && d >= 0) out[c.id] = d;
    });
    return out;
  }
  var rateText = function (c) { return E.n(c.rate) == null ? null : E.rp(c.rate) + (c.rate_unit ? ' per ' + c.rate_unit : ''); };
  function row(c, w) {
    var gone = c.sheet_state === 'missing', owed = E.n(c.unpaid), paid = E.n(c.paid_this_year), href = '#crew/' + c.id;
    return h('tr', { 'data-href': href },
      h('td', {}, h('div', { class: 'pj' }, h('span', { class: 'av', 'aria-hidden': 'true', text: E.initial(c.name) }),
        h('div', {}, h('b', {}, h('a', { href: href, onclick: go(c.id), text: c.name })), c.role ? h('span', { text: c.role }) : null,
          gone ? h('span', { class: 'tag amber', text: 'No longer in the Sheet' }) : null))),
      h('td', { 'data-l': 'Rate' }, E.n(c.rate) == null ? h('span', { class: 'muted', text: 'Not set' })
        : [E.rp(c.rate), c.rate_unit ? h('span', { class: 'muted', text: ' per ' + c.rate_unit }) : null]),
      h('td', { 'data-l': 'Owed', class: owed > 0 ? null : 'muted' }, owed == null ? 'Not in the Sheet' : !(owed > 0) ? E.rp(0)
        : h('span', { class: 'owe' }, h('b', { text: E.rp(owed) }), w[c.id] != null ? h('span', { class: 'tag amber' }, I('clock'), E.plural(w[c.id], 'day')) : null)),
      h('td', { 'data-l': 'Paid this year', class: paid == null ? 'muted' : null, text: paid == null ? 'Not in the Sheet' : E.rp(paid) }),
      h('td', { class: 'go' }, I('chev', 's')));
  }
  function draw() {
    if (!got) return;
    var t = E.words(ui.q.value.trim());
    var list = got.crew.filter(function (c) { return !t || [c.name, c.role, c.phone].some(function (v) { return E.words(v).indexOf(t) > -1; }); })
      .sort(function (a, b) { return (a.sheet_state === 'missing') - (b.sheet_state === 'missing') || key(a.name).localeCompare(key(b.name)); });
    var w = waits(got.crew, got.kas);
    ui.body.innerHTML = '';
    list.forEach(function (c) { ui.body.appendChild(row(c, w)); });
    ui.tbl.hidden = !list.length;
    state(list.length ? '' : t ? 'Nobody on the crew list matches that search.' : 'Nobody on the crew list yet. The Crew tab of the Sheet fills it.');
    ui.note.hidden = !!got.kas || !got.crew.some(function (c) { return E.n(c.unpaid) > 0; });
    var seen = got.crew.reduce(function (m, c) { return c.sheet_seen_at && c.sheet_seen_at > m ? c.sheet_seen_at : m; }, '');
    ui.src.innerHTML = ''; A.add(ui.src, [I('sheet'), E.fromSheet(got.values, seen || null)]);
  }
  A.loaders.crew = function () {
    build();
    var mine = ++turn;
    top('crew', ui);
    if (!got) { ui.tbl.hidden = true; ui.note.hidden = true; state('Loading the crew list…'); }
    Promise.all([E.settle(crewList()), E.settle(E.data.kas()), E.settle(E.data.values())]).then(function (r) {
      if (mine !== turn) return;
      if (r[0].e) {
        got = null; ui.tbl.hidden = true; ui.note.hidden = true;
        return state(E.ecoError(r[0].e), true, function () { forget(); A.loaders.crew(); });
      }
      got = { crew: r[0].v, kas: r[1].e ? null : r[1].v, values: r[2].v || {} };
      draw();
    });
  };

  // the Network tab (its list is people.js's) gets the same figures and tabs on top
  var netBox = null, netLoad = A.loaders.network;
  A.loaders.network = function () {
    if (!netBox) {
      var card = A.$('.tablecard', netPanel), bar = A.$('.bar', card);
      netBox = { tiles: h('section', { class: 'tiles t3', 'aria-label': 'Crew figures', hidden: true }), tabs: h('nav', { class: 'tabs', 'aria-label': 'Crew & Vendors' }) };
      netPanel.insertBefore(netBox.tiles, card);
      bar.insertBefore(netBox.tabs, bar.firstChild);
    }
    top('network', netBox);
    if (netLoad) netLoad();
  };

  // ---------- one person ----------
  // the Crew tab's own fields (Owed and Paid this year are the Sheet's formulas); the note takes the whole width
  var FIELDS = [['role', 'Role', 120], ['phone', 'Phone', 60], ['rate', 'Rate (Rp)', 0], ['rate_unit', 'Per', 40], ['note', 'Note', 1000, true]];
  var fieldEl = function (f, v) {
    if (f[0] === 'rate') return E.amountInput(v, 'Rate');
    if (f[3]) return h('textarea', { maxlength: f[2], value: v == null ? '' : String(v) });
    return h('input', { type: f[0] === 'phone' ? 'tel' : 'text', maxlength: f[2], autocomplete: 'off', placeholder: f[0] === 'rate_unit' ? 'day' : null, value: v == null ? '' : String(v) });
  };
  var readOf = function (f) { return f[0] === 'rate' ? E.amount : undefined; };

  // keep: drawn again after a save, at the same scroll position; then: the data-k of the control that gets focus once it is drawn
  function open(id, keep, then) {
    if (!E.isId(id)) return A.toast('That person isn’t on the crew list any more.', true);
    Promise.all([
      sb.from('crew').select('*').eq('id', id).maybeSingle(),
      E.settle(E.data.projects()), E.settle(E.rows(sb.from('project_money').select('project_id, crew_lines').limit(2000))), E.settle(E.data.kas()), E.settle(E.data.values())
    ]).then(function (r) {
      if (r[0].error) return E.failed(r[0].error);
      if (!r[0].data) return A.toast('That person isn’t on the crew list any more.', true);
      show({ c: r[0].data, projects: r[1], lines: r[2], kas: r[3], values: r[4] }, keep);
      var b = then && A.$('[data-drawer] [data-k="' + then + '"]');
      if (b) b.focus();
    }).catch(E.failed);
  }
  // d = {c, projects, lines (project_money crew lines), kas, values}, each list as {v} or {e}
  function show(d, keep) {
    var c = d.c, vals = d.values.v || {}, gone = c.sheet_state === 'missing', k = key(c.name);
    var owed = E.n(c.unpaid), paid = E.n(c.paid_this_year);
    var soft = function (t) { return h('b', { class: 'soft', text: t }); };
    var figs = h('div', { class: 'stats3' },
      h('div', {}, h('span', { text: 'Owed' }), owed == null ? soft('Not in the Sheet') : h('b', { text: E.rp(owed) })),
      h('div', {}, h('span', { text: 'Paid this year' }), paid == null ? soft('Not in the Sheet') : h('b', { text: E.rp(paid) })),
      h('div', {}, h('span', { text: 'Network profile' }), !c.network_profile_id ? soft('Not linked')
        : A.canEdit() ? h('b', {}, h('a', { href: '#network/' + c.network_profile_id, text: 'Open the profile' })) : soft('Linked')));

    // the Kas entries paid to this person (or still to pay); people who can change the Kas open an entry there
    var pays = d.kas.e ? [] : (d.kas.v || []).filter(function (x) { return x.crew_id === c.id || key(x.counterparty) === k; });
    var payList = d.kas.e ? empty(E.ecoError(d.kas.e), true) : !pays.length ? empty('No payments in the Kas yet.')
      : [h('ul', { class: 'rlist' }, pays.map(function (x) {
        var kids = [h('div', {}, h('b', { text: x.description || x.category || 'Payment' }), h('span', { text: [E.day(x.entry_date), x.project_tab || 'Operasional'].filter(Boolean).join(', ') })),
          x.paid ? h('span', { class: 'pill ' + (x.paid === 'Belum' ? 'no' : 'yes'), text: x.paid }) : h('span'),
          h('span', { class: 'amt', text: E.n(x.amount) == null ? '' : E.rp(x.amount) })];
        return h('li', {}, canWrite() ? h('a', { class: 'r', href: '#finance/' + x.id, title: 'Open in the Kas' }, kids) : h('div', { class: 'r' }, kids));
      })), h('div', {}, h('a', { class: 'btn sm', href: '#finance/kas' }, 'Open the Kas'))];

    // the RAB crew lines that name this person
    var lines = [];
    if (!d.projects.e && !d.lines.e) {
      var byId = {}; d.projects.v.forEach(function (p) { byId[p.id] = p; });
      d.lines.v.forEach(function (m) {
        (Array.isArray(m.crew_lines) ? m.crew_lines : []).forEach(function (l) { if (l.person && key(l.person) === k && byId[m.project_id]) lines.push({ p: byId[m.project_id], l: l }); });
      });
    }
    var projList = d.projects.e || d.lines.e ? empty(E.ecoError(d.projects.e || d.lines.e), true) : !lines.length ? empty('Not named in any RAB yet.')
      : h('ul', { class: 'rlist' }, lines.map(function (x) {
        return h('li', {}, h('a', { class: 'r', href: '#projects/' + x.p.id }, h('div', {}, h('b', { text: E.projectLine(x.p) }), x.l.desc ? h('span', { text: x.l.desc }) : null),
          h('span', { class: 'amt', text: E.n(x.l.total) == null ? '' : E.rp(x.l.total) }), I('chev', 's')));
      }));

    // details: what the Crew tab holds, and for owners and admins with money access a form that writes to it
    var notSet = function () { return h('span', { class: 'muted', text: 'Not set' }); };
    var view = h('div', { class: 'cdet' }, E.props([
      ['Role', c.role || notSet()], ['Phone', E.phoneLink(c.phone) || notSet()], ['Rate', E.n(c.rate) == null ? notSet() : E.rp(c.rate)],
      ['Per', c.rate_unit || notSet()], ['Note', c.note ? h('span', { class: 'pre', text: c.note }) : notSet()]]));
    var tab = E.sheetUrl(vals), edit = canWrite() && !gone, on = E.writesOn(vals), vErr = !!d.values.e, form = null, formBox = null;
    if (edit && on) {
      form = E.sheetForm({ label: 'Save details', look: 'mock sm', op: 'crew_upsert',
        args: function (set, expect) { return { name: c.name, set: set, expect: expect }; },
        check: function (set) { return set.rate > 1e12 ? 'That rate is too large.' : ''; },
        done: function (res) {
          A.toast(res.status === 202 ? E.writeText(res) : 'Saved to the Crew tab.');
          forget(); open(c.id, true, 'edit-details');
          if (ui && !panel.hidden) A.loaders.crew();
        } });
      var first = null;
      formBox = h('div', { class: 'cform', hidden: true },
        h('div', { class: 'fgrid' }, FIELDS.map(function (f) {
          var el = form.field(f[0], fieldEl(f, c[f[0]]), c[f[0]], readOf(f));
          first = first || el;
          return h('label', { class: 'f' + (f[3] ? ' full' : '') }, f[1], el);
        })),
        form.bar,
        h('p', { class: 'src' }, I('sheet'), h('span', { text: 'Saved to the Crew tab in the Sheet. The name stays the same, because the Kas and RAB lines find people by it.' })));
      // Cancel draws the person again as the Sheet has them, and puts the cursor back on Edit details
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

    E.drawer('crew', c.id, [
      E.dhead(h('span', { class: 'av', 'aria-hidden': 'true', text: E.initial(c.name) }), c.name, c.role || 'On the crew list',
        [gone ? ['amber', 'No longer in the Sheet'] : null, rateText(c)].filter(Boolean)),
      h('div', { class: 'dr-body' },
        h('p', { class: 'src' }, I('sheet'), h('span', { text: E.fromSheet(vals, c.sheet_seen_at) })),
        gone ? h('p', { class: 'note amber' }, I('alert'), h('span', { text: 'Not in the Crew tab of the Sheet any more, so these details can’t be edited here.' })) : null,
        figs,
        E.dsec('Payments', h('span', { class: 'src' }, I('sheet'), 'Kas'), payList),
        E.dsec('Projects', h('span', { class: 'src' }, I('rab'), 'RAB crew lines'), projList),
        E.dsec('Details', h('span', { class: 'src' }, I('sheet'), 'Crew tab'), view, formBox))
    ], keep);
    A.guard(function () { return !!form && form.dirty(); });
  }

  // ---------- a new person, added to the Crew tab ----------
  function newPerson() {
    if (!canWrite()) return;
    Promise.all([E.data.values(), crewList(true)]).then(function (r) {
      if (!E.writesOn(r[0])) { A.toast('Sheet writes are paused, so people can’t be added from the admin for now.', true); return; }
      personForm(r[1].map(function (c) { return key(c.name); }));
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
    // a failed check names the field and puts the cursor in it
    var bad = function (el, t) { say(t, true); el.setAttribute('aria-invalid', 'true'); el.focus(); };
    var btn = h('button', { class: 'btn lime', type: 'button', onclick: function () {
      var n = name.value.trim().replace(/\s+/g, ' '), set = {};
      all.forEach(function (x) { x.removeAttribute('aria-invalid'); });
      FIELDS.forEach(function (f) {
        var v = f[0] === 'rate' ? E.amount(els.rate) : els[f[0]].value.trim() || null;
        if (v != null) set[f[0]] = v;
      });
      if (!n) return bad(name, 'Give the person a name.');
      if (names.indexOf(n.toLowerCase()) > -1) return bad(name, n + ' is already on the crew list.');
      if (set.rate > 1e12) return bad(els.rate, 'That rate is too large.');
      all.forEach(function (x) { x.disabled = true; }); btn.disabled = true; say('Saving to the Sheet…');
      var back = function (t) { all.forEach(function (x) { x.disabled = false; }); btn.disabled = false; say(t, true); };
      send('crew_upsert', { name: n, create: true, set: set }).then(function (r) {
        if (r.status !== 200 && r.status !== 202) return back(E.writeText(r));
        A.guard(null); forget();
        A.toast(r.status === 202 ? E.writeText(r) : 'Added to the Crew tab: ' + n + '.');
        if (ui && !panel.hidden) A.loaders.crew();
        if (r.status !== 200) { A.closeDrawer(true); return; }
        crewList(true).then(function (cs) {
          var made = cs.filter(function (c) { return key(c.name) === n.toLowerCase(); })[0];
          if (made) open(made.id); else A.closeDrawer(true);
        }, function () { A.closeDrawer(true); });
      }, function (e) { back(E.ecoError(e)); });
    } }, 'Add person');
    E.drawer(null, null, [
      E.dhead(h('span', { class: 'av', 'aria-hidden': 'true' }, I('plus')), 'New person', 'Added to the Crew tab of the Sheet.'),
      h('div', { class: 'dr-body' }, h('div', { class: 'fgrid' },
        h('label', { class: 'f full' }, 'Name', name),
        FIELDS.map(function (f) { return h('label', { class: 'f' + (f[3] ? ' full' : '') }, f[1], els[f[0]]); })),
        h('p', { class: 'src' }, I('sheet'), h('span', { text: 'Kas entries and RAB lines find people by name, so the name can’t be changed from the admin later.' }))),
      h('div', { class: 'eco-actionbar' }, msg, btn)
    ]);
    A.guard(dirty);
    name.focus();
  }
  A.actions.crew = function () {
    return canWrite() ? h('button', { class: 'btn lime', type: 'button', onclick: newPerson }, I('plus', 's'), 'New person') : null;
  };
  A.openers.crew = open;
})();
