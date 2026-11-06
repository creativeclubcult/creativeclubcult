/* A RAB's lines on the project page, in groups as the RAB tab has them (M6). Owners and people with money access
   change, add and remove the lines of the breakdown sections and of the equipment, and fill in the actual costs. Each
   change is one write to the RAB tab through sheets-write (rab_line_set, rab_line_add, rab_line_clear, rab_internal),
   which checks the role, money access and every value again. Before it writes, the Sheet checks that the line is still
   the one shown here; it works out the totals itself. One line is open at a time. */
(function () {
  'use strict';
  if (!window.cccAdmin) return; // admin.js stopped early: the sign in library didn't load
  var A = window.cccAdmin, E = window.eco, sb = A.sb, h = A.h;

  // the breakdown in the order of the RAB tab, and the equipment groups as the Sheet names them
  var SECTIONS = [['pre', 'Pre-Production'], ['talent', 'Talent & Model'], ['crew', 'Production Crew'], ['equipment', 'Equipment'],
    ['location', 'Location & Permit'], ['art', 'Art, Property & Wardrobe'], ['transport', 'Transportation & Accommodation'],
    ['catering', 'Konsumsi / Catering'], ['post', 'Post Production'], ['others', 'Lain-lain']];
  var LABEL = {};
  SECTIONS.forEach(function (s) { LABEL[s[0]] = s[1]; });
  var GEAR = [['CAMERA', 'Camera'], ['LENS', 'Lens'], ['CAMERA SUPPORT', 'Camera support'], ['BACKGROUND', 'Background'],
    ['LIGHTING', 'Lighting'], ['LIGHTING SUPPORT', 'Lighting support'], ['AUDIO', 'Audio'], ['LAINNYA', 'Lainnya']];
  var GEAR_LABEL = {};
  GEAR.forEach(function (g) { GEAR_LABEL[g[0]] = g[1]; });

  // [key, label, kind, max length]: the columns a section takes from the admin (the server's SECTION_RULES)
  var DESC = ['desc', 'Description', 'text', 500], COST = ['cost', 'Cost (Rp)', 'money'], QTY = ['qty', 'Qty', 'num'],
    UNIT = ['unit', 'Unit', 'text', 60], DAYS = ['days', 'Days', 'num'];
  var FIELDS = {
    talent: [DESC, COST, QTY, DAYS],
    crew: [['desc', 'Role', 'text', 500], ['person', 'Person', 'text', 200], COST, QTY, DAYS],
    equipment: [['item', 'Equipment', 'gear', 300], ['qty', 'Qty', 'n30'], ['days', 'Days', 'n30'], ['manual_price', 'Price per day (Rp)', 'money']]
  };
  var fieldsOf = function (key) { return FIELDS[key] || [DESC, COST, QTY, UNIT, DAYS]; };
  // what the Sheet compares before it writes: every column of the line as the admin shows it, the number in A too
  var expectOf = function (key, l) {
    var keys = key === 'equipment' ? ['item', 'qty', 'days', 'manual_price'] : ['no'].concat(fieldsOf(key).map(function (f) { return f[0]; }));
    var o = {};
    keys.forEach(function (k) { o[k] = l[k] === undefined ? null : l[k]; });
    return o;
  };
  var NOUN = { cost: 'the cost', manual_price: 'the price', qty: 'the qty', days: 'the days' };

  // ---------- reading what was typed ----------
  var DEC = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 });
  var dec = function (v) { var x = E.n(v); return x == null ? '' : DEC.format(x); };
  // Rupiah as 1.500.000 or 1500000 (Rp in front is fine): a whole amount, null when empty, NaN when it isn't one
  function readMoney(el) {
    var s = el.value.replace(/^\s*rp\.?/i, '').replace(/\s/g, '');
    if (!s) return null;
    if (!/^(\d{1,3}(\.\d{3})+|\d+)(,0{1,2})?$/.test(s)) return NaN;
    return Number(s.split(',')[0].replace(/\./g, ''));
  }
  // qty and days: 2 or 1,5 (at most 2 decimals)
  function readNum(el) {
    var s = el.value.replace(/\s/g, '').replace(',', '.');
    if (!s) return null;
    return /^\d+(\.\d{1,2})?$/.test(s) ? Number(s) : NaN;
  }
  var readText = function (el) { return el.value.trim() || null; };
  var same = function (a, b) { return String(a == null ? '' : a) === String(b == null ? '' : b); };
  function moneyInput(v, label) {
    var el = h('input', { type: 'text', inputmode: 'numeric', autocomplete: 'off', placeholder: '0', value: E.n(v) == null ? '' : E.num(v), 'aria-label': label });
    el.addEventListener('blur', function () { var x = readMoney(el); if (x != null && x === x) el.value = E.num(x); });
    return el;
  }
  // one field's control; read gives the value to send
  function control(f, v, listId) {
    var kind = f[2], el, read = readText;
    if (kind === 'money') { el = moneyInput(v, f[1]); read = readMoney; }
    else if (kind === 'num') {
      el = h('input', { type: 'text', inputmode: 'decimal', autocomplete: 'off', value: E.n(v) == null ? '' : String(E.n(v)).replace('.', ','), 'aria-label': f[1] });
      read = readNum;
    } else if (kind === 'n30') {
      // the Sheet's list is 1 to 30, and an empty cell counts as 1
      var opts = [], x = E.n(v);
      for (var i = 1; i <= 30; i++) opts.push([String(i), String(i)]);
      if (x != null && !(x >= 1 && x <= 30 && x === Math.round(x))) opts.push([String(x), dec(x)]);
      el = A.select(opts, x == null ? '1' : String(x), { 'aria-label': f[1] });
      read = function (s) { return Number(s.value); };
    } else {
      el = h('input', { type: 'text', maxlength: f[3], autocomplete: 'off', value: v == null ? '' : String(v), 'aria-label': f[1], list: kind === 'gear' ? listId : null });
    }
    return { key: f[0], f: f, el: el, read: read };
  }

  // ---------- Katalog Alat, for the equipment picker (read through sheets-sync, kept for ten minutes) ----------
  var catalog = null;
  function loadCatalog() {
    if (catalog && catalog.items && Date.now() - catalog.at < 600000) return Promise.resolve(catalog.items);
    if (catalog && catalog.wait) return catalog.wait;
    var ask = function (tries) {
      return sb.functions.invoke('sheets-sync', { body: { kind: 'catalog' } }).then(function (r) {
        if (!r.error) return Array.isArray(r.data && r.data.items) ? r.data.items : [];
        var res = r.error.context;
        // someone read the list a moment ago: once more after the wait the server asks for
        if (res && res.status === 429 && tries > 0) return new Promise(function (go) { setTimeout(go, 3200); }).then(function () { return ask(tries - 1); });
        throw r.error;
      });
    };
    var wait = ask(1).then(function (items) { catalog = { at: Date.now(), items: items }; return items; }, function (e) { catalog = null; throw e; });
    catalog = { wait: wait };
    return wait;
  }

  // ---------- the Budget: the lines in groups, one form open at a time ----------
  // c = {p, rab, edit, note, link, forms, saved(answer, text), refresh(text)}; gives the nodes of the Budget pane.
  // edit false: the lines only (an old RAB, Sheet writes paused, or an account that can't change the RAB)
  var closed = {};   // groups folded on a project stay folded when the page is drawn again
  function budget(c) {
    var p = c.p, rab = c.rab, edit = c.edit !== false, open = null, seq = 0;
    var eq = rab.equipment && typeof rab.equipment === 'object' && Array.isArray(rab.equipment.groups) ? rab.equipment : null;
    var sectionOf = function (key) { return (rab.sections || []).filter(function (s) { return s.key === key; })[0] || null; };
    var numbered = (rab.sections || []).some(function (s) { return (s.lines || []).some(function (l) { return E.n(l.no) != null; }); });
    var box = h('div', { class: 'rab' + (edit ? '' : ' ro') });
    if (edit) c.forms.push({ dirty: function () { return !!open && open.dirty(); } });

    // another form opens only after the one with changes is let go
    function claim() {
      if (!open) return Promise.resolve(true);
      if (!open.dirty()) { open.close(); return Promise.resolve(true); }
      return A.ask('Discard your changes?', 'The line you were changing has changes that aren’t saved.', 'Discard').then(function (yes) {
        if (yes) open.close();
        return yes;
      });
    }
    // a new line takes the next number in A when this RAB numbers its lines, as the rows above it do
    function nextNo(key) {
      if (!numbered || key === 'equipment') return null;
      var s = sectionOf(key), max = 0;
      ((s && s.lines) || []).forEach(function (l) { var x = E.n(l.no); if (x != null && x > max) max = x; });
      return Math.min(Math.floor(max) + 1, 999);
    }

    // the fields of one line and their buttons; o = {key, group, line (null: a new line), close}
    function lineForm(o) {
      var l = o.line, adding = !l, key = o.key, grp = o.group || null;
      var send = E.writer(), ctrls = [], listId = 'eco-gear-' + p.id.slice(0, 8) + '-' + (++seq);
      var grid = h('div', { class: 'ed-f' }), list = h('datalist', { id: listId });
      var msg = h('span', { class: 'fmsg', role: 'status' });
      var hint = h('p', { class: 'help full', hidden: true, text: 'A price typed here is locked. Leave it empty to follow Katalog Alat.' });
      var pick = null;
      if (adding) {
        var opts = [];
        SECTIONS.forEach(function (s) {
          if (s[0] !== 'equipment') opts.push([s[0], s[1]]);
          else if (eq) GEAR.forEach(function (g) { opts.push(['equipment:' + g[0], 'Equipment, ' + g[1]]); });
        });
        pick = A.select(opts, o.pick || 'pre', { 'aria-label': 'Section' });
        pick.addEventListener('change', function () { var v = pick.value.split(':'); draw(v[0], v[1] || null); say(''); });
      }
      function draw(k, g) {
        var keep = {};
        ctrls.forEach(function (x) { if (x.el.tagName === 'INPUT') keep[x.key + '|' + x.f[2]] = x.el.value; });
        key = k; grp = g; ctrls = []; grid.innerHTML = '';
        if (pick) grid.appendChild(h('label', { class: 'f full' }, 'Section', pick));
        fieldsOf(key).forEach(function (f) {
          var x = control(f, l ? l[f[0]] : null, listId);
          x.was = x.read(x.el);
          if (keep[f[0] + '|' + f[2]] !== undefined) x.el.value = keep[f[0] + '|' + f[2]];
          ctrls.push(x);
          grid.appendChild(h('label', { class: 'f' + (f[0] === 'desc' || f[0] === 'item' ? ' full' : '') }, f[1], x.el));
        });
        grid.appendChild(hint);
        hint.hidden = key !== 'equipment';
        if (key === 'equipment') gear();
      }
      var ctrl = function (k) { return ctrls.filter(function (x) { return x.key === k; })[0]; };
      // the catalog's names for the picker, and its price as the hint in an empty price field. A locked price belongs
      // to its equipment: other equipment picked on a locked line brings its own catalog price (still locked), or an
      // empty price when the catalog has none, unless a price was typed here
      function gear() {
        var item = ctrl('item'), price = ctrl('manual_price'), g = grp || (l && o.group);
        var items = [], typed = false, was = l && l.item != null ? String(l.item).trim() : '';
        var locked = !!l && E.n(l.manual_price) != null;
        var hitOf = function (name) { return items.filter(function (x) { return x[0] === name; })[0]; };
        var tip = function () {
          var hit = hitOf(item.el.value.trim());
          price.el.placeholder = hit && hit[2] != null ? E.num(hit[2]) + ' in the catalog' : 'Catalog price';
        };
        var note = '', tell = function (t) { if (t || note) say(t); note = t; };   // only ever clears its own line
        var follow = function () {
          if (!locked || typed) return;
          var name = item.el.value.trim(), hit = hitOf(name);
          if (name === was) { price.el.value = E.num(l.manual_price); return tell(''); }
          price.el.value = hit && hit[2] != null ? E.num(hit[2]) : '';
          tell(hit && hit[2] != null ? 'Price per day from Katalog Alat: ' + E.rp(hit[2]) + '.' : '');
        };
        price.el.placeholder = 'Catalog price';
        price.el.addEventListener('input', function () { typed = true; });
        item.el.addEventListener('input', function () { tip(); follow(); });
        loadCatalog().then(function (got) {
          if (!item.el.isConnected) return;
          items = got;
          list.innerHTML = '';
          var mine = items.filter(function (x) { return x[1] === g; });
          (mine.length ? mine : items).forEach(function (x) {
            list.appendChild(h('option', { value: x[0] }, x[2] == null ? 'Price by call' : 'Rp ' + E.num(x[2])));
          });
          tip();
          if (item.el.value.trim() !== was) follow();
        }, function () {
          if (item.el.isConnected) say('The equipment list couldn’t be loaded. Type the name as it is in Katalog Alat.');
        });
      }
      var say = function (t, err) { msg.textContent = t || ''; msg.classList.toggle('is-err', !!err); };
      var save = h('button', { class: 'btn sm lime', type: 'button' }, adding ? 'Add line' : 'Save line');
      var cancel = h('button', { class: 'btn sm quiet', type: 'button' }, 'Cancel');
      var remove = adding ? null : h('button', { class: 'btn sm quiet danger', type: 'button' }, 'Remove line');
      var busy = function (on) {
        [save, cancel, remove, pick].forEach(function (b) { if (b) b.disabled = on; });
        ctrls.forEach(function (x) { x.el.disabled = on; });
      };
      // what the form would write: the changed fields of a line, or every filled field of a new one
      var values = function () {
        var set = {};
        ctrls.forEach(function (x) {
          var v = x.read(x.el);
          if (adding ? v != null && !(x.f[2] === 'n30' && v === 1) : !same(v, x.was)) set[x.key] = v;
        });
        return set;
      };
      function problem(set) {
        for (var i = 0; i < ctrls.length; i++) {
          var x = ctrls[i], v = set[x.key];
          if (!(x.key in set) || v === null) continue;
          if (v !== v) return x.f[2] === 'money' ? 'Type ' + NOUN[x.key] + ' as a whole amount, like 1.500.000.' : 'Type ' + NOUN[x.key] + ' as a number, like 2 or 1,5.';
          if (x.f[2] === 'money' && v > 1e12) return 'That amount is too large.';
          if (x.f[2] === 'num' && v > 100000) return 'That number is too large.';
        }
        var id = key === 'equipment' ? 'item' : 'desc', out = adding ? '' : ' To take the line out, use Remove line.';
        if ((adding || id in set) && !set[id]) return (key === 'equipment' ? 'Pick or type the equipment.' : key === 'crew' ? 'A crew line needs a role.' : 'A line needs a description.') + out;
        return '';
      }
      // the Sheet's answer: saved (or queued) draws the page again; a line that changed in the Sheet meanwhile is read
      // again; anything else stays here with the reason, and the refused change is cleared from the Sheet's list
      function settle(r, text) {
        if (r.status === 200 || r.status === 202) return c.saved(r, text(r));
        var mine = r.body.op_id && r.body.op_id === r.op_id;
        if (mine && (r.body.conflict || r.status === 422 || r.status === 423)) E.sheetWrite('outbox_discard', { op_id: r.op_id }).catch(function () {});
        if (r.body.conflict || r.body.code === 'line_moved') return c.refresh('This line changed in the Sheet meanwhile, so nothing was written. The Budget now shows it as the Sheet has it.');
        busy(false); say(E.writeText(r), true);
      }
      var failed = function (e) { busy(false); say(E.ecoError(e), true); };
      save.addEventListener('click', function () {
        var set = values();
        if (!Object.keys(set).length) return say(adding ? (key === 'equipment' ? 'Pick or type the equipment.' : 'Type the line first.') : 'Nothing changed.');
        var bad = problem(set);
        if (bad) return say(bad, true);
        var no = adding ? nextNo(key) : null;
        if (no != null) set.no = no;
        busy(true); say('Saving to the Sheet…');
        var args = adding ? { project_id: p.id, section: key, group: key === 'equipment' ? grp : null, set: set }
          : { project_id: p.id, section: key, lines: [{ row: l.row, set: set, expect: expectOf(key, l) }] };
        send(adding ? 'rab_line_add' : 'rab_line_set', args).then(function (r) {
          settle(r, function (a) {
            if (!adding) return 'Line saved to the Sheet.';
            var rec = a.body.record || {};
            return rec.replayed ? 'That line was already added in the Sheet.' : 'Line added to ' + (key === 'equipment' ? 'Equipment, ' + GEAR_LABEL[grp] : LABEL[key]) + ' in the Sheet.';
          });
        }, failed);
      });
      cancel.addEventListener('click', function () { o.close(); });
      if (remove) {
        remove.addEventListener('click', function () {
          var name = key === 'equipment' ? l.desc || l.item : l.desc;
          A.ask('Remove this line?', (name ? '“' + E.clip(name, 80) + '”' : 'This line') + (E.n(l.total) ? ', ' + E.rp(l.total) + ',' : '')
            + ' is emptied in the RAB tab and the totals are worked out again. The row stays in the Sheet, empty.', 'Remove line', true).then(function (go) {
            if (!go) return;
            busy(true); say('Saving to the Sheet…');
            send('rab_line_clear', { project_id: p.id, section: key, row: l.row, expect: expectOf(key, l) }).then(function (r) {
              settle(r, function () { return 'Line removed from the RAB.'; });
            }, failed);
          });
        });
      }
      draw(key, grp);
      return {
        el: h('div', { class: 'ed' }, grid, list, h('div', { class: 'acts' }, save, cancel, msg, remove)),
        dirty: function () { return Object.keys(values()).length > 0; },
        focus: function () { var x = pick || (ctrls[0] && ctrls[0].el); if (x) x.focus(); }
      };
    }

    // ---------- the groups and their lines ----------
    var qd = function (key, l) {
      var q = E.n(l.qty), d = E.n(l.days);
      if (key === 'equipment') return dec(q == null ? 1 : q) + ' × ' + dec(d == null ? 1 : d);
      return q != null && d != null ? dec(q) + ' × ' + dec(d) : q != null ? dec(q) : d != null ? (d === 1 ? '1 day' : dec(d) + ' days') : '';
    };
    var sumOf = function (ls) { var any = false, t = 0; ls.forEach(function (l) { var v = E.n(l.total); if (v != null) { any = true; t += v; } }); return any ? t : null; };
    var all = 0, known = false;
    var count = function (v) { if (v != null) { known = true; all += v; } return v; };
    function line(key, g, l) {
      var name = key === 'equipment' ? l.desc || l.item : l.desc, locked = key === 'equipment' && E.n(l.manual_price) != null;
      // equipment: the lock (said in words for a screen reader), then where the price is from
      var from = key === 'equipment' ? [l.vendor, l.price_date ? E.day(l.price_date, { year: false }) : null].filter(Boolean).join(', ') : '';
      var sub = key === 'crew' ? (l.person ? h('span', { text: l.person }) : null)
        : key === 'equipment' ? h('span', {}, A.icon(locked ? 'lock' : 'unlock', 'lk' + (locked ? ' on' : '')),
          from ? [h('span', { class: 'sr', text: locked ? 'Price locked, ' : 'Price not locked, ' }), from] : locked ? 'Price locked' : 'Price not locked')
          : null;
      var li = h('li', { class: 'ln' }, h('div', { class: 'nm' }, h('b', { class: name ? null : 'muted', text: name || 'No description' }), sub),
        h('span', { class: 'q', text: qd(key, l) }), h('span', { class: 't', text: E.num(l.total) }));
      if (!edit) return li;
      var btn = h('button', { class: 'ib', type: 'button', 'aria-expanded': 'false', 'aria-label': 'Edit ' + (name ? E.clip(name, 60) : 'this line') }, A.icon('edit'));
      li.appendChild(btn);
      btn.addEventListener('click', function () {
        if (btn.getAttribute('aria-expanded') === 'true') { if (open) open.ask(); return; }
        claim().then(function (go) {
          if (!go) return;
          var row = h('li', { class: 'ed-li' });
          var shut = function () { row.remove(); btn.setAttribute('aria-expanded', 'false'); open = null; };
          var f = lineForm({ key: key, group: g, line: l, close: function () { shut(); btn.focus(); } });
          row.appendChild(f.el);
          btn.setAttribute('aria-expanded', 'true');
          li.parentNode.insertBefore(row, li.nextSibling);
          open = { dirty: f.dirty, close: shut, ask: function () { claim().then(function (yes) { if (yes) btn.focus(); }); } };
          f.focus();
        });
      });
      return li;
    }
    // one section of the RAB, folded under its name, with its line count and its total
    function group(id, title, n, total, extra, body) {
      var d = h('details', { class: 'grp', open: !closed[p.id + id] },
        h('summary', {}, A.icon('chev', 'car'), h('b', { text: title }), h('span', { class: 'cnt', text: E.plural(n, 'line') }), extra,
          h('span', { class: 'tot', text: total == null ? '' : E.rp(total) })), body);
      d.addEventListener('toggle', function () { closed[p.id + id] = !d.open; });
      box.appendChild(d);
    }
    SECTIONS.forEach(function (s) {
      if (s[0] === 'equipment') {
        if (!eq) return;
        var parts = [], n = 0;
        eq.groups.forEach(function (g) {
          var ls = Array.isArray(g.lines) ? g.lines : [];
          if (!ls.length) return;
          n += ls.length;
          parts.push(h('p', { class: 'subh', text: GEAR_LABEL[g.name] || g.name }), h('ul', { class: 'lines' }, ls.map(function (l) { return line('equipment', g.name, l); })));
        });
        if (!n) return;
        if (E.n(eq.ppn_bsm) > 0) parts.push(h('p', { class: 'lsum' }, h('span', { text: 'Subtotal ' + E.rp(eq.subtotal) }), h('span', { text: 'PPN BSM ' + E.rp(eq.ppn_bsm) })));
        var k = p.unlocked_gear || 0;
        var tag = k > 0 ? h('span', { class: 'tag amber' }, A.icon('unlock'), E.plural(k, 'price') + ' not locked') : h('span', { class: 'tag lime' }, A.icon('lock'), 'Prices locked');
        group('equipment', s[1], n, count(E.n(eq.total) != null ? E.n(eq.total) : sumOf([].concat.apply([], eq.groups.map(function (g) { return g.lines || []; })))), tag, parts);
        return;
      }
      var sec = sectionOf(s[0]), ls = sec && Array.isArray(sec.lines) ? sec.lines : [];
      if (!ls.length) return;
      group(s[0], s[1], ls.length, count(E.n(sec.subtotal) != null ? E.n(sec.subtotal) : sumOf(ls)), null,
        h('ul', { class: 'lines' }, ls.map(function (l) { return line(s[0], null, l); })));
    });

    var addBtn = edit ? h('button', { class: 'btn sm', type: 'button', 'aria-expanded': 'false' }, A.icon('plus', 's'), 'Add a line') : null;
    if (addBtn) {
      addBtn.addEventListener('click', function () {
        if (addBtn.getAttribute('aria-expanded') === 'true') { if (open) open.ask(); return; }
        claim().then(function (go) {
          if (!go) return;
          var shut = function () { f.el.remove(); addBtn.setAttribute('aria-expanded', 'false'); open = null; };
          var f = lineForm({ key: 'pre', line: null, close: function () { shut(); addBtn.focus(); } });
          addBtn.setAttribute('aria-expanded', 'true');
          box.insertBefore(f.el, box.firstChild);
          open = { dirty: f.dirty, close: shut, ask: function () { claim().then(function (yes) { if (yes) addBtn.focus(); }); } };
          f.focus();
        });
      });
    }
    var empty = !box.children.length;
    return [
      h('div', { class: 'pane-h' }, h('h3', { text: 'Lines on the quote' }), known && !empty ? h('span', { class: 'cnt', text: E.rp(all) + ' in all' }) : null, addBtn),
      empty ? h('p', { class: 'empty', text: 'The RAB has no lines yet.' }) : null,
      box,
      h('p', { class: 'src' }, A.icon('sheet'), h('span', {}, c.note || (edit ? 'Each change goes to the RAB tab in the Sheet, which works out the totals again.' : 'From the RAB tab in the Sheet.'),
        c.link ? [' ', c.link] : null))
    ];
  }

  // ---------- the actual costs: REALISASI per category and the costs outside the RAB (Biaya lain di luar RAB) ----------
  // the totals of the internal summary (TOTAL BIAYA KELUAR, L and M): the Sheet's own when the RAB was read, otherwise
  // added up the way the Sheet does it, where an actual left empty counts as its estimate
  function costTotals(rab, cats) {
    var inn = (rab && rab.internal) || {}, est = 0, act = 0, any = false;
    cats.concat([{ estimate: inn.other_estimate, actual: inn.other_actual }]).forEach(function (x) {
      var e = E.n(x.estimate), a = E.n(x.actual);
      if (e == null && a == null) return;
      any = true; est += e || 0; act += a != null ? a : e || 0;
    });
    var se = E.n(inn.cost_estimate), sa = E.n(inn.cost_actual);
    return { estimate: se != null ? se : any ? est : null, actual: sa != null ? sa : any ? act : null };
  }

  // the categories at Rp 0 (rows marked data-zero in scope) behind one button, so the ones that cost something stand
  // out; key keeps it open or shut when the page is drawn again. null when no row is at Rp 0
  var zeroShown = {};
  function zeroToggle(scope, key) {
    var rows = A.$$('tr[data-zero]', scope);
    if (!rows.length) return null;
    var btn = h('button', { class: 'btn sm', type: 'button' });
    var paint = function () {
      var on = !!zeroShown[key];
      rows.forEach(function (r) { r.hidden = !on; });
      btn.textContent = on ? 'Hide the categories at Rp 0' : 'Show ' + E.plural(rows.length, 'category', 'categories') + ' at Rp 0';
      btn.setAttribute('aria-expanded', String(on));
    };
    btn.addEventListener('click', function () { zeroShown[key] = !zeroShown[key]; paint(); });
    paint();
    return btn;
  }

  // c = {p, rab, cats (project_money.categories), forms, saved(answer, text)}; gives {table, bar}
  function actuals(c) {
    var p = c.p, rab = c.rab, cats = c.cats, raw = (rab.summary && rab.summary.categories) || [], inn = rab.internal || {};
    var form = E.sheetForm({ label: 'Save actual costs', op: 'rab_internal', look: 'mock sm',
      args: function (set, expect) { return { project_id: p.id, set: set, expect: expect }; },
      check: function (set) {
        var ks = Object.keys(set);
        if (ks.some(function (k) { return set[k] !== null && set[k] !== set[k]; })) return 'Type amounts as whole Rupiah, like 1.500.000.';
        return ks.some(function (k) { return set[k] > 1e12; }) ? 'That amount is too large.' : '';
      },
      done: function (r) { c.saved(r, 'Actual costs saved to the Sheet.'); } });
    c.forms.push(form);
    // an empty actual shows its estimate greyed out: that is the amount the Sheet counts for it
    var input = function (key, v, rawV, label, est) {
      var el = moneyInput(v, label);
      if (E.n(est) != null) el.placeholder = E.num(est);
      return h('td', { class: 'num act' }, form.field(key, el, rawV === undefined ? null : rawV, readMoney));
    };
    var sum = function (list, k) { var any = false, t = 0; list.forEach(function (x) { var v = E.n(x[k]); if (v != null) { any = true; t += v; } }); return any ? t : null; };
    var other = { estimate: inn.other_estimate, actual: inn.other_actual };
    var rows = cats.map(function (x, i) {
      var billed = E.n(x.total), est = E.n(x.estimate), r = raw[i] || {};
      // a cost that isn't billed to the client is marked; a category with nothing in it waits behind the button
      var hot = est > 0 && !(billed > 0), zero = !billed && !est && !E.n(x.actual);
      return h('tr', { class: hot ? 'hot' : null, 'data-zero': zero ? '' : null },
        h('td', {}, hot ? A.icon('alert') : null, x.label || ''),
        h('td', { class: 'num hide-s' }, E.num(x.total)), h('td', { class: 'num' }, E.num(x.estimate)),
        input('actual_' + (i + 1), x.actual, r.actual, 'Actual, ' + (x.label || 'category ' + (i + 1)), x.estimate));
    });
    var oz = !E.n(other.estimate) && !E.n(other.actual);
    rows.push(h('tr', { 'data-zero': oz ? '' : null }, h('td', { text: 'Other costs outside the RAB' }), h('td', { class: 'num hide-s' }),
      h('td', { class: 'num act' }, form.field('other_estimate', moneyInput(other.estimate, 'Estimate, other costs outside the RAB'), other.estimate === undefined ? null : other.estimate, readMoney)),
      input('other_actual', other.actual, other.actual, 'Actual, other costs outside the RAB', other.estimate)));
    var tot = costTotals(rab, cats);
    rows.push(h('tr', { class: 'sum' }, h('td', { text: 'Total' }), h('td', { class: 'num hide-s' }, E.num(sum(cats, 'total'))),
      h('td', { class: 'num' }, E.num(tot.estimate)), h('td', { class: 'num' }, E.num(tot.actual))));
    var tbody = h('tbody', {}, rows);
    var table = h('div', { class: 'scrollx' }, h('table', { class: 'tbl compact' },
      h('thead', {}, h('tr', {}, h('th', { text: 'Category' }), h('th', { class: 'num hide-s', text: 'Billed' }), h('th', { class: 'num', text: 'Estimate' }),
        h('th', { class: 'num', text: 'Actual' }))), tbody));
    var toggle = zeroToggle(tbody, p.id);
    if (toggle) form.bar.insertBefore(toggle, form.bar.firstChild);
    return { table: table, bar: form.bar };
  }

  E.RAB_SECTIONS = SECTIONS;
  E.rabBudget = budget;
  E.rabActuals = actuals;
  E.rabCostTotals = costTotals;
  E.zeroToggle = zeroToggle;
})();
