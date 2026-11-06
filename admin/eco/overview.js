/* Overview, as in the approved mockup (Work CCC/mockup-admin-ui): a photo greeting with the day's chips, three money
   cards (money access only), what needs you next to the coming week and the latest activity, then the active
   projects. A figure or list that can't be loaded says so; it never shows 0 instead. */
(function () {
  'use strict';
  if (!window.cccAdmin) return; // admin.js stopped early: the sign in library didn't load
  var A = window.cccAdmin, E = window.eco, sb = A.sb, h = A.h, I = A.icon;
  var panel = A.$('[data-panel="overview"]'), ui = null, showAll = false, stageOn = 'all', needItems = [], needBroken = 0;
  var SHOW = 6;
  var smooth = function () { return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'; };
  // leads, applicants and network sign-ups are only read by owners and admins; for anyone else there is nothing to list
  var forEditors = function (q) { return A.canEdit() ? E.settle(E.rows(q())) : Promise.resolve({ v: [] }); };
  var forMoney = function (q) { return A.canMoney() ? E.settle(E.rows(q())) : Promise.resolve({ v: [] }); };

  // ---------- the page ----------
  function build() {
    if (ui) return;
    ui = {};
    ui.date = h('p', { class: 'hero-date' });
    ui.hi = h('h1', { class: 'hero-hi' });
    ui.top = h('div', { class: 'hero-top' });
    ui.chips = h('ul', { class: 'hero-chips', 'aria-label': 'Today' });
    var find = h('button', { class: 'search hero-search', type: 'button', 'aria-haspopup': 'dialog', 'aria-keyshortcuts': '/',
      onclick: function () { if (E.find) E.find(); } }, I('search'), h('span', { class: 'ph', text: 'Search projects, clients, leads' }), h('kbd', { text: '/' }));
    ui.hero = h('section', { class: 'hero', 'aria-label': 'Today' },
      h('div', { class: 'hero-ph' }), h('div', { class: 'hero-tint' }), h('div', { class: 'hero-shade' }),
      h('div', { class: 'hero-in' }, h('div', { class: 'hero-left' }, ui.date, ui.hi), ui.top, ui.chips, find));

    ui.kpis = h('section', { class: 'kpis', 'aria-label': 'Money' });

    ui.needCount = h('span', { class: 'badge', hidden: true });
    ui.needs = h('ul', { class: 'nlist' });
    ui.needMore = h('button', { class: 'btn sm more', type: 'button', hidden: true, onclick: function () { showAll = !showAll; drawNeeds(); } });
    ui.needCard = h('section', { class: 'card', id: 'needs', tabindex: '-1', 'aria-labelledby': 'ov-needs-h' },
      h('header', { class: 'card-h' }, h('h2', { id: 'ov-needs-h', text: 'Needs you' }), ui.needCount), ui.needs, ui.needMore);

    ui.weekAside = h('span', { class: 'aside' });
    ui.week = h('div', {});
    var weekCard = h('section', { class: 'card', 'aria-labelledby': 'ov-week-h' },
      h('header', { class: 'card-h' }, h('h2', { id: 'ov-week-h', text: 'Next 7 days' }), ui.weekAside), ui.week);

    ui.acts = h('ul', { class: 'alist' });
    var actCard = h('section', { class: 'card', 'aria-labelledby': 'ov-act-h' },
      h('header', { class: 'card-h' }, h('h2', { id: 'ov-act-h', text: 'Recent activity' })), ui.acts);

    ui.tabs = h('div', { class: 'tabs', role: 'group', 'aria-label': 'Stage' });
    ui.table = h('table', { class: 'tbl cards' });
    ui.tableCard = h('section', { class: 'card tablecard', 'aria-labelledby': 'ov-proj-h' },
      h('header', { class: 'card-h' }, h('h2', { id: 'ov-proj-h', text: 'Active projects' }), ui.tabs, h('a', { class: 'btn sm', href: '#projects' }, 'All projects')),
      ui.table);

    A.add(panel, [ui.hero, ui.kpis, h('div', { class: 'row2' }, ui.needCard, h('div', { class: 'stack' }, weekCard, actCard)), ui.tableCard]);
  }
  var wait = function (el) { el.innerHTML = ''; el.appendChild(h('li', { class: 'empty', text: 'Loading…' })); };

  // ---------- greeting ----------
  function hero(f, projects) {
    ui.date.textContent = A.today();
    ui.hi.textContent = A.greeting();
    ui.top.innerHTML = '';
    ui.top.hidden = !A.canEdit();
    if (A.canEdit()) {
      A.add(ui.top, [
        h('button', { class: 'btn glass', type: 'button', onclick: function () { E.addLead(); } }, I('chat', 's'), 'Add lead'),
        E.newProject ? h('button', { class: 'btn white', type: 'button', onclick: function () { E.newProject(); } }, I('plus', 's'), 'New project') : null]);
    }
    chips(f, projects);
  }
  // the day's chips: what needs you (once the list is in), the next shoot, new leads
  var flowNow = null, projectsNow = null;
  function chips(f, projects) {
    if (f !== undefined) { flowNow = f; projectsNow = projects; }
    f = flowNow; projects = projectsNow;
    ui.chips.innerHTML = '';
    var put = function (el) { ui.chips.appendChild(h('li', {}, el)); };
    var k = needItems.length;
    if (k > 0) {
      put(h('button', { class: 'chip', type: 'button', onclick: function () {
        ui.needCard.scrollIntoView({ behavior: smooth(), block: 'start' }); ui.needCard.focus({ preventScroll: true });
      } }, I('alert'), E.plural(k, 'thing') + (k === 1 ? ' needs you' : ' need you')));
    }
    var ns = f && f.next_shoot, d = ns ? E.days(E.today(), ns.date) : null;
    if (ns && d != null && d >= 0) {
      var p = (projects || []).filter(function (x) { return x.id === ns.project_id; })[0];
      put(h('a', { class: 'chip', href: '#projects/' + ns.project_id }, I('camera'),
        (d === 0 ? 'Shoot today' : d === 1 ? 'Shoot tomorrow' : 'Shoot ' + E.when(ns.date)) + ', ' + (p ? E.clientName(p) : ns.label)));
    }
    if (A.canEdit() && f && f.leads_new > 0) put(h('a', { class: 'chip', href: '#leads' }, I('chat'), E.plural(f.leads_new, 'new lead')));
  }

  // ---------- money cards ----------
  function kpiCard(icon, title, tag, body) {
    return h('article', { class: 'card kpi' },
      h('header', { class: 'kpi-h' }, h('span', { class: 'ic' }, I(icon)), h('h2', { text: title }), tag), body);
  }
  // a figure from the Sheet: missing reads as such (never 0)
  var big = function (v) { var x = E.n(v); return x == null ? h('p', { class: 'big is-none', text: 'Not in the Sheet' }) : h('p', { class: 'big' + (x < 0 ? ' neg' : ''), text: E.rp(x) }); };
  var noLoad = function (e) { return [h('p', { class: 'big is-none', text: 'Couldn’t load' }), h('p', { class: 'cap', text: E.ecoError(e) })]; };
  function seg(parts) {
    var bar = h('div', { class: 'seg' });
    parts.forEach(function (x) {
      if (!(x.v > 0)) return;
      var s = h('span', { class: 's ' + x.cls, 'aria-label': x.k + ' ' + E.rp(x.v) });
      s.style.flex = String(x.v);
      bar.appendChild(E.tip(s, x.k, x.tip));
    });
    if (!bar.children.length) bar.classList.add('is-empty');
    return bar;
  }
  function kpis(r) {
    var box = ui.kpis;
    box.innerHTML = '';
    box.hidden = !A.canMoney();
    if (!A.canMoney()) return;
    var f = r.flow.v, m = f && f.money, vals = r.values.v || {};
    var val = function (k) { return vals[k] ? vals[k].value || {} : {}; };

    // to collect: the Sheet's receivable; the bar splits the active deals project by project
    var collect = [];
    if (r.flow.e || !m) collect = noLoad(r.flow.e);
    else {
      collect.push(big(m.to_collect));
      if (r.projects.e || r.money.e) collect.push(h('p', { class: 'cap', text: 'The split by project couldn’t be loaded.' }));
      else {
        var worth = 0, paid = 0, late = 0, due = 0, lateWho = [], dueWho = [];
        r.projects.v.forEach(function (p) {
          if (E.phase(p) !== 'Deal' || p.sheet_state !== 'present' || p.archived_at) return;
          var x = r.money.v[p.id]; if (!x) return;
          worth += E.n(x.grand_total) || 0; paid += E.n(x.paid_total) || 0;
          var o = E.n(x.outstanding) || 0;
          if (x.pay_status === 'Telat') { late += o; if (o > 0) lateWho.push(E.clientName(p)); } else { due += o; if (o > 0) dueWho.push(E.clientName(p)); }
        });
        collect.push(h('p', { class: 'cap', text: worth > 0 ? 'Still owed on active deals worth ' + E.rp(worth) : 'No active deals right now.' }));
        if (worth > 0) {
          collect.push(h('div', { class: 'kpi-viz' },
            seg([{ k: 'Paid', v: paid, cls: 'paid', tip: E.rp(paid) + ' received' },
              { k: 'Overdue', v: late, cls: 'late', tip: E.rp(late) + (lateWho.length ? ' from ' + lateWho.join(', ') : '') },
              { k: 'Not due yet', v: due, cls: 'due', tip: E.rp(due) + (dueWho.length ? ' from ' + dueWho.join(', ') : '') }]),
            h('ul', { class: 'stats' }, [['paid', 'Paid', paid], ['late', 'Overdue', late], ['due', 'Not due yet', due]].map(function (s) {
              return h('li', {}, h('span', { class: 'k' }, h('i', { class: 'sw ' + s[0] }), s[1]), h('b', { text: E.rp(s[2]) }));
            }))));
        }
      }
    }
    var overdue = m ? E.n(m.overdue_count) : null;
    box.appendChild(kpiCard('in', 'To collect', overdue > 0 ? h('span', { class: 'tag red', text: overdue + ' overdue' }) : null, collect));

    // cash: the Kas tab; in and out since the Kas start, what's still to pay out
    var cash = [];
    if (r.flow.e || !m) cash = noLoad(r.flow.e);
    else {
      var ks = val('kas_summary');
      cash.push(big(m.cash), h('p', { class: 'cap', text: 'From the Kas tab in the Sheet' + (ks.start_date ? ', since ' + E.day(ks.start_date) : '') }));
      var inn = E.n(ks['in']), out = E.n(ks.out), top = Math.max(inn || 0, out || 0);
      var hb = function (k, v, cls) {
        var bar = h('i', { class: cls });
        bar.style.width = (top > 0 && v > 0 ? Math.max(2, Math.round(v / top * 100)) : 0) + '%';
        return h('div', { class: 'hb' }, h('span', { text: k }), h('div', { class: 'tr' }, bar), h('b', { text: v == null ? 'Not in the Sheet' : E.rp(v) }));
      };
      var unpaid = r.kas.e ? null : r.kas.v.filter(function (k) { return k.kind === 'Keluar' && k.paid === 'Belum'; });
      var oldest = unpaid && unpaid.length ? unpaid.map(function (k) { return k.entry_date; }).filter(Boolean).sort()[0] : null;
      var age = oldest ? E.days(oldest, E.today()) : null;
      cash.push(h('div', { class: 'kpi-viz' }, h('div', { class: 'hbars' }, hb('In', inn, 'in'), hb('Out', out, 'out')),
        h('div', { class: 'inset' },
          h('div', {}, h('span', { text: 'Owed to crew' }), h('b', { text: E.n(m.owed) == null ? 'Not in the Sheet' : E.rp(m.owed) })),
          h('div', {}, h('span', { text: 'Oldest unpaid' }), h('b', { text: r.kas.e ? 'Couldn’t load' : age == null ? 'None' : E.plural(age, 'day') })))));
    }
    var nUnpaid = !r.kas.e && r.kas.v ? r.kas.v.filter(function (k) { return k.kind === 'Keluar' && k.paid === 'Belum'; }).length : 0;
    box.appendChild(kpiCard('wallet', 'Cash', nUnpaid > 0 ? h('span', { class: 'tag amber', text: nUnpaid + ' unpaid' }) : null, cash));

    // the year: omset and profit from the Keuangan tab; the Sheet's projects by status
    var year = [], yr = m && m.year;
    if (r.flow.e || !m) year = noLoad(r.flow.e);
    else {
      year.push(big(m.omset_year), h('p', { class: 'cap', text: E.n(m.profit_year) == null ? 'Profit not in the Sheet' : 'Profit so far ' + E.rp(m.profit_year) }));
      var sc = val('rekap_summary').status_counts;
      if (sc) {
        var keys = ['Draft', 'Dikirim', 'Deal', 'Lunas'], most = Math.max.apply(null, keys.map(function (k) { return E.n(sc[k]) || 0; }).concat([1]));
        year.push(h('div', { class: 'kpi-viz' }, h('figure', { class: 'colchart' },
          h('figcaption', { text: 'Projects in the Sheet, by status' }),
          h('div', { class: 'cols' }, keys.map(function (k) {
            var c = E.n(sc[k]) || 0, bar = h('i', {});
            bar.style.height = Math.max(6, Math.round(c / most * 64)) + 'px';
            return E.tip(h('div', { class: 'col', 'aria-label': k + ' ' + c }, h('b', { text: String(c) }), bar), k, E.plural(c, 'project'));
          })),
          h('div', { class: 'collab' }, keys.map(function (k) { return h('span', { text: k }); })))));
      }
    }
    var margin = m ? E.n(m.margin_year) : null;
    box.appendChild(kpiCard('trend', 'Revenue' + (yr ? ' ' + yr : ''), margin != null ? h('span', { class: 'tag', text: 'Margin ' + E.pct(margin) }) : null, year));
  }

  // ---------- needs you: most urgent first, one action each ----------
  function needs(r) {
    var f = r.flow.v, money = r.money.v || {}, td = E.today(), items = [];
    needBroken = 0;
    var put = function (rank, at, it) { it.rank = rank; it.at = at || ''; items.push(it); };
    var ago = function (t) { return E.waited(t); };
    if (r.flow.e) needBroken++;
    else if (A.canEdit()) {
      if (f.sheet && f.sheet.connected && (f.sheet.status === 'error' || f.failed > 0)) {
        put(1, '', { icon: 'alert', tone: 'red', text: 'The Sheet sync stopped', sub: f.sheet.last_error || E.plural(f.failed, 'change') + ' couldn’t be written to the Sheet', href: '#settings' });
      }
      if (f.conflicts > 0) put(1, '', { icon: 'sync', tone: 'amber', text: E.plural(f.conflicts, 'Sheet change') + (f.conflicts === 1 ? ' needs' : ' need') + ' a look', sub: 'Changed in the Sheet and here at the same time', href: '#settings' });
      if (f.issues_open > 0) put(1, '', { icon: 'alert', tone: 'amber', text: E.plural(f.issues_open, 'sync issue') + ' to settle', sub: 'Something in the Sheet needs a look', href: '#settings' });
    }
    if (r.projects.e || r.money.e) needBroken++;
    else {
      var shown = {};
      (r.portfolio.v || []).forEach(function (it) { if (it.project_id && it.status !== 'archived') shown[it.project_id] = true; });
      r.projects.v.forEach(function (p) {
        if (p.sheet_state === 'removed') return;
        var m = money[p.id], ph = E.phase(p), who = E.clientName(p), line = E.projectLine(p), href = '#projects/' + p.id;
        if (ph === 'Deal' && m) {
          if (m.pay_status === 'Telat') {
            var late = p.payment_due ? E.days(p.payment_due, td) : null;
            put(2, p.payment_due, { icon: 'in', tone: 'red', text: 'Collect ' + E.rp(m.outstanding), sub: who + ', ' + line, href: href,
              tag: late > 0 ? E.plural(late, 'day') + ' late' : 'Overdue', tagTone: 'red' });
          } else if (E.n(m.outstanding) > 0 && p.payment_due) {
            var due = E.days(td, p.payment_due);
            if (due >= 0 && due <= 7) put(3, p.payment_due, { icon: 'in', tone: 'amber', text: 'Collect ' + E.rp(m.outstanding), sub: who + ', ' + line, href: href,
              tag: due === 0 ? 'Due today' : 'Due ' + E.when(p.payment_due), tagIcon: 'cal' });
          }
        }
        if (E.isActive(p) && p.shoot_date) {
          var sd = E.days(td, p.shoot_date);
          if (sd >= 0 && sd <= 7) {
            put(4, p.shoot_date, { icon: 'camera', tone: 'lime', text: sd === 0 ? 'Shoot today' : sd === 1 ? 'Shoot tomorrow' : 'Shoot on ' + E.when(p.shoot_date),
              sub: who + ', ' + line + (p.unlocked_gear > 0 ? '. ' + E.plural(p.unlocked_gear, 'gear price') + ' not locked' : ''), href: href,
              tag: E.when(p.shoot_date), tagTone: 'lime', tagIcon: 'cal' });
          }
        }
        if (ph === 'Deal' && m && p.status_changed_at && E.n(m.dp_amount) > 0 && !(E.n(m.dp_received) > 0) && E.days(E.jkt(p.status_changed_at), td) >= 7) {
          put(5, p.status_changed_at, { icon: 'wallet', tone: 'amber', text: 'No DP yet', sub: who + ', deal since ' + E.day(E.jkt(p.status_changed_at), { year: false }), href: href, tag: ago(p.status_changed_at) });
        }
        if (p.deliver_by && !p.final_file_date && E.isActive(p) && E.days(td, p.deliver_by) <= 3) {
          var dd = E.days(td, p.deliver_by);
          put(6, p.deliver_by, { icon: 'send', tone: dd < 0 ? 'red' : 'violet', text: 'Deliver the final files', sub: who + ', ' + line, href: href,
            tag: dd < 0 ? E.plural(-dd, 'day') + ' late' : dd === 0 ? 'Due today' : 'Due ' + E.when(p.deliver_by), tagTone: dd < 0 ? 'red' : '', tagIcon: dd < 0 ? 'clock' : 'cal' });
        } else {
          var shot = p.shoot_end || p.shoot_date;
          if (ph === 'Deal' && shot && shot < td && !p.final_file_date && !p.deliver_by) {
            put(6, shot, { icon: 'send', tone: 'violet', text: 'Deliver the final files', sub: who + ', shot on ' + E.when(shot), href: href });
          }
        }
        if (ph === 'Brief' && !p.archived_at && E.days(E.jkt(p.created_at), td) > 3) put(9, p.created_at, { icon: 'rab', text: 'Make the RAB', sub: who + ', ' + line, href: href, tag: ago(p.created_at) });
        if (ph === 'Draft' && p.quote_date && E.days(p.quote_date, td) > 7) put(10, p.quote_date, { icon: 'send', tone: 'violet', text: 'Send the quote', sub: who + ', quote dated ' + E.when(p.quote_date), href: href, tag: E.plural(E.days(p.quote_date, td), 'day') });
        if (ph === 'Dikirim' && p.quote_date && E.days(p.quote_date, td) > 14) put(10, p.quote_date, { icon: 'send', tone: 'violet', text: 'Follow up the quote', sub: who + ', quote dated ' + E.when(p.quote_date), href: href, tag: E.plural(E.days(p.quote_date, td), 'day') });
        if (ph === 'Lunas' && p.status_changed_at && !p.portfolio_skip && !r.portfolio.e && !shown[p.id]) put(11, p.status_changed_at, { icon: 'web', text: 'Add to the portfolio', sub: who + ', ' + line, href: href });
      });
    }
    // the client says they paid (the invoice link page): check the bank, then mark it in the Sheet
    if (r.paid.e) needBroken++;
    else {
      r.paid.v.forEach(function (x) {
        var p = !r.projects.e ? r.projects.v.filter(function (q) { return q.id === x.project_id; })[0] : null;
        var m = money[x.project_id];
        if (!p || (m && (m.pay_status === 'Lunas' || E.n(m.outstanding) === 0))) return;
        put(2, x.client_paid_at, { icon: 'check', tone: 'lime', text: E.clientName(p) + ' says they paid', sub: (x.amount != null ? E.rp(x.amount) + ' for ' : 'For ') + (x.doc_no || E.projectLine(p)) + '. Check the bank, then mark it paid',
          href: '#projects/' + p.id, tag: ago(x.client_paid_at) });
      });
    }
    if (r.kas.e) needBroken++;
    else {
      var weekAgo = E.jkt(Date.now() - 7 * 864e5);
      (r.kas.v || []).forEach(function (k) {
        if (k.kind !== 'Keluar' || k.paid !== 'Belum' || !k.entry_date || k.entry_date > weekAgo) return;
        put(7, k.entry_date, { icon: 'out', tone: 'amber', text: 'Pay ' + (k.counterparty || 'an unnamed payee') + ' ' + E.rp(k.amount),
          sub: [k.category, k.project_tab ? 'for ' + k.project_tab.slice(0, 3) : null].filter(Boolean).join(' ') || 'From the Kas tab', href: '#finance', tag: ago(k.entry_date) });
      });
    }
    // lead follow ups that are due, then leads nobody answered for a day
    if (r.follow.e) needBroken++;
    else {
      r.follow.v.forEach(function (l) {
        var dl = E.days(l.next_step_on, td);
        put(dl > 0 ? 2 : 3, l.next_step_on, { icon: 'chat', tone: 'violet', text: 'Follow up with ' + l.name, sub: l.next_step || l.company || 'Next step not written', href: '#leads/' + l.id,
          tag: dl > 0 ? E.plural(dl, 'day') + ' late' : 'Today', tagTone: dl > 0 ? 'red' : 'violet', tagIcon: dl > 0 ? 'clock' : 'cal' });
      });
    }
    if (r.leads.e) needBroken++;
    else {
      var dayAgo = Date.now() - 864e5;
      r.leads.v.forEach(function (l) {
        if (new Date(l.created_at).getTime() > dayAgo) return;
        put(8, l.created_at, { icon: 'chat', tone: 'violet', text: 'Reply to ' + l.name,
          sub: [l.company, l.about || E.clip(l.description, 70)].filter(Boolean).join(', ') || (l.kind === 'website' ? 'New lead from the website' : 'New lead'), href: '#leads/' + l.id, tag: ago(l.created_at) });
      });
    }
    var each = function (x, fn) { if (x.e) { needBroken++; return; } x.v.forEach(fn); };
    each(r.applicants, function (a) {
      put(12, a.created_at, { icon: 'careers', text: 'Review ' + a.name, sub: (a.track === 'internship' ? 'Internship' : 'Team') + ' application', href: '#applicants/' + a.id, tag: ago(a.created_at) });
    });
    each(r.network, function (p) { put(12, p.created_at, { icon: 'crew', text: 'Review a network sign up', sub: p.company_name || p.name, href: '#network/' + p.id, tag: ago(p.created_at) }); });
    each(r.drafts, function (d) { put(12, d.updated_at, { icon: 'web', text: 'Finish or archive a draft', sub: d.title, href: '#portfolio/' + d.id, tag: ago(d.updated_at) }); });

    items.sort(function (a, b) { return a.rank - b.rank || (a.at < b.at ? -1 : a.at > b.at ? 1 : 0); });
    needItems = items;
    drawNeeds();
    chips();
  }
  function needRow(it) {
    return h('li', { class: 'n' },
      h('span', { class: 'nic' + (it.tone ? ' ' + it.tone : '') }, I(it.icon)),
      h('div', { class: 'nt' }, h('b', { text: it.text }), it.sub ? h('span', { text: it.sub }) : null),
      it.tag ? h('span', { class: 'tag' + (it.tagTone ? ' ' + it.tagTone : '') }, I(it.tagIcon || 'clock'), it.tag) : null,
      h('a', { class: 'btn sm', href: it.href, 'aria-label': 'Open: ' + it.text }, 'Open'),
      I('chev', 'chev'));
  }
  function drawNeeds() {
    var ul = ui.needs, items = needItems, cut = showAll ? items.length : SHOW;
    ul.innerHTML = '';
    items.slice(0, cut).forEach(function (it) { ul.appendChild(needRow(it)); });
    if (!items.length && !needBroken) ul.appendChild(h('li', { class: 'empty', text: 'Nothing is waiting on you.' }));
    if (needBroken) ul.appendChild(h('li', { class: 'empty is-err', text: 'Part of this list couldn’t be checked. Reload to try again.' }));
    ui.needCount.hidden = !items.length; ui.needCount.textContent = items.length || '';
    ui.needCount.setAttribute('aria-label', E.plural(items.length, 'item'));
    ui.needMore.hidden = items.length <= SHOW;
    ui.needMore.textContent = showAll ? 'Show fewer' : 'Show all ' + items.length;
  }

  // ---------- the coming week ----------
  function week(r) {
    var box = ui.week, td = E.today(), end = E.addDays(td, 6);
    box.innerHTML = '';
    // "6 to 12 Nov", or "28 Nov to 4 Dec" across a month
    var a0 = E.day(td, { year: false }), b0 = E.day(end, { year: false });
    ui.weekAside.textContent = (a0.split(' ')[1] === b0.split(' ')[1] ? a0.split(' ')[0] : a0) + ' to ' + b0;
    var days = h('div', { class: 'days' });
    for (var i = 0; i < 7; i++) {
      var d = E.addDays(td, i), wd = E.day(d, { weekday: true, year: false }).split(' ');
      days.appendChild(h('div', { class: 'd' + (i === 0 ? ' today' : ''), 'aria-label': i === 0 ? 'Today, ' + E.day(d, { weekday: true, year: false }) : E.day(d, { weekday: true, year: false }) },
        h('span', { text: i === 0 ? 'Today' : wd[0] }), h('b', { text: wd[1] })));
    }
    box.appendChild(days);
    if (r.projects.e || r.money.e || r.followAll.e) {
      box.appendChild(h('p', { class: 'quiet is-err', text: 'The week couldn’t be loaded. Reload to try again.' }));
      return;
    }
    var RANK = { shoot: 0, deliver: 1, pay: 2, follow: 3 };
    var list = E.events(r.projects.v, r.money.v, r.followAll.v).filter(function (ev) { return ev.end >= td && ev.start <= end; })
      .sort(function (x, y) { return (x.start < td ? td : x.start) < (y.start < td ? td : y.start) ? -1 : (x.start < td ? td : x.start) > (y.start < td ? td : y.start) ? 1 : RANK[x.type] - RANK[y.type]; });
    // a day with something on it gets a mark; the list under the days says what (a bar per day can't hold a name)
    list.forEach(function (ev) {
      var a = ev.start < td ? 0 : E.days(td, ev.start), b = Math.min(6, E.days(td, ev.end));
      for (var k = a; k <= b; k++) days.children[k].classList.add('busy');
    });
    var when = function (d) {
      var k = E.days(td, d);
      return k <= 0 ? 'Today' : k === 1 ? 'Tomorrow' : E.day(d, { weekday: true, year: false }).split(' ').slice(0, 2).join(' ');
    };
    var shown = list.slice(0, 5), ul = h('ul', { class: 'wl' });
    shown.forEach(function (ev) {
      var t = ev.start < td ? 'Until ' + when(ev.end) : when(ev.start) + (ev.end !== ev.start ? ' to ' + when(ev.end) : '');
      ul.appendChild(h('li', {}, h('a', { class: 'we ' + ev.type + (ev.tent ? ' tent' : '') + (ev.late ? ' late' : ''), href: ev.href },
        I(E.EVENT[ev.type].icon), h('span', { class: 'we-t' }, h('b', { text: E.EVENT[ev.type].label + (ev.tent ? ', not confirmed' : '') }), ' ' + ev.title),
        h('span', { class: 'we-d', text: t }))));
    });
    if (shown.length) box.appendChild(ul);
    var more = list.length - shown.length;
    box.appendChild(h('p', { class: 'quiet' },
      !list.length ? 'Nothing planned in the next 7 days. ' : more > 0 ? E.plural(more, 'more thing') + ' this week. ' : '',
      h('a', { href: '#calendar' }, 'Open the calendar')));
  }

  // ---------- recent activity ----------
  var KIND = { portfolio: 'Portfolio', project: 'Project', lead: 'Lead', document: 'Document', kas: 'Kas' };
  var HREF = {
    portfolio: function (id) { return '#portfolio/' + id; }, project: function (id) { return '#projects/' + id; },
    lead: function (id) { return '#leads/' + id; }, document: function () { return '#documents'; }
  };
  function activity() {
    var ul = ui.acts; wait(ul);
    Promise.all([
      E.settle(E.rows(sb.from('activity_log').select('at, actor_email, action, entity, entity_id, label, source').order('at', { ascending: false }).limit(15))),
      forEditors(function () { return sb.from('lead_inbox').select('id, kind, created_at, name, source').order('created_at', { ascending: false }).limit(8); }),
      forEditors(function () { return sb.from('applicants').select('id, name, track, created_at').order('created_at', { ascending: false }).limit(8); }),
      forEditors(function () { return sb.from('network_profiles').select('id, name, company_name, created_at').order('created_at', { ascending: false }).limit(8); })
    ]).then(function (r) {
      var list = [], broken = 0;
      var each = function (x, fn) { if (x.e) { broken++; return; } x.v.forEach(function (it) { list.push(fn(it)); }); };
      each(r[0], function (a) {
        var who = a.actor_email ? a.actor_email.split('@')[0] : 'Someone';
        return { at: a.at, href: HREF[a.entity] && a.entity_id ? HREF[a.entity](a.entity_id) : null, av: E.initial(who),
          text: who + ' ' + a.action + ' “' + (a.label || 'an item') + '”', sub: [KIND[a.entity], a.source === 'sheet' ? 'in the Sheet' : null].filter(Boolean).join(', ') };
      });
      each(r[1], function (l) {
        return { at: l.created_at, href: '#leads/' + l.id, av: E.initial(l.name), text: 'New lead from ' + l.name,
          sub: l.kind === 'website' ? 'Website form' : (E.SOURCES[l.source] || l.source) + ', added by hand' };
      });
      each(r[2], function (a) {
        return { at: a.created_at, href: '#applicants/' + a.id, av: E.initial(a.name), text: (a.track === 'internship' ? 'Internship' : 'Team') + ' application from ' + a.name, sub: 'Careers page' };
      });
      each(r[3], function (p) { return { at: p.created_at, href: '#network/' + p.id, av: E.initial(p.company_name || p.name), text: 'Network sign up from ' + (p.company_name || p.name), sub: 'Careers page' }; });
      list.sort(function (a, b) { return new Date(b.at) - new Date(a.at); });
      ul.innerHTML = '';
      list.slice(0, 6).forEach(function (it) {
        var body = h('p', {}, it.text, it.sub ? h('span', { text: it.sub }) : null);
        ul.appendChild(h('li', { class: 'a' }, h('span', { class: 'av', 'aria-hidden': 'true', text: it.av }),
          it.href ? h('a', { href: it.href, class: 'a-link' }, body) : body, h('time', { datetime: it.at, title: E.stamp(it.at), text: E.shortStamp(it.at) })));
      });
      if (!list.length && !broken) ul.appendChild(h('li', { class: 'empty', text: 'No activity yet.' }));
      if (broken) ul.appendChild(h('li', { class: 'empty is-err', text: 'Part of the activity couldn’t be loaded. Reload to try again.' }));
    });
  }

  // ---------- active projects ----------
  var STAGES = ['Brief', 'Draft', 'Dikirim', 'Deal'];
  function projects(r) {
    var t = ui.table, tb = h('tbody'), cols = A.canMoney() ? 7 : 5;
    t.innerHTML = ''; t.appendChild(E.cardHead()); t.appendChild(tb);
    ui.tabs.innerHTML = '';
    if (r.projects.e || r.money.e) { E.errRow(tb, cols, r.projects.e || r.money.e); return; }
    var ctx = E.stepContext(r.docs.e ? undefined : r.docs.v, r.kas.e ? undefined : r.kas.v, r.portfolio.e ? undefined : r.portfolio.v), money = r.money.v;
    var list = E.byUrgency(r.projects.v.filter(E.isActive), money, E.today());
    var count = {}; list.forEach(function (p) { var k = E.phase(p); count[k] = (count[k] || 0) + 1; });
    if (stageOn !== 'all' && !count[stageOn]) stageOn = 'all';
    var tab = function (key, label, k) {
      return h('button', { type: 'button', 'aria-pressed': stageOn === key ? 'true' : 'false', onclick: function () { stageOn = key; projects(r); } },
        label, h('span', { class: 'c', text: String(k) }));
    };
    A.add(ui.tabs, [tab('all', 'All', list.length)].concat(STAGES.filter(function (s) { return count[s]; }).map(function (s) { return tab(s, s, count[s]); })));
    ui.tabs.hidden = list.length === 0;
    var rows = list.filter(function (p) { return stageOn === 'all' || E.phase(p) === stageOn; }).slice(0, 10);
    rows.forEach(function (p) { tb.appendChild(E.projectCard(p, money[p.id], ctx(p), '#projects/' + p.id)); });
    if (!list.length) E.fullRow(tb, cols, 'No active projects right now.');
  }

  A.loaders.overview = function () {
    build();
    showAll = false;
    wait(ui.needs);
    var wk = new Date(Date.now() - 7 * 864e5).toISOString(), td = E.today();
    var r = {
      flow: E.settle(E.data.flow(true)), projects: E.settle(E.data.projects()), money: E.settle(E.data.money()),
      docs: E.settle(E.data.docs()), kas: E.settle(E.data.kas()), portfolio: E.settle(E.data.portfolio()), values: E.settle(E.data.values()),
      leads: forEditors(function () { return sb.from('lead_inbox').select('id, kind, created_at, name, company, about, description').eq('status', 'new').order('created_at').limit(20); }),
      follow: forEditors(function () {
        return sb.from('lead_inbox').select('id, name, company, status, next_step, next_step_on').in('status', E.OPEN_LEAD).lte('next_step_on', td).order('next_step_on').limit(30);
      }),
      followAll: forEditors(function () {
        return sb.from('lead_inbox').select('id, name, status, next_step, next_step_on').in('status', E.OPEN_LEAD).gte('next_step_on', td).lte('next_step_on', E.addDays(td, 6)).limit(50);
      }),
      paid: forMoney(function () {
        return sb.from('pay_links').select('project_id, doc_no, amount, client_paid_at').not('client_paid_at', 'is', null).is('revoked_at', null).order('client_paid_at').limit(20);
      }),
      applicants: forEditors(function () { return sb.from('applicants').select('id, name, track, created_at').eq('status', 'new').order('created_at').limit(10); }),
      network: forEditors(function () { return sb.from('network_profiles').select('id, name, company_name, created_at').eq('status', 'new').order('created_at').limit(10); }),
      drafts: E.settle(E.rows(sb.from('portfolio_items').select('id, title, updated_at').eq('status', 'draft').lt('updated_at', wk).order('updated_at').limit(6)))
    };
    var keys = Object.keys(r);
    hero(null, null);
    Promise.all([r.flow, r.projects]).then(function (x) { chips(x[0].v || null, x[1].v || null); });
    Promise.all(keys.map(function (k) { return r[k]; })).then(function (vals) {
      var got = {}; keys.forEach(function (k, i) { got[k] = vals[i]; });
      kpis(got); needs(got); week(got); projects(got);
    });
    activity();
  };
})();
