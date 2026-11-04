/* Reports: the year in numbers straight from the Sheet's Keuangan tab, checked against each project's own figures
   (money access), and the lead pipeline (everyone). Read only; no charts in this version. */
(function () {
  'use strict';
  var A = window.cccAdmin, E = window.eco, sb = A.sb, h = A.h;
  var panel = A.$('[data-panel="reports"]'), ui = null, got = null, loading = 0;
  var DEAL = ['Deal', 'Lunas'];
  var MON = new Intl.DateTimeFormat('en-GB', { month: 'long', timeZone: 'UTC' });
  var monthName = function (m) { return MON.format(new Date(Date.UTC(2000, m - 1, 1))); };
  var FIELD = { projects: 'the project count', omset: 'Omset', cost: 'Cost', profit: 'Profit' };

  var block = function (title, right) {
    var s = h('section', { class: 'eco-block' }, h('div', { class: 'eco-block-h' }, h('h2', { class: 'eco-h', text: title }), right || null));
    for (var i = 2; i < arguments.length; i++) A.add(s, arguments[i]);
    return s;
  };
  var csvBtn = function (fn) { return h('button', { class: 'eco-btn', type: 'button', onclick: fn }, 'Export CSV'); };
  var table = function (head, rows) { return h('div', { class: 'adm-table-wrap' }, h('table', { class: 'adm-table is-stack' }, head, h('tbody', {}, rows))); };
  var still = function (tr) { tr.style.cursor = 'default'; return tr; };
  var cell = function (v, cls, fmt) { return h('td', { class: 'num' + (cls ? ' ' + cls : '') + (E.n(v) < 0 ? ' neg' : '') }, (fmt || E.num)(v)); };
  var zero = function (list) { return list.every(function (v) { return !E.n(v); }); };
  // a running total; a total of figures the Sheet doesn't have stays empty instead of becoming 0
  var plus = function (acc, k, v) { var x = E.n(v); if (x != null) acc[k] = (acc[k] || 0) + x; };

  function build() {
    if (ui) return;
    ui = { year: A.select([], '', { 'aria-label': 'Year' }), body: h('div'), sort: { k: 'date', dir: -1 } };
    ui.year.addEventListener('change', draw);
    A.add(panel, [h('div', { class: 'adm-bar' }, ui.year), ui.body]);
  }
  var val = function (key) { var v = got.values.v; return v && v[key] ? v[key].value : null; };
  var leadYear = function (l) { return (E.jkt(l.created_at) || '').slice(0, 4); };
  // Deal and Lunas projects in the Sheet with the quote dated in the year (the check on the server counts the same)
  var yearProjects = function (y) {
    return (got.projects.v || []).filter(function (p) {
      return p.sheet_state === 'present' && DEAL.indexOf(p.status) > -1 && (p.quote_date || '').slice(0, 4) === String(y);
    });
  };

  function fillYears() {
    var set = {}, now = +E.today().slice(0, 4), ku = val('keuangan');
    set[now] = true;
    if (ku) {
      if (E.n(ku.year)) set[E.n(ku.year)] = true;
      (Array.isArray(ku.years) ? ku.years : []).forEach(function (r) { if (r && E.n(r.year)) set[E.n(r.year)] = true; });
    }
    (got.projects.v || []).forEach(function (p) { if (p.quote_date && DEAL.indexOf(p.status) > -1) set[+p.quote_date.slice(0, 4)] = true; });
    (got.leads.v || []).forEach(function (l) { var y = +leadYear(l); if (y) set[y] = true; });
    var keep = +ui.year.value || (A.canMoney() && ku && E.n(ku.year)) || now;
    ui.year.length = 0;
    Object.keys(set).map(Number).sort(function (a, b) { return b - a; })
      .forEach(function (y) { ui.year.appendChild(h('option', { value: y, selected: y === keep }, String(y))); });
  }
  function draw() {
    if (!got) return;
    var y = +ui.year.value;
    ui.body.innerHTML = '';
    if (A.canMoney()) money(y);
    else ui.body.appendChild(h('p', { class: 'adm-note eco-block', text: 'Money figures need money access. An owner can turn it on for you in Settings.' }));
    ui.body.appendChild(pipeline(y));
  }

  // ---------- money: the Sheet's year, then each project's own figures ----------
  function money(y) {
    if (got.values.e) { ui.body.appendChild(h('p', { class: 'eco-err', text: E.ecoError(got.values.e) })); return; }
    var ku = val('keuangan'), here = !!ku && E.n(ku.year) === y;
    var row = ku && Array.isArray(ku.years) ? ku.years.filter(function (r) { return r && E.n(r.year) === y; })[0] : null;
    var seen = got.values.v.keuangan ? got.values.v.keuangan.seen_at : null, figs;
    if (!ku) figs = h('p', { class: 'adm-note', text: 'The Sheet\u2019s Keuangan tab hasn\u2019t been read yet.' });
    else if (here) {
      figs = h('div', { class: 'eco-figs' }, E.money('Omset', ku.omset), E.money('Cost', ku.cost), E.money('Profit', ku.profit),
        E.money('Margin', ku.margin, { fmt: E.pct }), E.money('Money in', ku.money_in), E.money('To collect', ku.receivable_all),
        E.money('Operational', ku.operational), E.money('Net profit', ku.net_profit));
    } else if (row) {
      figs = h('div', { class: 'eco-figs is-6' }, E.money('Omset', row.omset), E.money('Cost', row.cost), E.money('Profit', row.profit),
        E.money('Margin', row.margin, { fmt: E.pct }), E.money('Money in', row.money_in), E.money('Net profit', row.net_profit));
    } else figs = h('p', { class: 'adm-note', text: 'The Sheet\u2019s Keuangan tab has no figures for ' + y + '.' });
    var check = h('p', { class: 'eco-note', text: 'Checking against each project\u2026' });
    ui.body.appendChild(block('Year summary', null, figs, ku ? h('p', { class: 'eco-note', text: E.fromSheet(got.values.v, seen) }) : null, check));
    checkLine(y, check);
    var list = yearProjects(y), broken = got.projects.e || got.money.e;
    ui.body.appendChild(here && Array.isArray(ku.months) ? sheetMonths(y, ku) : broken ? errBlock('Months', broken) : summedMonths(y, list));
    ui.body.appendChild(broken ? errBlock('Projects', broken) : projects(y, list));
    ui.body.appendChild(broken ? errBlock('Clients', broken) : clients(y, list));
  }
  var errBlock = function (title, e) { return block(title, null, h('p', { class: 'eco-err', text: E.ecoError(e) })); };

  function checkLine(y, box) {
    sb.rpc('report_check', { p_year: y }).then(function (r) {
      if (r.error) throw r.error;
      var c = r.data;
      if (!c) { box.textContent = ''; return; }
      if (!c.sheet) { box.textContent = 'Nothing to check against: the Sheet\u2019s Keuangan tab has no row for ' + y + '.'; return; }
      if (c.matches) { box.textContent = 'Matches the Sheet\u2019s Keuangan tab \u00b7 checked ' + A.ago(c.checked_at); return; }
      var many = c.diffs.length > 1;
      box.className = 'eco-note eco-warn';
      box.textContent = 'Differs from the Sheet ' + c.diffs.map(diffText).join(', ') + '; the Sheet\u2019s figure' + (many ? 's are the right ones.' : ' is the right one.');
    }).catch(function (e) { box.className = 'eco-note eco-err'; box.textContent = 'Couldn\u2019t check against each project. ' + E.ecoError(e); });
  }
  function diffText(d) {
    var a = E.n(d.admin), s = E.n(d.sheet);
    if (s == null) return 'in ' + FIELD[d.field] + ' (the Sheet has no figure)';
    if (d.field === 'projects') return 'in ' + FIELD.projects + ' (' + a + ' here, ' + s + ' in the Sheet)';
    return 'by ' + E.rp(Math.abs(a - s)) + ' in ' + FIELD[d.field];
  }

  // the Sheet's own month table for its year, as it stands
  var MKEYS = ['projects', 'omset', 'cost', 'profit', 'margin', 'money_in', 'receivable', 'operational', 'net_profit'];
  var MHEAD = ['Month', ['Projects', 'num'], ['Omset', 'num'], ['Cost', 'num'], ['Profit', 'num'], ['Margin', 'num'], ['Money in', 'num'],
    ['To collect', 'num'], ['Operational', 'num'], ['Net profit', 'num']];
  function sheetMonths(y, ku) {
    var line = function (label, m) {
      return still(h('tr', { class: zero(MKEYS.map(function (k) { return m[k]; })) ? 'is-zero' : null },
        h('td', {}, label),
        cell(m.projects, 'hide-s'), cell(m.omset), cell(m.cost, 'hide-s'), cell(m.profit, 'hide-s'), cell(m.margin, 'hide-s', E.pct),
        cell(m.money_in, 'hide-s'), cell(m.receivable, 'hide-s'), cell(m.operational, 'hide-s'), cell(m.net_profit, 'hide-s'),
        h('td', { class: 'only-s' }, ['Cost ' + E.num(m.cost), 'Profit ' + E.num(m.profit), 'Net profit ' + E.num(m.net_profit)].join(' \u00b7 '))));
    };
    var rows = ku.months.map(function (m) { return line(m.label || monthName(m.month), m); });
    if (ku.total) rows.push(line('Total', ku.total));
    return block('Months', csvBtn(function () {
      E.csv('ccc-report-' + y + '-months', MHEAD.map(function (c) { return Array.isArray(c) ? c[0] : c; }),
        ku.months.map(function (m) { return [m.label || monthName(m.month)].concat(MKEYS.map(function (k) { return m[k]; })); })
          .concat(ku.total ? [['Total'].concat(MKEYS.map(function (k) { return ku.total[k]; }))] : []));
    }), table(E.thead(MHEAD), rows), h('p', { class: 'eco-note', text: 'As the Keuangan tab shows it.' }));
  }
  // other years: the Sheet keeps no month table, so each project's Omset, Cost and Profit is added up by its quote month
  function summedMonths(y, list) {
    var by = {}, bare = 0;
    list.forEach(function (p) {
      var m = got.money.v[p.id], k = +p.quote_date.slice(5, 7), b = by[k] = by[k] || { projects: 0 };
      b.projects++;
      if (!m) { bare++; return; }
      plus(b, 'omset', m.revenue); plus(b, 'cost', m.cost); plus(b, 'profit', m.profit);
    });
    var head = ['Month', ['Projects', 'num'], ['Omset', 'num'], ['Cost', 'num'], ['Profit', 'num']], rows = [], out = [];
    for (var k = 1; k <= 12; k++) {
      var b = by[k] || { projects: 0, omset: 0, cost: 0, profit: 0 };
      out.push([monthName(k), b.projects, b.omset, b.cost, b.profit]);
      rows.push(still(h('tr', { class: b.projects ? null : 'is-zero' }, h('td', {}, monthName(k)), cell(b.projects, 'hide-s'), cell(b.omset),
        cell(b.cost, 'hide-s'), cell(b.profit, 'hide-s'),
        h('td', { class: 'only-s' }, [E.plural(b.projects, 'project'), b.cost == null ? null : 'Cost ' + E.num(b.cost),
          b.profit == null ? null : 'Profit ' + E.num(b.profit)].filter(Boolean).join(' \u00b7 ')))));
    }
    return block('Months', list.length ? csvBtn(function () { E.csv('ccc-report-' + y + '-months', head.map(function (c) { return Array.isArray(c) ? c[0] : c; }), out); }) : null,
      list.length ? table(E.thead(head), rows) : h('p', { class: 'adm-note', text: 'No Deal or Lunas projects with a quote dated ' + y + '.' }),
      list.length ? h('p', { class: 'eco-note', text: 'Summed from each project in the Sheet, by the month of its quote.'
        + (bare ? ' ' + E.plural(bare, 'project has', 'projects have') + ' no figures in the Sheet yet.' : '') }) : null);
  }

  // ---------- each project that year, sortable ----------
  var PCOLS = [{ k: 'name', t: 'Project' }, { k: 'client', t: 'Client' }, { k: 'date', t: 'Quote date' }, { k: 'omset', t: 'Omset', cls: 'num' },
    { k: 'cost', t: 'Cost', cls: 'num' }, { k: 'profit', t: 'Profit', cls: 'num' }, { k: 'margin', t: 'Margin', cls: 'num' }];
  function sortValue(p, k) {
    var m = got.money.v[p.id] || {};
    return k === 'name' ? E.short(p).toLowerCase() : k === 'client' ? E.words(p.client_label) : k === 'date' ? p.quote_date || ''
      : E.n(m[k === 'omset' ? 'revenue' : k]);
  }
  function projects(y, list) {
    var s = ui.sort, wrap = h('div');
    var paint = function () {
      var sorted = list.slice().sort(function (a, b) {
        var x = sortValue(a, s.k), z = sortValue(b, s.k);
        if (x == null || x === '') return z == null || z === '' ? 0 : 1;
        if (z == null || z === '') return -1;
        return (x < z ? -1 : x > z ? 1 : 0) * s.dir || (b.seq || 0) - (a.seq || 0);
      });
      var head = h('thead', {}, h('tr', {}, PCOLS.map(function (c) {
        return h('th', { class: c.cls || null, 'aria-sort': s.k === c.k ? (s.dir > 0 ? 'ascending' : 'descending') : null },
          h('button', { class: 'eco-sort', type: 'button', onclick: function () {
            s.dir = s.k === c.k ? -s.dir : c.cls ? -1 : 1; s.k = c.k; paint();
          } }, c.t));
      })));
      var tot = {};
      var rows = sorted.map(function (p) {
        var m = got.money.v[p.id];
        if (m) { plus(tot, 'omset', m.revenue); plus(tot, 'cost', m.cost); plus(tot, 'profit', m.profit); }
        var none = function (cls) { return h('td', { class: 'num ' + cls }, E.quiet('Not in the Sheet')); };
        return h('tr', { onclick: function () { location.hash = '#projects/' + p.id; } },
          h('td', {}, E.short(p), p.title ? h('span', { class: 'sub', text: p.title }) : null),
          h('td', { class: 'hide-s' }, p.client_label || ''),
          h('td', { class: 'hide-s' }, E.day(p.quote_date)),
          m ? cell(m.revenue, 'hide-s') : none('hide-s'), m ? cell(m.cost, 'hide-s') : none('hide-s'), m ? cell(m.profit) : none(''),
          m ? cell(m.margin, 'hide-s', E.pct) : none('hide-s'),
          h('td', { class: 'only-s' }, m ? ['Omset ' + E.num(m.revenue), 'Cost ' + E.num(m.cost), 'margin ' + E.pct(m.margin)].join(' \u00b7 ') : 'Not in the Sheet'));
      });
      wrap.innerHTML = '';
      var noCost = list.filter(function (p) { var m = got.money.v[p.id]; return !m || E.n(m.cost) == null; }).length;
      A.add(wrap, [table(head, rows), h('p', { class: 'eco-note', text: [E.plural(list.length, 'project'),
        tot.omset == null ? null : 'Omset ' + E.rp(tot.omset), tot.cost == null ? null : 'Cost ' + E.rp(tot.cost),
        tot.profit == null ? null : 'Profit ' + E.rp(tot.profit)].filter(Boolean).join(' \u00b7 ')
        + (noCost ? '. ' + E.plural(noCost, 'project has', 'projects have') + ' no cost figures in the Sheet yet, so ' + (noCost === 1 ? 'its' : 'their')
          + ' Cost, Profit and Margin are blank.' : '') })]);
    };
    if (list.length) paint();
    return block('Projects', list.length ? csvBtn(function () {
      E.csv('ccc-report-' + y + '-projects', ['Project', 'Title', 'Client', 'Quote date', 'Status', 'Omset', 'Cost', 'Profit', 'Margin'],
        list.map(function (p) { var m = got.money.v[p.id] || {}; return [E.short(p), p.title, p.client_label, p.quote_date, p.status, m.revenue, m.cost, m.profit, m.margin]; }));
    }) : null, list.length ? wrap : h('p', { class: 'adm-note', text: 'No Deal or Lunas projects with a quote dated ' + y + '.' }));
  }

  // ---------- clients that year ----------
  function clients(y, list) {
    var names = {}, groups = {}, order = [];
    (got.clients.v || []).forEach(function (c) { names[c.id] = c.name || c.code; });
    list.forEach(function (p) {
      var key = p.client_id || 'label:' + (p.client_label || ''), m = got.money.v[p.id] || {};
      var g = groups[key];
      if (!g) { g = groups[key] = { id: p.client_id, name: names[p.client_id] || p.client_label || 'No client', projects: 0 }; order.push(g); }
      g.projects++; plus(g, 'omset', m.revenue); plus(g, 'profit', m.profit);
    });
    order.sort(function (a, b) { return (b.omset || 0) - (a.omset || 0) || E.words(a.name).localeCompare(E.words(b.name)); });
    var head = ['Client', ['Projects', 'num'], ['Omset', 'num'], ['Profit', 'num']];
    var rows = order.map(function (g) {
      var tr = h('tr', { onclick: g.id ? function () { location.hash = '#clients/' + g.id; } : null },
        h('td', {}, g.name), cell(g.projects, 'hide-s'), cell(g.omset, 'hide-s'), cell(g.profit),
        h('td', { class: 'only-s' }, E.plural(g.projects, 'project') + (g.omset == null ? '' : ' \u00b7 Omset ' + E.num(g.omset))));
      return g.id ? tr : still(tr);
    });
    return block('Clients', order.length ? csvBtn(function () {
      E.csv('ccc-report-' + y + '-clients', ['Client', 'Projects', 'Omset', 'Profit'], order.map(function (g) { return [g.name, g.projects, g.omset, g.profit]; }));
    }) : null, order.length ? table(E.thead(head), rows) : h('p', { class: 'adm-note', text: 'No clients with Deal or Lunas projects in ' + y + '.' }));
  }

  // ---------- the lead pipeline (everyone) ----------
  function pipeline(y) {
    if (got.leads.e) return errBlock('Pipeline', got.leads.e);
    var now = E.today(), last = +now.slice(0, 4) === y ? +now.slice(5, 7) : 12;
    var leads = got.leads.v.filter(function (l) { return leadYear(l) === String(y) && l.status !== 'spam'; });
    if (!leads.length) return block('Pipeline', null, h('p', { class: 'adm-note', text: 'No leads in ' + y + '.' }));
    var seen = {};
    leads.forEach(function (l) { seen[l.source || 'other'] = true; });
    var srcs = Object.keys(E.SOURCES).filter(function (s) { return seen[s]; })
      .concat(Object.keys(seen).filter(function (s) { return !E.SOURCES[s]; }).sort());
    var name = function (s) { return E.SOURCES[s] || s; };
    var by = {}, tot = { all: 0, won: 0, lost: 0, src: {} };
    leads.forEach(function (l) {
      var k = +(E.jkt(l.created_at) || '').slice(5, 7), b = by[k] = by[k] || { all: 0, won: 0, lost: 0, src: {} }, s = l.source || 'other';
      [b, tot].forEach(function (x) { x.all++; x.src[s] = (x.src[s] || 0) + 1; if (l.status === 'won') x.won++; if (l.status === 'lost') x.lost++; });
    });
    var rate = function (b) { return b.won + b.lost ? E.pct(b.won / (b.won + b.lost)) : ''; };
    var line = function (label, b) {
      return still(h('tr', { class: b.all ? null : 'is-zero' }, h('td', {}, label), cell(b.all),
        srcs.map(function (s) { return cell(b.src[s] || 0, 'hide-s'); }), cell(b.won, 'hide-s'), cell(b.lost, 'hide-s'),
        h('td', { class: 'num hide-s' }, rate(b)),
        h('td', { class: 'only-s' }, srcs.filter(function (s) { return b.src[s]; }).map(function (s) { return name(s) + ' ' + b.src[s]; })
          .concat(b.all ? ['won ' + b.won, 'lost ' + b.lost] : [], rate(b) ? ['win rate ' + rate(b)] : []).join(' \u00b7 '))));
    };
    var rows = [], out = [];
    for (var k = 1; k <= last; k++) {
      var b = by[k] || { all: 0, won: 0, lost: 0, src: {} };
      rows.push(line(monthName(k), b));
      out.push([monthName(k), b.all].concat(srcs.map(function (s) { return b.src[s] || 0; }), [b.won, b.lost]));
    }
    rows.push(line('Total', tot));
    var head = ['Month', ['Leads', 'num']].concat(srcs.map(function (s) { return [name(s), 'num']; }), [['Won', 'num'], ['Lost', 'num'], ['Win rate', 'num']]);
    return block('Pipeline', csvBtn(function () {
      E.csv('ccc-report-' + y + '-pipeline', ['Month', 'Leads'].concat(srcs.map(name), ['Won', 'Lost']), out);
    }), table(E.thead(head), rows),
      h('p', { class: 'eco-note', text: 'Counted by the month each lead came in. Spam is left out. Win rate is won out of won and lost.' }));
  }

  A.loaders.reports = function () {
    build();
    var my = ++loading;
    ui.body.innerHTML = '';
    ui.body.appendChild(h('p', { class: 'eco-wait', text: 'Loading\u2026' }));
    Promise.all([E.settle(E.data.values()), E.settle(E.data.projects()), E.settle(E.data.money()), E.settle(E.data.clients()),
      E.settle(E.rows(sb.from('lead_inbox').select('id, created_at, source, status').order('created_at', { ascending: false }).limit(5000)))
    ]).then(function (r) {
      if (my !== loading) return;
      got = { values: r[0], projects: r[1], money: r[2], clients: r[3], leads: r[4] };
      fillYears(); draw();
    });
  };
})();
