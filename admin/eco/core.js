/* CCC admin ecosystem: what the section scripts in admin/eco/ share. Loaded after admin.js, which hands over
   its helpers as window.cccAdmin. Everything here reads as the signed-in team member, and the database's row
   level security decides what arrives: money (totals, costs, payments, Kas) sits in tables that only owners and
   people with money access can read, so it never reaches anyone else's page. A figure that can't be loaded says
   so; it never turns into 0. */
(function () {
  'use strict';
  if (!window.cccAdmin) return; // admin.js stopped early: the sign in library didn't load
  var A = window.cccAdmin, sb = A.sb, h = A.h, $$ = A.$$;

  // ---------- numbers ----------
  var RP = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 });
  var NUM = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 });
  var PCT = new Intl.NumberFormat('id-ID', { style: 'percent', maximumFractionDigits: 1 });
  var n = function (v) { if (v == null || v === '') return null; var x = Number(v); return isFinite(x) ? x : null; };
  // Rp 12.142.600, and a loss as −Rp 3.500.000 (a real minus sign)
  var signed = function (f) { return function (v) { var x = n(v); return x == null ? '' : (x < 0 ? '\u2212' : '') + f.format(Math.abs(x)); }; };
  var rp = signed(RP), num = signed(NUM), pct = signed(PCT);
  // a project's margin as Rekap Project shows it, profit over omset from the whole amounts (the stored ratio is rounded
  // to four places, which can move the shown percentage by 0.1); the stored one when either amount is missing
  var margin = function (profit, omset, stored) { var p = n(profit), o = n(omset); return p != null && o ? p / o : n(stored); };
  var plural = function (k, one, many) { return k + ' ' + (k === 1 ? one : (many || one + 's')); };
  var clip = function (s, k) { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > k ? s.slice(0, k - 1).trim() + '\u2026' : s; };

  // ---------- dates ----------
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var ymd = function (s) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(typeof s === 'string' ? s : ''); return m ? [+m[1], +m[2], +m[3]] : null; };
  var utc = function (p) { return Date.UTC(p[0], p[1] - 1, p[2]); };
  // calendar days (Sheet dates, plans) read the same in every time zone: "4 Nov 2026", "Fri 7 Nov"
  var day = function (s, o) {
    var p = ymd(s); if (!p) return '';
    o = o || {};
    return (o.weekday ? WD[new Date(utc(p)).getUTCDay()] + ' ' : '') + p[2] + ' ' + MON[p[1] - 1] + (o.year === false ? '' : ' ' + p[0]);
  };
  // a moment, as the calendar day it was in Jakarta
  var JKT = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' });
  var JKT_TIME = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit' });
  var jkt = function (t) { return t == null ? null : JKT.format(new Date(t)); };
  var today = function () { return jkt(Date.now()); };
  var days = function (a, b) { var x = ymd(a), y = ymd(b); return x && y ? Math.round((utc(y) - utc(x)) / 864e5) : null; };
  var stamp = function (t) { return t ? day(jkt(t)) + ', ' + JKT_TIME.format(new Date(t)) : ''; };
  var thisYear = function (d) { return !!d && d.slice(0, 4) === today().slice(0, 4); };
  var shortStamp = function (t) { var d = jkt(t); return thisYear(d) ? day(d, { year: false }) : day(d); };
  // a planned day, short when it's this year: "Fri 7 Nov"
  var when = function (s) { return thisYear(s) ? day(s, { weekday: true, year: false }) : day(s); };
  // how long something has been waiting: "12 min", "5 h", "3 days"
  var waited = function (t) {
    var m = Math.max(0, Math.round((Date.now() - new Date(t).getTime()) / 60000));
    if (m < 60) return plural(m, 'minute');
    if (m < 1440) return plural(Math.round(m / 60), 'hour');
    return plural(Math.floor(m / 1440), 'day');
  };

  // ---------- projects ----------
  var pad3 = function (s) { return s == null ? '' : ('00' + s).slice(-3); };
  var phase = function (p) { return p.sheet_state === 'none' ? 'Brief' : (p.status || ''); };
  var ACTIVE = ['Brief', 'Draft', 'Dikirim', 'Deal'];
  var isActive = function (p) { return p.sheet_state !== 'removed' && !p.archived_at && ACTIVE.indexOf(phase(p)) > -1; };
  var planClient = function (p) { var c = p.plan_client; return c && typeof c === 'object' && c.name ? String(c.name) : null; };
  // "011 ACME": the RAB number and the client; "011 ACME, Photoshoot Campaign" in full
  var short = function (p) { return p.sheet_state === 'none' ? (planClient(p) || 'New client') : (pad3(p.seq) + ' ' + (p.client_label || '')).trim(); };
  var pname = function (p) {
    var t = p.sheet_state === 'none' ? p.plan_title : (p.title || p.tab_name);
    return [short(p), t].filter(Boolean).join(', ');
  };
  var PILL = { Brief: 'is-off is-brief', Draft: 'is-off', Dikirim: 'is-sent', Deal: 'is-open', Lunas: 'is-live', Batal: 'is-arch', Telat: 'is-err' };
  var pill = function (t) { return t ? h('span', { class: 'adm-pill ' + (PILL[t] || ''), text: t }) : null; };
  var gear = function (k) { return 'Lock ' + plural(k, 'gear price'); };

  // §7.13: the one thing to do next, first match wins. x = {today, money, docs: kinds made, kasOwed, inPortfolio}.
  // Without money access the amounts (and the steps that need them) stay out.
  function nextStep(p, m, x) {
    var ph = phase(p), k = p.unlocked_gear || 0, mon = !!(x.money && m);
    if (p.sheet_state === 'removed') return 'Removed from the Sheet';
    if (ph === 'Brief') return 'Make the RAB';
    if (ph === 'Batal') return 'Cancelled';
    if (ph === 'Draft') {
      if (mon && !(n(m.grand_total) > 0)) return 'Fill the RAB';
      if (k > 0) return gear(k);
      if (x.money && x.docs && x.docs.indexOf('penawaran') < 0) return 'Make the quote PDF';
      return 'Send the quote, then mark it sent';
    }
    if (ph === 'Dikirim') return days(p.quote_date, x.today) > 14 ? 'Follow up with the client' : 'Waiting for the client';
    if (ph === 'Deal') {
      if (mon && n(m.dp_amount) > 0 && !(n(m.dp_received) > 0)) return 'Record the DP';
      if (!p.shoot_date) return 'Set the shoot date';
      if (k > 0) return gear(k);
      if (p.shoot_date >= x.today) return 'Shoot on ' + day(p.shoot_date, { weekday: true, year: false });
      if (!p.final_file_date) return 'Deliver final files, then mark delivered';
      if (!mon) return 'Waiting for the payment';
      if (m.pay_status === 'Telat') return 'Overdue: collect ' + rp(m.outstanding);
      if (n(m.outstanding) > 0) return 'Collect ' + rp(m.outstanding) + (p.payment_due ? ' by ' + day(p.payment_due, { year: false }) : '');
      if (n(m.outstanding) === 0) return 'Paid in full: mark Lunas';
      return 'Waiting for the payment';
    }
    if (ph === 'Lunas') {
      if (x.money && x.kasOwed > 0) return 'Pay crew: ' + rp(x.kasOwed);
      // only projects that turned Lunas while the admin was watching (older ones were never meant for it)
      if (p.status_changed_at && !p.portfolio_skip && x.inPortfolio === false) return 'Add to the portfolio';
      return 'Done';
    }
    return '';
  }
  // what nextStep needs beyond the project; a list that couldn't be loaded is passed as undefined and its check is skipped
  function stepContext(docs, kas, portfolio) {
    var kinds = {}, owed = {}, shown = {};
    (docs || []).forEach(function (d) { if (d.project_id) (kinds[d.project_id] = kinds[d.project_id] || []).push(d.kind); });
    (kas || []).forEach(function (k) {
      if (k.project_id && k.kind === 'Keluar' && k.paid === 'Belum') owed[k.project_id] = (owed[k.project_id] || 0) + (n(k.amount) || 0);
    });
    (portfolio || []).forEach(function (it) { if (it.project_id && it.status !== 'archived') shown[it.project_id] = true; });
    var td = today(), money = A.canMoney();
    return function (p) {
      return { today: td, money: money, docs: docs ? kinds[p.id] || [] : undefined, kasOwed: owed[p.id] || 0,
        inPortfolio: portfolio ? !!shown[p.id] : undefined };
    };
  }
  // most urgent first: overdue, due within a week, shooting within a week, then by phase
  var ORDER = ['Deal', 'Dikirim', 'Draft', 'Brief', 'Lunas', 'Batal'];
  function urgency(p, m, td) {
    if (m && m.pay_status === 'Telat') return 0;
    if (m && n(m.outstanding) > 0 && p.payment_due && days(td, p.payment_due) <= 7) return 1;
    var s = isActive(p) && p.shoot_date ? days(td, p.shoot_date) : null;
    if (s != null && s >= 0 && s <= 7) return 2;
    var i = ORDER.indexOf(phase(p));
    return 3 + (i < 0 ? ORDER.length : i);
  }
  var byUrgency = function (list, money, td) {
    return list.slice().sort(function (a, b) {
      return urgency(a, money[a.id], td) - urgency(b, money[b.id], td) || (b.seq == null ? 1e6 : b.seq) - (a.seq == null ? 1e6 : a.seq);
    });
  };
  // "Sat 7 Nov", "Sat 7 to Sun 8 Nov" (the same month this year, as the mockup has it), "Mon 30 Nov to Tue 1 Dec"
  var shootText = function (p) {
    var a = p.shoot_date, b = p.shoot_end, x = ymd(a), y = ymd(b);
    if (!a) return '';
    if (!b || b === a) return when(a);
    if (x && y && thisYear(a) && thisYear(b) && x[1] === y[1]) return WD[new Date(utc(x)).getUTCDay()] + ' ' + x[2] + ' to ' + when(b);
    return when(a) + ' to ' + when(b);
  };
  var quiet = function (t) { return h('span', { class: 'muted', text: t }); };

  // ---------- the mockup's pieces, shared by the Overview, Projects and the Calendar ----------
  var addDays = function (s, k) { var p = ymd(s); return p ? new Date(utc(p) + k * 864e5).toISOString().slice(0, 10) : null; };
  // who a project is for, and its own line under that: "Movana" over "013 SAMPLE Launch Film"
  var clientName = function (p) { return p.sheet_state === 'none' ? (planClient(p) || 'New client') : (p.client_label || 'No client'); };
  var projectLine = function (p) {
    if (p.sheet_state === 'none') return p.plan_title || 'Brief';
    return [pad3(p.seq), p.title || p.tab_name].filter(Boolean).join(' ');
  };
  var initial = function (s) { var c = String(s || '').trim().charAt(0); return c ? c.toUpperCase() : '?'; };
  // a Sheet status as the mockup's pill (the words stay the Sheet's own)
  var STAGE = { Brief: 'brief', Draft: 'draft', Dikirim: 'sent', Deal: 'deal', Lunas: 'paid', Batal: 'off', Telat: 'late' };
  var stage = function (t) { return t ? h('span', { class: 'pill ' + (STAGE[t] || 'off'), text: t }) : null; };
  // leads still in play (a quote sent counts)
  var OPEN_LEAD = ['new', 'replied', 'in progress', 'quoted'];

  // a short note on hover or focus, for marks that carry a figure (bar segments, calendar days)
  var tipBox = null;
  var hideTip = function () { if (tipBox) tipBox.hidden = true; };
  // Escape puts it away, and so does leaving the page it belongs to
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') hideTip(); });
  window.addEventListener('hashchange', hideTip);
  // tap: a tap shows the note too (on a phone a tap is also a click), for marks that do nothing else when pressed
  function tip(el, title, text, tap) {
    if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '0');
    var show = function () {
      if (!tipBox) { tipBox = h('div', { class: 'tip', role: 'tooltip', hidden: true }); document.body.appendChild(tipBox); }
      tipBox.innerHTML = '';
      A.add(tipBox, [h('b', { text: title }), text ? h('span', { text: text }) : null]);
      tipBox.hidden = false;
      var r = el.getBoundingClientRect(), w = tipBox.offsetWidth, ht = tipBox.offsetHeight;
      tipBox.style.left = Math.round(Math.min(Math.max(8, r.left + r.width / 2 - w / 2), window.innerWidth - w - 8)) + 'px';
      tipBox.style.top = Math.round(r.top - ht - 8 < 8 ? r.bottom + 8 : r.top - ht - 8) + 'px';
    };
    el.addEventListener('mouseenter', show); el.addEventListener('focus', show);
    el.addEventListener('mouseleave', hideTip); el.addEventListener('blur', hideTip); el.addEventListener('click', tap ? show : hideTip);
    return el;
  }

  // What happens on which day (the Overview's week and the Calendar): shoots (a span of days), final files due,
  // payments due (only with money access: money is {} otherwise) and lead follow ups (only owners and admins
  // read leads). Each: { type, start, end, title, sub, href, late, crew, pid }, and tent on a shoot whose quote isn't a
  // Deal yet (pencilled in, not confirmed).
  var EVENT = {
    shoot: { label: 'Shoot', icon: 'camera' }, deliver: { label: 'Files due', icon: 'send' },
    pay: { label: 'Payment due', icon: 'in' }, follow: { label: 'Follow up', icon: 'chat' }
  };
  function events(projects, money, leads) {
    var out = [], td = today();
    (projects || []).forEach(function (p) {
      if (p.sheet_state === 'removed' || p.archived_at) return;
      var ph = phase(p), who = clientName(p), href = '#projects/' + p.id, crew = (p.crew_names || []).filter(Boolean);
      // a shoot stays on the calendar once paid (a client can pay in full before the shoot); only a cancelled one goes
      if (ph !== 'Batal' && p.shoot_date) {
        out.push({ type: 'shoot', start: p.shoot_date, end: p.shoot_end && p.shoot_end > p.shoot_date ? p.shoot_end : p.shoot_date,
          title: who, sub: projectLine(p), href: href, crew: crew, pid: p.id, tent: ph === 'Brief' || ph === 'Draft' || ph === 'Dikirim' });
      }
      if (p.deliver_by && !p.final_file_date && ph !== 'Batal') {
        out.push({ type: 'deliver', start: p.deliver_by, end: p.deliver_by, title: who, sub: 'Final files for ' + projectLine(p), href: href,
          late: p.deliver_by < td, crew: crew, pid: p.id });
      }
      var m = money && money[p.id];
      if (m && p.payment_due && n(m.outstanding) > 0 && (ph === 'Deal' || ph === 'Lunas')) {
        out.push({ type: 'pay', start: p.payment_due, end: p.payment_due, title: who, sub: rp(m.outstanding) + ' for ' + projectLine(p), href: href,
          late: m.pay_status === 'Telat' || p.payment_due < td, crew: [], pid: p.id });
      }
    });
    (leads || []).forEach(function (l) {
      if (!l.next_step_on || OPEN_LEAD.indexOf(l.status) < 0) return;
      out.push({ type: 'follow', start: l.next_step_on, end: l.next_step_on, title: l.name, sub: l.next_step || 'Follow up', href: '#leads/' + l.id,
        late: l.next_step_on < td, crew: [] });
    });
    return out.sort(function (a, b) { return a.start < b.start ? -1 : a.start > b.start ? 1 : (a.type < b.type ? -1 : 1); });
  }

  // one project as a row of the mockup's table (Overview, Projects); on phones it becomes a card
  var cardCols = function () {
    var money = A.canMoney();
    return [['Project'], ['Stage'], ['Shoot']].concat(money ? [['Value', 'num'], ['Paid']] : [], [['Next step'], ['', 'go']]);
  };
  function cardHead() {
    return h('thead', {}, h('tr', {}, cardCols().map(function (c) {
      return h('th', { class: c[1] || null }, c[0] ? c[0] : h('span', { class: 'sr', text: 'Open' }));
    })));
  }
  function paidCell(p, m) {
    var ph = phase(p), total = m ? n(m.grand_total) : null;
    if (!(ph === 'Deal' || ph === 'Lunas') || !m || !(total > 0)) return h('td', { class: 'c-pg muted', text: ph === 'Batal' ? '' : 'Not billed yet' });
    var paid = Math.max(0, Math.min(total, n(m.paid_total) || 0)), owe = n(m.outstanding), late = m.pay_status === 'Telat' && owe > 0;
    if (owe === 0) return h('td', { class: 'c-pg' }, h('span', { class: 'paidok' }, A.icon('check'), 'Paid in full'));
    var share = Math.round(paid / total * 100);
    var bar = h('div', { class: 'tr' }, h('i', { class: 'is-paid' }), late ? h('i', { class: 'is-late' }) : null);
    bar.firstChild.style.width = share + '%';
    if (late) bar.lastChild.style.width = Math.min(100 - share, Math.round(owe / total * 100)) + '%';
    var right = late ? h('span', { class: 'late', text: rp(owe) + ' late' })
      : owe > 0 ? h('span', { text: rp(owe) + (p.payment_due ? ' due ' + day(p.payment_due, { year: false }) : ' to collect') })
      : owe === 0 ? h('span', { text: 'Paid in full' }) : null;
    return h('td', { class: 'c-pg' }, h('div', { class: 'prog' }, bar, h('div', { class: 'l' }, h('span', { text: share + '% paid' }), right)));
  }
  // open: the project's address (the name becomes its link, and the link covers the row) or a function to run on a click
  function projectCard(p, m, x, open) {
    var ph = phase(p), money = A.canMoney(), who = clientName(p), href = typeof open === 'string' ? open : null;
    var tag = p.sheet_state === 'removed' ? 'Removed from the Sheet' : null;
    var value = null;
    if (money) {
      value = !m ? h('td', { class: 'num c-val muted', text: p.sheet_state === 'none' ? 'No RAB yet' : 'Not in the Sheet' })
        : m.grand_total == null ? h('td', { class: 'num c-val muted', text: 'Not in the RAB' }) : h('td', { class: 'num c-val', text: rp(m.grand_total) });
    }
    return h('tr', { 'data-s': ph, 'data-href': href, onclick: href ? null : open },
      h('td', { class: 'c-pj' }, h('div', { class: 'pj' }, h('span', { class: 'av', 'aria-hidden': 'true', text: initial(who) }),
        h('div', {}, h('b', {}, href ? h('a', { href: href, text: who }) : who), h('span', { text: tag ? projectLine(p) + ', ' + tag : projectLine(p) })))),
      h('td', { class: 'c-st' }, stage(ph)),
      h('td', { class: 'c-sh' + (p.shoot_date ? '' : ' muted'), text: p.shoot_date ? shootText(p) : 'Not set' }),
      value, money ? paidCell(p, m) : null,
      h('td', { class: 'next c-nx', text: nextStep(p, m, x) }),
      h('td', { class: 'go' }, A.icon('chev', 's')));
  }

  // ---------- data (one load per kind, shared by everything on the page for 30 seconds) ----------
  var cache = {};
  function once(key, make, fresh) {
    var c = cache[key];
    if (!fresh && c && Date.now() - c.at < 30000) return c.p;
    var p = make();
    cache[key] = { at: Date.now(), p: p };
    p.catch(function () { if (cache[key] && cache[key].p === p) delete cache[key]; });
    return p;
  }
  var forget = function () { cache = {}; };
  var rows = function (q) { return q.then(function (r) { if (r.error) throw r.error; return r.data || []; }); };
  // a promise that never fails: {v} or {e}, so one broken list doesn't take the page down
  var settle = function (p) { return p.then(function (v) { return { v: v }; }, function (e) { return { e: e || new Error('Failed') }; }); };
  var byKey = function (k) { return function (list) { var o = {}; list.forEach(function (x) { o[x[k]] = x; }); return o; }; };
  var data = {
    flow: function (fresh) {
      return once('flow', function () {
        return sb.rpc('overview_flow').then(function (r) {
          if (r.error) throw r.error;
          if (!r.data) throw new Error('Your account isn\u2019t on the team.');
          paintSheet(r.data);
          A.badge('finance', { count: r.data.money ? n(r.data.money.overdue_count) || 0 : 0 }, 'overdue');
          return r.data;
        });
      }, fresh);
    },
    projects: function (fresh) { return once('projects', function () { return rows(sb.from('projects').select('*').order('seq', { ascending: false, nullsFirst: true }).limit(2000)); }, fresh); },
    // by project id; nothing is asked for (and {} comes back) without money access
    money: function (fresh) {
      if (!A.canMoney()) return Promise.resolve({});
      return once('money', function () {
        return rows(sb.from('project_money').select('project_id, updated_at, grand_total, dp_amount, final_amount, dp_received, dp_date, '
          + 'final_received, final_date, paid_total, outstanding, pay_status, cost_override, revenue, cost, profit, margin, dp_pct').limit(2000)).then(byKey('project_id'));
      }, fresh);
    },
    clients: function (fresh) { return once('clients', function () { return rows(sb.from('clients').select('*').order('name').limit(2000)); }, fresh); },
    // meta, labels and flags for everyone; the Sheet's summaries (Rekap, Kas, Keuangan) only with money access
    values: function (fresh) { return once('values', function () { return rows(sb.from('sheet_values').select('key, value, seen_at')).then(byKey('key')); }, fresh); },
    kas: function (fresh) {
      if (!A.canMoney()) return Promise.resolve([]);
      return once('kas', function () { return rows(sb.from('kas_entries').select('*').eq('sheet_state', 'present').order('entry_date', { ascending: false }).limit(5000)); }, fresh);
    },
    docs: function (fresh) { return once('docs', function () { return rows(sb.from('documents').select('*').eq('archived', false).order('created_at', { ascending: false }).limit(2000)); }, fresh); },
    portfolio: function (fresh) { return once('portfolio', function () { return rows(sb.from('portfolio_items').select('id, project_id, status, title').limit(2000)); }, fresh); }
  };

  // ---------- the Sheet connection, in the sidebar footer (§3.12) ----------
  function sheetState(f) {
    var s = (f && f.sheet) || {};
    // text: the sidebar line; short: the same without the word Sheet (Settings puts its own label in front)
    var st = function (short, cls, text) { return { text: text || 'Sheet ' + short, short: short, cls: cls || '' }; };
    if (!s.connected) return st('not connected');
    if (s.status === 'error' || f.failed > 0) return st('sync stopped', 'is-err');
    var need = f.conflicts === 1 ? ' needs a look' : ' need a look';
    if (f.conflicts > 0) return st(plural(f.conflicts, 'change') + need, 'is-ink', plural(f.conflicts, 'Sheet change') + need);
    if (f.waiting > 0) return st(plural(f.waiting, 'change') + ' waiting', 'is-ink', plural(f.waiting, 'Sheet change') + ' waiting');
    if (s.pull_enabled === false) return st('sync paused');
    if (s.writes_enabled === false) return st('read only', '', 'Sheet is read only');
    return s.last_success_at ? st('synced ' + A.ago(s.last_success_at), 'is-ok') : st('not synced yet');
  }
  function paintSheet(f) {
    var st = f ? sheetState(f) : { text: 'Couldn\u2019t check the Sheet', cls: 'is-err' };
    $$('[data-sheet-line]').forEach(function (box) {
      box.innerHTML = '';
      box.appendChild(h('a', { href: '#settings', class: st.cls || null, text: st.text }));
    });
  }
  // the footer line is filled at sign in and kept current while the tab is open
  A.onSignedIn(function () { data.flow(true).catch(function () { paintSheet(null); }); });
  setInterval(function () { if (A.me() && !document.hidden) data.flow(true).catch(function () { paintSheet(null); }); }, 60000);

  // The live Sheet only: a DEV seed (a one-time copy) has no spreadsheet to open
  var REAL_ID = /^[A-Za-z0-9_-]{30,80}$/;
  function sheetUrl(values, gid) {
    var meta = values && values.meta && values.meta.value;
    if (!meta || !REAL_ID.test(meta.sheet || '') || /^SEED_/.test(meta.sheet)) return null;
    return 'https://docs.google.com/spreadsheets/d/' + meta.sheet + '/edit' + (gid != null ? '#gid=' + gid : '');
  }
  // where a Sheet-backed block's figures come from, and how old they are
  function fromSheet(values, at) {
    var meta = values && values.meta && values.meta.value;
    var seed = meta && meta.version === 'seed';
    return (seed ? 'From a snapshot of the Sheet' : 'From the Sheet') + (at ? ', read ' + stamp(at) : '');
  }

  // ---------- writing to the Sheet (sheets-write checks the role, money access and every value again) ----------
  var uuid = function () {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    var b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
    var x = Array.prototype.map.call(b, function (v) { return ('0' + v.toString(16)).slice(-2); }).join('');
    return [x.slice(0, 8), x.slice(8, 12), x.slice(12, 16), x.slice(16, 20), x.slice(20)].join('-');
  };
  // one change \u2192 {status, body, op_id}: 200 saved, 202 queued (the Sheet was busy and it goes in by itself),
  // 409 conflict, duplicate or another change still waiting, 422 refused, 423 writes paused, 429 too many.
  // Only a failed connection rejects. Re-sending the same op_id asks for its state instead of writing twice.
  // Once it has an answer the sidebar's Sheet line is read again: the minute timer may have caught the change mid-send.
  function sheetWrite(op, args, opId) {
    var id = opId || uuid();
    return sb.functions.invoke('sheets-write', { body: { op_id: id, op: op, args: args || {} } }).then(function (r) {
      if (!r.error) return { status: r.data && r.data.queued ? 202 : 200, body: r.data || {}, op_id: id };
      var res = r.error.context;
      if (!res || typeof res.json !== 'function') throw r.error;
      return res.json().catch(function () { return {}; }).then(function (b) { return { status: res.status, body: b || {}, op_id: id }; });
    }).then(function (out) { data.flow(true).catch(function () {}); return out; });
  }
  // what a write's answer means, in a sentence
  function writeText(r) {
    if (r.status === 200) return 'Saved to the Sheet.';
    if (r.status === 202) return 'The Sheet is busy. The change is queued and goes in by itself.';
    if (r.body.conflict) return 'Not saved: this changed in the Sheet meanwhile. Reload the page to see it, then try again.';
    return r.body.error || 'Not saved. Try again.';
  }
  // after a write, a pull brings the Sheet's own totals (Kas, Rekap) up to date; a busy or failed pull is left for the next one
  var pullSoon = function () { return sb.functions.invoke('sheets-sync', { body: {} }).then(function (r) { return !r.error; }, function () { return false; }); };
  // a form's sender: the same change sent again after a lost answer keeps its op id, so the Sheet never gets it twice
  function writer() {
    var opId = null, opKey = null;
    return function (op, args) {
      var key = op + JSON.stringify(args);
      if (key !== opKey) { opKey = key; opId = uuid(); }
      return sheetWrite(op, args, opId).then(function (r) {
        if (r.status !== 500 && r.status !== 502 && r.status !== 503) opKey = null;    // settled: the next attempt is a new change
        return r;
      });
    };
  }
  // the switch every write checks (sheet_values.flags); flags that couldn't be read count as off
  var writesOn = function (values) { var f = values && values.flags && values.flags.value; return !!(f && f.writes_enabled === true); };
  // RAB 001 to 009 are the old tabs: the admin shows them and never writes to them
  var frozen = function (p) { return p.sheet_state === 'present' && p.seq != null && p.seq <= 9; };

  // ---------- forms over Sheet values ----------
  var same = function (a, b) { return String(a == null ? '' : a) === String(b == null ? '' : b); };
  var plain = function (el) { return el.value.trim() || null; };
  // Rupiah typed as 1.500.000 or 1500000: a whole amount, or null when empty
  var rupiah = function (s) { var d = String(s == null ? '' : s).split(',')[0].replace(/\D/g, ''); return d ? Number(d) : null; };
  var amount = function (el) { return rupiah(el.value); };
  function amountInput(v, label) {
    var el = h('input', { type: 'text', inputmode: 'numeric', autocomplete: 'off', placeholder: '0', value: n(v) != null ? NUM.format(n(v)) : '', 'aria-label': label });
    el.addEventListener('blur', function () { var x = rupiah(el.value); el.value = x == null ? '' : NUM.format(x); });
    return el;
  }
  // a share typed as a whole percent (11 or 11,5) and kept as a fraction (0.11); NaN when it isn't a number
  var share = function (el) {
    var s = el.value.trim().replace('%', '').replace(',', '.').trim();
    if (!s) return null;
    return /^\d{1,3}(\.\d{1,2})?$/.test(s) ? Math.round(Number(s) * 100) / 10000 : NaN;
  };
  function shareInput(v, label) {
    var x = n(v);
    return h('input', { type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: '0', class: 'eco-pct', 'aria-label': label,
      value: x == null ? '' : String(Math.round(x * 10000) / 100).replace('.', ',') });
  }
  // a Sheet date as yyyy-mm-dd for a date field: ISO, 28/10/2026 (a date typed as text) or a day number (46291)
  function isoDay(v) {
    if (typeof v === 'number' && v > 20000 && v < 80000) return new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 864e5).toISOString().slice(0, 10);
    var s = String(v == null ? '' : v).trim(), m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
    if (m) return m[1];
    m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
    return m ? m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2) : '';
  }
  var dayOf = function (el) { return el.value || null; };
  /* A form whose values live in the Sheet. Each field remembers what it showed and the Sheet's value behind it, so
     only what changed is sent, with the old value as `expect`: the Sheet refuses the change when that cell changed
     meanwhile. o = {label, op, args(set, expect), check(set) → '' or a problem, done(answer), look}; look 'mock' (or
     'mock sm' for the small button) draws the bar the way the mockup's pages do */
  function sheetForm(o) {
    var fields = [], send = writer(), mock = /^mock/.test(o.look || '');
    var msg = h('span', { class: mock ? 'fmsg' : 'eco-saved', role: 'status' });
    var btn = h('button', { class: mock ? 'btn lime' + (/\bsm\b/.test(o.look) ? ' sm' : '') : 'eco-btn is-primary', type: 'button' }, o.label);
    var say = function (t, err) { msg.textContent = t || ''; msg.classList.toggle('is-err', !!err); };
    var busy = function (on) { btn.disabled = on; fields.forEach(function (x) { x.el.disabled = on; }); };
    btn.addEventListener('click', function () {
      var set = {}, expect = {};
      fields.forEach(function (x) { var v = x.read(x.el); if (!same(v, x.was)) { set[x.key] = v; expect[x.key] = x.raw; } });
      if (!Object.keys(set).length) return say('Nothing changed.');
      var bad = o.check ? o.check(set) : '';
      if (bad) return say(bad, true);
      busy(true); say('Saving to the Sheet…');
      send(o.op, o.args(set, expect)).then(function (r) {
        if (r.status === 200 || r.status === 202) { o.done(r); return; }
        busy(false); say(writeText(r), true);
      }, function (e) { busy(false); say(ecoError(e), true); });
    });
    return {
      // raw: the value as the Sheet holds it (sent back as `expect`); read: the field's value as it would be written
      field: function (key, el, raw, read) {
        var x = { key: key, el: el, raw: raw === undefined ? null : raw, read: read || plain };
        x.was = x.read(el); fields.push(x);
        return el;
      },
      dirty: function () { return fields.some(function (x) { return !same(x.read(x.el), x.was); }); },
      bar: mock ? h('div', { class: 'formacts' }, btn, msg) : h('div', { class: 'eco-formbar' }, msg, btn)
    };
  }

  // ---------- small UI pieces ----------
  var SOURCES = { website: 'Website', whatsapp: 'WhatsApp', instagram: 'Instagram', referral: 'Referral', email: 'Email', phone: 'Phone', event: 'Event', other: 'Other' };
  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  var isId = function (s) { return UUID.test(s || ''); };
  // friendly words for what went wrong (the database's own message as the last resort)
  function ecoError(e) {
    var msg = (e && (e.message || e.error_description)) || '';
    var code = e && e.code;
    if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) return 'Couldn\u2019t reach the database. Check the connection and reload.';
    // a server function the browser couldn't reach (supabase-js words the failed request its own way)
    if ((e && e.name === 'FunctionsFetchError') || /Failed to send a request/i.test(msg)) return 'Couldn\u2019t reach the admin. Check the connection and try again.';
    if (code === 'PGRST301' || /JWT|token/i.test(msg)) return 'Your session has ended. Sign in again.';
    if (code === '42501' || /permission denied|row-level security/i.test(msg)) return 'Your account isn\u2019t allowed to do this.';
    if (code === '23514') return 'One of the values isn\u2019t allowed here. Check the fields and try again.';
    return msg || 'Something went wrong. Reload to try again.';
  }
  var failed = function (e) { A.toast(ecoError(e), true); };
  var fullRow = function (tbody, cols, text, cls) {
    tbody.innerHTML = '';
    tbody.appendChild(h('tr', { class: 'empty' }, h('td', { colspan: cols, class: cls || null, text: text })));
  };
  var waitRow = function (tbody, cols) { fullRow(tbody, cols, 'Loading\u2026', 'eco-wait'); };
  var errRow = function (tbody, cols, e) { fullRow(tbody, cols, ecoError(e), 'eco-err'); };
  var thead = function (cols) {
    return h('thead', {}, h('tr', {}, cols.map(function (c) { return Array.isArray(c) ? h('th', { class: c[1] }, c[0]) : h('th', {}, c); })));
  };
  var fig = function (k, v, o) {
    o = o || {};
    return h('div', { class: 'eco-fig' }, h('div', { class: 'k', text: k }),
      h('div', { class: 'v' + (o.cls ? ' ' + o.cls : ''), text: v, title: o.title || null }), o.sub ? h('div', { class: 's', text: o.sub }) : null);
  };
  // an amount as a figure: missing in the Sheet reads as such, a loss in red
  var money = function (k, v, o) {
    o = o || {};
    var x = n(v);
    return x == null ? fig(k, o.none || 'Not in the Sheet', { cls: 'is-quiet', sub: o.sub })
      : fig(k, (o.fmt || rp)(x), { cls: x < 0 ? 'neg' : '', sub: o.sub });
  };
  var section = function (title, right) {
    var s = h('section', { class: 'eco-sec' }, h('h3', {}, h('span', { text: title }), right ? h('span', { class: 'r' }, right) : null));
    for (var i = 2; i < arguments.length; i++) A.add(s, arguments[i]);
    return s;
  };
  // label and value pairs; a pair whose value is missing is left out (pass quiet('Not set') to show it)
  var kv = function (pairs) {
    var dl = h('dl', { class: 'eco-kv' });
    pairs.forEach(function (p) {
      if (!p || p[1] == null || p[1] === '') return;
      dl.appendChild(h('dt', { text: p[0] })); dl.appendChild(h('dd', { class: p[2] || null }, p[1]));
    });
    return dl;
  };
  // the mockup's drawer parts: a head (a mark such as an avatar or a client code, the name, a line under it, small tags),
  // sections with a plain heading and an optional control on its right, and label and value rows
  var dhead = function (mark, title, sub, tags) {
    return h('div', { class: 'dr-head' }, mark, h('div', { class: 't' }, h('h2', { text: title }), sub ? h('p', { text: sub }) : null,
      tags && tags.length ? h('ul', { class: 'metas' }, tags.map(function (t) {
        // a tag is its text, or [colour, text] for one that marks a state (amber: no longer in the Sheet)
        return Array.isArray(t) ? h('li', { class: 'tag ' + t[0] }, t[1]) : h('li', { class: 'tag' }, t);
      })) : null));
  };
  // what the crew is still owed, as Finance and Crew & Vendors both put it: the Kas entries not paid yet (Keluar and
  // Belum), how many there are, and who the oldest is for and how long it has waited. kas is null when it couldn't be loaded
  function crewOwed(kas) {
    var unpaid = kas ? kas.filter(function (k) { return k.kind === 'Keluar' && k.paid === 'Belum'; }) : null;
    var old = unpaid && unpaid.slice().sort(function (a, b) { return (a.entry_date || '9').localeCompare(b.entry_date || '9'); })[0];
    var since = old && old.entry_date ? days(old.entry_date, today()) : null;
    var sub = !unpaid ? 'The Kas entries couldn\u2019t be loaded' : !unpaid.length ? 'Nothing unpaid'
      : unpaid.length === 1 ? [old.counterparty || old.description || old.category, since != null ? plural(since, 'day') : null].filter(Boolean).join(', ')
      : old.entry_date ? 'The oldest from ' + day(old.entry_date, { year: false }) : plural(unpaid.length, 'entry', 'entries');
    return { unpaid: unpaid, sub: sub, tag: unpaid && unpaid.length ? h('span', { class: 'tag amber', text: unpaid.length + ' unpaid' }) : null };
  }
  var dsec = function (title, right) {
    // a control beside the heading stays out of it, so the heading reads as its title alone
    var s = h('section', { class: 'sec' }, right ? h('div', { class: 'sec-hd' }, h('h3', { text: title }), right) : h('h3', { text: title }));
    for (var i = 2; i < arguments.length; i++) A.add(s, arguments[i]);
    return s;
  };
  var props = function (pairs) {
    var dl = h('dl', { class: 'props' });
    pairs.forEach(function (p) {
      if (!p || p[1] == null || p[1] === '') return;
      dl.appendChild(h('dt', { text: p[0] })); dl.appendChild(h('dd', {}, p[1]));
    });
    return dl;
  };
  // segmented control; onPick(value) runs when the choice changes (without it, the control only shows the value)
  var seg = function (opts, current, onPick, attrs) {
    var box = h('div', Object.assign({ class: 'eco-seg', role: 'group' }, attrs || {}));
    opts.forEach(function (o) {
      box.appendChild(h('button', { type: 'button', 'aria-pressed': String(o[0] === current), 'data-v': o[0], disabled: !onPick, onclick: onPick ? function () {
        $$('button', box).forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-v') === o[0])); });
        onPick(o[0]);
      } : null }, o[1]));
    });
    return box;
  };
  // a document made for a project, as the mockup lists it (its number, its kind and day); it opens in Google Drive
  var DOC_KIND = { penawaran: 'Penawaran', invoice: 'Invoice', kwitansi: 'Kwitansi', contract: 'Contract', brief: 'Brief', other: 'Other' };
  var docItem = function (x, more) {
    var u = A.safeUrl(x.url), kind = DOC_KIND[x.kind] || x.kind || 'Document';
    var kids = [h('span', { class: 'nic' }, A.icon('docs', 's')),
      h('div', {}, h('b', { text: x.doc_no || x.title || kind }), h('span', { text: [kind, more, shortStamp(x.file_created_at || x.created_at)].filter(Boolean).join(', ') })),
      u ? A.icon('ext', 's') : null];
    return h('li', {}, u ? h('a', { class: 'doc', href: u, target: '_blank', rel: 'noopener noreferrer' }, kids) : h('div', { class: 'doc' }, kids));
  };
  var ext = function (href, text) { var u = A.safeUrl(href); return u ? h('a', { href: u, target: '_blank', rel: 'noopener noreferrer', text: text }) : text; };
  var wa = function (phone) { var d = String(phone || '').replace(/[^\d]/g, '').replace(/^0/, '62'); return d.length >= 8 ? 'https://wa.me/' + d : null; };
  var phoneLink = function (phone) { var u = wa(phone); return !phone ? null : u ? h('a', { href: u, target: '_blank', rel: 'noopener noreferrer', text: phone }) : phone; };
  var mailLink = function (email) { return email ? h('a', { href: 'mailto:' + email, text: email }) : null; };
  var igLink = function (ig) {
    var handle = String(ig || '').replace(/^@+/, '').replace(/[^A-Za-z0-9._]/g, '');
    return handle ? h('a', { href: 'https://instagram.com/' + handle, target: '_blank', rel: 'noopener noreferrer', text: '@' + handle }) : null;
  };
  var setHash = function (tab, id) { history.replaceState(null, '', '#' + tab + (id ? '/' + id : '')); };
  // the drawer, wide, with the address pointing at the record (so a reload or a shared link opens it again);
  // keep: the same record drawn again after a save stays where it was scrolled to
  function drawer(tab, id, content, keep) {
    var box = A.$('[data-drawer]'), y = keep && box && !box.hidden ? box.scrollTop : 0;
    if (tab && id) setHash(tab, id);
    A.openDrawer(content.concat([h('div', { class: 'eco-drawer-end' })]), true);
    if (y && box) box.scrollTop = y;
  }
  // Tab stays inside an open drawer; the rest of the page is behind the scrim
  document.addEventListener('keydown', function (e) {
    var d = A.$('[data-drawer]');
    if (e.key !== 'Tab' || !d || d.hidden) return;
    var f = $$('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])', d)
      .filter(function (x) { return x.offsetParent !== null; });
    if (!f.length) return;
    var first = f[0], last = f[f.length - 1];
    if (!d.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
    else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
  // CSV for a spreadsheet: no cell may start a formula
  function csv(name, head, list) {
    var q = function (v) { var s = v == null ? '' : String(v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
    var lines = [head.map(q).join(',')].concat(list.map(function (r) { return r.map(q).join(','); }));
    var blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    var a = h('a', { href: URL.createObjectURL(blob), download: name + '-' + today() + '.csv' });
    document.body.appendChild(a); a.click(); a.remove();
  }
  // a filter that waits for the typing to stop
  var debounce = function (fn, ms) { var t; return function () { clearTimeout(t); t = setTimeout(fn, ms || 250); }; };
  var words = function (s) { return String(s == null ? '' : s).toLowerCase(); };
  var search = function (s) { return String(s || '').replace(/["\\,()*%]/g, ' ').replace(/\s+/g, ' ').trim(); };

  window.eco = {
    n: n, rp: rp, num: num, pct: pct, margin: margin, plural: plural, clip: clip,
    day: day, jkt: jkt, today: today, days: days, stamp: stamp, shortStamp: shortStamp, when: when, waited: waited,
    pad3: pad3, phase: phase, isActive: isActive, short: short, pname: pname, pill: pill, nextStep: nextStep, stepContext: stepContext,
    byUrgency: byUrgency, shootText: shootText,
    data: data, forget: forget, rows: rows, settle: settle, sheetState: sheetState, paintSheet: paintSheet, sheetUrl: sheetUrl, fromSheet: fromSheet,
    uuid: uuid, sheetWrite: sheetWrite, writeText: writeText, pullSoon: pullSoon, writer: writer, writesOn: writesOn, frozen: frozen,
    rupiah: rupiah, amount: amount, amountInput: amountInput, share: share, shareInput: shareInput, isoDay: isoDay, dayOf: dayOf, sheetForm: sheetForm,
    SOURCES: SOURCES, isId: isId, ecoError: ecoError, failed: failed, fullRow: fullRow, waitRow: waitRow, errRow: errRow, thead: thead,
    fig: fig, money: money, quiet: quiet, section: section, kv: kv, dhead: dhead, crewOwed: crewOwed, dsec: dsec, props: props, seg: seg, ext: ext, DOC_KIND: DOC_KIND, docItem: docItem, wa: wa, phoneLink: phoneLink, mailLink: mailLink, igLink: igLink,
    setHash: setHash, drawer: drawer, csv: csv, debounce: debounce, words: words, search: search,
    addDays: addDays, clientName: clientName, projectLine: projectLine, initial: initial, stage: stage, OPEN_LEAD: OPEN_LEAD, tip: tip,
    EVENT: EVENT, events: events, cardHead: cardHead, projectCard: projectCard
  };
})();
