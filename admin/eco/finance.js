/* Finance (money access only): what clients owe and how late it is, and the Kas, as the Sheet has them (Rekap Project,
   the Kas tab and Keuangan). As in the approved mockup: four figures, money owed by how late it is, then Invoices and
   Kas. Collect (owners and admins with money access) opens one invoice: a WhatsApp reminder with the text filled in,
   and a private invoice link for the client, made and emailed by the pay-link function, which checks the account again.
   Kas entries are added, edited and marked paid here and written to the Kas tab through sheets-write, which checks the
   role and the values again; deleting is for owners. Whatever the client reads is in Indonesian. */
(function () {
  'use strict';
  if (!window.cccAdmin) return; // admin.js stopped early: the sign in library didn't load
  var A = window.cccAdmin, E = window.eco, sb = A.sb, h = A.h, I = A.icon;
  var panel = A.$('[data-panel="finance"]'), ui = null, got = null, want = null, turn = 0;
  // the Kas form's categories, for when the Sheet's own list hasn't been read
  var CATS = ['Fee Crew', 'Sewa Alat', 'Transport', 'Akomodasi', 'Konsumsi', 'Lokasi', 'Properti & Wardrobe', 'Post Production',
    'Operasional', 'Beli Alat', 'Pajak', 'Pemasukan Lain', 'Lain-lain'];
  var KEYS = ['entry_date', 'kind', 'category', 'project_tab', 'description', 'counterparty', 'amount', 'paid', 'method', 'proof_url', 'note'];
  // money owed by how late it is, in days after the due date in Rekap Project: key, label, tag colour, the label in a sentence
  var AGES = [['soon', 'Not due yet', '', 'not due yet'], ['d30', '1 to 30 days late', 'amber', '1 to 30 days late'],
    ['d60', '31 to 60 days late', 'red', '31 to 60 days late'], ['d90', 'Over 60 days late', 'red', 'over 60 days late'],
    ['none', 'No due date', '', 'with no due date']];
  var RANK = { d90: 0, d60: 0, d30: 0, none: 1, soon: 2 };
  var LINKS = 'id, created_at, project_id, doc_no, amount, due_on, expires_at, revoked_at, sent_via, sent_to, sent_at, '
    + 'first_viewed_at, last_viewed_at, view_count, client_paid_at, client_note';
  var EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  var BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  var canWrite = function () { return A.canEdit() && A.canMoney(); };
  var val = function (key) { return got.values[key] ? got.values[key].value : null; };
  // a plain click on a link that opens something on this page (a new tab or window still works as a link)
  var plain = function (e) { return !(e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button); };
  var say = function (el, text, err) { el.textContent = text || ''; el.classList.toggle('neg', !!err); };
  // a due date, without the year when it is this year's
  var due = function (s) { return s && s.slice(0, 4) === E.today().slice(0, 4) ? E.day(s, { year: false }) : E.day(s); };

  // ---------- data ----------
  var links = function () { return E.rows(sb.from('pay_links').select(LINKS).order('created_at', { ascending: false }).limit(1000)); };
  var bank = function () { return E.rows(sb.from('pay_settings').select('bank_name, account_no, account_name').limit(1)).then(function (r) { return r[0] || null; }); };
  var linksOf = function (pid) { return got.links.v ? got.links.v.filter(function (l) { return l.project_id === pid; }) : []; };
  var saidPaid = function (pid) { return linksOf(pid).filter(function (l) { return l.client_paid_at && !l.revoked_at; })[0] || null; };
  var clientOf = function (p) { return got.clients.v ? got.clients.v.filter(function (c) { return c.id === p.client_id; })[0] || null : null; };
  var bankReady = function () { var b = got.bank.v; return !!(b && b.bank_name && b.account_no && b.account_name); };
  var live = function (l) { return !l.revoked_at && new Date(l.expires_at).getTime() > Date.now(); };
  // a table this copy of the database doesn't have yet (invoice links came later than the rest)
  var missing = function (e) { return !!e && (e.code === '42P01' || e.code === 'PGRST205' || /does not exist|schema cache/i.test(e.message || '')); };

  // one row per project in Rekap Project with a total: what is still owed (only once it is billed) and how late
  function bills() {
    var td = E.today();
    return got.projects.filter(function (p) { var m = got.money[p.id]; return p.sheet_state === 'present' && m && E.n(m.grand_total) > 0; }).map(function (p) {
      var m = got.money[p.id], billed = p.status === 'Deal' || p.status === 'Lunas', owe = billed ? E.n(m.outstanding) : null;
      var open = owe > 0, late = open && p.payment_due ? E.days(p.payment_due, td) : null;
      return { p: p, m: m, billed: billed, owe: owe, late: late, said: open ? saidPaid(p.id) : null,
        age: !open ? null : !p.payment_due ? 'none' : late <= 0 ? 'soon' : late <= 30 ? 'd30' : late <= 60 ? 'd60' : 'd90' };
    }).sort(function (a, b) {
      // the latest first, then those without a date, then what falls due soonest, then the rest by RAB number
      var x = a.age ? RANK[a.age] : 3, y = b.age ? RANK[b.age] : 3;
      return x - y || (x === 0 ? b.late - a.late : x === 2 ? a.p.payment_due.localeCompare(b.p.payment_due) : 0) || (b.p.seq || 0) - (a.p.seq || 0);
    });
  }
  var shown = function () { return ui.age ? got.list.filter(function (b) { return b.age === ui.age; }) : got.list; };
  function kasRows() {
    var mo = ui.month.value, j = ui.jenis.value, pr = ui.proj.value, pd = ui.paid.value;
    return (got.kas.v || []).filter(function (k) {
      return (!mo || (k.entry_date || '').slice(0, 7) === mo) && (!j || k.kind === j) && (!pd || k.paid === pd)
        && (!pr || (pr === '-' ? !k.project_tab || k.project_tab === 'Operasional' : k.project_tab === pr));
    });
  }

  // ---------- the page ----------
  function build() {
    if (ui) return;
    ui = {
      view: 'invoices', age: null,
      wait: h('div', { class: 'fwait' }),
      tiles: h('section', { class: 'tiles', 'aria-label': 'Money' }),
      ages: h('section', { class: 'card pipe age', 'aria-label': 'Money owed by how late it is', hidden: true }),
      gap: h('p', { class: 'note amber', hidden: true }),
      src: h('span', { class: 'src' }),
      fnote: h('p', { class: 'lnote', hidden: true }),
      lfail: h('p', { class: 'note amber', hidden: true }),
      inv: h('table', { class: 'tbl cards inv' }),
      kas: h('table', { class: 'tbl kas' }),
      count: h('span', { class: 'muted' }),
      month: A.select([['', 'Every month']], '', { class: 'field', 'aria-label': 'Month' }),
      jenis: A.select([['', 'Keluar and Masuk'], ['Keluar', 'Keluar'], ['Masuk', 'Masuk']], '', { class: 'field', 'aria-label': 'Jenis' }),
      proj: A.select([['', 'Every project'], ['-', 'Operasional']], '', { class: 'field', 'aria-label': 'Project' }),
      paid: A.select([['', 'Sudah and Belum'], ['Belum', 'Belum only'], ['Sudah', 'Sudah only']], '', { class: 'field', 'aria-label': 'Status' })
    };
    var tab = function (v, label) { return h('button', { type: 'button', 'aria-pressed': String(ui.view === v), onclick: function () { setView(v); } }, label, h('span', { class: 'c' })); };
    ui.tabInv = tab('invoices', 'Invoices'); ui.tabKas = tab('kas', 'Kas');
    [ui.month, ui.jenis, ui.proj, ui.paid].forEach(function (s) { s.addEventListener('change', draw); });
    ui.invBox = h('div', {}, ui.lfail, ui.fnote, h('div', { class: 'scrollx' }, ui.inv));
    ui.kasBox = h('div', { hidden: true }, h('div', { class: 'bar kasbar' }, ui.month, ui.jenis, ui.proj, ui.paid, ui.count), h('div', { class: 'scrollx' }, ui.kas));
    ui.card = h('section', { class: 'card tablecard', 'aria-label': 'Invoices and Kas', hidden: true },
      h('div', { class: 'bar' }, h('div', { class: 'tabs', role: 'group', 'aria-label': 'Show' }, ui.tabInv, ui.tabKas), ui.src,
        h('button', { class: 'btn sm csv', type: 'button', onclick: exportCsv }, I('in', 's'), 'Export CSV')),
      ui.invBox, ui.kasBox);
    panel.classList.add('fin');
    A.add(panel, [ui.wait, ui.tiles, ui.ages, ui.gap, ui.card]);
  }
  function setView(v) { ui.view = v; draw(); }

  // the four figures, as in the mockup; a figure the Sheet doesn't have says so instead of showing 0
  function tile(icon, label, tag, amount, sub) {
    var x = E.n(amount);
    return h('article', { class: 'tile' },
      h('p', { class: 'k' }, I(icon), h('span', { text: label }), tag),
      h('p', { class: 'v' + (x == null ? ' soft' : x < 0 ? ' neg' : ''), text: x == null ? 'Not in the Sheet' : E.rp(x) }),
      h('p', { class: 'c', text: sub }));
  }
  function figures(list) {
    var rs = val('rekap_summary') || {}, ks = val('kas_summary') || {}, ku = val('keuangan') || {};
    var owed = list.filter(function (b) { return b.owe > 0; });
    // overdue as the Sheet marks it (Telat), the same count as the sidebar
    var telat = list.filter(function (b) { return b.m.pay_status === 'Telat'; });
    var lateSum = telat.reduce(function (t, b) { return t + (b.owe > 0 ? b.owe : 0); }, 0);
    var next = owed.filter(function (b) { return b.age === 'soon'; })[0];
    var collectSub = telat.length === 1 ? E.clientName(telat[0].p) + (telat[0].late > 0 ? ', ' + E.plural(telat[0].late, 'day') + ' late' : ', late')
      : telat.length > 1 ? E.rp(lateSum) + ' of it late'
      : next ? 'Next due ' + E.when(next.p.payment_due)
      : owed.length ? E.plural(owed.length, 'invoice') + ' open' : 'Nothing to collect';
    var crew = E.crewOwed(got.kas.v || null);
    var year = E.n(ku.year);
    ui.tiles.innerHTML = '';
    A.add(ui.tiles, [
      tile('in', 'To collect', telat.length ? h('span', { class: 'tag red', text: telat.length + ' overdue' }) : null, rs.receivable, collectSub),
      tile('wallet', 'Cash in the Kas', null, ks.cash, 'From the Kas tab'),
      tile('out', 'Owed to crew', crew.tag, ks.owed, crew.sub),
      tile('trend', 'Omset' + (year ? ' ' + year : ''), null, ku.omset, E.n(ku.profit) == null ? 'Profit isn’t in the Sheet' : 'Profit ' + E.rp(ku.profit))]);
    // the invoices should add up to Rekap Project's own total; when they don't, say so rather than pick one
    var sum = owed.reduce(function (t, b) { return t + b.owe; }, 0), rec = E.n(rs.receivable);
    ui.gap.hidden = rec == null || Math.abs(sum - rec) < 1;
    ui.gap.innerHTML = '';
    if (!ui.gap.hidden) A.add(ui.gap, [I('alert'), h('span', { text: 'The invoices below add up to ' + E.rp(sum) + ' still owed, and Rekap Project’s own total says ' + E.rp(rec) + '.' })]);
  }

  // money owed by how late it is; a block filters the invoices below to it, a second press shows them all again
  function ages(list) {
    var owed = list.filter(function (b) { return b.age; }), n = 0;
    if (ui.age && !owed.some(function (b) { return b.age === ui.age; })) ui.age = null;
    ui.ages.innerHTML = '';
    ui.ages.hidden = !owed.length;
    AGES.forEach(function (a) {
      var rows = owed.filter(function (b) { return b.age === a[0]; });
      if (a[0] === 'none' && !rows.length) return;
      n++;
      ui.ages.appendChild(h('button', { class: 'st', type: 'button', 'data-age': a[0], 'aria-pressed': String(ui.age === a[0]), disabled: !rows.length,
        onclick: function () { pick(ui.age === a[0] ? null : a[0]); } },
        h('span', { class: 'row' }, h('span', { class: 'tag' + (a[2] && rows.length ? ' ' + a[2] : ''), text: a[1] })),
        h('b', { text: E.rp(rows.reduce(function (t, b) { return t + b.owe; }, 0)) }),
        h('span', { class: 'v', text: rows.length ? E.plural(rows.length, 'invoice') : 'None' })));
    });
    ui.ages.classList.toggle('n5', n === 5);
  }
  function pick(key) {
    ui.age = key; ui.view = 'invoices';
    A.$$('.st', ui.ages).forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-age') === key)); });
    draw();
  }

  function draw() {
    if (!got) return;
    var kas = ui.view === 'kas', seen = got.values[kas ? 'kas_summary' : 'rekap_summary'];
    ui.tabInv.setAttribute('aria-pressed', String(!kas)); ui.tabKas.setAttribute('aria-pressed', String(kas));
    ui.tabInv.lastChild.textContent = String(got.list.length);
    ui.tabKas.lastChild.textContent = got.kas.v ? String(got.kas.v.length) : '';
    ui.invBox.hidden = kas; ui.kasBox.hidden = !kas;
    ui.src.innerHTML = '';
    A.add(ui.src, [I('sheet'), h('span', { text: E.fromSheet(got.values, seen && seen.seen_at) })]);
    if (kas) drawKas(); else drawInv();
  }

  // ---------- invoices ----------
  function paidCell(b) {
    var p = b.p, m = b.m, total = E.n(m.grand_total);
    if (!b.billed) return h('td', { class: 'c-pg muted', text: E.phase(p) === 'Batal' ? '' : 'Not billed yet' });
    if (b.owe == null) return h('td', { class: 'c-pg muted', text: 'Not in the Sheet' });
    if (b.owe <= 0) return h('td', { class: 'c-pg' }, h('span', { class: 'paidok' }, I('check'), 'Paid in full'));
    var paid = Math.max(0, Math.min(total, E.n(m.paid_total) || 0)), share = Math.round(paid / total * 100);
    var late = b.late > 0 || m.pay_status === 'Telat';
    var bar = h('div', { class: 'tr' }, h('i', { class: 'is-paid' }), late ? h('i', { class: 'is-late' }) : null);
    bar.firstChild.style.width = share + '%';
    if (late) bar.lastChild.style.width = Math.min(100 - share, Math.round(b.owe / total * 100)) + '%';
    var right = late ? h('span', { class: 'late', text: E.rp(b.owe) + ' late' })
      : h('span', { text: E.rp(b.owe) + (p.payment_due ? ' due ' + due(p.payment_due) : ' to collect') });
    return h('td', { class: 'c-pg' }, h('div', { class: 'prog' }, bar, h('div', { class: 'l' }, h('span', { text: share + '% paid' }), right)));
  }
  function invRow(b, w) {
    var p = b.p, m = b.m, who = E.clientName(p), href = '#projects/' + p.id;
    var tr = h('tr', {},
      h('td', { class: 'c-pj' }, h('div', { class: 'pj' }, h('span', { class: 'av', 'aria-hidden': 'true', text: E.initial(who) }),
        h('div', {}, h('b', {}, h('a', { href: href, text: who })), h('span', { text: E.projectLine(p) })))),
      h('td', { class: 'c-nx muted', text: p.invoice_no || '' }),
      h('td', { class: 'num c-val', text: E.rp(m.grand_total) }),
      paidCell(b),
      h('td', { class: 'c-sh' + (p.payment_due ? '' : ' muted'), text: p.payment_due ? due(p.payment_due) : '' }),
      h('td', { class: 'c-st' }, E.stage(m.pay_status || E.phase(p)), b.said ? h('span', { class: 'tag violet', text: 'Client says paid' }) : null),
      // an invoice with money owed has Collect where the others have the arrow
      w && b.owe > 0 ? h('td', { class: 'c-ac' }, h('button', { class: 'btn sm', type: 'button', onclick: function () { collect(b); } }, 'Collect'))
        : h('td', { class: 'go' }, I('chev', 's')));
    // the whole row opens the project; its name is the link a keyboard or a new tab uses
    tr.addEventListener('click', function (e) { if (!e.target.closest('a, button')) location.hash = href; });
    return tr;
  }
  function drawInv() {
    var w = canWrite(), rows = shown(), tb = h('tbody');
    ui.inv.innerHTML = '';
    A.add(ui.inv, [h('thead', {}, h('tr', {}, h('th', { text: 'Project' }), h('th', { class: 'c-nx', text: 'Invoice no.' }), h('th', { class: 'num', text: 'Total' }),
      h('th', { text: 'Paid' }), h('th', { text: 'Due' }), h('th', { text: 'Status' }), h('th', {}, h('span', { class: 'sr', text: w ? 'Collect' : 'Open' })))), tb]);
    rows.forEach(function (b) { tb.appendChild(invRow(b, w)); });
    if (!rows.length) E.fullRow(tb, 7, got.list.length ? 'No invoices here.' : 'No invoices yet. A project shows here once Rekap Project has its total.');
    // links that failed to load can hide a client's "I've paid"; say so rather than show nothing
    var lf = !!got.links.e && !missing(got.links.e);
    ui.lfail.hidden = !lf; ui.lfail.innerHTML = '';
    if (lf) A.add(ui.lfail, [I('alert'), h('span', { text: 'The invoice links couldn\u2019t be loaded, so \u201cClient says paid\u201d can be missing here. Reload to try again.' })]);
    var a = ui.age ? AGES.filter(function (x) { return x[0] === ui.age; })[0] : null;
    ui.fnote.hidden = !a; ui.fnote.innerHTML = '';
    if (a) A.add(ui.fnote, ['Showing ' + E.plural(rows.length, 'invoice') + ' ' + a[3] + '. ',
      h('button', { class: 'link', type: 'button', onclick: function () { pick(null); ui.tabInv.focus(); } }, 'Show all invoices')]);
  }

  // ---------- the Kas ----------
  function kasRow(k, w) {
    var owed = k.paid === 'Belum', out = k.kind === 'Keluar', name = k.description || k.category || 'Cash entry';
    var title = w ? h('a', { href: '#finance/' + k.id, text: name, onclick: function (e) { if (plain(e)) { e.preventDefault(); kasEditor(k); } } }) : name;
    var tr = h('tr', {},
      h('td', { class: 'k-dt', text: E.day(k.entry_date) }),
      h('td', { class: 'k-ds' }, h('div', { class: 'pj' }, h('div', {}, h('b', {}, title), h('span', { text: k.category || '' })))),
      h('td', { class: 'k-pr muted', text: k.project_tab || 'Operasional' }),
      h('td', { class: 'k-to', text: k.counterparty || '' }),
      h('td', { class: 'num k-am' }, k.amount == null ? null : h('span', { class: 'amt ' + (out ? 'out' : 'in') }, I(out ? 'out' : 'in'),
        h('span', { class: 'sr', text: out ? 'Keluar ' : 'Masuk ' }), (out ? '−' : '') + E.num(k.amount))),
      h('td', { class: 'k-st' }, k.paid ? h('span', { class: 'pill ' + (owed ? 'no' : 'yes'), text: k.paid }) : null),
      h('td', { class: 'k-me muted', text: k.method || '' }),
      w ? h('td', { class: 'k-ac' }, owed ? h('button', { class: 'btn sm', type: 'button', onclick: function (e) { markPaid(k, e.currentTarget); } }, 'Mark paid') : null) : null);
    if (w) tr.addEventListener('click', function (e) { if (!e.target.closest('a, button')) kasEditor(k); });
    else tr.classList.add('ro');
    return tr;
  }
  function drawKas() {
    var w = canWrite(), tb = h('tbody'), cols = w ? 8 : 7;
    ui.kas.innerHTML = '';
    A.add(ui.kas, [h('thead', {}, h('tr', {}, ['Date', 'Keterangan', 'Project', 'To or from'].map(function (t) { return h('th', { text: t }); }),
      h('th', { class: 'num', text: 'Nominal' }), h('th', { text: 'Status' }), h('th', { text: 'Metode' }),
      w ? h('th', {}, h('span', { class: 'sr', text: 'Mark paid' })) : null)), tb]);
    if (got.kas.e) { E.errRow(tb, cols, got.kas.e); ui.count.textContent = ''; return; }
    var rows = kasRows();
    rows.forEach(function (k) { tb.appendChild(kasRow(k, w)); });
    if (!rows.length) {
      E.fullRow(tb, cols, got.kas.v.length ? 'No cash entries match these filters.'
        : w ? 'No cash entries yet. Add one here, or keep using the Kas form on your phone.' : 'No cash entries yet. Entries in the Kas tab of the Sheet show up here.');
    }
    ui.count.textContent = E.plural(rows.length, 'entry', 'entries');
  }
  function fillFilters() {
    var months = {}, tabs = {}, mo = ui.month.value, pr = ui.proj.value;
    (got.kas.v || []).forEach(function (k) { if (k.entry_date) months[k.entry_date.slice(0, 7)] = true; if (k.project_tab && k.project_tab !== 'Operasional') tabs[k.project_tab] = true; });
    ui.month.length = 1;
    Object.keys(months).sort().reverse().forEach(function (m) { ui.month.appendChild(h('option', { value: m }, E.day(m + '-01').replace(/^1 /, ''))); });
    ui.proj.length = 2;
    Object.keys(tabs).sort().forEach(function (t) { ui.proj.appendChild(h('option', { value: t }, t)); });
    // a reload keeps the filters that still have entries
    ui.month.value = months[mo] ? mo : '';
    ui.proj.value = pr === '-' || tabs[pr] ? pr : '';
  }
  function exportCsv() {
    if (!got) return;
    if (ui.view === 'kas') {
      if (!got.kas.v) { A.toast('The Kas entries couldn’t be loaded, so there is nothing to export.', true); return; }
      E.csv('ccc-kas', ['Date', 'Jenis', 'Kategori', 'Project', 'Keterangan', 'To or from', 'Nominal', 'Status', 'Metode'],
        kasRows().map(function (k) { return [k.entry_date, k.kind, k.category, k.project_tab || 'Operasional', k.description, k.counterparty, k.amount, k.paid, k.method]; }));
    } else {
      E.csv('ccc-invoices', ['Project', 'Client', 'Invoice no.', 'Status', 'Total', 'Paid', 'Outstanding', 'Due', 'Days late', 'Pay status'],
        shown().map(function (b) {
          var p = b.p, m = b.m;
          return [p.tab_name, p.client_label, p.invoice_no, p.status, m.grand_total, m.paid_total, m.outstanding, p.payment_due, b.late > 0 ? b.late : null, m.pay_status];
        }));
    }
  }

  // ---------- Collect: one invoice, a reminder on WhatsApp and the private invoice link ----------
  // pay-link answers {status, body}; only a failed connection rejects
  function payLink(body) {
    return sb.functions.invoke('pay-link', { body: body }).then(function (r) {
      if (!r.error) return { status: 200, body: r.data || {} };
      var res = r.error.context;
      // no answer at all (offline, or the function couldn't be reached)
      if (!res || typeof res.json !== 'function') throw new Error('Couldn\u2019t reach the server. Check the connection and try again.');
      return res.json().catch(function () { return {}; }).then(function (b) { return { status: res.status, body: b || {} }; });
    });
  }
  // the function's own words first: it knows which limit was hit and what is missing
  function linkError(r) {
    var c = r.body && r.body.code, said = r.body && typeof r.body.error === 'string' ? r.body.error : '';
    if (c === 'mail_not_configured') return 'Email isn’t set up on this copy of the admin yet. Send the link on WhatsApp or copy it instead.';
    // a 404 that isn't the function's answer: the function isn't there
    if (r.status === 404 && c !== 'not_found') return 'Invoice links aren’t set up on this copy of the admin yet.';
    if (said) return said;
    if (r.status === 403) return 'Your account isn’t allowed to send invoice links.';
    if (r.status === 429) return 'Too many links in a short time. Wait a few minutes and try again.';
    return 'The invoice link couldn’t be made. Try again.';
  }
  function copyText(s) {
    var old = function () {
      var t = h('textarea', { class: 'sr', readonly: true, value: s });
      document.body.appendChild(t); t.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      t.remove();
      return ok;
    };
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(s).then(function () { return true; }, function () { return old(); });
    return Promise.resolve(old());
  }
  // a day as the client reads it: "25 Oktober 2026"
  var tanggal = function (s) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || ''); return m ? +m[3] + ' ' + BULAN[+m[2] - 1] + ' ' + m[1] : ''; };
  var LINK_LINE = 'Rincian tagihan dan rekening pembayarannya ada di sini: ';
  // the reminder in Indonesian, with the invoice link once there is one
  function reminder(b, cl, url) {
    var p = b.p, pic = cl && cl.pic ? String(cl.pic).trim() : '';
    var what = (p.title || p.tab_name || 'project kami') + (p.invoice_no ? ' (invoice ' + p.invoice_no + ')' : '');
    var due = !p.payment_due ? '' : (b.late > 0 ? ' yang jatuh tempo ' : ', jatuh tempo ') + tanggal(p.payment_due);
    return [pic ? 'Halo Kak ' + pic + ',' : 'Halo,',
      'Kami dari Creative Club Cult mau mengingatkan pembayaran untuk ' + what + ' sebesar ' + E.rp(b.owe) + due + '.',
      url ? LINK_LINE + url : null,
      'Kalau sudah transfer, abaikan saja pesan ini ya. Terima kasih!'].filter(Boolean).join('\n\n');
  }

  function linkItem(l, off) {
    var how = l.sent_via === 'email' ? 'Emailed' + (l.sent_to ? ' to ' + l.sent_to : '') : l.sent_via === 'whatsapp' ? 'Made for WhatsApp' : 'Copied';
    var state = l.revoked_at ? 'Turned off ' + E.shortStamp(l.revoked_at)
      : !live(l) ? 'Expired ' + E.shortStamp(l.expires_at)
      : (l.view_count > 0 ? 'Opened ' + (l.view_count === 1 ? 'once' : l.view_count + ' times') + ', last ' + E.shortStamp(l.last_viewed_at) : 'Not opened yet')
        + '. Works until ' + E.shortStamp(l.expires_at);
    return h('li', { class: 'plink' + (live(l) ? '' : ' gone') },
      h('div', {}, h('b', { text: how + ', ' + E.shortStamp(l.created_at) }), h('span', { text: state + '.' })),
      live(l) ? h('button', { class: 'btn sm danger', type: 'button', onclick: function (e) { off(l, e.currentTarget); } }, 'Turn off') : null,
      l.client_paid_at ? h('p', { class: 'said' }, h('span', { class: 'tag violet', text: 'Says paid ' + E.shortStamp(l.client_paid_at) }),
        l.client_note ? h('span', { text: '“' + l.client_note + '”' }) : null) : null);
  }

  function collect(b) {
    if (!canWrite() || !got) return;
    var p = b.p, m = b.m, who = E.clientName(p), cl = clientOf(p), total = E.n(m.grand_total);
    var ready = bankReady() && !got.links.e, wa = E.wa(cl && cl.phone), said = saidPaid(p.id);
    var share = Math.round(Math.max(0, Math.min(total, E.n(m.paid_total) || 0)) / total * 100);

    // the reminder: WhatsApp opens with it filled in, the admin presses send
    var text = h('textarea', { rows: 9, maxlength: 2000, value: reminder(b, cl, null) });
    var waBtn = wa ? h('a', { class: 'btn lime', href: wa, target: '_blank', rel: 'noopener noreferrer' }, I('chat', 's'), 'Open WhatsApp') : null;
    var sync = function () { if (waBtn) waBtn.href = wa + '?text=' + encodeURIComponent(text.value.trim()); };
    text.addEventListener('input', sync); sync();
    var waSay = h('p', { class: 'help', role: 'status' });
    var addLink = ready ? h('button', { class: 'btn sm', type: 'button', onclick: function () {
      addLink.disabled = true; say(waSay, 'Making the link…');
      payLink({ action: 'create', project_id: p.id, via: 'whatsapp', origin: location.origin }).then(function (r) {
        if (r.status !== 200 || !r.body.url) { addLink.disabled = false; say(waSay, linkError(r), true); return; }
        // an untouched message gets the link in its place; an edited one gets it at the end
        text.value = text.value.trim() === reminder(b, cl, null) ? reminder(b, cl, r.body.url) : text.value.trim() + '\n\n' + LINK_LINE + r.body.url;
        sync(); addLink.hidden = true;
        say(waSay, 'Link added. It works until ' + E.day(E.jkt(r.body.expires_at)) + '.');
        refresh();
      }, function (e) { addLink.disabled = false; say(waSay, E.ecoError(e), true); });
    } }, I('link', 's'), 'Add the invoice link') : null;
    var copyMsg = h('button', { class: 'btn', type: 'button', onclick: function () {
      copyText(text.value.trim()).then(function (ok) { A.toast(ok ? 'Message copied.' : 'Couldn’t copy. Select the text and copy it yourself.', !ok); });
    } }, I('copy', 's'), 'Copy message');
    var to = !got.clients.v ? 'The client’s details couldn’t be loaded. Copy the message and send it yourself.'
      : wa ? 'To ' + [cl.pic, cl.phone].filter(Boolean).join(', ') + '. WhatsApp opens with this message, and you press send.'
      : 'There’s no phone number for ' + who + ' in the Client tab of the Sheet. Copy the message and send it yourself.';

    // the private link by email (or copied for any other channel)
    var mailTo = h('input', { type: 'email', maxlength: 254, autocomplete: 'off', placeholder: 'name@company.com', value: (cl && cl.email) || '' });
    var mailSay = h('p', { class: 'help', role: 'status' }), linkOut = h('div', { class: 'linkout', hidden: true });
    var sendBtn = h('button', { class: 'btn', type: 'button', onclick: sendMail }, I('mail', 's'), 'Send email');
    var copyBtn = h('button', { class: 'btn quiet', type: 'button', onclick: copyLink }, I('copy', 's'), 'Copy a link');
    var busy = function (on) { sendBtn.disabled = on; copyBtn.disabled = on; };
    function sendMail() {
      var addr = mailTo.value.trim();
      if (!EMAIL.test(addr)) { say(mailSay, 'Enter the client’s email address.', true); mailTo.focus(); return; }
      A.ask('Email the invoice link?', 'It goes to ' + addr + ' with the invoice summary, CCC’s bank details and a private link.', 'Send email').then(function (go) {
        if (!go) return;
        busy(true); say(mailSay, 'Sending…');
        payLink({ action: 'create', project_id: p.id, via: 'email', to: addr, origin: location.origin }).then(function (r) {
          busy(false);
          if (r.status !== 200) { say(mailSay, linkError(r), true); return; }
          say(mailSay, 'Sent to ' + addr + '.');
          refresh();
        }, function (e) { busy(false); say(mailSay, E.ecoError(e), true); });
      });
    }
    function copyLink() {
      busy(true); say(mailSay, 'Making the link…');
      payLink({ action: 'create', project_id: p.id, via: 'copy', origin: location.origin }).then(function (r) {
        busy(false);
        if (r.status !== 200 || !r.body.url) { say(mailSay, linkError(r), true); return; }
        var until = 'It works until ' + E.day(E.jkt(r.body.expires_at)) + '.';
        // shown as well, for when the browser doesn't allow copying after a wait
        linkOut.innerHTML = ''; linkOut.hidden = false;
        A.add(linkOut, [h('input', { type: 'text', readonly: true, value: r.body.url, 'aria-label': 'Invoice link' }),
          h('button', { class: 'btn sm', type: 'button', onclick: function () { copyText(r.body.url).then(function (ok) { A.toast(ok ? 'Link copied.' : 'Couldn’t copy. Select the link and copy it yourself.', !ok); }); } }, I('copy', 's'), 'Copy')]);
        copyText(r.body.url).then(function (ok) { say(mailSay, (ok ? 'Link copied. ' : '') + until); });
        refresh();
      }, function (e) { busy(false); say(mailSay, E.ecoError(e), true); });
    }
    var noLink = missing(got.links.e) || missing(got.bank.e) ? 'Invoice links aren’t set up on this copy of the admin yet.'
      : got.links.e ? 'The invoice links couldn’t be loaded, so making a new one is off for now. Reload to try again.'
      : got.bank.e ? 'CCC’s bank details couldn’t be loaded, so invoice links are off for now. Reload to try again.'
      : !bankReady() ? (A.isOwner() ? 'Add CCC’s bank details in Settings first. The client’s page shows them.' : 'An owner adds CCC’s bank details in Settings first. The client’s page shows them.')
      : null;

    // links sent before, newest first; a live one can be turned off
    var past = h('ul', { class: 'plinks' }), pastSec = E.dsec('Links sent', null, past);
    function off(l, btn) {
      A.ask('Turn off this link?', 'The client sees that the link no longer works. You can send a new one any time.', 'Turn off', true).then(function (go) {
        if (!go) return;
        btn.disabled = true;
        payLink({ action: 'revoke', id: l.id }).then(function (r) {
          if (r.status !== 200) {
            btn.disabled = false; A.toast(linkError(r), true);
            // already off (from another device, say): show the list as it is now
            if (r.body && r.body.code === 'not_found') refresh();
            return;
          }
          A.toast('Link turned off.'); refresh();
        }, function (e) { btn.disabled = false; E.failed(e); });
      });
    }
    function drawLinks() {
      var own = linksOf(p.id);
      past.innerHTML = '';
      pastSec.hidden = !own.length;
      own.forEach(function (l) { past.appendChild(linkItem(l, off)); });
    }
    function refresh() {
      E.settle(links()).then(function (r) { got.links = r; got.list = bills(); drawLinks(); draw(); });
    }

    var late = b.late > 0;
    var due = h('p', { class: 'due' }, 'Of ' + E.rp(total) + ', ' + share + '% paid. ',
      !p.payment_due ? 'No due date in Rekap Project.' : b.late === 0 ? 'Due today.' : 'Due ' + E.day(p.payment_due) + (late ? ', ' : '.'),
      late ? h('span', { class: 'late', text: E.plural(b.late, 'day') + ' late.' }) : null);
    E.drawer('finance', p.id, [
      E.dhead(h('span', { class: 'av', 'aria-hidden': 'true', text: E.initial(who) }), who, E.projectLine(p), [p.invoice_no, m.pay_status].filter(Boolean)),
      h('div', { class: 'dr-body collect' },
        said ? h('div', { class: 'note violet' }, I('check'), h('div', {},
          h('p', { text: who + ' says they paid on ' + E.day(E.jkt(said.client_paid_at)) + (said.client_note ? ': “' + said.client_note + '”' : '.') }),
          h('p', { text: 'Check the bank. Once it’s there, save the payment on the project.' }),
          h('a', { class: 'btn sm', href: '#projects/' + p.id }, 'Open the project'))) : null,
        E.dsec('To collect', null, h('p', { class: 'big' + (late ? ' neg' : ''), text: E.rp(b.owe) }), due),
        E.dsec('Remind on WhatsApp', null,
          h('label', { class: 'f' }, h('span', { class: 'sr', text: 'Message to the client' }), text),
          addLink ? h('div', { class: 'formacts' }, addLink) : null, waSay,
          h('div', { class: 'formacts' }, waBtn, copyMsg),
          h('p', { class: 'help', text: to })),
        E.dsec('Invoice link by email', null, noLink
          ? [h('p', { class: 'note' }, I('bank'), h('span', { text: noLink })),
            A.isOwner() && !got.links.e && !got.bank.e ? h('div', { class: 'formacts' }, h('a', { class: 'btn sm', href: '#settings' }, 'Open Settings')) : null]
          : [h('label', { class: 'f' }, 'Send to', mailTo), h('div', { class: 'formacts' }, sendBtn, copyBtn), mailSay, linkOut,
            h('p', { class: 'help', text: 'The email has the invoice summary, CCC’s bank details and a private link with an “I’ve paid” button. A link works for 60 days.' })]),
        pastSec)
    ]);
    drawLinks();
  }

  // ---------- the Kas, written to the Sheet ----------
  // the entry as the admin saw it, so the Sheet can tell whether the row changed meanwhile
  var seen = function (k) { var m = {}; KEYS.forEach(function (key) { m[key] = k[key] == null ? null : k[key]; }); return m; };
  var same = function (a, b) { return String(a == null ? '' : a) === String(b == null ? '' : b); };
  // after a change: the list at once (the write already updated it), the Sheet's totals after a pull
  function reload() {
    E.forget(); A.loaders.finance();
    E.pullSoon().then(function (ok) { if (ok && !panel.hidden) { E.forget(); A.loaders.finance(); } });
  }

  function markPaid(k, btn) {
    btn.disabled = true; btn.textContent = 'Saving…';
    E.sheetWrite('kas_update', { hint_row: k.sheet_row, match: seen(k), set: { paid: 'Sudah' } }).then(function (r) {
      if (r.status === 200 || r.status === 202) { A.toast(r.status === 200 ? 'Marked paid in the Sheet.' : E.writeText(r)); reload(); return; }
      A.toast(E.writeText(r), true); btn.disabled = false; btn.textContent = 'Mark paid';
    }, function (e) { A.toast(E.ecoError(e), true); btn.disabled = false; btn.textContent = 'Mark paid'; });
  }

  // a choice that a second tap clears again (Metode is optional, as in the Kas form)
  function optional(opts, current, label, onPick) {
    var box = h('div', { class: 'eco-seg', role: 'group', 'aria-label': label });
    opts.forEach(function (o) {
      box.appendChild(h('button', { type: 'button', 'aria-pressed': String(o === current), onclick: function (e) {
        var b = e.currentTarget, on = b.getAttribute('aria-pressed') !== 'true';
        A.$$('button', box).forEach(function (x) { x.setAttribute('aria-pressed', 'false'); });
        b.setAttribute('aria-pressed', String(on));
        onPick(on ? o : null);
      } }, o));
    });
    return box;
  }

  // Add (k = null) or edit one entry. The fields are the Kas form's, in the same order.
  function kasEditor(k) {
    if (!canWrite()) return;
    if (!got) { A.toast('Still loading. Try again in a moment.'); return; }
    var x = k || {}, cats = (val('labels') || {}).kas_categories;
    cats = Array.isArray(cats) && cats.length ? cats.slice() : CATS.slice();
    if (x.category && cats.indexOf(x.category) < 0) cats.push(x.category);
    var tabs = got.projects.filter(function (p) { return p.sheet_state === 'present' && p.tab_name; });
    var opts = (k ? [] : [['', 'Pick one']]).concat([['-', 'Operasional']], tabs.map(function (p) { return [p.tab_name, [E.short(p), p.title].filter(Boolean).join(', ')]; }));
    var oper = !x.project_tab || x.project_tab === 'Operasional';
    if (!oper && !tabs.some(function (p) { return p.tab_name === x.project_tab; })) opts.push([x.project_tab, x.project_tab]);
    var st = { kind: x.kind || 'Keluar', paid: x.paid || 'Sudah', method: x.method || null };
    var f = {
      amount: h('input', { type: 'text', inputmode: 'numeric', autocomplete: 'off', placeholder: '1.500.000', value: x.amount != null ? E.num(x.amount) : '' }),
      description: h('input', { type: 'text', maxlength: 1000, autocomplete: 'off', placeholder: 'What it was for', value: x.description || '' }),
      project: A.select(opts, k ? (oper ? '-' : x.project_tab) : ''),
      category: A.select((k ? [] : [['', 'Pick one']]).concat(cats.map(function (c) { return [c, c]; })), x.category || ''),
      counterparty: h('input', { type: 'text', maxlength: 200, autocomplete: 'off', placeholder: 'Crew, vendor or client', value: x.counterparty || '', list: 'eco-crew-names' }),
      entry_date: h('input', { type: 'date', value: x.entry_date || E.today() }),
      proof_url: h('input', { type: 'url', maxlength: 1000, autocomplete: 'off', placeholder: 'Receipt or transfer proof, optional', value: x.proof_url || '' })
    };
    var amount = function () { var d = f.amount.value.split(',')[0].replace(/\D/g, ''); return d ? Number(d) : null; };
    f.amount.addEventListener('blur', function () { var v = amount(); f.amount.value = v == null ? '' : E.num(v); });
    function entry() {
      var pv = f.project.value;
      return {
        entry_date: f.entry_date.value || null, kind: st.kind, category: f.category.value || null,
        project_tab: pv === '-' ? (x.project_tab === 'Operasional' ? 'Operasional' : null) : pv || null,
        description: f.description.value.trim() || null, counterparty: f.counterparty.value.trim() || null, amount: amount(),
        paid: st.paid, method: st.method, proof_url: f.proof_url.value.trim() || null
      };
    }
    function problem(r) {
      if (!(r.amount > 0)) return 'Fill in the amount.';
      if (r.amount > 1e12) return 'That amount is too large.';
      if (!r.description) return 'Say what it was for.';
      if (!k && !f.project.value) return 'Pick the project, or Operasional.';
      if (!r.category) return 'Pick a category.';
      if (!r.entry_date) return 'Pick the date.';
      if (r.proof_url && !/^https:\/\/\S{4,990}$/.test(r.proof_url)) return 'The proof link must start with https://';
      return '';
    }

    // a new name can go into the crew list too (only when the list could be read, so "new" is certain)
    var crew = null, list = h('datalist', { id: 'eco-crew-names' });
    var saveBox = h('input', { type: 'checkbox' }), saveText = h('span');
    var saveRow = h('label', { class: 'chk full', hidden: true }, saveBox, saveText);
    function newName() {
      var n = f.counterparty.value.trim();
      var show = !k && !!crew && st.kind === 'Keluar' && n.length > 1 && crew.indexOf(n.toLowerCase()) < 0;
      saveRow.hidden = !show;
      if (!show) saveBox.checked = false;
      saveText.textContent = 'Save “' + n + '” to the crew list';
    }
    f.counterparty.addEventListener('input', newName);
    if (!k) {
      E.rows(A.sb.from('crew').select('name').eq('sheet_state', 'present').order('name').limit(2000)).then(function (rows) {
        crew = rows.map(function (c) { return String(c.name || '').trim().toLowerCase(); });
        rows.forEach(function (c) { if (c.name) list.appendChild(h('option', { value: c.name })); });
        newName();
      }, function () { crew = null; });
    }

    var field = function (label, el, full) { return h('label', { class: 'f' + (full ? ' full' : '') }, label, el); };
    var group = function (label, el) { return h('div', { class: 'f' }, h('span', { 'aria-hidden': 'true', text: label }), el); };
    var msg = h('span', { class: 'help', role: 'status' });
    var btn = h('button', { class: 'btn lime', type: 'button', onclick: function () { if (k) saveEdit(); else addNew(); } }, k ? 'Save changes' : 'Add to Kas');
    var del = k && A.isOwner() ? h('button', { class: 'btn quiet danger', type: 'button', onclick: remove }, 'Delete entry') : null;
    var busy = function (on) { btn.disabled = on; if (del) del.disabled = on; };
    var from = x.note === 'via Form' ? 'From the Kas form' : x.note === 'via Admin' ? 'Added in the admin' : 'From the Kas tab';
    var start = JSON.stringify(entry());
    var opId = null, opKey = null;    // a retry of the same entry after a lost answer re-sends the same change, never a second one

    function finish(r, text) {
      A.guard(null); A.closeDrawer(true);
      A.toast(r.status === 202 ? E.writeText(r) : text);
      ui.view = 'kas'; reload();
    }
    function failed(e) { busy(false); say(msg, E.ecoError(e), true); }
    function send(op, args, key) {
      if (key !== opKey) { opKey = key; opId = E.uuid(); }
      return E.sheetWrite(op, args, opId).then(function (r) {
        if (r.status !== 500 && r.status !== 502 && r.status !== 503) opKey = null;    // settled: a new attempt is a new change
        return r;
      });
    }
    function addNew() {
      var r = entry(), bad = problem(r);
      if (bad) return say(msg, bad, true);
      busy(true); say(msg, 'Saving to the Sheet…');
      var add = function (dup) {
        return send('kas_add', { row: r, allow_duplicate: dup }, JSON.stringify([r, dup])).then(function (res) {
          if (!(res.status === 409 && res.body.duplicate)) return res;
          var at = res.body.row && res.body.row.row;
          // the refused attempt is cleared either way; "Add another" sends a new one that allows the twin
          return E.sheetWrite('outbox_discard', { op_id: res.op_id }).catch(function () {}).then(function () {
            return A.ask('Add it again?', 'The same entry is already in Kas' + (at ? ' (row ' + at + ')' : '') + '. Add another one anyway?', 'Add another')
              .then(function (go) { return go ? add(true) : null; });
          });
        });
      };
      add(false).then(function (res) {
        if (!res) { busy(false); say(msg, ''); return; }
        if (res.status !== 200 && res.status !== 202) { busy(false); say(msg, E.writeText(res), true); return; }
        if (!saveBox.checked || saveRow.hidden || res.status !== 200) { finish(res, 'Added to Kas.'); return; }
        say(msg, 'Saving to the crew list…');
        E.sheetWrite('crew_upsert', { name: r.counterparty, create: true, set: {} }).then(function (c) {
          if (c.status === 200 || c.status === 202) finish(res, 'Added to Kas and to the crew list.');
          else { finish(res, 'Added to Kas.'); A.toast('Added to Kas. The crew list wasn’t changed: ' + E.writeText(c), true); }
        }, function (e) { finish(res, 'Added to Kas.'); A.toast('Added to Kas. The crew list wasn’t changed: ' + E.ecoError(e), true); });
      }, failed);
    }
    function saveEdit() {
      var r = entry(), bad = problem(r);
      if (bad) return say(msg, bad, true);
      var m = seen(k), set = {};
      Object.keys(r).forEach(function (key) { if (!same(r[key], m[key])) set[key] = r[key]; });
      if (!Object.keys(set).length) return say(msg, 'Nothing changed.');
      busy(true); say(msg, 'Saving to the Sheet…');
      send('kas_update', { hint_row: k.sheet_row, match: m, set: set }, JSON.stringify(set)).then(function (res) {
        if (res.status === 200 || res.status === 202) finish(res, 'Saved to the Sheet.');
        else { busy(false); say(msg, E.writeText(res), true); }
      }, failed);
    }
    function remove() {
      A.ask('Delete this cash entry?', 'It is cleared from the Kas tab of the Sheet. To bring it back, add it again.', 'Delete entry', true).then(function (go) {
        if (!go) return;
        busy(true); say(msg, 'Deleting…');
        send('kas_delete', { hint_row: k.sheet_row, match: seen(k) }, 'delete').then(function (res) {
          if (res.status === 200 || res.status === 202) finish(res, 'Deleted from the Sheet.');
          else { busy(false); say(msg, E.writeText(res), true); }
        }, failed);
      });
    }

    E.drawer(k ? 'finance' : null, k ? k.id : null, [
      E.dhead(h('span', { class: 'av', 'aria-hidden': 'true' }, I('wallet')), k ? (x.description || x.category || 'Cash entry') : 'Add cash entry',
        k ? from + (x.sheet_row ? ', row ' + x.sheet_row + ' in the Kas tab' : '') : 'Goes into the Kas tab of the Sheet, the same as the Kas form.'),
      h('div', { class: 'dr-body' },
        h('div', { class: 'fgrid' },
          group('Jenis', E.seg([['Keluar', 'Keluar'], ['Masuk', 'Masuk']], st.kind, function (v) { st.kind = v; newName(); }, { 'aria-label': 'Jenis' })),
          field('Nominal (Rp)', f.amount),
          field('Keterangan', f.description, true),
          field('Project', f.project),
          field('Kategori', f.category),
          field('To or from', f.counterparty),
          field('Date', f.entry_date),
          saveRow,
          group('Status', E.seg([['Sudah', 'Sudah'], ['Belum', 'Belum']], st.paid, function (v) { st.paid = v; }, { 'aria-label': 'Status' })),
          group('Metode', optional(['Transfer', 'Cash', 'QRIS'], st.method, 'Metode', function (v) { st.method = v; })),
          field('Proof link', f.proof_url, true), list),
        h('div', { class: 'formacts' }, btn, del, msg))
    ]);
    A.guard(function () { return JSON.stringify(entry()) !== start || saveBox.checked; });
    if (!k) f.amount.focus();
  }

  A.actions.finance = function () {
    return canWrite() ? h('button', { class: 'btn lime', type: 'button', onclick: function () { kasEditor(null); } }, I('plus', 's'), 'Add cash entry') : null;
  };
  A.loaders.finance = function () {
    if (!A.canMoney()) {
      panel.innerHTML = ''; ui = null; got = null;
      panel.appendChild(h('p', { class: 'empty', text: 'Finance needs money access. An owner can turn it on for you in Settings.' }));
      return;
    }
    if (!ui) panel.innerHTML = '';
    build();
    var mine = ++turn;
    // a first visit waits; a return keeps the last figures on screen until the new ones arrive
    if (!got) { ui.wait.innerHTML = ''; ui.wait.hidden = false; ui.wait.appendChild(h('p', { class: 'empty', text: 'Loading Finance…' })); }
    Promise.all([E.data.values(), E.data.projects(), E.data.money(), E.settle(E.data.kas()), E.settle(E.data.clients()), E.settle(links()), E.settle(bank())]).then(function (r) {
      if (mine !== turn) return;
      got = { values: r[0], projects: r[1], money: r[2], kas: r[3], clients: r[4], links: r[5], bank: r[6] };
      got.list = bills();
      ui.wait.hidden = true; ui.card.hidden = false;
      figures(got.list); ages(got.list); fillFilters(); draw();
      // #finance/kas opens on the Kas; an address with an entry or a project (#finance/<id>) opens it once the lists are here
      if (want === 'kas') { want = null; setView('kas'); E.setHash('finance'); }
      else if (want) {
        var id = want, k = got.kas.v ? got.kas.v.filter(function (e) { return e.id === id; })[0] : null;
        var b = got.list.filter(function (x) { return x.p.id === id; })[0];
        want = null;
        if (k && canWrite()) { setView('kas'); kasEditor(k); }
        else if (b && b.owe > 0 && canWrite()) collect(b);
        else E.setHash('finance');
      }
    }, function (e) {
      if (mine !== turn) return;
      got = null;
      ui.tiles.innerHTML = ''; ui.ages.hidden = true; ui.gap.hidden = true; ui.card.hidden = true;
      ui.wait.innerHTML = ''; ui.wait.hidden = false;
      A.add(ui.wait, [h('p', { class: 'empty is-err', text: E.ecoError(e) }),
        h('button', { class: 'btn sm', type: 'button', onclick: function () { E.forget(); A.loaders.finance(); } }, 'Try again')]);
    });
  };
  A.openers.finance = function (id) { if (id === 'kas' || E.isId(id)) want = id; };
})();
