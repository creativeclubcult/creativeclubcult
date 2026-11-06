/* Reports: the year from the Sheet's Keuangan tab, checked against each project's own figures (money access), and the
   leads that came in that year (owners and admins), laid out as the mockup has it. Read only. A figure that can't be
   loaded says so; it never becomes 0. */
(function () {
  'use strict';
  if (!window.cccAdmin) return; // admin.js stopped early: the sign in library didn't load
  var A = window.cccAdmin, E = window.eco, sb = A.sb, h = A.h, I = A.icon;
  var panel = A.$('[data-panel="reports"]'), ui = null, got = null, turn = 0, view = 'chart', checks = {}, uid = 0;
  var DEAL = ['Deal', 'Lunas'];
  var MON = new Intl.DateTimeFormat('en-GB', { month: 'long', timeZone: 'UTC' });
  var monthName = function (m) { return MON.format(new Date(Date.UTC(2000, m - 1, 1))); };
  var SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var AX = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1 });
  var FIELD = { omset: 'omset', cost: 'cost', profit: 'profit' };
  // a running total; a total of figures the Sheet doesn't have stays empty instead of becoming 0
  var plus = function (acc, k, v) { var x = E.n(v); if (x != null) acc[k] = (acc[k] || 0) + x; };
  var bySeq = function (a, b) { return (b.seq || 0) - (a.seq || 0); };
  var join = function (l) { return l.length > 1 ? l.slice(0, -1).join(', ') + ' and ' + l[l.length - 1] : l[0] || ''; };
  var cap = function (s) { return s.charAt(0).toUpperCase() + s.slice(1); };
  var empty = function (t) { return h('p', { class: 'empty', text: t }); };
  var note = function (icon, t) { return h('p', { class: 'src' }, icon ? I(icon) : null, h('span', { text: t })); };

  function build() {
    if (ui) return;
    ui = { year: A.select([], '', { class: 'field', 'aria-label': 'Year', hidden: true }),
      csv: h('button', { class: 'btn', type: 'button', hidden: true, onclick: exportYear }, I('in', 's'), 'Export CSV'), list: [] };
    ui.year.addEventListener('change', draw);
  }
  var val = function (key) { var v = got.values.v; return v && v[key] ? v[key].value : null; };
  var leadYear = function (l) { return (E.jkt(l.created_at) || '').slice(0, 4); };
  // Deal and Lunas projects in the Sheet with the quote dated in the year (the check on the server counts the same)
  var yearProjects = function (y) {
    return (got.projects.v || []).filter(function (p) {
      return p.sheet_state === 'present' && DEAL.indexOf(p.status) > -1 && (p.quote_date || '').slice(0, 4) === String(y);
    });
  };

  // the years there is something to show for: the Sheet's, the projects' (money access) and the leads' (owners and admins)
  function fillYears() {
    var set = {}, now = +E.today().slice(0, 4), ku = A.canMoney() ? val('keuangan') : null;
    var put = function (y) { y = E.n(y); if (y && y > 1999) set[y] = true; };
    put(now);
    if (ku) { put(ku.year); (Array.isArray(ku.years) ? ku.years : []).forEach(function (r) { if (r) put(r.year); }); }
    if (A.canMoney()) (got.projects.v || []).forEach(function (p) { if (DEAL.indexOf(p.status) > -1) put((p.quote_date || '').slice(0, 4)); });
    (got.leads.v || []).forEach(function (l) { put(leadYear(l)); });
    var keep = +ui.year.value || (ku && E.n(ku.year)) || now;
    ui.year.length = 0;
    Object.keys(set).map(Number).sort(function (a, b) { return b - a; })
      .forEach(function (y) { ui.year.appendChild(h('option', { value: y, selected: y === keep }, String(y))); });
    ui.year.hidden = false;
  }

  function card(title, aside, cls) {
    var id = 'rp-h' + (++uid);
    return h('section', { class: 'card' + (cls ? ' ' + cls : ''), 'aria-labelledby': id },
      h('header', { class: 'card-h' }, h('h2', { id: id, text: title }), aside || null));
  }
  function fail(e) {
    return h('div', { class: 'lstate' }, h('p', { class: 'empty is-err', text: E.ecoError(e) }),
      h('button', { class: 'btn sm', type: 'button', onclick: function () { E.forget(); A.loaders.reports(); } }, 'Try again'));
  }

  function draw() {
    if (!got) return;
    var y = +ui.year.value, money = A.canMoney(), edit = A.canEdit();
    var broken = money && (got.projects.e || got.money.e);
    var list = money && !broken ? yearProjects(y).sort(bySeq) : [];
    ui.list = list;
    ui.csv.hidden = !list.length;
    var banner = money ? h('p', { class: 'note amber', hidden: true }) : null, line = null, kids;
    if (money) {
      var pj = projectsCard(y, list, broken);
      line = pj.line;
      // without the leads card, the clients sit beside the chart and the projects take the full row below
      kids = edit ? [chart(y, list, broken), leadsCard(y), pj.el, clientsCard(y, list, broken)]
        : [chart(y, list, broken), clientsCard(y, list, broken), pj.el];
      if (!edit) pj.el.classList.add('rfull');
    } else kids = [leadsCard(y)];
    panel.innerHTML = '';
    A.add(panel, [
      money ? null : h('p', { class: 'note' }, I('lock'), h('span', { text: 'Money figures need money access. An owner can turn it on for you in Settings.' })),
      banner, money ? tiles(y) : null,
      h('div', { class: 'rgrid' + (money ? '' : ' solo') }, kids)]);
    if (money && !got.values.e) runCheck(y, banner, line);
  }

  // ---------- the Sheet's year against each project (the check runs on the server) ----------
  function runCheck(y, banner, line) {
    var mine = turn;
    if (!checks[y]) checks[y] = sb.rpc('report_check', { p_year: y }).then(function (r) { if (r.error) throw r.error; return r.data; });
    checks[y].then(function (c) {
      if (mine !== turn || +ui.year.value !== y) return;
      // no row for the year in the Keuangan tab: the figures already say so, and there is nothing to check against
      if (!c || !c.sheet) return;
      if (c.matches) { A.add(line, [I('check'), h('span', { text: 'Matches the Keuangan tab, checked ' + A.ago(c.checked_at) })]); line.hidden = false; return; }
      A.add(banner, [I('alert'), h('span', {}, h('b', { text: 'The project list and the Sheet differ.' }), ' ' + diffText(c.diffs || []))]);
      banner.hidden = false;
    }, function (e) {
      if (checks[y]) delete checks[y];
      if (mine !== turn || +ui.year.value !== y) return;
      A.add(line, [I('alert'), h('span', { text: 'Couldn’t check the year against each project. ' + E.ecoError(e) })]);
      line.hidden = false;
    });
  }
  // "11 projects here, 10 in the Keuangan tab. Omset is off by Rp 24.000.000 and cost by Rp 26.500.000. The Sheet's figures are the right ones."
  function diffText(diffs) {
    var out = [], off = [], none = [], right = 0;
    diffs.forEach(function (d) {
      var a = E.n(d.admin) || 0, s = E.n(d.sheet);
      if (d.field === 'projects') {
        if (s == null) out.push('The Keuangan tab has no project count.');
        else { out.push(E.plural(a, 'project') + ' here, ' + s + ' in the Keuangan tab.'); right++; }
        return;
      }
      if (!FIELD[d.field]) return;
      if (s == null) { none.push(FIELD[d.field]); return; }
      right++;
      off.push((off.length ? FIELD[d.field] + ' by ' : cap(FIELD[d.field]) + ' is off by ') + E.rp(Math.abs(a - s)));
    });
    if (off.length) out.push(join(off) + '.');
    if (none.length) out.push('The Keuangan tab has no figure for ' + join(none) + '.');
    if (right) out.push(right > 1 ? 'The Sheet’s figures are the right ones.' : 'The Sheet’s figure is the right one.');
    return out.join(' ');
  }

  // ---------- the four figures ----------
  function tile(icon, label, v, sub) {
    var x = E.n(v);
    return h('article', { class: 'tile' },
      h('p', { class: 'k' }, I(icon), h('span', { text: label })),
      h('p', { class: 'v' + (x == null ? ' soft' : x < 0 ? ' neg' : ''), text: x == null ? 'Not in the Sheet' : E.rp(x) }),
      sub ? h('p', { class: 'c', text: sub }) : null);
  }
  function tiles(y) {
    if (got.values.e) return h('section', { class: 'card', 'aria-label': 'The year' }, fail(got.values.e));
    var ku = val('keuangan');
    if (!ku) return h('p', { class: 'note' }, I('sheet'), h('span', { text: 'The Sheet’s Keuangan tab hasn’t been read yet.' }));
    // the Sheet's own year has every figure; earlier years keep a row each in the tab's year table
    var here = E.n(ku.year) === y;
    var row = here ? ku : (Array.isArray(ku.years) ? ku.years : []).filter(function (r) { return r && E.n(r.year) === y; })[0];
    if (!row) return h('p', { class: 'note' }, I('sheet'), h('span', { text: 'The Keuangan tab has no figures for ' + y + '.' }));
    var sub = function (label, v, fmt) { return E.n(v) == null ? null : label + ' ' + (fmt || E.rp)(v); };
    return h('section', { class: 'tiles', 'aria-label': 'The year' },
      tile('trend', 'Omset ' + y, row.omset, sub('Money in', row.money_in)),
      tile('out', 'Cost', row.cost, here ? sub('Operational', ku.operational) : null),
      tile('wallet', 'Profit', row.profit, sub('Margin', E.margin(row.profit, row.omset, row.margin), E.pct)),
      tile('check', 'Net profit', row.net_profit, here ? sub('To collect', ku.receivable_all) : null));
  }

  // ---------- omset and cost by month: the Sheet's month table for its year, summed from the projects for others ----------
  // three steps of 1, 2, 2.5 or 5 times a power of ten that clear the highest month
  function niceStep(top) {
    var raw = top / 3, p = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10)), f = raw / p;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
  }
  var axis = function (v) { return !v ? '0' : v >= 1e9 ? AX.format(v / 1e9) + 'B' : v >= 1e6 ? AX.format(v / 1e6) + 'M' : v >= 1e3 ? AX.format(v / 1e3) + 'K' : AX.format(v); };
  function months(y, list, here) {
    var out = [], ku = val('keuangan'), k, noCost = 0, bare = 0;
    for (k = 1; k <= 12; k++) out.push({ k: k, n: 0 });
    if (here) {
      ku.months.forEach(function (m) {
        var b = m && out[E.n(m.month) - 1];
        if (!b) return;
        b.n = 1; b.omset = E.n(m.omset); b.cost = E.n(m.cost); b.profit = E.n(m.profit); b.net = E.n(m.net_profit);
      });
      return { list: out, total: ku.total || null };
    }
    list.forEach(function (p) {
      var b = out[+(p.quote_date || '').slice(5, 7) - 1], m = got.money.v[p.id];
      if (!b) return;
      b.n++;
      if (!m || E.n(m.revenue) == null) { bare++; return; }
      if (E.n(m.cost) == null) noCost++;
      plus(b, 'omset', m.revenue); plus(b, 'cost', m.cost); plus(b, 'profit', m.profit);
    });
    // a month with no projects really had nothing; one whose projects have no figures yet stays blank
    out.forEach(function (b) {
      if (!b.n) { b.omset = 0; b.cost = 0; b.profit = 0; }
      ['omset', 'cost', 'profit'].forEach(function (f) { if (b[f] === undefined) b[f] = null; });
    });
    return { list: out, total: null, noCost: noCost, bare: bare };
  }
  function chart(y, list, broken) {
    var ku = val('keuangan'), here = !!ku && E.n(ku.year) === y && Array.isArray(ku.months);
    var sec = card('Omset and cost by month', null, 'rchart');
    if (!here && broken) { sec.appendChild(fail(broken)); return sec; }
    var data = months(y, list, here), ms = data.list;
    var top = Math.max.apply(null, ms.map(function (b) { return Math.max(b.omset || 0, b.cost || 0); }));
    if (!(top > 0)) {
      sec.appendChild(empty(here ? 'The Keuangan tab has no omset or cost for ' + y + ' yet.'
        : list.length ? 'The projects of ' + y + ' have no figures in the Sheet yet.' : 'No Deal or Lunas projects with a quote dated ' + y + '.'));
      return sec;
    }
    var step = niceStep(top), max = step * 3;
    var size = function (el, v) { el.style.height = (Math.max(0, v) / max * 100).toFixed(2) + '%'; return el; };
    var at = function (el, i) { el.style.bottom = (i * 100 / 3).toFixed(2) + '%'; return el; };
    var rpOr = function (v) { return v == null ? 'not in the Sheet yet' : E.rp(v); };
    var plot = h('div', { class: 'plot' }, [1, 2, 3].map(function (i) { return at(h('span', { class: 'gl' }), i); }), ms.map(function (b) {
      var m = h('div', { class: 'm' });
      if (!(b.omset > 0) && !(b.cost > 0)) return m;
      if (b.omset > 0) m.appendChild(size(h('i', { class: 'om' }), b.omset));
      if (b.cost > 0) m.appendChild(size(h('i', { class: 'co' }), b.cost));
      var text = 'Omset ' + rpOr(b.omset) + ', cost ' + rpOr(b.cost);
      m.setAttribute('role', 'img');
      m.setAttribute('aria-label', monthName(b.k) + ': ' + text.charAt(0).toLowerCase() + text.slice(1));
      return E.tip(m, monthName(b.k) + ' ' + y, text, true);
    }));
    var fig = h('figure', { class: 'mchart', 'aria-label': 'Omset and cost by month in ' + y + '. The table view lists every month.' },
      h('div', { class: 'yax', 'aria-hidden': 'true' }, [0, 1, 2, 3].map(function (i) { return at(h('span', { text: axis(step * i) }), i); })),
      plot, h('div', { class: 'xax', 'aria-hidden': 'true' }, SHORT.map(function (s) { return h('span', { text: s }); })));
    var chartView = h('div', {}, h('ul', { class: 'legend' }, h('li', {}, h('i', { class: 'sw om' }), 'Omset'), h('li', {}, h('i', { class: 'sw co' }), 'Cost')), fig);
    var tableView = h('div', {}, h('div', { class: 'scrollx' }, monthTable(ms, here, data.total)));
    var tabs = h('div', { class: 'tabs', role: 'group', 'aria-label': 'View' });
    var show = function () {
      chartView.hidden = view !== 'chart'; tableView.hidden = view !== 'table';
      A.$$('button', tabs).forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-v') === view)); });
    };
    [['chart', 'Chart'], ['table', 'Table']].forEach(function (v) {
      tabs.appendChild(h('button', { type: 'button', 'data-v': v[0], onclick: function () { view = v[0]; show(); } }, v[1]));
    });
    A.$('.card-h', sec).appendChild(tabs);
    show();
    var seen = here && got.values.v.keuangan ? got.values.v.keuangan.seen_at : null;
    var meta = val('meta'), seed = meta && meta.version === 'seed';
    var src = here ? (seed ? 'From a snapshot of the Keuangan tab' : 'From the Keuangan tab') + (seen ? ', read ' + E.stamp(seen) : '')
      : 'Summed from each project in the Sheet, by the month of its quote.'
        + (data.bare ? ' ' + E.plural(data.bare, 'project has', 'projects have') + ' no figures yet.' : '')
        + (data.noCost ? ' ' + E.plural(data.noCost, 'project has', 'projects have') + ' no cost yet.' : '');
    A.add(sec, [chartView, tableView, note(here ? 'sheet' : null, src)]);
    return sec;
  }
  function monthTable(ms, here, total) {
    var cols = [['omset', 'Omset'], ['cost', 'Cost'], ['profit', 'Profit']].concat(here ? [['net', 'Net profit']] : []);
    // a month's 0 is greyed so the months with money stand out; the total row stays plain
    var td = function (v, foot) { var x = E.n(v); return h('td', { class: 'num' + (x === 0 && !foot ? ' muted' : x < 0 ? ' neg' : ''), text: E.num(x) }); };
    var sum = {};
    ms.forEach(function (b) { cols.forEach(function (c) { plus(sum, c[0], b[c[0]]); }); });
    // the Sheet's own total row for its year; otherwise the months added up
    var tot = here && total ? { omset: total.omset, cost: total.cost, profit: total.profit, net: total.net_profit } : sum;
    return h('table', { class: 'tbl compact mtab' },
      h('thead', {}, h('tr', {}, h('th', { text: 'Month' }), cols.map(function (c) { return h('th', { class: 'num', text: c[1] }); }))),
      h('tbody', {}, ms.map(function (b) { return h('tr', {}, h('td', { text: monthName(b.k) }), cols.map(function (c) { return td(b[c[0]]); })); })),
      h('tfoot', {}, h('tr', {}, h('td', { text: 'Total' }), cols.map(function (c) { return td(tot[c[0]], true); }))));
  }

  // ---------- leads that came in that year (owners and admins) ----------
  function leadsCard(y) {
    var sec = card('Leads in ' + y);
    if (got.leads.e) { sec.appendChild(fail(got.leads.e)); return sec; }
    var list = got.leads.v.filter(function (l) { return leadYear(l) === String(y) && l.status !== 'spam'; });
    if (!list.length) { sec.appendChild(empty('No leads in ' + y + '.')); return sec; }
    var src = {}, mon = {}, won = 0, lost = 0, order = Object.keys(E.SOURCES);
    list.forEach(function (l) {
      var s = l.source || 'other', k = +(E.jkt(l.created_at) || '').slice(5, 7);
      src[s] = (src[s] || 0) + 1;
      if (k) mon[k] = (mon[k] || 0) + 1;
      if (l.status === 'won') won++;
      if (l.status === 'lost') lost++;
    });
    var rank = function (s) { var i = order.indexOf(s); return i < 0 ? order.length : i; };
    var bars = function (rows) {
      var most = Math.max.apply(null, rows.map(function (r) { return r[1]; }));
      return h('div', { class: 'hbars lbl' }, rows.map(function (r) {
        var bar = h('i', { class: 'in' });
        bar.style.width = (r[1] / most * 100).toFixed(1) + '%';
        return h('div', { class: 'hb' }, h('span', { text: r[0], title: r[0] }), h('div', { class: 'tr' }, bar), h('b', { text: String(r[1]) }));
      }));
    };
    var stat = function (label, v) { return h('div', {}, h('span', { text: label }), h('b', { text: String(v) })); };
    A.add(sec, [
      h('div', { class: 'stats3' }, stat('Leads', list.length), stat('Won', won), stat('Lost', lost)),
      h('h3', { class: 'mini', text: 'By source' }),
      bars(Object.keys(src).sort(function (a, b) { return src[b] - src[a] || rank(a) - rank(b) || a.localeCompare(b); })
        .map(function (s) { return [E.SOURCES[s] || s, src[s]]; })),
      h('h3', { class: 'mini', text: 'By month' }),
      bars(Object.keys(mon).map(Number).sort(function (a, b) { return a - b; }).map(function (k) { return [monthName(k), mon[k]]; })),
      note(null, 'Counted by the month each lead came in. Spam is left out.')]);
    return sec;
  }

  // ---------- each project that year ----------
  function projectsCard(y, list, broken) {
    var sec = card('Projects', broken ? null : h('span', { class: 'aside', text: E.plural(list.length, 'project') }));
    var line = h('p', { class: 'src', hidden: true });
    if (broken) { sec.appendChild(fail(broken)); return { el: sec, line: line }; }
    if (!list.length) { A.add(sec, [empty('No Deal or Lunas projects with a quote dated ' + y + '.'), line]); return { el: sec, line: line }; }
    var num = function (v, label, fmt) { var x = E.n(v); return h('td', { class: 'num' + (x < 0 ? ' neg' : ''), 'data-l': label, text: (fmt || E.num)(x) }); };
    var tot = {}, noCost = 0, noFig = 0;
    var rows = list.map(function (p) {
      var m = got.money.v[p.id] || {}, om = E.n(m.revenue), co = E.n(m.cost), cells;
      plus(tot, 'omset', om); plus(tot, 'cost', co); plus(tot, 'profit', m.profit);
      if (om == null) { noFig++; cells = [h('td', { class: 'nc', text: 'No figures yet' }), h('td'), h('td'), h('td')]; }
      else if (co == null) { noCost++; cells = [num(om, 'Omset'), h('td', { class: 'nc', text: 'No cost yet' }), h('td'), h('td')]; }
      else cells = [num(om, 'Omset'), num(co, 'Cost'), num(m.profit, 'Profit'), num(E.margin(m.profit, m.revenue, m.margin), 'Margin', E.pct)];
      return h('tr', {}, h('td', {}, h('div', { class: 'pj' }, h('span', { class: 'av', 'aria-hidden': 'true', text: E.initial(p.client_label || E.clientName(p)) }),
        h('div', {}, h('b', {}, h('a', { href: '#projects/' + p.id, text: E.short(p) })), p.title ? h('span', { text: p.title }) : null))), cells);
    });
    var notes = [];
    if (noCost) notes.push(E.plural(noCost, 'project has', 'projects have') + ' no cost in the Sheet yet, so ' + (noCost === 1 ? 'its' : 'their') + ' profit and margin stay blank.');
    if (noFig) notes.push(E.plural(noFig, 'project has', 'projects have') + ' no figures in the Sheet yet.');
    A.add(sec, [h('table', { class: 'tbl rep' },
      h('thead', {}, h('tr', {}, h('th', { text: 'Project' }), ['Omset', 'Cost', 'Profit', 'Margin'].map(function (t) { return h('th', { class: 'num', text: t }); }))),
      h('tbody', {}, rows),
      h('tfoot', {}, h('tr', {}, h('td', { text: E.plural(list.length, 'project') }), num(tot.omset, 'Omset'), num(tot.cost, 'Cost'), num(tot.profit, 'Profit'), h('td')))),
      notes.length ? note(null, notes.join(' ')) : null, line]);
    return { el: sec, line: line };
  }

  // ---------- clients that year, by omset ----------
  function clientsCard(y, list, broken) {
    if (broken) return h('div', { hidden: true });
    var names = {}, groups = {}, order = [];
    (got.clients.v || []).forEach(function (c) { names[c.id] = c.name || c.code; });
    list.forEach(function (p) {
      var key = p.client_id || 'label:' + E.words(p.client_label), m = got.money.v[p.id] || {}, g = groups[key];
      if (!g) { g = groups[key] = { id: p.client_id, name: names[p.client_id] || p.client_label || 'No client', n: 0, all: true }; order.push(g); }
      g.n++; plus(g, 'omset', m.revenue); plus(g, 'profit', m.profit);
      if (E.n(m.profit) == null) g.all = false;
    });
    var sec = card('Clients by omset', order.length ? h('span', { class: 'aside', text: E.plural(order.length, 'client') }) : null);
    if (!order.length) { sec.appendChild(empty('No clients with Deal or Lunas projects in ' + y + '.')); return sec; }
    order.sort(function (a, b) { return (b.omset == null ? -1 : b.omset) - (a.omset == null ? -1 : a.omset) || E.words(a.name).localeCompare(E.words(b.name)); });
    var most = Math.max.apply(null, order.map(function (g) { return g.omset || 0; }));
    sec.appendChild(h('ul', { class: 'cbars' }, order.map(function (g) {
      var bar = null;
      if (g.omset > 0 && most > 0) { bar = h('i'); bar.style.width = (g.omset / most * 100).toFixed(1) + '%'; }
      // the profit only when every project of the client has one, so a part never passes for the whole
      var sub = g.all ? h('span', { class: 'sub' }, E.plural(g.n, 'project') + ', profit ', h('span', { class: g.profit < 0 ? 'neg' : null, text: E.rp(g.profit) }))
        : g.n > 1 ? h('span', { class: 'sub', text: E.plural(g.n, 'project') }) : null;
      return h('li', {}, h('b', {}, g.id ? h('a', { href: '#clients/' + g.id, text: g.name }) : g.name),
        g.omset == null ? h('span', { class: 'amt soft', text: 'No figures yet' }) : h('span', { class: 'amt', text: E.rp(g.omset) }),
        h('span', { class: 'tr' }, bar), sub);
    })));
    return sec;
  }

  // the year's projects with their figures, for a spreadsheet
  function exportYear() {
    var y = +ui.year.value;
    if (!got || !ui.list.length) return;
    E.csv('ccc-report-' + y + '-projects', ['Project', 'Title', 'Client', 'Quote date', 'Status', 'Omset', 'Cost', 'Profit', 'Margin'],
      ui.list.map(function (p) {
        var m = got.money.v[p.id] || {};
        return [E.short(p), p.title, p.client_label, p.quote_date, p.status, m.revenue, m.cost, m.profit, E.margin(m.profit, m.revenue, m.margin)];
      }));
  }

  A.loaders.reports = function () {
    build();
    var mine = ++turn;
    checks = {};
    // a first visit waits; a return keeps the last report on screen until the new one is in
    if (!got) { panel.innerHTML = ''; panel.appendChild(empty('Loading reports…')); }
    Promise.all([E.data.values(), E.data.projects(), E.data.money(), E.data.clients(),
      A.canEdit() ? E.rows(sb.from('lead_inbox').select('id, created_at, source, status').order('created_at', { ascending: false }).limit(5000)) : Promise.resolve([])
    ].map(E.settle)).then(function (r) {
      if (mine !== turn) return;
      got = { values: r[0], projects: r[1], money: r[2], clients: r[3], leads: r[4] };
      fillYears(); draw();
    });
  };
  // the year for everyone who opens Reports; the export for money access (it holds each project's figures)
  A.actions.reports = function () {
    build();
    return [ui.year, A.canMoney() ? ui.csv : null];
  };
})();
