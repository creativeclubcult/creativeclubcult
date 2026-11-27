/* Profit & Kas (money access only): where each project's profit goes. A project's profit (its price less its production
   cost, from Rekap Project) is split by its allocation into Kas CCC, Net profit and the fees to people. The page adds
   the three up to the year's profit, lists them project by project with whether each part has been moved, and shows
   the three accounts from the actual entries in the Kas tab: what came into Kas CCC and what was paid from it, what
   moved to Net profit, and the fees person by person. Read only: an entry is recorded on the project (Money) and
   edited in Finance, Kas. */
(function () {
  'use strict';
  if (!window.cccAdmin) return; // admin.js stopped early: the sign in library didn't load
  var A = window.cccAdmin, E = window.eco, h = A.h;
  var panel = A.$('[data-panel="profit"]'), got = null, turn = 0, open = {};
  var CATS = { kas: ['Setor Kas CCC'], net: ['Setor Net Profit'], fee: ['Fee PR', 'Fee Internal'] };
  var PARTS = ['kas', 'net', 'fee'];
  var val = function (key) { return got.values[key] ? got.values[key].value : null; };

  // each project with what its profit is made of (the allocation) and the entries that record each part in the Kas
  function build(year) {
    var kas = got.kas.v || [], yr = year ? String(year) : null, rows = [];
    got.projects.forEach(function (p) {
      if (p.sheet_state !== 'present' || (p.status !== 'Deal' && p.status !== 'Lunas')) return;
      if (yr && (p.quote_date || '').slice(0, 4) !== yr) return;
      var m = got.money[p.id] || {}, plan = E.splitOf(m.alloc), profit = E.n(m.profit);
      // only a project with a profit in the Sheet: one whose cost was typed in equal to its price (profit 0) has
      // nothing to split, and what it set aside to Kas CCC came out of its cost, so it shows in the account below
      if (!profit) return;
      var r = { p: p, m: m, profit: profit || 0, paid: p.status === 'Lunas', part: {} };
      PARTS.forEach(function (k) {
        var mine = kas.filter(function (e) { return e.kind === 'Keluar' && e.project_id === p.id && CATS[k].indexOf(e.category) > -1; });
        var planned = plan ? plan.filter(function (y) { return CATS[k].indexOf(y.cat) > -1; }).reduce(function (t, y) { return t + (y.amount || 0); }, 0) : 0;
        var rec = mine.reduce(function (t, e) { return t + (E.n(e.amount) || 0); }, 0);
        // the amount as recorded once it is in the Kas, as planned until then
        var amount = mine.length ? rec : planned;
        var state = !amount ? null : mine.length ? (mine.every(function (e) { return e.paid === 'Sudah'; }) ? 'done' : 'todo') : r.paid ? 'todo' : 'wait';
        var who = k === 'fee' && amount ? mine.map(function (e) { return e.counterparty; }).filter(function (v, i, a) { return v && a.indexOf(v) === i; }).join(', ') || 'No name yet' : null;
        r.part[k] = { amount: amount, state: state, who: who, entries: mine };
      });
      rows.push(r);
    });
    rows.sort(function (a, b) { return (b.p.seq || 0) - (a.p.seq || 0); });
    return rows;
  }

  function tile(label, amount, sub, cls) {
    return h('article', { class: 'tile' + (cls ? ' ' + cls : '') }, h('p', { class: 'k' }, h('span', { text: label })),
      h('p', { class: 'v', text: E.rp(amount) }), h('p', { class: 'c', text: sub }));
  }
  var op = function (t) { return h('span', { class: 'op', 'aria-hidden': 'true', text: t }); };
  var LABEL = { kas: { done: 'Moved', todo: 'To move', wait: 'After client pays' }, net: { done: 'Moved', todo: 'To move', wait: 'After client pays' },
    fee: { done: 'Paid', todo: 'To pay', wait: 'After client pays' } };

  // one account as a small sum (the result on the last line) over its entries, newest first; a long list folds
  function account(key, title, lines, result, items, emptyText) {
    var list = h('ul', { class: 'mini' }), more = null, LIMIT = 5;
    var fill = function () {
      list.innerHTML = '';
      (open[key] ? items : items.slice(0, LIMIT)).forEach(function (it) { list.appendChild(h('li', {}, h('span', { text: it[0] }), h('b', { class: it[2] || null, text: it[1] }))); });
      if (more) more.textContent = open[key] ? 'Show fewer' : 'Show all ' + items.length;
    };
    if (items.length > LIMIT) more = h('button', { class: 'btn sm', type: 'button', 'aria-expanded': String(!!open[key]),
      onclick: function () { open[key] = !open[key]; more.setAttribute('aria-expanded', String(!!open[key])); fill(); } });
    fill();
    return h('article', { class: 'card acct' }, h('h3', { text: title }),
      h('div', { class: 'eq' }, lines.map(function (l) { return h('div', {}, h('span', { text: l[0] }), h('b', { text: E.num(l[1]) })); }),
        h('div', { class: 'res' }, h('span', { text: result[0] }), h('span', { text: E.rp(result[1]) }))),
      items.length ? list : h('p', { class: 'help', text: emptyText }), more);
  }

  function draw() {
    var ku = val('keuangan') || {}, year = E.n(ku.year), rows = build(year);
    var sum = { profit: 0, kas: 0, net: 0, fee: 0, profitPaid: 0, kasPaid: 0, netPaid: 0, feePaid: 0 };
    rows.forEach(function (r) {
      sum.profit += r.profit; if (r.paid) sum.profitPaid += r.profit;
      PARTS.forEach(function (k) { sum[k] += r.part[k].amount; if (r.paid) sum[k + 'Paid'] += r.part[k].amount; });
    });
    var from = function (v) { return E.rp(v) + ' from paid projects'; };
    var rest = sum.profit - sum.kas - sum.net - sum.fee;
    var head = h('section', { class: 'sumrow' + (Math.abs(rest) >= 1 ? ' n5' : ''), 'aria-label': 'Profit of the ' + (year || '') + ' projects, split' },
      tile('Kas CCC', sum.kas, from(sum.kasPaid)), op('+'),
      tile('Net profit', sum.net, from(sum.netPaid)), op('+'),
      tile('Fees to people', sum.fee, from(sum.feePaid)),
      Math.abs(rest) >= 1 ? [op('+'), tile('Not split yet', rest, 'Left in the production budget')] : null, op('='),
      tile('Total profit' + (year ? ' ' + year : ''), sum.profit, from(sum.profitPaid), 'total'));

    // project by project: each part with its state under it, the project's profit on the right
    var tb = h('tbody');
    var cell = function (r, k) {
      var x = r.part[k];
      if (!x.amount) return h('td', { class: 'num muted', text: '0' });
      return h('td', { class: 'num' }, h('b', { text: E.num(x.amount) }), x.who ? h('span', { class: 'who2', text: x.who }) : null,
        h('span', { class: 'st2 ' + x.state, text: LABEL[k][x.state] }));
    };
    rows.forEach(function (r) {
      var p = r.p, dp = E.n(r.m.dp_received) > 0 || E.n(r.m.paid_total) > 0;
      tb.appendChild(h('tr', {},
        h('td', { class: 'pj2' }, h('a', { href: '#projects/' + p.id }, h('b', { text: E.clientName(p) }), h('span', { text: p.title || '' }))),
        h('td', {}, h('span', { class: 'pill ' + (r.paid ? 'yes' : dp ? 'part' : 'no'), text: r.paid ? 'Paid' : dp ? 'DP only' : 'Not paid' })),
        cell(r, 'kas'), cell(r, 'net'), cell(r, 'fee'), h('td', { class: 'num tot', text: E.num(r.profit) })));
    });
    if (!rows.length) E.fullRow(tb, 6, 'No project with a profit' + (year ? ' in ' + year : '') + ' yet.');
    else tb.appendChild(h('tr', { class: 'sum' }, h('td', { text: 'Total' }), h('td'), h('td', { class: 'num', text: E.num(sum.kas) }),
      h('td', { class: 'num', text: E.num(sum.net) }), h('td', { class: 'num', text: E.num(sum.fee) }), h('td', { class: 'num tot', text: E.num(sum.profit) })));
    var table = h('section', { class: 'card tablecard' },
      h('div', { class: 'bar2' }, h('h2', { text: 'By project' }), h('span', { class: 'muted', text: E.plural(rows.length, 'project') + ' with a profit' + (year ? ' in ' + year : '') })),
      h('div', { class: 'scrollx' }, h('table', { class: 'tbl compact' },
        E.thead(['Project', 'Client', ['Kas CCC', 'num'], ['Net profit', 'num'], ['Fees to people', 'num'], ['Total profit', 'num']]), tb)),
      h('p', { class: 'help', text: 'To move or To pay: record it on the project, under Money, then mark it paid. A project with no profit in the Sheet isn’t listed here; what it set aside still shows in the Kas CCC account below.' }));

    // the three accounts, from every entry in the Kas (not only this year's projects)
    var kas = got.kas.v || [], byId = {};
    got.projects.forEach(function (p) { byId[p.id] = p; });
    var nameOf = function (e) { var p = byId[e.project_id]; return p ? E.clientName(p) : (e.counterparty || e.description || 'Operasional'); };
    var day = function (e) { return e.entry_date ? E.day(e.entry_date, { year: false }) : 'No date'; };
    var newest = function (a, b) { return (b.entry_date || '').localeCompare(a.entry_date || '') || (b.sheet_row || 0) - (a.sheet_row || 0); };
    var of = function (cats) { return kas.filter(function (e) { return e.kind === 'Keluar' && cats.indexOf(e.category) > -1; }); };
    var total = function (list, st) { return list.reduce(function (t, e) { return t + (!st || e.paid === st ? E.n(e.amount) || 0 : 0); }, 0); };
    var kasIn = of(CATS.kas), kasOut = kas.filter(function (e) { return e.kind === 'Keluar' && E.SPLIT_CATS.indexOf(e.category) < 0 && E.FROM_KAS.test(e.description || ''); });
    var inn = total(kasIn, 'Sudah'), out = total(kasOut, 'Sudah');
    var kasItems = kasIn.map(function (e) { return { e: e, inn: true }; }).concat(kasOut.map(function (e) { return { e: e }; }))
      .sort(function (a, b) { return newest(a.e, b.e); }).map(function (x) {
        var e = x.e, note = e.paid === 'Sudah' ? '' : ', not moved yet';
        return [day(e) + ', ' + (x.inn ? nameOf(e) : (e.counterparty || e.description || 'Used')) + note, (x.inn ? '+' : '−') + E.num(e.amount)];
      });
    var netIn = of(CATS.net).sort(newest), netMoved = total(netIn, 'Sudah');
    var netItems = netIn.map(function (e) { return [day(e) + ', ' + nameOf(e) + (e.paid === 'Sudah' ? '' : ', not moved yet'), '+' + E.num(e.amount)]; });
    var fees = of(CATS.fee).sort(newest), feePaid = total(fees, 'Sudah'), feeOwed = total(fees, 'Belum'), feeWait = 0;
    var feeItems = fees.map(function (e) { return [(e.counterparty || 'No name') + ', ' + nameOf(e), E.num(e.amount) + (e.paid === 'Sudah' ? ' Paid' : ' To pay')]; });
    rows.forEach(function (r) {
      var x = r.part.fee;
      if (x.amount && !x.entries.length) { if (!r.paid) feeWait += x.amount; feeItems.push([x.who + ', ' + E.clientName(r.p), E.num(x.amount) + (r.paid ? ' To pay' : '')]); if (r.paid) feeOwed += x.amount; }
    });
    var accts = h('section', { class: 'accts', 'aria-label': 'The accounts' },
      account('kas', 'Kas CCC account', [['In from projects', inn], ['Used', out]], ['Left in Kas CCC', inn - out], kasItems, 'Nothing set aside to Kas CCC yet.'),
      account('net', 'Net profit account', [['Moved in', netMoved]], ['In Net profit', netMoved], netItems, 'Nothing moved to Net profit yet.'),
      account('fee', 'Fees to people', [['Paid', feePaid], ['Still to pay', feeOwed]], ['After clients pay', feeWait], feeItems, 'No fee to anyone yet.'));

    var seen = got.values.kas_summary;
    panel.innerHTML = '';
    A.add(panel, [h('div', { class: 'pk' }, head, table, accts,
      h('p', { class: 'src' }, A.icon('sheet'), h('span', { text: E.fromSheet(got.values, seen && seen.seen_at) }),
        h('a', { href: '#finance/kas', text: 'Open the Kas' })))]);
  }

  A.loaders.profit = function () {
    if (!A.canMoney()) {
      panel.innerHTML = ''; got = null;
      panel.appendChild(h('p', { class: 'empty', text: 'Profit & Kas needs money access. An owner can turn it on for you in Settings.' }));
      return;
    }
    var mine = ++turn;
    // a first visit waits; a return keeps the last figures on screen until the new ones arrive
    if (!got) { panel.innerHTML = ''; panel.appendChild(h('p', { class: 'empty', text: 'Loading Profit & Kas…' })); }
    Promise.all([E.data.values(), E.data.projects(), E.data.money(), E.settle(E.data.kas())]).then(function (r) {
      if (mine !== turn) return;
      got = { values: r[0], projects: r[1], money: r[2], kas: r[3] };
      // a list that couldn't be loaded is said so; it is never shown as Rp 0
      if (got.kas.e) { panel.innerHTML = ''; panel.appendChild(h('p', { class: 'note red' }, A.icon('alert'), h('span', { text: 'The Kas entries couldn’t be loaded. ' + E.ecoError(got.kas.e) }))); return; }
      draw();
    }, function (e) {
      if (mine !== turn) return;
      panel.innerHTML = ''; panel.appendChild(h('p', { class: 'note red' }, A.icon('alert'), h('span', { text: E.ecoError(e) })));
    });
  };
})();
