/* Overview: the flow strip (one figure per stage, in sidebar order), what needs doing, the active projects and
   recent activity. A figure or list that can't be loaded says so; it never shows 0 instead. */
(function () {
  'use strict';
  var A = window.cccAdmin, E = window.eco, sb = A.sb, h = A.h;
  var panel = A.$('[data-panel="overview"]'), box = null, showAll = false;

  A.actions.overview = function () {
    return A.canEdit() ? h('button', { class: 'btn', type: 'button', onclick: function () { E.addLead(); } }, 'Add lead') : null;
  };

  function build() {
    if (box) return;
    box = {
      flow: h('nav', { class: 'eco-flow', 'aria-label': 'Flow' }),
      needs: h('ul', { class: 'eco-list' }),
      activity: h('ul', { class: 'eco-list' }),
      active: h('table', { class: 'adm-table is-stack' })
    };
    A.add(panel, [box.flow, h('div', { class: 'eco-cols' },
      h('section', {}, h('h2', { class: 'eco-h', text: 'Needs you' }), box.needs),
      h('section', {}, h('h2', { class: 'eco-h', text: 'Recent activity' }), box.activity),
      h('section', { class: 'wide' }, h('h2', { class: 'eco-h', text: 'Active projects' }), h('div', { class: 'adm-table-wrap' }, box.active)))]);
  }
  var waitList = function (ul) { ul.innerHTML = ''; ul.appendChild(h('li', { class: 'eco-wait', text: 'Loading\u2026' })); };

  // ---------- the strip ----------
  function stage(name, href, v, c, cls) {
    return h(href ? 'a' : 'div', { class: 'eco-stage', href: href || null },
      h('span', { class: 'n', text: name }), h('span', { class: 'v' + (cls ? ' ' + cls : ''), text: v }), h('span', { class: 'c', text: c }));
  }
  // an amount from the Sheet: missing reads as such
  var amount = function (v) { var x = E.n(v); return x == null ? ['Not in the Sheet', 'is-quiet'] : [E.rp(x), x < 0 ? 'neg' : '']; };
  function strip(f, projects) {
    var m = f.money || {}, money = !!f.can_see_money, synced = !!(f.sheet && f.sheet.synced);
    var later = function (name) { return stage(name, '#settings', 'Not synced yet', 'The Sheet hasn\u2019t been read yet', 'is-quiet'); };
    var ph = f.projects_by_phase || {};
    var phases = ['Brief', 'Draft', 'Dikirim', 'Deal'].filter(function (k) { return ph[k] > 0; }).map(function (k) { return k + ' ' + ph[k]; }).join(' \u00b7 ');
    var ns = f.next_shoot, nsp = ns && (projects || []).filter(function (p) { return p.id === ns.project_id; })[0];
    var net = f.network_new > 0 ? E.plural(f.network_new, 'network sign-up') + ' to review' : 'no sign-ups to review';
    var owed = amount(m.owed), collect = amount(m.to_collect), profit = amount(m.profit_year);
    box.flow.innerHTML = '';
    A.add(box.flow, [
      stage('Leads', '#leads', E.num(f.leads_new), f.leads_new > 0 && f.leads_oldest_new_at ? 'Oldest waiting ' + E.waited(f.leads_oldest_new_at) : 'Nothing waiting'),
      synced ? stage('Clients', '#clients', E.num(f.clients_present), E.plural(f.clients_active, 'client') + ' with open projects') : later('Clients'),
      stage('Projects', '#projects', E.num(f.projects_active),
        ns ? 'Next shoot ' + E.when(ns.date) + ' \u00b7 ' + (nsp ? E.short(nsp) : ns.label) : (phases || 'Nothing active')),
      !money ? stage('Crew & Vendors', '#crew', E.num(f.crew_on_active), 'People on active projects \u00b7 ' + net)
        : synced ? stage('Crew & Vendors', '#crew', owed[0], 'Owed to crew \u00b7 ' + net, owed[1]) : later('Crew & Vendors'),
      stage('Documents', '#documents', E.num(f.docs_this_month), 'PDFs this month \u00b7 '
        + (money && f.deals_without_invoice_pdf > 0 ? E.plural(f.deals_without_invoice_pdf, 'deal') + ' without an invoice PDF' : 'nothing waiting')),
      !money ? stage('Finance', null, 'No access', 'Needs money access', 'is-quiet')
        : synced ? stage('Finance', '#finance', collect[0], 'To collect \u00b7 ' + E.num(m.overdue_count) + ' overdue \u00b7 cash ' + (E.n(m.cash) == null ? 'not in the Sheet' : E.rp(m.cash)), collect[1]) : later('Finance'),
      !money ? stage('Reports', '#reports', 'Pipeline', 'Money figures need money access', 'is-quiet')
        : synced ? stage('Reports', '#reports', profit[0], 'Profit ' + (m.year || '') + ' \u00b7 omset ' + (E.n(m.omset_year) == null ? 'not in the Sheet' : E.rp(m.omset_year)), profit[1]) : later('Reports'),
      stage('Portfolio', '#portfolio', E.num(f.portfolio_live), 'Live items \u00b7 '
        + (f.lunas_not_in_portfolio > 0 ? E.plural(f.lunas_not_in_portfolio, 'finished project') + ' not added' : 'nothing to add'))
    ]);
  }
  function stripError(e) {
    box.flow.innerHTML = '';
    ['Leads', 'Clients', 'Projects', 'Crew & Vendors', 'Documents', 'Finance', 'Reports', 'Portfolio'].forEach(function (name) {
      box.flow.appendChild(stage(name, null, 'Couldn\u2019t load', E.ecoError(e), 'is-err'));
    });
  }

  // ---------- needs you: most urgent first, one action each ----------
  function needs(r) {
    var f = r.flow.v, list = r.projects.v, money = r.money.v || {}, td = E.today(), items = [], broken = 0;
    var put = function (rank, at, text, sub, href, btn, w) { items.push({ rank: rank, at: at || '', text: text, sub: sub, href: href, btn: btn, w: w }); };
    if (r.flow.e) broken++;
    else if (A.canEdit()) {
      if (f.sheet && f.sheet.connected && (f.sheet.status === 'error' || f.failed > 0)) {
        put(1, '', 'The Sheet sync stopped', f.sheet.last_error || E.plural(f.failed, 'change') + ' couldn\u2019t be written to the Sheet', '#settings', 'Open');
      }
      if (f.conflicts > 0) put(1, '', E.plural(f.conflicts, 'Sheet change') + (f.conflicts === 1 ? ' needs' : ' need') + ' a look', null, '#settings', 'Open');
      if (f.issues_open > 0) put(1, '', E.plural(f.issues_open, 'sync issue') + ' to settle', null, '#settings', 'Open');
    }
    if (r.projects.e || r.money.e) broken++;
    else {
      var shown = {};
      (r.portfolio.v || []).forEach(function (it) { if (it.project_id && it.status !== 'archived') shown[it.project_id] = true; });
      list.forEach(function (p) {
        if (p.sheet_state === 'removed') return;
        var m = money[p.id], ph = E.phase(p), lbl = E.short(p), href = '#projects/' + p.id;
        var who = p.client_label ? p.client_label + ' \u00b7 ' + E.pad3(p.seq) : lbl;
        if (ph === 'Deal' && m) {
          if (m.pay_status === 'Telat') {
            var late = p.payment_due ? E.days(p.payment_due, td) : null;
            put(2, p.payment_due, 'Collect ' + E.rp(m.outstanding) + ' from ' + who + (late > 0 ? ' \u00b7 ' + E.plural(late, 'day') + ' overdue' : ''), null, href, 'Open project');
          } else if (E.n(m.outstanding) > 0 && p.payment_due) {
            var due = E.days(td, p.payment_due);
            if (due >= 0 && due <= 7) put(3, p.payment_due, 'Collect ' + E.rp(m.outstanding) + ' from ' + who + ' by ' + E.when(p.payment_due), null, href, 'Open project');
          }
        }
        if (E.isActive(p) && p.shoot_date) {
          var sd = E.days(td, p.shoot_date);
          if (sd >= 0 && sd <= 7) {
            put(4, p.shoot_date, 'Shoot ' + (sd === 0 ? 'today' : sd === 1 ? 'tomorrow' : 'on ' + E.when(p.shoot_date)) + ' \u00b7 ' + lbl,
              p.unlocked_gear > 0 ? E.plural(p.unlocked_gear, 'gear price') + ' not locked' : null, href, 'Open project');
          }
        }
        if (ph === 'Deal' && m && p.status_changed_at && E.n(m.dp_amount) > 0 && !(E.n(m.dp_received) > 0) && E.days(E.jkt(p.status_changed_at), td) >= 7) {
          put(5, p.status_changed_at, 'No DP yet from ' + who, 'Deal since ' + E.day(E.jkt(p.status_changed_at), { year: false }), href, 'Open project');
        }
        var shot = p.shoot_end || p.shoot_date;
        if (ph === 'Deal' && shot && shot < td && !p.final_file_date) put(6, shot, 'Deliver the final files for ' + lbl, 'Shot on ' + E.when(shot), href, 'Open project');
        if (ph === 'Brief' && !p.archived_at && E.days(E.jkt(p.created_at), td) > 3) put(9, p.created_at, 'Make the RAB for ' + E.pname(p), null, href, 'Open project', E.waited(p.created_at));
        if (ph === 'Draft' && p.quote_date && E.days(p.quote_date, td) > 7) put(10, p.quote_date, 'Send the quote for ' + lbl, 'Quote dated ' + E.when(p.quote_date), href, 'Open project');
        if (ph === 'Dikirim' && p.quote_date && E.days(p.quote_date, td) > 14) put(10, p.quote_date, 'Follow up the quote for ' + lbl, 'Quote dated ' + E.when(p.quote_date), href, 'Open project');
        if (ph === 'Lunas' && p.status_changed_at && !p.portfolio_skip && !r.portfolio.e && !shown[p.id]) put(11, p.status_changed_at, 'Add ' + lbl + ' to the portfolio', null, href, 'Open project');
      });
    }
    if (r.kas.e) broken++;
    else {
      var weekAgo = E.jkt(Date.now() - 7 * 864e5);
      (r.kas.v || []).forEach(function (k) {
        if (k.kind !== 'Keluar' || k.paid !== 'Belum' || !k.entry_date || k.entry_date > weekAgo) return;
        put(7, k.entry_date, 'Pay ' + (k.counterparty || 'an unnamed payee') + ' ' + E.rp(k.amount) + (k.project_tab ? ' \u00b7 ' + k.project_tab.slice(0, 3) : ''),
          k.category, '#finance', 'Open', E.waited(k.entry_date));
      });
    }
    if (r.leads.e) broken++;
    else {
      var dayAgo = Date.now() - 864e5;
      r.leads.v.forEach(function (l) {
        if (new Date(l.created_at).getTime() > dayAgo) return;
        put(8, l.created_at, 'Reply to ' + l.name, [l.company, l.about || E.clip(l.description, 70), l.budget].filter(Boolean).join(' \u00b7 '),
          '#leads/' + l.id, 'Open lead', E.waited(l.created_at));
      });
    }
    var each = function (x, fn) { if (x.e) { broken++; return; } x.v.forEach(fn); };
    each(r.applicants, function (a) {
      put(12, a.created_at, 'Review ' + a.name + '\u2019s ' + (a.track === 'internship' ? 'internship' : 'team') + ' application', null, '#applicants/' + a.id, 'Review', E.waited(a.created_at));
    });
    each(r.network, function (p) { put(12, p.created_at, 'Review a network sign-up', p.company_name || p.name, '#network/' + p.id, 'Review', E.waited(p.created_at)); });
    each(r.drafts, function (d) { put(12, d.updated_at, 'Finish or archive the draft \u201c' + d.title + '\u201d', null, '#portfolio/' + d.id, 'Open', E.waited(d.updated_at)); });

    items.sort(function (a, b) { return a.rank - b.rank || (a.at < b.at ? -1 : a.at > b.at ? 1 : 0); });
    var ul = box.needs, cut = showAll ? items.length : 8;
    ul.innerHTML = '';
    items.slice(0, cut).forEach(function (it) {
      ul.appendChild(h('li', {},
        h('span', { class: 't' }, it.text, it.sub ? h('span', { class: 'sub', text: it.sub }) : null),
        it.w ? h('span', { class: 'w', text: it.w }) : null,
        h('a', { class: 'eco-btn', href: it.href }, it.btn)));
    });
    if (!items.length && !broken) ul.appendChild(h('li', { class: 'eco-empty', text: 'Nothing is waiting on you.' }));
    if (broken) ul.appendChild(h('li', { class: 'eco-err', text: 'Part of this list couldn\u2019t be checked. Reload to try again.' }));
    if (items.length > cut) {
      ul.appendChild(h('li', { class: 'eco-empty' }, h('button', { class: 'eco-btn', type: 'button', onclick: function () { showAll = true; needs(r); } }, 'Show all ' + items.length)));
    }
  }

  // ---------- active projects ----------
  function active(r) {
    var t = box.active, cols = E.projectCols(), tb = h('tbody');
    t.innerHTML = ''; t.appendChild(E.thead(cols)); t.appendChild(tb);
    if (r.projects.e || r.money.e) return E.errRow(tb, cols.length, r.projects.e || r.money.e);
    var ctx = E.stepContext(r.docs.v, r.kas.v, r.portfolio.v), money = r.money.v;
    var list = E.byUrgency(r.projects.v.filter(E.isActive), money, E.today()).slice(0, 8);
    list.forEach(function (p) { tb.appendChild(E.projectRow(p, money[p.id], ctx(p), function () { location.hash = '#projects/' + p.id; })); });
    if (!list.length) E.fullRow(tb, cols.length, 'No active projects right now.');
  }

  // ---------- recent activity ----------
  var KIND = { portfolio: 'Portfolio', project: 'Project', lead: 'Lead', document: 'Document' };
  var HREF = {
    portfolio: function (id) { return '#portfolio/' + id; }, project: function (id) { return '#projects/' + id; },
    lead: function (id) { return '#leads/' + id; }, document: function () { return '#documents'; }
  };
  function activity() {
    var ul = box.activity; waitList(ul);
    Promise.all([
      E.settle(E.rows(sb.from('activity_log').select('at, actor_email, action, entity, entity_id, label, source').order('at', { ascending: false }).limit(15))),
      E.settle(E.rows(sb.from('lead_inbox').select('id, kind, created_at, name, source').order('created_at', { ascending: false }).limit(8))),
      E.settle(E.rows(sb.from('applicants').select('id, name, track, created_at').order('created_at', { ascending: false }).limit(8))),
      E.settle(E.rows(sb.from('network_profiles').select('id, name, company_name, created_at').order('created_at', { ascending: false }).limit(8)))
    ]).then(function (r) {
      var list = [], broken = 0;
      var each = function (x, fn) { if (x.e) { broken++; return; } x.v.forEach(function (it) { list.push(fn(it)); }); };
      each(r[0], function (a) {
        return { at: a.at, href: HREF[a.entity] && a.entity_id ? HREF[a.entity](a.entity_id) : null,
          text: (a.actor_email || 'Someone') + ' ' + a.action + ' \u201c' + (a.label || 'an item') + '\u201d',
          sub: [KIND[a.entity], a.source === 'sheet' ? 'in the Sheet' : null].filter(Boolean).join(' \u00b7 ') };
      });
      each(r[1], function (l) {
        return { at: l.created_at, href: '#leads/' + l.id, text: 'New lead from ' + l.name,
          sub: l.kind === 'website' ? 'Website form' : (E.SOURCES[l.source] || l.source) + ', added by hand' };
      });
      each(r[2], function (a) {
        return { at: a.created_at, href: '#applicants/' + a.id, text: 'New ' + (a.track === 'internship' ? 'internship' : 'team') + ' application from ' + a.name, sub: 'Careers page' };
      });
      each(r[3], function (p) { return { at: p.created_at, href: '#network/' + p.id, text: 'Network sign-up from ' + (p.company_name || p.name), sub: 'Careers page' }; });
      list.sort(function (a, b) { return new Date(b.at) - new Date(a.at); });
      ul.innerHTML = '';
      list.slice(0, 12).forEach(function (it) {
        ul.appendChild(h('li', {}, h(it.href ? 'a' : 'span', { class: 't', href: it.href }, it.text, it.sub ? h('span', { class: 'sub', text: it.sub }) : null),
          h('span', { class: 'w', text: E.shortStamp(it.at), title: E.stamp(it.at) })));
      });
      if (!list.length && !broken) ul.appendChild(h('li', { class: 'eco-empty', text: 'No activity yet.' }));
      if (broken) ul.appendChild(h('li', { class: 'eco-err', text: 'Part of the activity couldn\u2019t be loaded. Reload to try again.' }));
    });
  }

  A.loaders.overview = function () {
    build();
    showAll = false;
    waitList(box.needs);
    var wk = new Date(Date.now() - 7 * 864e5).toISOString();
    var r = {
      flow: E.settle(E.data.flow(true)), projects: E.settle(E.data.projects()), money: E.settle(E.data.money()),
      docs: E.settle(E.data.docs()), kas: E.settle(E.data.kas()), portfolio: E.settle(E.data.portfolio()),
      leads: E.settle(E.rows(sb.from('lead_inbox').select('id, kind, created_at, name, company, about, description, budget').eq('status', 'new').order('created_at').limit(20))),
      applicants: E.settle(E.rows(sb.from('applicants').select('id, name, track, created_at').eq('status', 'new').order('created_at').limit(10))),
      network: E.settle(E.rows(sb.from('network_profiles').select('id, name, company_name, created_at').eq('status', 'new').order('created_at').limit(10))),
      drafts: E.settle(E.rows(sb.from('portfolio_items').select('id, title, updated_at').eq('status', 'draft').lt('updated_at', wk).order('updated_at').limit(6)))
    };
    var keys = Object.keys(r);
    if (!box.flow.children.length) box.flow.appendChild(h('p', { class: 'eco-wait', text: 'Loading\u2026' }));
    Promise.all([r.flow, r.projects]).then(function (x) { if (x[0].e) stripError(x[0].e); else strip(x[0].v, x[1].v); });
    Promise.all(keys.map(function (k) { return r[k]; })).then(function (vals) {
      var got = {}; keys.forEach(function (k, i) { got[k] = vals[i]; });
      needs(got); active(got);
    });
    activity();
  };
})();
