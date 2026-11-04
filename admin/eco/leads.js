/* Leads: website messages (inquiries) and leads added by hand (manual_leads), one list through lead_inbox.
   Editors change the status and notes, and add leads that came in by WhatsApp, Instagram and the like. */
(function () {
  'use strict';
  var A = window.cccAdmin, E = window.eco, sb = A.sb, h = A.h;
  var panel = A.$('[data-panel="leads"]');
  var STATUS = ['new', 'replied', 'in progress', 'won', 'lost', 'spam'];
  var MANUAL = ['whatsapp', 'instagram', 'referral', 'email', 'phone', 'event', 'other'];
  var EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  var PAGE = 100, ui = null, from = 0, turn = 0;
  var gone = function () { A.toast('That lead isn\u2019t there any more.', true); };
  var sourceOf = function (l) { return l.kind === 'website' ? 'Website' : (E.SOURCES[l.source] || l.source); };

  function build() {
    if (ui) return;
    ui = {
      q: h('input', { type: 'search', placeholder: 'Search name, company, email, phone', 'aria-label': 'Search leads' }),
      status: A.select([['open', 'Open'], ['won', 'Won'], ['lost', 'Lost'], ['spam', 'Spam'], ['', 'All']], 'open', { 'aria-label': 'Status' }),
      source: A.select([['', 'Any source'], ['website', 'Website']].concat(MANUAL.map(function (s) { return [s, E.SOURCES[s]]; })), '', { 'aria-label': 'Source' }),
      count: h('span', { class: 'adm-count' }),
      tbody: h('tbody'),
      more: h('button', { class: 'btn ghost adm-more', type: 'button', hidden: true, onclick: function () { load(true); } }, 'Load more')
    };
    var again = E.debounce(function () { load(false); });
    ui.q.addEventListener('input', again);
    ui.status.addEventListener('change', again);
    ui.source.addEventListener('change', again);
    A.add(panel, [h('div', { class: 'adm-bar' }, ui.q, ui.status, ui.source, ui.count),
      h('div', { class: 'adm-table-wrap' }, h('table', { class: 'adm-table is-stack' }, E.thead(['Date', 'Name', 'About', 'Source', 'Status']), ui.tbody)),
      ui.more]);
  }

  function query() {
    var q = sb.from('lead_inbox').select('*', { count: 'exact' }).order('created_at', { ascending: false });
    var st = ui.status.value, t = E.search(ui.q.value);
    if (st === 'open') q = q.in('status', ['new', 'replied', 'in progress']); else if (st) q = q.eq('status', st);
    if (ui.source.value) q = q.eq('source', ui.source.value);
    if (t) q = q.or(['name', 'company', 'email', 'phone'].map(function (c) { return c + '.ilike."*' + t + '*"'; }).join(','));
    return q;
  }
  function load(more) {
    build();
    var mine = ++turn, at = more ? from : 0;
    if (!more) E.waitRow(ui.tbody, 5);
    query().range(at, at + PAGE - 1).then(function (r) {
      if (mine !== turn) return;   // a newer search is on its way
      if (r.error) { if (more) E.failed(r.error); else E.errRow(ui.tbody, 5, r.error); return; }
      if (!more) ui.tbody.innerHTML = '';
      (r.data || []).forEach(function (l) { ui.tbody.appendChild(row(l)); });
      from = at + (r.data || []).length;
      if (!ui.tbody.children.length) {
        var filtered = ui.q.value.trim() || ui.source.value || ui.status.value !== 'open';
        E.fullRow(ui.tbody, 5, filtered ? 'No leads match these filters.'
          : 'No open leads. Website messages land here by themselves' + (A.canEdit() ? '; add WhatsApp or Instagram leads with Add lead.' : '.'));
      }
      ui.count.textContent = E.plural(r.count || 0, 'lead');
      ui.more.hidden = from >= (r.count || 0);
    });
  }
  function row(l) {
    var about = l.kind === 'website' ? l.about : E.clip(l.description, 70);
    return h('tr', { onclick: function () { open(l.id); } },
      h('td', { class: 'hide-s' }, A.date(l.created_at)),
      h('td', {}, l.name, l.company ? h('span', { class: 'sub', text: l.company }) : null),
      h('td', { class: 'hide-s' }, about || '', l.budget ? h('span', { class: 'sub', text: l.budget }) : null),
      h('td', { class: 'hide-s' }, sourceOf(l)),
      h('td', {}, h('span', { class: 'adm-pill' + (l.status === 'new' ? ' is-new' : ''), text: l.status })),
      h('td', { class: 'only-s' }, [A.date(l.created_at), sourceOf(l), about].filter(Boolean).join(' \u00b7 ')));
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
    var web = l.kind === 'website', ro = !A.canEdit();
    var status = A.select(STATUS, l.status, { disabled: ro });
    var notes = h('textarea', { value: l.notes || '', placeholder: 'Notes for the team', maxlength: 4000, disabled: ro });
    var save = h('button', { class: 'btn', type: 'button', disabled: ro, onclick: function () {
      var next = { status: status.value, notes: notes.value.trim() || null };
      save.disabled = true;
      sb.from(web ? 'inquiries' : 'manual_leads').update(next).eq('id', l.id).select('id').then(function (r) {
        save.disabled = false;
        if (r.error) return E.failed(r.error);
        if (!r.data || !r.data.length) return A.toast('Your account isn\u2019t allowed to change this lead.', true);
        l.status = next.status; l.notes = next.notes;
        A.toast('Saved.'); E.forget(); A.refreshBadges();
        if (ui && !panel.hidden) load(false);
      });
    } }, 'Save');

    var projects;
    if (pr.error) projects = h('p', { class: 'eco-err', text: E.ecoError(pr.error) });
    else if (!(pr.data || []).length) projects = h('p', { class: 'adm-note', text: 'No project for this lead yet.' });
    else {
      projects = h('ul', { class: 'eco-list' }, pr.data.map(function (p) {
        return h('li', {}, h('a', { class: 't', href: '#projects/' + p.id }, E.pname(p)), E.pill(E.phase(p)));
      }));
    }
    E.drawer('leads', l.id, [
      h('h2', { text: l.name }),
      h('p', { class: 'lead-line', text: [web ? 'Website form' : sourceOf(l) + ', added by hand', l.company, A.dateTime(l.created_at)].filter(Boolean).join(' \u00b7 ') }),
      E.section('Status', null, h('div', { class: 'adm-controls' }, h('label', {}, 'Status', status), h('label', { class: 'wide' }, 'Notes', notes)),
        h('div', { class: 'adm-row' }, save, ro ? h('span', { class: 'adm-note', text: 'Viewers can read only.' }) : null)),
      l.description ? E.section(web ? 'Message' : 'What they want', null, h('div', { class: 'adm-text', text: l.description })) : null,
      E.section('Contact', null, E.kv([
        ['Email', E.mailLink(l.email)], ['WhatsApp', E.phoneLink(l.phone)], ['Instagram', E.igLink(l.instagram)],
        ['Reach them via', web ? l.preferred_contact : null]
      ])),
      E.section('Details', null, E.kv([
        ['About', web ? l.inquiry_type : null], ['Timeline', web ? l.timeline : null], ['Budget', l.budget || E.quiet('Not given')],
        ['Sent from', web ? l.page : null], ['Came in', A.dateTime(l.created_at)], ['Updated', !web && l.updated_at !== l.created_at ? A.dateTime(l.updated_at) : null]
      ])),
      E.section('Projects', null, projects)
    ]);
    A.guard(function () { return status.value !== l.status || (notes.value.trim() || null) !== (l.notes || null); });
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
      budget: h('input', { type: 'text', maxlength: 60, autocomplete: 'off', placeholder: '50 to 150M IDR' })
    };
    var val = function (k) { return f[k].value.trim(); };
    var msg = h('p', { class: 'adm-msg', role: 'status' });
    var say = function (t, err) { msg.textContent = t; msg.classList.toggle('is-error', !!err); };
    var btn = h('button', { class: 'btn', type: 'button', onclick: function () {
      var row = { source: f.source.value, name: val('name'), company: val('company') || null, phone: val('phone') || null,
        instagram: val('instagram').replace(/^@+/, '') || null, email: val('email') || null,
        description: val('description') || null, budget: val('budget') || null };
      var bad = !row.name ? 'Give the lead a name.'
        : !(row.phone || row.instagram || row.email) ? 'Add a phone number, Instagram or email, so the team can reach them.'
        : row.email && !EMAIL.test(row.email) ? 'That email doesn\u2019t look right.' : '';
      if (bad) return say(bad, true);
      btn.disabled = true; say('Saving\u2026');
      sb.from('manual_leads').insert(row).select('id').single().then(function (r) {
        btn.disabled = false;
        if (r.error) return say(E.ecoError(r.error), true);
        A.toast('Lead added.'); E.forget(); A.refreshBadges();
        A.closeDrawer(true);
        if (!panel.hidden) { load(false); open(r.data.id); } else location.hash = '#leads/' + r.data.id;
      });
    } }, 'Add lead');
    var field = function (label, el, wide) { return h('label', { class: wide ? 'wide' : null }, label, el); };
    E.drawer(null, null, [
      h('h2', { text: 'Add lead' }),
      h('p', { class: 'lead-line', text: 'For leads from WhatsApp, Instagram, referrals and the like. Website messages are added by themselves.' }),
      h('div', { class: 'adm-sec eco-form' }, h('div', { class: 'adm-controls' },
        field('Came in by', f.source), field('Name', f.name), field('Company', f.company), field('Phone or WhatsApp', f.phone),
        field('Instagram', f.instagram), field('Email', f.email), field('What they want', f.description, true), field('Budget', f.budget)),
        h('div', { class: 'adm-row' }, btn, msg))
    ]);
    A.guard(function () { return Object.keys(f).some(function (k) { return k !== 'source' && val(k); }); });
    f.name.focus();
  }
  E.addLead = addLead;

  A.actions.leads = function () { return A.canEdit() ? h('button', { class: 'btn', type: 'button', onclick: addLead }, 'Add lead') : null; };
  A.loaders.leads = function () { load(false); };
  A.openers.leads = open;
})();
