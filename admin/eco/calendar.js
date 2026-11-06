/* The Calendar: one month of shoot days, final files due, payments due (only with money access) and lead follow ups
   (only owners and admins read leads; the database checks the same), all from E.events. A laptop sees the month as a
   grid, where a shoot of several days is one bar; a tablet or phone sees a list of the days that have something on.
   The month sits in the address (#calendar/2026-12), so Back from a project lands on the same month. Filters: one
   project, or one crew member. */
(function () {
  'use strict';
  if (!window.cccAdmin) return; // admin.js stopped early: the sign in library didn't load
  var A = window.cccAdmin, E = window.eco, sb = A.sb, h = A.h, I = A.icon;
  var panel = A.$('[data-panel="calendar"]');
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  var RANK = { shoot: 0, deliver: 1, pay: 2, follow: 3 };
  // a week shows this many rows of bars; past that, each day says how many more it has
  var LANES = 3;
  var ui = null, loaded = null, month = null, pick = { project: '', crew: '' }, wide = {}, gen = 0;

  // ---------- months and days (YYYY-MM and YYYY-MM-DD, as the Sheet keeps them) ----------
  var ym = function (d) { return d.slice(0, 7); };
  var first = function (m) { return m + '-01'; };
  var shift = function (m, k) {
    var y = +m.slice(0, 4), mo = +m.slice(5, 7) - 1 + k;
    y += Math.floor(mo / 12); mo = ((mo % 12) + 12) % 12;
    return y + '-' + ('0' + (mo + 1)).slice(-2);
  };
  var last = function (m) { return E.addDays(first(shift(m, 1)), -1); };
  var mname = function (m) { return MONTHS[+m.slice(5, 7) - 1]; };
  var monthName = function (m) { return mname(m) + ' ' + m.slice(0, 4); };
  var monthsTo = function (d) { return (+d.slice(0, 4) - +month.slice(0, 4)) * 12 + (+d.slice(5, 7) - +month.slice(5, 7)); };
  // the Monday of the week a day falls in
  var monday = function (d) { var wd = new Date(d + 'T00:00:00Z').getUTCDay(); return E.addDays(d, -((wd + 6) % 7)); };
  var long = function (d) { return E.day(d, { weekday: true, year: false }); };
  var span = function (ev) { return ev.end !== ev.start ? long(ev.start) + ' to ' + long(ev.end) : long(ev.start); };
  var kind = function (ev) { return E.EVENT[ev.type].label + (ev.tent ? ', not confirmed' : ''); };
  // what a bar or a row says to a screen reader: "Shoot. Fri 7 Nov to Sun 9 Nov. Senja, 015 Brand Shoot."
  var label = function (ev) { return kind(ev) + '. ' + span(ev) + '. ' + ev.title + (ev.sub ? ', ' + ev.sub : '') + '.' + (ev.late ? ' Late.' : ''); };

  function monthFromHash() {
    var p = (location.hash || '').slice(1).split('/');
    return p[0] === 'calendar' && /^\d{4}-(0[1-9]|1[0-2])$/.test(p[1] || '') ? p[1] : ym(E.today());
  }
  function go(k) {
    month = k === 0 ? ym(E.today()) : shift(month, k);
    wide = {};
    // the month replaces the address in place, so Back still goes to where the person was before the calendar
    history.replaceState(null, '', '#calendar' + (month === ym(E.today()) ? '' : '/' + month));
    draw();
  }

  // ---------- the page ----------
  function build() {
    if (ui) return;
    ui = {
      title: h('h2', { 'aria-live': 'polite' }),
      prev: h('button', { class: 'btn ico', type: 'button', 'aria-label': 'Previous month', onclick: function () { go(-1); } }, I('chev', 'back')),
      next: h('button', { class: 'btn ico', type: 'button', 'aria-label': 'Next month', onclick: function () { go(1); } }, I('chev')),
      now: h('button', { class: 'btn', type: 'button', onclick: function () { go(0); } }, 'Today'),
      project: A.select([['', 'All projects']], '', { class: 'field', 'aria-label': 'Project' }),
      crew: A.select([['', 'All crew']], '', { class: 'field', 'aria-label': 'Crew member' }),
      key: h('ul', { class: 'cal-key', 'aria-label': 'Legend' }),
      note: h('div', { class: 'cal-note' }),
      grid: h('div', { class: 'cal-grid', role: 'group' }),
      list: h('div', { class: 'cal-ag' })
    };
    ui.project.addEventListener('change', function () { pick.project = ui.project.value; wide = {}; draw(); });
    ui.crew.addEventListener('change', function () { pick.crew = ui.crew.value; wide = {}; draw(); });
    A.add(panel, h('section', { class: 'card cal', 'aria-label': 'Calendar' },
      h('div', { class: 'cal-h' }, ui.title, h('div', { class: 'cal-nav' }, ui.prev, ui.now, ui.next),
        h('div', { class: 'cal-f' }, ui.project, ui.crew)),
      ui.key, ui.note, ui.grid, ui.list));
  }

  // the kinds of date this person can see
  function legend() {
    var items = [['shoot', 'Shoot'], ['tent', 'Shoot, not confirmed'], ['deliver', 'Files due']]
      .concat(A.canMoney() ? [['pay', 'Payment due']] : [], A.canEdit() ? [['follow', 'Follow up']] : [], [['late', 'Late']]);
    ui.key.innerHTML = '';
    items.forEach(function (it) {
      var ic = it[0] === 'late' ? null : I(it[0] === 'tent' ? 'camera' : E.EVENT[it[0]].icon);
      ui.key.appendChild(h('li', {}, h('span', { class: 'sw ' + it[0] }, ic), it[1]));
    });
  }

  function load() {
    build();
    month = monthFromHash();
    legend();
    var mine = ++gen;
    ui.title.textContent = monthName(month);
    ui.grid.innerHTML = ''; ui.list.innerHTML = ''; ui.note.innerHTML = '';
    ui.note.appendChild(h('p', { class: 'quiet', text: 'Loading the calendar…' }));
    var leads = A.canEdit()
      ? E.settle(E.rows(sb.from('lead_inbox').select('id, name, status, next_step, next_step_on').in('status', E.OPEN_LEAD)
        .not('next_step_on', 'is', null).order('next_step_on').limit(1000)))
      : Promise.resolve({ v: [] });
    Promise.all([E.settle(E.data.projects()), E.settle(E.data.money()), leads]).then(function (r) {
      if (mine !== gen) return;
      if (r[0].e) {
        loaded = null;
        ui.note.innerHTML = '';
        ui.note.appendChild(h('div', { class: 'cal-err' }, h('p', { class: 'quiet is-err', text: E.ecoError(r[0].e) }),
          h('button', { class: 'btn sm', type: 'button', onclick: function () { E.forget(); load(); } }, 'Try again')));
        return;
      }
      loaded = { projects: r[0].v, list: E.events(r[0].v, r[1].v || {}, r[2].v || []), noMoney: !!r[1].e, noLeads: !!r[2].e };
      filters();
      draw();
    });
  }

  // the filters offer what has a date: the projects (by client) and the crew booked on them
  function filters() {
    var seen = {}, crew = {}, opts = [];
    loaded.list.forEach(function (ev) {
      if (ev.pid) seen[ev.pid] = true;
      (ev.crew || []).forEach(function (c) { crew[c] = true; });
    });
    loaded.projects.forEach(function (p) { if (seen[p.id]) opts.push([p.id, E.clientName(p) + ', ' + E.projectLine(p)]); });
    opts.sort(function (a, b) { return a[1].localeCompare(b[1]); });
    var names = Object.keys(crew).sort(function (a, b) { return a.localeCompare(b); });
    if (!seen[pick.project]) pick.project = '';
    if (!crew[pick.crew]) pick.crew = '';
    fill(ui.project, [['', 'All projects']].concat(opts), pick.project);
    fill(ui.crew, [['', 'All crew']].concat(names.map(function (c) { return [c, c]; })), pick.crew);
    ui.project.hidden = !opts.length;
    ui.crew.hidden = !names.length;
  }
  function fill(sel, opts, v) {
    sel.innerHTML = '';
    opts.forEach(function (o) { sel.appendChild(h('option', { value: o[0], text: o[1] })); });
    sel.value = v;
  }

  // ---------- one month ----------
  function draw() {
    if (!loaded) return;
    ui.title.textContent = monthName(month);
    var a = first(month), z = last(month), td = E.today();
    var list = loaded.list.filter(function (ev) {
      return (!pick.project || ev.pid === pick.project) && (!pick.crew || (ev.crew || []).indexOf(pick.crew) > -1);
    }).sort(function (x, y) { return x.start < y.start ? -1 : x.start > y.start ? 1 : RANK[x.type] - RANK[y.type]; });
    var inMonth = list.filter(function (ev) { return ev.end >= a && ev.start <= z; });
    notes(list, inMonth, a, z);
    grid(list, a, z, td);
    agenda(inMonth, a, td);
  }

  // what couldn't be loaded, and what to do when the month is empty
  function notes(list, inMonth, a, z) {
    ui.note.innerHTML = '';
    if (loaded.noMoney) ui.note.appendChild(h('p', { class: 'quiet is-err', text: 'Payment dates couldn’t be loaded, so they are missing here. Reload to try again.' }));
    if (loaded.noLeads) ui.note.appendChild(h('p', { class: 'quiet is-err', text: 'Lead follow ups couldn’t be loaded, so they are missing here. Reload to try again.' }));
    if (inMonth.length) return;
    if (!loaded.list.length) {
      var kinds = ['Shoot days', 'file deadlines'].concat(A.canMoney() ? ['payment dates'] : [], A.canEdit() ? ['lead follow ups'] : []);
      ui.note.appendChild(h('p', { class: 'quiet', text: 'Nothing has a date yet. ' + kinds.slice(0, -1).join(', ') + ' and ' + kinds[kinds.length - 1] + ' show here once they are set.' }));
      return;
    }
    // the nearest month that has something: the next one, or for a filter, the last one
    var who = pick.crew ? ' for ' + pick.crew : pick.project ? ' for this project' : '';
    var next = list.filter(function (ev) { return ev.start > z; })[0];
    var prev = who ? list.filter(function (ev) { return ev.end < a; }).pop() : null;
    var to = next || prev;
    var p = h('p', { class: 'quiet' }, 'Nothing in ' + mname(month) + who + '.');
    if (to) {
      p.appendChild(document.createTextNode(' The ' + (next ? 'next one is' : 'last one was') + ' on ' + E.when(to.start) + '. '));
      p.appendChild(h('button', { class: 'link', type: 'button', onclick: function () { go(monthsTo(to.start)); } }, 'Go to ' + mname(ym(to.start))));
    } else if (who) {
      p.appendChild(document.createTextNode(' '));
      p.appendChild(h('button', { class: 'link', type: 'button', onclick: function () {
        pick.project = ''; pick.crew = ''; ui.project.value = ''; ui.crew.value = ''; draw();
      } }, 'Show everything'));
    }
    ui.note.appendChild(p);
  }

  // the grid: a row per week, Monday first, the bars in rows under the day numbers
  function grid(list, a, z, td) {
    var box = ui.grid, end = E.addDays(monday(z), 6);
    box.innerHTML = '';
    box.setAttribute('aria-label', monthName(month));
    box.appendChild(h('div', { class: 'cal-dow', 'aria-hidden': 'true' }, DOW.map(function (d) { return h('span', { text: d }); })));
    for (var w = 0, wk = monday(a); wk <= end; w++, wk = E.addDays(wk, 7)) box.appendChild(week(list, wk, w, a, z, td));
  }
  function week(list, wk, w, a, z, td) {
    var we = E.addDays(wk, 6);
    // each bar cut to the week, the longest first so the short ones fill the gaps beside them
    var bars = list.filter(function (ev) { return ev.end >= wk && ev.start <= we; }).map(function (ev) {
      return { ev: ev, s: ev.start < wk ? 0 : E.days(wk, ev.start), e: ev.end > we ? 6 : E.days(wk, ev.end), from: ev.start < wk, on: ev.end > we };
    }).sort(function (x, y) { return x.s - y.s || (y.e - y.s) - (x.e - x.s) || RANK[x.ev.type] - RANK[y.ev.type]; });
    var ends = [];
    bars.forEach(function (b) {
      var l = 0;
      while (ends[l] != null && ends[l] >= b.s) l++;
      ends[l] = b.e; b.lane = l;
    });
    // one row too many costs the same space as the "more" line, so it shows
    var cap = wide[w] || ends.length <= LANES + 1 ? ends.length : LANES;
    var hid = [0, 0, 0, 0, 0, 0, 0];
    bars.forEach(function (b) { if (b.lane >= cap) for (var k = b.s; k <= b.e; k++) hid[k]++; });
    var more = hid.some(function (c) { return c > 0; });
    var rows = ['32px'];
    for (var i = 0; i < cap; i++) rows.push('28px');
    if (more) rows.push('26px');
    rows.push('minmax(6px,1fr)');
    var row = h('div', { class: 'cal-wk', style: 'grid-template-rows:' + rows.join(' ') });
    for (var k = 0; k < 7; k++) {
      var d = E.addDays(wk, k), n = +d.slice(8, 10), out = d < a || d > z;
      row.appendChild(h('div', { class: 'cal-d' + (out ? ' out' : '') + (d === td ? ' today' : ''), style: 'grid-column:' + (k + 1), 'aria-hidden': 'true' },
        h('span', { class: 'cal-n', text: n === 1 && out ? E.day(d, { year: false }) : String(n) })));
    }
    bars.filter(function (b) { return b.lane < cap; }).sort(function (x, y) { return x.s - y.s || x.lane - y.lane; }).forEach(function (b) {
      var ev = b.ev, el = h('a', {
        class: 'cal-e ' + ev.type + (ev.tent ? ' tent' : '') + (ev.late ? ' late' : '') + (b.from ? ' from' : '') + (b.on ? ' on' : ''),
        href: ev.href, 'aria-label': label(ev), 'data-s': b.s, 'data-e': b.e, 'data-lane': b.lane,
        style: 'grid-column:' + (b.s + 1) + ' / ' + (b.e + 2) + ';grid-row:' + (b.lane + 2)
      }, I(E.EVENT[ev.type].icon), h('span', { text: ev.title }));
      E.tip(el, kind(ev) + (ev.late ? ', late' : '') + ': ' + ev.title, [ev.sub, ev.end !== ev.start ? span(ev) : null].filter(Boolean).join('. '));
      row.appendChild(el);
    });
    hid.forEach(function (c, k) {
      if (!c) return;
      row.appendChild(h('button', {
        class: 'cal-more', type: 'button', 'aria-expanded': 'false', style: 'grid-column:' + (k + 1) + ';grid-row:' + (cap + 2),
        'aria-label': 'Show ' + c + ' more on ' + long(E.addDays(wk, k)),
        onclick: function () {
          wide[w] = true;
          var fresh = week(list, wk, w, a, z, td);
          row.replaceWith(fresh);
          // focus goes to the first bar of that day that was out of sight
          var shown = A.$$('.cal-e', fresh).filter(function (x) { return +x.getAttribute('data-lane') >= cap && +x.getAttribute('data-s') <= k && +x.getAttribute('data-e') >= k; })[0];
          if (shown) shown.focus();
        }
      }, '+' + c + ' more'));
    });
    return row;
  }

  // the list of days, for a tablet or phone: each thing once, on its first day in the month (a shoot of several days says until when)
  function agenda(inMonth, a, td) {
    var box = ui.list;
    box.innerHTML = '';
    if (!inMonth.length) return;
    var days = {}, order = [];
    inMonth.forEach(function (ev) {
      var d = ev.start < a ? a : ev.start;
      if (!days[d]) { days[d] = []; order.push(d); }
      days[d].push(ev);
    });
    order.sort();
    var item = function (d) {
      var head = d === td ? 'Today, ' + long(d) : E.days(td, d) === 1 ? 'Tomorrow, ' + long(d) : long(d);
      return h('li', { class: 'cal-day' + (d === td ? ' today' : '') }, h('h3', { text: head }),
        h('ul', {}, days[d].map(function (ev) {
          var sub = [ev.sub, ev.end !== ev.start ? 'Until ' + long(ev.end) : null].filter(Boolean).join('. ');
          return h('li', {}, h('a', { class: 'cal-r', href: ev.href, 'aria-label': label(ev) },
            h('span', { class: 'sw ' + ev.type + (ev.tent ? ' tent' : '') + (ev.late ? ' late' : '') }, I(E.EVENT[ev.type].icon)),
            h('span', { class: 'cal-rt' }, h('b', {}, h('em', { text: kind(ev) }), ' ' + ev.title), sub ? h('span', { text: sub }) : null),
            ev.late ? h('span', { class: 'tag red', text: 'Late' }) : null,
            I('chev', 'chev')));
        })));
    };
    // this month starts at today; the days already gone wait behind a button
    var before = ym(td) === month ? order.filter(function (d) { return d < td; }) : [];
    var ol = h('ol', { class: 'cal-days' });
    order.filter(function (d) { return before.indexOf(d) < 0; }).forEach(function (d) { ol.appendChild(item(d)); });
    if (before.length) {
      var earlier = h('button', { class: 'btn sm cal-earlier', type: 'button', onclick: function () {
        var mark = ol.firstChild;
        before.forEach(function (d) { ol.insertBefore(item(d), mark); });
        earlier.remove();
        if (rest) rest.remove();
        var f = ol.querySelector('a'); if (f) f.focus();
      } }, 'Show ' + E.plural(before.length, 'earlier day') + ' this month');
      box.appendChild(earlier);
    }
    var rest = ol.firstChild ? null : h('p', { class: 'quiet', text: 'Nothing else this month.' });
    if (rest) box.appendChild(rest);
    box.appendChild(ol);
  }

  A.loaders.calendar = function () { load(); };
})();
