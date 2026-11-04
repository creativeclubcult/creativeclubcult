/* Finance (money access only): what to collect and the Kas, as the Sheet has them (Rekap Project, the Kas tab and
   Keuangan). Owners and admins with money access also add, edit and mark Kas entries paid here; every change is
   written to the Kas tab through sheets-write, which checks the role and the values again. Deleting is for owners. */
(function () {
  'use strict';
  var A = window.cccAdmin, E = window.eco, h = A.h;
  var panel = A.$('[data-panel="finance"]'), ui = null, got = null, want = null;
  var INV = ['Project', 'Client', 'Invoice no.', ['Total', 'num'], ['Paid', 'num'], ['Outstanding', 'num'], 'Due', 'Status'];
  var KAS = ['Date', 'Jenis', 'Kategori', 'Project', 'Keterangan', 'To or from', ['Nominal', 'num'], 'Status', 'Metode'];
  // the Kas form's categories, for when the Sheet's own list hasn't been read
  var CATS = ['Fee Crew', 'Sewa Alat', 'Transport', 'Akomodasi', 'Konsumsi', 'Lokasi', 'Properti & Wardrobe', 'Post Production',
    'Operasional', 'Beli Alat', 'Pajak', 'Pemasukan Lain', 'Lain-lain'];
  var KEYS = ['entry_date', 'kind', 'category', 'project_tab', 'description', 'counterparty', 'amount', 'paid', 'method', 'proof_url', 'note'];
  var canWrite = function () { return A.canEdit() && A.canMoney(); };

  function build() {
    if (ui) return;
    ui = { view: 'invoices', figs: h('div', { class: 'eco-figs is-6' }), from: h('p', { class: 'eco-note eco-bar-note' }),
      count: h('span', { class: 'adm-count' }), table: h('table', { class: 'adm-table is-stack' }),
      month: A.select([['', 'Every month']], '', { 'aria-label': 'Month' }),
      jenis: A.select([['', 'Keluar and Masuk'], ['Keluar', 'Keluar'], ['Masuk', 'Masuk']], '', { 'aria-label': 'Jenis' }),
      proj: A.select([['', 'Every project'], ['-', 'Operasional']], '', { 'aria-label': 'Project' }),
      paid: A.select([['', 'Sudah and Belum'], ['Belum', 'Belum only'], ['Sudah', 'Sudah only']], '', { 'aria-label': 'Status' }) };
    ui.seg = E.seg([['invoices', 'Invoices'], ['kas', 'Kas']], 'invoices', function (v) { ui.view = v; draw(); }, { 'aria-label': 'Show' });
    ui.csv = h('button', { class: 'btn ghost', type: 'button', onclick: exportCsv }, 'Export CSV');
    [ui.month, ui.jenis, ui.proj, ui.paid].forEach(function (s) { s.addEventListener('change', draw); });
    A.add(panel, [ui.figs, ui.from,
      h('div', { class: 'adm-bar' }, ui.seg, ui.month, ui.jenis, ui.proj, ui.paid, ui.count, ui.csv),
      h('div', { class: 'adm-table-wrap' }, ui.table)]);
    // phones: the page's Add button sits at the bottom of the screen
    if (canWrite()) {
      panel.classList.add('has-sticky');
      panel.appendChild(h('div', { class: 'eco-sticky' }, h('button', { class: 'btn', type: 'button', onclick: function () { kasEditor(null); } }, 'Add cash entry')));
    }
  }
  var val = function (key) { return got.values[key] ? got.values[key].value : null; };

  function figures() {
    var rs = val('rekap_summary') || {}, ks = val('kas_summary') || {}, ku = val('keuangan') || {};
    var year = E.n(ku.year), now = +E.today().slice(0, 4);
    var overdue = got.projects.filter(function (p) { var m = got.money[p.id]; return p.sheet_state === 'present' && m && m.pay_status === 'Telat'; }).length;
    ui.figs.innerHTML = '';
    A.add(ui.figs, [E.money('To collect', rs.receivable), E.fig('Overdue', E.plural(overdue, 'invoice'), { cls: overdue ? 'neg' : '' }),
      E.money('Cash', ks.cash), E.money('Owed to crew', ks.owed),
      E.money('Omset ' + (year || ''), ku.omset), E.money('Profit ' + (year || ''), ku.profit)]);
    ui.from.textContent = E.fromSheet(got.values, got.values.keuangan && got.values.keuangan.seen_at)
      + (year && year !== now ? ' · Year shown in the Sheet: ' + year : '');
  }

  function invoices() {
    var list = got.projects.filter(function (p) { var m = got.money[p.id]; return p.sheet_state === 'present' && m && E.n(m.grand_total) > 0; });
    var rank = function (p) { var m = got.money[p.id]; return m.pay_status === 'Telat' ? 0 : E.n(m.outstanding) > 0 ? 1 : 2; };
    return list.sort(function (a, b) {
      return rank(a) - rank(b) || (rank(a) === 1 ? (a.payment_due || '9').localeCompare(b.payment_due || '9') : 0) || (b.seq || 0) - (a.seq || 0);
    });
  }
  function kasRows() {
    var mo = ui.month.value, j = ui.jenis.value, pr = ui.proj.value, pd = ui.paid.value;
    return got.kas.filter(function (k) {
      return (!mo || (k.entry_date || '').slice(0, 7) === mo) && (!j || k.kind === j) && (!pd || k.paid === pd)
        && (!pr || (pr === '-' ? !k.project_tab || k.project_tab === 'Operasional' : k.project_tab === pr));
    });
  }
  function draw() {
    if (!got) return;
    var kas = ui.view === 'kas', w = kas && canWrite();
    [ui.month, ui.jenis, ui.proj, ui.paid].forEach(function (s) { s.hidden = !kas; });
    ui.table.innerHTML = '';
    var tb = h('tbody'), head = E.thead(kas ? KAS : INV);
    if (w) head.firstChild.appendChild(h('th', { class: 'act' }, h('span', { class: 'sr', text: 'Actions' })));
    ui.table.appendChild(head); ui.table.appendChild(tb);
    if (!kas) {
      var list = invoices();
      list.forEach(function (p) {
        var m = got.money[p.id], billed = p.status === 'Deal' || p.status === 'Lunas';
        tb.appendChild(h('tr', { onclick: function () { location.hash = '#projects/' + p.id; } },
          h('td', {}, E.short(p), p.title ? h('span', { class: 'sub', text: p.title }) : null),
          h('td', { class: 'hide-s' }, p.client_label || ''),
          h('td', { class: 'hide-s' }, p.invoice_no || ''),
          h('td', { class: 'num hide-s' }, E.num(m.grand_total)),
          h('td', { class: 'num hide-s' }, E.num(m.paid_total)),
          h('td', { class: 'num' }, billed && m.outstanding != null ? E.rp(m.outstanding) : E.quiet('Not billed yet')),
          h('td', { class: 'hide-s d' }, p.payment_due ? E.day(p.payment_due) : ''),
          h('td', { class: 'hide-s' }, m.pay_status === 'Telat' || m.pay_status === 'Lunas' ? E.pill(m.pay_status) : m.pay_status || E.pill(E.phase(p))),
          h('td', { class: 'only-s' }, [m.pay_status || p.status, p.payment_due ? 'due ' + E.day(p.payment_due, { year: false }) : null, p.invoice_no].filter(Boolean).join(' · '))));
      });
      if (!list.length) E.fullRow(tb, INV.length, 'Nothing to collect.');
      ui.count.textContent = E.plural(list.length, 'invoice');
      return;
    }
    var rows = kasRows();
    rows.forEach(function (k) {
      var owed = w && k.paid === 'Belum';
      var tr = h('tr', { class: owed ? 'has-act' : null, onclick: w ? function () { kasEditor(k); } : null },
        h('td', { class: 'hide-s d' }, E.day(k.entry_date)),
        h('td', { class: 'hide-s' }, k.kind || ''),
        h('td', { class: 'hide-s' }, k.category || ''),
        h('td', { class: 'hide-s' }, k.project_tab || 'Operasional'),
        h('td', {}, k.description || k.category || ''),
        h('td', { class: 'hide-s' }, k.counterparty || ''),
        h('td', { class: 'num' }, k.amount == null ? '' : (k.kind === 'Keluar' ? '−' : '') + E.num(k.amount)),
        h('td', { class: 'hide-s' + (k.paid === 'Belum' ? '' : ' muted') }, k.paid || ''),
        h('td', { class: 'hide-s' }, k.method || ''),
        h('td', { class: 'only-s' }, [E.day(k.entry_date, { year: false }), k.kind, k.counterparty, k.paid].filter(Boolean).join(' · ')),
        w ? h('td', { class: 'act' + (owed ? '' : ' hide-s') }, owed ? h('button', { class: 'eco-btn', type: 'button', onclick: function (e) {
          e.stopPropagation(); markPaid(k, e.currentTarget);
        } }, 'Mark paid') : null) : null);
      if (!w) tr.style.cursor = 'default';
      tb.appendChild(tr);
    });
    if (!rows.length) {
      E.fullRow(tb, KAS.length + (w ? 1 : 0), got.kas.length ? 'No cash entries match these filters.'
        : w ? 'No cash entries yet. Add one here, or keep using the Kas form on your phone.' : 'No cash entries yet. Entries in the Kas tab of the Sheet show up here.');
    }
    ui.count.textContent = E.plural(rows.length, 'entry', 'entries');
  }
  function fillFilters() {
    var months = {}, tabs = {}, mo = ui.month.value, pr = ui.proj.value;
    got.kas.forEach(function (k) { if (k.entry_date) months[k.entry_date.slice(0, 7)] = true; if (k.project_tab && k.project_tab !== 'Operasional') tabs[k.project_tab] = true; });
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
      E.csv('ccc-kas', ['Date', 'Jenis', 'Kategori', 'Project', 'Keterangan', 'To or from', 'Nominal', 'Status', 'Metode'],
        kasRows().map(function (k) { return [k.entry_date, k.kind, k.category, k.project_tab || 'Operasional', k.description, k.counterparty, k.amount, k.paid, k.method]; }));
    } else {
      E.csv('ccc-invoices', ['Project', 'Client', 'Invoice no.', 'Status', 'Total', 'Paid', 'Outstanding', 'Due', 'Pay status'],
        invoices().map(function (p) { var m = got.money[p.id]; return [p.tab_name, p.client_label, p.invoice_no, p.status, m.grand_total, m.paid_total, m.outstanding, p.payment_due, m.pay_status]; }));
    }
  }

  // ---------- the Kas, written to the Sheet ----------
  // the entry as the admin saw it, so the Sheet can tell whether the row changed meanwhile
  var seen = function (k) { var m = {}; KEYS.forEach(function (key) { m[key] = k[key] == null ? null : k[key]; }); return m; };
  var same = function (a, b) { return String(a == null ? '' : a) === String(b == null ? '' : b); };
  function showKas() {
    ui.view = 'kas';
    A.$$('button', ui.seg).forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-v') === 'kas')); });
  }
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
    var opts = (k ? [] : [['', 'Pick one']]).concat([['-', 'Operasional']], tabs.map(function (p) { return [p.tab_name, E.pname(p)]; }));
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
    var saveRow = h('label', { class: 'adm-check eco-new', hidden: true }, saveBox, saveText);
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

    var field = function (label, el, cls) { return h('label', { class: cls || null }, label, el); };
    var group = function (label, el) { return h('div', { class: 'eco-field' }, h('span', { 'aria-hidden': 'true', text: label }), el); };
    var msg = h('span', { class: 's', role: 'status' });
    var say = function (t, err) { msg.textContent = t || ''; msg.classList.toggle('neg', !!err); };
    var btn = h('button', { class: 'btn', type: 'button', onclick: function () { if (k) saveEdit(); else addNew(); } }, k ? 'Save changes' : 'Add to Kas');
    var del = k && A.isOwner() ? h('button', { class: 'adm-link adm-danger', type: 'button', onclick: remove }, 'Delete entry') : null;
    var busy = function (on) { btn.disabled = on; if (del) del.disabled = on; };
    var from = x.note === 'via Form' ? 'From the Kas form' : x.note === 'via Admin' ? 'Added in the admin' : 'From the Kas tab';
    var start = JSON.stringify(entry());
    var opId = null, opKey = null;    // a retry of the same entry after a lost answer re-sends the same change, never a second one

    function finish(r, text) {
      A.guard(null); A.closeDrawer(true);
      A.toast(r.status === 202 ? E.writeText(r) : text);
      showKas(); reload();
    }
    function failed(e) { busy(false); say(E.ecoError(e), true); }
    function send(op, args, key) {
      if (key !== opKey) { opKey = key; opId = E.uuid(); }
      return E.sheetWrite(op, args, opId).then(function (r) {
        if (r.status !== 500 && r.status !== 502 && r.status !== 503) opKey = null;    // settled: a new attempt is a new change
        return r;
      });
    }
    function addNew() {
      var r = entry(), bad = problem(r);
      if (bad) return say(bad, true);
      busy(true); say('Saving to the Sheet…');
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
        if (!res) { busy(false); say(''); return; }
        if (res.status !== 200 && res.status !== 202) { busy(false); say(E.writeText(res), true); return; }
        if (!saveBox.checked || saveRow.hidden || res.status !== 200) { finish(res, 'Added to Kas.'); return; }
        say('Saving to the crew list…');
        E.sheetWrite('crew_upsert', { name: r.counterparty, create: true, set: {} }).then(function (c) {
          if (c.status === 200 || c.status === 202) finish(res, 'Added to Kas and to the crew list.');
          else { finish(res, 'Added to Kas.'); A.toast('Added to Kas. The crew list wasn’t changed: ' + E.writeText(c), true); }
        }, function (e) { finish(res, 'Added to Kas.'); A.toast('Added to Kas. The crew list wasn’t changed: ' + E.ecoError(e), true); });
      }, failed);
    }
    function saveEdit() {
      var r = entry(), bad = problem(r);
      if (bad) return say(bad, true);
      var m = seen(k), set = {};
      Object.keys(r).forEach(function (key) { if (!same(r[key], m[key])) set[key] = r[key]; });
      if (!Object.keys(set).length) return say('Nothing changed.');
      busy(true); say('Saving to the Sheet…');
      send('kas_update', { hint_row: k.sheet_row, match: m, set: set }, JSON.stringify(set)).then(function (res) {
        if (res.status === 200 || res.status === 202) finish(res, 'Saved to the Sheet.');
        else { busy(false); say(E.writeText(res), true); }
      }, failed);
    }
    function remove() {
      A.ask('Delete this cash entry?', 'It is cleared from the Kas tab of the Sheet. To bring it back, add it again.', 'Delete entry', true).then(function (go) {
        if (!go) return;
        busy(true); say('Deleting…');
        send('kas_delete', { hint_row: k.sheet_row, match: seen(k) }, 'delete').then(function (res) {
          if (res.status === 200 || res.status === 202) finish(res, 'Deleted from the Sheet.');
          else { busy(false); say(E.writeText(res), true); }
        }, failed);
      });
    }

    E.drawer(k ? 'finance' : null, k ? k.id : null, [
      h('h2', { text: k ? (x.description || x.category || 'Cash entry') : 'Add cash entry' }),
      h('p', { class: 'lead-line', text: k ? from + (x.sheet_row ? ' · row ' + x.sheet_row + ' in the Kas tab' : '') : 'Goes into the Kas tab of the Sheet, the same as the Kas form.' }),
      h('div', { class: 'adm-sec eco-form' }, h('div', { class: 'adm-controls' },
        group('Jenis', E.seg([['Keluar', 'Keluar'], ['Masuk', 'Masuk']], st.kind, function (v) { st.kind = v; newName(); }, { 'aria-label': 'Jenis' })),
        field('Nominal (Rp)', f.amount),
        field('Keterangan', f.description, 'wide'),
        field('Project', f.project),
        field('Kategori', f.category),
        field('To or from', f.counterparty),
        field('Date', f.entry_date),
        saveRow,
        group('Status', E.seg([['Sudah', 'Sudah'], ['Belum', 'Belum']], st.paid, function (v) { st.paid = v; }, { 'aria-label': 'Status' })),
        group('Metode', optional(['Transfer', 'Cash', 'QRIS'], st.method, 'Metode', function (v) { st.method = v; })),
        field('Proof link', f.proof_url, 'wide'), list)),
      h('div', { class: 'eco-actionbar' }, msg, del, btn)
    ]);
    A.guard(function () { return JSON.stringify(entry()) !== start || saveBox.checked; });
    if (!k) f.amount.focus();
  }

  A.actions.finance = function () {
    return canWrite() ? h('button', { class: 'btn is-wide-only', type: 'button', onclick: function () { kasEditor(null); } }, 'Add cash entry') : null;
  };
  A.loaders.finance = function () {
    if (!A.canMoney()) {
      panel.innerHTML = ''; ui = null; panel.classList.remove('has-sticky');
      panel.appendChild(h('p', { class: 'adm-note', text: 'Finance needs money access. An owner can turn it on for you in Settings.' }));
      return;
    }
    if (!ui) panel.innerHTML = '';
    build();
    ui.figs.innerHTML = ''; ui.figs.appendChild(h('p', { class: 'eco-wait', text: 'Loading…' }));
    ui.table.innerHTML = '';
    Promise.all([E.data.values(), E.data.projects(), E.data.money(), E.data.kas()]).then(function (r) {
      got = { values: r[0], projects: r[1], money: r[2], kas: r[3] };
      figures(); fillFilters(); draw();
      // an address with an entry (#finance/<id>) opens it once the list is here
      if (want) {
        var k = got.kas.filter(function (e) { return e.id === want; })[0];
        want = null;
        if (k && canWrite()) { showKas(); draw(); kasEditor(k); }
      }
    }, function (e) {
      got = null;
      ui.figs.innerHTML = ''; ui.figs.appendChild(h('p', { class: 'eco-err', text: E.ecoError(e) }));
    });
  };
  A.openers.finance = function (id) { if (E.isId(id)) want = id; };
})();
