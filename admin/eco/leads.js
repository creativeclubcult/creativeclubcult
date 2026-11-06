/* Leads: website messages (inquiries) and leads added by hand (manual_leads), one list through lead_inbox.
   As in the approved mockup: status tabs over a list of rows, or a board by stage. A lead can carry a next step and a day
   for it; the Overview and the calendar show those. Only owners and admins see leads, and the database checks the same. */
(function () {
  'use strict';
  if (!window.cccAdmin) return; // admin.js stopped early: the sign in library didn't load
  var A = window.cccAdmin, E = window.eco, sb = A.sb, h = A.h, I = A.icon;
  var panel = A.$('[data-panel="leads"]');
  var STATUS = [['new', 'New'], ['replied', 'Replied'], ['in progress', 'In progress'], ['quoted', 'Quote sent'], ['won', 'Won'], ['lost', 'Lost'], ['spam', 'Spam']];
  var LABEL = {};
  STATUS.forEach(function (s) { LABEL[s[0]] = s[1]; });
  var TONE = { 'new': 'new', replied: 'draft', 'in progress': 'busy', quoted: 'sent', won: 'deal', lost: 'off', spam: 'off' };
  var TABS = [['open', 'Open'], ['won', 'Won'], ['lost', 'Lost'], ['spam', 'Spam'], ['all', 'All']];
  var LANES = [['new', 'New', ['new']], ['talk', 'Talking', ['replied', 'in progress']], ['quoted', 'Quote sent', ['quoted']],
    ['won', 'Won', ['won']], ['lost', 'Lost', ['lost']]];
  var EMPTY = { won: 'No won leads yet.', lost: 'No lost leads.', spam: 'No spam.', all: 'No leads yet.' };
  var MANUAL = ['whatsapp', 'instagram', 'referral', 'email', 'phone', 'event', 'other'];
  var EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  var COLS = 'kind, id, created_at, name, company, email, phone, about, description, budget, status, source, instagram, next_step, next_step_on';
  var PAGE = 100, OPEN_MAX = 200, LANE_SHOW = 30, CLOSED_SHOW = 8, KEY = 'ccc.admin.leads.view';
  var ui = null, from = 0, turn = 0, tab = 'open', view = 'list';
  try { if (localStorage.getItem(KEY) === 'board') view = 'board'; } catch (e) { /* storage blocked: the list it is */ }

  var gone = function () { A.toast('That lead isn’t there any more.', true); };
  var sourceOf = function (l) { return l.kind === 'website' ? 'Website' : (E.SOURCES[l.source] || l.source || ''); };
  var isOpen = function (st) { return E.OPEN_LEAD.indexOf(st) > -1; };
  var other = function (l) { return l.company && E.words(l.company).trim() !== E.words(l.name).trim() ? l.company : null; };
  // rows and cards are real links (a new tab works); a plain click opens the lead here without reloading the list
  var go = function (id) {
    return function (e) {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button) return;
      e.preventDefault(); open(id);
    };
  };
  // the next step, with when it is due first so a narrow row never cuts the day off: "Today: Send the quote"
  var dueIn = function (l) { return l.next_step_on ? E.days(E.today(), l.next_step_on) : null; };
  function nextLine(l, tag) {
    if (!isOpen(l.status) || !(l.next_step || l.next_step_on)) return null;
    var k = dueIn(l);
    var when = k == null ? 'Next' : k < 0 ? E.plural(-k, 'day') + ' late' : k === 0 ? 'Today' : k === 1 ? 'Tomorrow' : E.when(l.next_step_on);
    return h(tag || 'span', { class: 'nx' }, h('em', { class: k == null ? null : k < 0 ? 'late' : k <= 1 ? 'soon' : null, text: when + ':' }),
      ' ' + (l.next_step || 'Follow up'));
  }

  // ---------- the page ----------
  function build() {
    if (ui) return;
    ui = {
      tabs: h('div', { class: 'tabs', role: 'group', 'aria-label': 'Status' }),
      tab: {},
      q: h('input', { type: 'search', placeholder: 'Search name, company, email, phone', 'aria-label': 'Search leads', autocomplete: 'off' }),
      source: A.select([['', 'Any source'], ['website', 'Website']].concat(MANUAL.map(function (s) { return [s, E.SOURCES[s]]; })), '',
        { class: 'field', 'aria-label': 'Source' }),
      count: h('span', { class: 'muted' }),
      note: h('p', { class: 'lnote', hidden: true }),
      list: h('ul', { class: 'llist' }),
      board: h('div', { class: 'board lboard' }),
      more: h('button', { class: 'btn adm-more', type: 'button', hidden: true, onclick: function () { loadList(true); } }, 'Load more')
    };
    TABS.forEach(function (t) {
      ui.tab[t[0]] = h('button', { type: 'button', 'aria-pressed': String(t[0] === tab), onclick: function () {
        if (tab === t[0]) return;
        tab = t[0]; press(); load();
      } }, t[1], h('span', { class: 'c' }));
      ui.tabs.appendChild(ui.tab[t[0]]);
    });
    ui.q.addEventListener('input', E.debounce(function () { load(); }));
    ui.source.addEventListener('change', function () { load(); });
    A.add(panel, h('section', { class: 'card tablecard leads', 'aria-label': 'Leads' },
      h('div', { class: 'bar' }, ui.tabs, h('label', { class: 'field' }, I('search', 's'), ui.q), ui.source, ui.count),
      ui.note, ui.list, ui.board, ui.more));
  }
  function press() {
    TABS.forEach(function (t) { ui.tab[t[0]].setAttribute('aria-pressed', String(t[0] === tab)); });
  }
  // the search and the source apply to the list and the board alike
  function filter(q) {
    var t = E.search(ui.q.value);
    if (ui.source.value) q = q.eq('source', ui.source.value);
    if (t) q = q.or(['name', 'company', 'email', 'phone'].map(function (c) { return c + '.ilike."*' + t + '*"'; }).join(','));
    return q;
  }
  var inTab = function (q, t) { return t === 'open' ? q.in('status', E.OPEN_LEAD) : t === 'all' ? q : q.eq('status', t); };
  var filtered = function () { return !!(ui.q.value.trim() || ui.source.value); };
  function load() {
    build();
    var list = view === 'list';
    ui.tabs.hidden = !list; ui.count.hidden = !list; ui.list.hidden = !list; ui.board.hidden = list;
    ui.more.hidden = true; ui.note.hidden = true;
    if (list) loadList(false); else loadBoard();
  }
  function setView(v) {
    if (view === v) return;
    view = v;
    try { localStorage.setItem(KEY, v); } catch (e) { /* storage blocked: the choice lasts until reload */ }
    A.$$('[data-lview]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-lview') === v)); });
    load();
  }
  var waiting = function (box) { box.innerHTML = ''; box.appendChild(h(box === ui.list ? 'li' : 'div', { class: 'lempty' }, h('p', { class: 'empty', text: 'Loading leads…' }))); };
  function broke(box, e) {
    box.innerHTML = '';
    box.appendChild(h(box === ui.list ? 'li' : 'div', { class: 'lempty' }, h('p', { class: 'empty eco-err', text: E.ecoError(e) }),
      h('button', { class: 'btn sm', type: 'button', onclick: function () { load(); } }, 'Try again')));
  }

  // ---------- list ----------
  // each tab's count follows the search and the source; a count that fails shows nothing, never 0
  function counts(mine) {
    TABS.forEach(function (t) {
      var c = ui.tab[t[0]].querySelector('.c');
      inTab(filter(sb.from('lead_inbox').select('id', { count: 'exact', head: true })), t[0]).then(function (r) {
        if (mine === turn) c.textContent = r.error ? '' : String(r.count || 0);
      }, function () { if (mine === turn) c.textContent = ''; });
    });
  }
  function loadList(more) {
    var mine = more ? turn : ++turn, at = more ? from : 0;
    if (more) ui.more.disabled = true; else { waiting(ui.list); counts(mine); }
    inTab(filter(sb.from('lead_inbox').select(COLS, { count: 'exact' })), tab).order('created_at', { ascending: false })
      .range(at, at + PAGE - 1).then(function (r) {
        ui.more.disabled = false;
        if (mine !== turn) return;   // a newer search is on its way
        if (r.error) { if (more) E.failed(r.error); else broke(ui.list, r.error); return; }
        if (!more) ui.list.innerHTML = '';
        (r.data || []).forEach(function (l) { ui.list.appendChild(h('li', {}, row(l))); });
        from = at + (r.data || []).length;
        if (!from) ui.list.appendChild(h('li', { class: 'lempty' }, h('p', { class: 'empty', text: emptyText() })));
        ui.count.textContent = E.plural(r.count || 0, 'lead');
        ui.more.hidden = from >= (r.count || 0);
      }, function (e) {
        ui.more.disabled = false;
        if (mine === turn) { if (more) E.failed(e); else broke(ui.list, e); }
      });
  }
  function emptyText() {
    if (filtered()) return 'No leads match these filters.';
    if (tab === 'open') return 'No open leads. Messages from the website land here by themselves.' + (A.canEdit() ? ' Add leads from WhatsApp or Instagram with Add lead.' : '');
    return EMPTY[tab];
  }
  function row(l) {
    var co = other(l);
    return h('a', { class: 'lr', href: '#leads/' + l.id, onclick: go(l.id) },
      h('span', { class: 'av', 'aria-hidden': 'true', text: E.initial(l.name) }),
      h('div', { class: 'who' }, h('b', {}, l.name, co ? h('i', { text: co }) : null),
        nextLine(l) || h('span', { text: E.clip(l.description || l.about || '', 140) })),
      h('span', { class: 'pill ' + (TONE[l.status] || 'off'), text: LABEL[l.status] || l.status }),
      h('div', { class: 'meta' },
        h('span', { class: 'bud' + (l.budget ? '' : ' none'), text: l.budget || 'No budget given' }),
        h('span', { class: 'via', text: sourceOf(l) }),
        h('time', { datetime: E.jkt(l.created_at), text: E.shortStamp(l.created_at) })),
      I('chev', 'chev'));
  }

  // ---------- board ----------
  // every open lead (by when its next step is due), and the newest won and lost ones
  function loadBoard() {
    var mine = ++turn;
    waiting(ui.board);
    var q = function () { return filter(sb.from('lead_inbox').select(COLS, { count: 'exact' })).order('created_at', { ascending: false }); };
    var safe = function (p) { return p.then(function (r) { return r; }, function (e) { return { error: e }; }); };
    Promise.all([safe(q().in('status', E.OPEN_LEAD).limit(OPEN_MAX)), safe(q().eq('status', 'won').limit(CLOSED_SHOW)),
      safe(q().eq('status', 'lost').limit(CLOSED_SHOW))]).then(function (r) {
      if (mine !== turn) return;
      var bad = r.filter(function (x) { return x.error; })[0];
      if (bad) return broke(ui.board, bad.error);
      var open = r[0].data || [], total = { won: r[1].count || 0, lost: r[2].count || 0 }, closed = { won: r[1].data || [], lost: r[2].data || [] };
      ui.board.innerHTML = '';
      if (!filtered() && !open.length && !total.won && !total.lost) {
        ui.board.appendChild(h('div', { class: 'lempty' }, h('p', { class: 'empty', text: emptyTextBoard() })));
        return;
      }
      if ((r[0].count || 0) > open.length) {
        ui.note.hidden = false;
        ui.note.textContent = 'Showing the newest ' + open.length + ' open leads. The list has all ' + r[0].count + '.';
      }
      if (!open.length && !total.won && !total.lost) {
        ui.board.appendChild(h('div', { class: 'lempty' }, h('p', { class: 'empty', text: 'No leads match these filters.' })));
        return;
      }
      LANES.forEach(function (ln) {
        var shut = ln[0] === 'won' || ln[0] === 'lost';
        var items = shut ? closed[ln[0]] : open.filter(function (l) { return ln[2].indexOf(l.status) > -1; }).sort(byDue);
        var n = shut ? total[ln[0]] : items.length;
        var shown = items.slice(0, shut ? CLOSED_SHOW : LANE_SHOW);
        var lane = h('section', { class: 'lane', 'aria-label': ln[1] + ', ' + E.plural(n, 'lead') },
          h('h3', { class: 'lane-h' }, ln[1], h('span', { class: 'c', 'aria-hidden': 'true', text: String(n) })));
        shown.forEach(function (l) { lane.appendChild(card(l, ln[0] === 'talk')); });
        if (!n) lane.appendChild(h('p', { class: 'none', text: 'No leads here' }));
        if (n > shown.length) {
          var t = shut ? ln[0] : 'open';
          lane.appendChild(h('button', { class: 'btn sm quiet lane-more', type: 'button', onclick: function () { tab = t; press(); setView('list'); } },
            'See all ' + n + ' in the list'));
        }
        ui.board.appendChild(lane);
      });
    });
  }
  // the step due soonest first, so the most overdue lead tops its lane; leads with no date after, newest first
  function byDue(a, b) {
    var x = a.next_step_on || '9999', y = b.next_step_on || '9999';
    return x < y ? -1 : x > y ? 1 : (a.created_at < b.created_at ? 1 : -1);
  }
  function emptyTextBoard() {
    return 'No leads yet. Messages from the website land here by themselves.' + (A.canEdit() ? ' Add leads from WhatsApp or Instagram with Add lead.' : '');
  }
  function card(l, talk) {
    var co = other(l);
    return h('a', { class: 'ac lc', href: '#leads/' + l.id, onclick: go(l.id) },
      h('div', { class: 'ac-t' }, h('span', { class: 'av', 'aria-hidden': 'true', text: E.initial(l.name) }),
        h('div', {}, h('b', { text: l.name }), h('span', { text: [co, sourceOf(l)].filter(Boolean).join(', ') }))),
      nextLine(l, 'p'),
      talk || l.budget ? h('div', { class: 'ac-m' }, talk ? h('span', { class: 'tag', text: LABEL[l.status] }) : null,
        l.budget ? h('span', { class: 'tag', text: l.budget }) : null) : null);
  }

  // ---------- one lead ----------
  function open(id) {
    if (!E.isId(id)) return gone();
    sb.from('lead_inbox').select('id, kind').eq('id', id).maybeSingle().then(function (r) {
      if (r.error) return E.failed(r.error);
      if (!r.data) return gone();
      var web = r.data.kind === 'website';
      return Promise.all([
        sb.from(web ? 'inquiries' : 'manual_leads').select('*').eq('id', id).maybeSingle(),
        sb.from('projects').select('id, seq, tab_name, title, plan_title, plan_client, client_label, sheet_state, status, archived_at')
          .or('inquiry_id.eq.' + id + ',manual_lead_id.eq.' + id)
      ]).then(function (res) {
        if (res[0].error) return E.failed(res[0].error);
        if (!res[0].data) return gone();
        var l = res[0].data; l.kind = r.data.kind;
        show(l, res[1]);
      });
    }).catch(E.failed);
  }
  function show(l, pr) {
    var web = l.kind === 'website', ro = !A.canEdit(), pick = l.status;
    var step = h('input', { type: 'text', maxlength: 160, value: l.next_step || '', placeholder: 'Send the quote', autocomplete: 'off', disabled: ro });
    var on = h('input', { type: 'date', value: l.next_step_on || '', disabled: ro });
    var notes = h('textarea', { value: l.notes || '', placeholder: 'Notes for the team', maxlength: 4000, disabled: ro });
    var chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Lead status' });
    STATUS.forEach(function (s) {
      chips.appendChild(h('button', { type: 'button', 'aria-pressed': String(s[0] === pick), 'data-v': s[0], disabled: ro, onclick: function () {
        pick = s[0];
        A.$$('button', chips).forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-v') === pick)); });
        nextSec.hidden = !isOpen(pick);
      } }, s[1]));
    });
    var dirty = function () {
      return pick !== l.status || (notes.value.trim() || null) !== (l.notes || null) ||
        (step.value.trim() || null) !== (l.next_step || null) || (on.value || null) !== (l.next_step_on || null);
    };
    var save = h('button', { class: 'btn', type: 'button', disabled: ro, onclick: function () { put(false); } }, 'Save');
    var done = h('button', { class: 'btn sm', type: 'button', hidden: ro || !(l.next_step || l.next_step_on), onclick: function () { put(true); } },
      I('check', 's'), 'Mark done');
    // Mark done clears the step and saves the rest of the form with it
    function put(finish) {
      var next = { status: pick, notes: notes.value.trim() || null,
        next_step: finish ? null : step.value.trim() || null, next_step_on: finish ? null : on.value || null };
      save.disabled = done.disabled = true;
      sb.from(web ? 'inquiries' : 'manual_leads').update(next).eq('id', l.id).select('id').then(function (r) {
        save.disabled = done.disabled = false;
        if (r.error) return E.failed(r.error);
        if (!r.data || !r.data.length) return A.toast('Your account isn’t allowed to change this lead.', true);
        Object.assign(l, next);
        if (finish) { step.value = ''; on.value = ''; step.focus(); }
        done.hidden = !(l.next_step || l.next_step_on);
        A.toast(finish ? 'Step done. Add the next one when you know it.' : 'Saved.');
        E.forget(); A.refreshBadges();
        if (ui && !panel.hidden) load();
      }, function (e) { save.disabled = done.disabled = false; E.failed(e); });
    }

    // ways to answer: the one they came in by is the main button
    var ig = String(l.instagram || '').replace(/^@+/, '').replace(/[^A-Za-z0-9._]/g, ''), wa = E.wa(l.phone);
    var reach = [];
    if (l.email) reach.push(['email', h('a', { class: 'btn', href: 'mailto:' + l.email }, I('mail', 's'), 'Reply by email')]);
    if (wa) reach.push(['whatsapp', h('a', { class: 'btn', href: wa, target: '_blank', rel: 'noopener noreferrer' }, I('chat', 's'), 'Open WhatsApp')]);
    if (ig) reach.push(['instagram', h('a', { class: 'btn', href: 'https://instagram.com/' + ig, target: '_blank', rel: 'noopener noreferrer' }, I('ext', 's'), 'Open Instagram')]);
    var via = web ? { Email: 'email', WhatsApp: 'whatsapp', 'Instagram DM': 'instagram' }[l.preferred_contact] : l.source;
    var main = reach.filter(function (x) { return x[0] === via; })[0] || reach[0];
    if (main) main[1].classList.add('lime');

    var projects;
    if (pr.error) projects = h('p', { class: 'empty eco-err', text: E.ecoError(pr.error) });
    else if (!(pr.data || []).length) projects = h('p', { class: 'empty', text: 'No project for this lead yet.' });
    else {
      projects = h('ul', { class: 'rlist' }, pr.data.map(function (p) {
        var title = p.sheet_state === 'none' ? p.plan_title : (p.title || p.tab_name);
        return h('li', {}, h('a', { class: 'r', href: '#projects/' + p.id },
          h('div', {}, h('b', { text: title || E.short(p) }), title ? h('span', { text: E.short(p) }) : null), E.stage(E.phase(p)), I('chev', 's')));
      }));
    }
    var start = ro ? null : h('button', { class: 'btn sm', type: 'button', onclick: function () {
      if (dirty()) return A.toast('Save this lead first, then start the project.', true);
      E.newProject({ lead: l });
    } }, I('plus', 's'), 'Start a project');

    var nextSec = E.dsec('Next step', done,
      h('div', { class: 'f2' }, h('label', { class: 'f' }, 'What to do', step), h('label', { class: 'f' }, 'When', on)));
    nextSec.hidden = !isOpen(pick);
    E.drawer('leads', l.id, [
      E.dhead(h('span', { class: 'av lead', 'aria-hidden': 'true', text: E.initial(l.name) }), l.name, other(l),
        [web ? 'Website form' : sourceOf(l) + ', added by hand', [I('clock'), E.stamp(l.created_at)]]),
      h('div', { class: 'dr-body' },
        E.dsec(web ? 'Message' : 'What they want', null,
          l.description ? h('blockquote', { class: 'quote pre', text: l.description }) : h('p', { class: 'empty', text: 'Nothing written down yet.' }),
          reach.length ? h('div', { class: 'formacts' }, reach.map(function (x) { return x[1]; })) : null),
        E.dsec('Status', null, chips),
        nextSec,
        E.dsec('Notes', null, h('label', { class: 'f' }, h('span', { class: 'sr', text: 'Notes' }), notes),
          h('div', { class: 'formacts' }, save, ro ? h('span', { class: 'muted', text: 'Viewers can read only.' }) : null)),
        E.dsec('Details', null, E.props([
          ['Email', E.mailLink(l.email)], ['WhatsApp', E.phoneLink(l.phone)], ['Instagram', E.igLink(l.instagram)],
          ['Reach them via', web ? l.preferred_contact : null], ['About', web ? l.inquiry_type : null], ['Timeline', web ? l.timeline : null],
          ['Budget', l.budget || E.quiet('Not given')], ['Sent from', web ? l.page : null], ['Came in', E.stamp(l.created_at)],
          ['Updated', !web && l.updated_at && l.updated_at !== l.created_at ? E.stamp(l.updated_at) : null]
        ])),
        E.dsec('Projects', start, projects))
    ]);
    A.guard(dirty);
  }

  // ---------- add a lead (editors) ----------
  function addLead() {
    if (!A.canEdit()) return;
    var f = {
      source: A.select(MANUAL.map(function (s) { return [s, E.SOURCES[s]]; }), 'whatsapp'),
      name: h('input', { type: 'text', maxlength: 120, autocomplete: 'off' }),
      company: h('input', { type: 'text', maxlength: 160, autocomplete: 'off' }),
      phone: h('input', { type: 'tel', maxlength: 40, autocomplete: 'off', placeholder: '0812 3456 7890' }),
      instagram: h('input', { type: 'text', maxlength: 80, autocomplete: 'off', placeholder: '@handle' }),
      email: h('input', { type: 'email', maxlength: 254, autocomplete: 'off' }),
      description: h('textarea', { maxlength: 5000, placeholder: 'What they want, in their words' }),
      budget: h('input', { type: 'text', maxlength: 60, autocomplete: 'off', placeholder: '50 to 150M IDR' }),
      next_step: h('input', { type: 'text', maxlength: 160, autocomplete: 'off', placeholder: 'Send the quote' }),
      next_step_on: h('input', { type: 'date' })
    };
    var val = function (k) { return f[k].value.trim(); };
    var msg = h('p', { class: 'adm-msg', role: 'status' });
    var say = function (t, err) { msg.textContent = t; msg.classList.toggle('is-error', !!err); };
    var btn = h('button', { class: 'btn lime', type: 'button', onclick: function () {
      var row = { source: f.source.value, name: val('name'), company: val('company') || null, phone: val('phone') || null,
        instagram: val('instagram').replace(/^@+/, '') || null, email: val('email') || null,
        description: val('description') || null, budget: val('budget') || null,
        next_step: val('next_step') || null, next_step_on: f.next_step_on.value || null };
      var bad = !row.name ? 'Give the lead a name.'
        : !(row.phone || row.instagram || row.email) ? 'Add a phone number, Instagram or email, so the team can reach them.'
        : row.email && !EMAIL.test(row.email) ? 'That email doesn’t look right.' : '';
      if (bad) return say(bad, true);
      btn.disabled = true; say('Saving…');
      sb.from('manual_leads').insert(row).select('id').single().then(function (r) {
        btn.disabled = false;
        if (r.error) return say(E.ecoError(r.error), true);
        A.toast('Lead added.'); E.forget(); A.refreshBadges();
        A.closeDrawer(true);
        if (!panel.hidden) { load(); open(r.data.id); } else location.hash = '#leads/' + r.data.id;
      });
    } }, 'Add lead');
    var field = function (label, el, wide) { return h('label', { class: wide ? 'wide' : null }, label, el); };
    E.drawer(null, null, [
      h('h2', { text: 'Add lead' }),
      h('p', { class: 'lead-line', text: 'For leads from WhatsApp, Instagram, referrals and the like. Website messages are added by themselves.' }),
      h('div', { class: 'adm-sec eco-form' }, h('div', { class: 'adm-controls' },
        field('Came in by', f.source), field('Name', f.name), field('Company', f.company), field('Phone or WhatsApp', f.phone),
        field('Instagram', f.instagram), field('Email', f.email), field('What they want', f.description, true), field('Budget', f.budget),
        field('Next step', f.next_step), field('When', f.next_step_on)),
        h('div', { class: 'adm-row' }, btn, msg))
    ]);
    A.guard(function () { return Object.keys(f).some(function (k) { return k !== 'source' && val(k); }); });
    f.name.focus();
  }
  E.addLead = addLead;

  // the header: List or Board, and Add lead
  A.actions.leads = function () {
    var b = function (v, icon, label) {
      return h('button', { type: 'button', 'data-lview': v, 'aria-pressed': String(view === v), onclick: function () { setView(v); } }, I(icon, 's'), label);
    };
    return [h('div', { class: 'tabs lview', role: 'group', 'aria-label': 'Show leads as' }, b('list', 'list', 'List'), b('board', 'board', 'Board')),
      A.canEdit() ? h('button', { class: 'btn lime', type: 'button', onclick: addLead }, I('plus', 's'), 'Add lead') : null];
  };
  A.loaders.leads = function () { load(); };
  A.openers.leads = open;
})();
