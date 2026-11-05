/* CCC admin core: sign in, the sidebar and addresses, drawers, the website portfolio, careers (applicants and open
   roles) and the creative network. The pages in admin/eco/ (overview, leads, clients, projects, crew, documents,
   finance, reports, settings) build on window.cccAdmin, set at the end of this file.
   Everything here runs as the signed-in team member; the database decides what they may see and change
   (row level security: viewers read, admins and owners edit, owners delete, money only for those allowed).
   Anything typed by the public is put on the page as text, never as HTML. */
(function () {
  'use strict';

  // A local preview works on the development database (ccc-website-dev), never the live one.
  var DEV = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  var SB_URL = DEV ? 'https://jvhhcehzhgpcphtpynnx.supabase.co' : 'https://zneckeqsvwbavqxpolri.supabase.co';
  var SB_KEY = DEV ? 'sb_publishable_4h3nPS3LkYpy8xOe2vEM_A_y9ffqKEY' : 'sb_publishable_-h0k4-TWYPa03dqcdAg4Eg_53_s0dFU';
  // A password-reset link signs the person in as well. Note it before the auth library reads and clears the
  // address, so the reset form stays up until the new password is saved.
  var recovering = /type=recovery/.test(location.hash + location.search);
  var sb = window.supabase.createClient(SB_URL, SB_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  Array.prototype.forEach.call(document.querySelectorAll('[data-env]'), function (el) { el.hidden = !DEV; });

  var PAGE = 100;
  var TRACK = { team: 'Team', internship: 'Internship' };
  // Two pipelines, kept apart: careers applicants (team, internship) and the creative network (collaborators,
  // vendors). Same screens, but separate tables, files bucket and statuses.
  var KINDS = {
    applicants: { table: 'applicants', skills: 'applicant_skills', files: 'applicant_files', notes: 'applicant_notes', fk: 'applicant_id',
      bucket: 'applications', csv: 'ccc-applicants', statuses: ['new', 'reviewing', 'shortlisted', 'interview', 'hired', 'declined', 'archived'] },
    network: { table: 'network_profiles', skills: 'network_profile_skills', files: 'network_profile_files', notes: 'network_profile_notes', fk: 'profile_id',
      bucket: 'network', csv: 'ccc-network', statuses: ['new', 'verified', 'worked-with', 'favourite', 'not-a-fit', 'archived'] }
  };
  var WORK = { onsite: 'On site', remote: 'Remote', hybrid: 'Hybrid', any: 'Any' };

  var me = null, skills = [], skillLabel = {}, signedIn = [];
  var canEdit = function () { return me && (me.role === 'owner' || me.role === 'admin'); };
  var isOwner = function () { return me && me.role === 'owner'; };
  // amounts, Finance, the Kas and the Sheet's figures: owners always, others once an owner turns it on (the database checks again)
  var canMoney = function () { return !!(me && me.money); };

  // ---------- small helpers ----------
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  function h(tag, props) {
    var el = document.createElement(tag);
    props = props || {};
    Object.keys(props).forEach(function (k) {
      var v = props[k];
      if (v == null || v === false) return;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
      else if (k === 'value') el.value = v;
      else el.setAttribute(k, v === true ? '' : v);
    });
    if (tag === 'tr' && props.onclick) el.tabIndex = 0;
    for (var i = 2; i < arguments.length; i++) add(el, arguments[i]);
    return el;
  }
  document.addEventListener('keydown', function (e) {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('tr[tabindex]')) { e.preventDefault(); e.target.click(); }
  });
  function add(el, c) {
    if (c == null || c === false) return;
    if (Array.isArray(c)) { c.forEach(function (x) { add(el, x); }); return; }
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  var date = function (d) { return d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : ''; };
  var dateTime = function (d) { return d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''; };
  var safeUrl = function (u) { return /^https?:\/\//i.test(u || '') ? u : null; };
  var toast = function (msg, err) {
    var t = $('[data-toast]'); t.textContent = msg; t.classList.toggle('is-error', !!err); t.hidden = false;
    clearTimeout(toast.t); toast.t = setTimeout(function () { t.hidden = true; }, err ? 6000 : 2500);
  };
  var fail = function (e) { toast((e && e.message) || 'Something went wrong.', true); };
  var ago = function (d) {
    var m = Math.round((Date.now() - new Date(d).getTime()) / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return m + ' min ago';
    if (m < 1440) return Math.round(m / 60) + ' h ago';
    var days = Math.round(m / 1440);
    return days === 1 ? 'yesterday' : days < 31 ? days + ' days ago' : date(d);
  };

  // A confirm that says what will happen (the browser's own confirm can't be styled or labelled)
  var askBox = $('[data-ask]');
  function ask(title, text, okLabel, danger) {
    return new Promise(function (resolve) {
      $('[data-ask-title]').textContent = title;
      $('[data-ask-text]').textContent = text || '';
      var ok = $('[data-ask-ok]'), cancel = $('[data-ask-cancel]');
      ok.textContent = okLabel || 'Continue';
      askBox.classList.toggle('is-danger', !!danger);
      var done = function (v) { ok.onclick = cancel.onclick = null; askBox.onclose = null; if (askBox.open) askBox.close(); resolve(v); };
      ok.onclick = function () { done(true); };
      cancel.onclick = function () { done(false); };
      askBox.onclose = function () { done(false); };
      askBox.showModal(); cancel.focus();
    });
  }
  var show = function (view) { $$('[data-view]').forEach(function (v) { v.hidden = v.getAttribute('data-view') !== view; }); };
  var select = function (opts, current, attrs) {
    var s = h('select', attrs || {});
    opts.forEach(function (o) { var v = Array.isArray(o) ? o[0] : o, l = Array.isArray(o) ? o[1] : o; s.appendChild(h('option', { value: v, selected: String(v) === String(current == null ? '' : current) }, l)); });
    return s;
  };

  // ---------- sign in / out ----------
  var loginForm = $('[data-form="login"]'), loginMsg = $('.adm-msg', loginForm);
  loginForm.addEventListener('submit', function (e) {
    e.preventDefault();
    loginMsg.textContent = 'Signing in…'; loginMsg.classList.remove('is-error');
    sb.auth.signInWithPassword({ email: loginForm.email.value.trim(), password: loginForm.password.value }).then(function (r) {
      if (r.error) { loginMsg.textContent = r.error.message; loginMsg.classList.add('is-error'); }
      else { loginMsg.textContent = ''; loginForm.password.value = ''; }
    });
  });
  $('[data-action="forgot"]').addEventListener('click', function () {
    var email = loginForm.email.value.trim();
    if (!email) { loginMsg.textContent = 'Type your email above first.'; loginMsg.classList.add('is-error'); return; }
    sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname }).then(function (r) {
      loginMsg.classList.toggle('is-error', !!r.error);
      loginMsg.textContent = r.error ? r.error.message : 'If that email is on the team, a reset link is on its way.';
    });
  });
  var resetForm = $('[data-form="reset"]'), resetMsg = $('.adm-msg', resetForm);
  resetForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var pw = resetForm.password.value;
    if (pw.length < 10) { resetMsg.textContent = 'Use at least 10 characters.'; resetMsg.classList.add('is-error'); return; }
    sb.auth.updateUser({ password: pw }).then(function (r) {
      if (r.error) { resetMsg.textContent = r.error.message; resetMsg.classList.add('is-error'); return; }
      resetForm.password.value = ''; toast('Password saved.');
      recovering = false;
      sb.auth.getSession().then(function (s) { route(s.data.session); });
    });
  });
  $$('[data-action="signout"]').forEach(function (b) { b.addEventListener('click', function () { sb.auth.signOut(); }); });

  // the pages in admin/eco/ load after this file; opening the first page waits for them
  var ready = new Promise(function (go) { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go); else go(); });
  var routing = false;
  function route(session) {
    if (!session) { me = null; show('login'); return; }
    // the auth library repeats "signed in" when the tab comes back into view: same person, nothing to redo
    // (re-routing would close an open record and lose what was being typed)
    if (me && me.id === session.user.id) return;
    if (routing) return; routing = true;
    sb.from('team_members').select('role, full_name, email, can_see_money').eq('user_id', session.user.id).maybeSingle().then(function (r) {
      routing = false;
      if (recovering) return; // a reset link turned up meanwhile: the reset form stays
      $$('[data-me-email]').forEach(function (el) { el.textContent = session.user.email; });
      if (r.error || !r.data) { show('denied'); return; }
      me = { id: session.user.id, email: session.user.email, role: r.data.role, name: r.data.full_name,
        money: r.data.role === 'owner' || r.data.can_see_money === true };
      $('[data-me-role]').textContent = me.role;
      $$('[data-edit-only]').forEach(function (el) { el.hidden = !canEdit(); });
      $$('[data-owner-only]').forEach(function (el) { el.hidden = !isOwner(); });
      $$('[data-money-only]').forEach(function (el) { el.hidden = !canMoney(); });
      $$('[data-edit-or-money]').forEach(function (el) { el.hidden = !canEdit() && !canMoney(); });
      $$('[data-env]').forEach(function (el) { el.hidden = !DEV; });
      show('app');
      refreshBadges();
      Promise.all([loadSkills().catch(fail), ready]).then(function () {
        signedIn.forEach(function (fn) { fn(me); });
        openTab();
      });
    });
  }
  sb.auth.onAuthStateChange(function (event, session) {
    if (event === 'PASSWORD_RECOVERY') { recovering = true; show('reset'); return; }
    // a fresh page after signing out: nothing one person loaded stays in memory or on the page for the next
    if (event === 'SIGNED_OUT') { recovering = false; var was = me; me = null; show('login'); if (was) location.reload(); return; }
    // the reset link's own sign-in must not swap the reset form for the dashboard
    if (recovering && session) { show('reset'); return; }
    if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') route(session);
  });

  // ---------- sections (sidebar) ----------
  // #tab or #tab/<record id>; old addresses keep working
  var loaders = {}, openers = {}, actions = {};
  var TITLES = { overview: 'Overview', leads: 'Leads', clients: 'Clients', projects: 'Projects', crew: 'Crew & Vendors', network: 'Crew & Vendors',
    documents: 'Documents', finance: 'Finance', reports: 'Reports', portfolio: 'Website & Portfolio', applicants: 'Careers', jobs: 'Careers',
    settings: 'Settings' };
  var ALIAS = { inquiries: 'leads', team: 'settings', careers: 'applicants' };
  // a page inside another sidebar item (its tabs show at the top of the page)
  var UNDER = { applicants: 'careers', jobs: 'careers', network: 'crew' };
  var SUBS = {
    leads: 'Contact form messages and the leads you add, in one list.',
    clients: function () { return canEdit() ? 'Clients from the Sheet, with their projects, leads and documents.' : 'Clients from the Sheet, with their projects and documents.'; },
    projects: 'Every project in the Sheet and every brief, most urgent first.',
    crew: 'The crew list from the Sheet: rates and what each person is owed.',
    network: 'Collaborators and vendors who want to work with us.',
    documents: function () { return canMoney() ? 'Quotes, invoices, receipts, contracts and briefs, kept in Google Drive.' : 'Contracts, briefs and other project files, kept in Google Drive.'; },
    finance: 'What to collect and the Kas, from the Sheet.',
    reports: function () {
      if (!canMoney()) return 'The lead pipeline. Money figures need money access.';
      return 'The year from the Sheet\u2019s Keuangan tab, checked against each project' + (canEdit() ? ', and the lead pipeline.' : '.');
    },
    portfolio: 'Projects for the Work page. Drafts stay private until you publish.',
    applicants: 'Careers applications: team and internship.',
    jobs: 'Roles shown on the Careers pages.',
    settings: 'Who can use the admin, the Google Sheet connection and backups.'
  };
  var side = $('[data-side]'), sideScrim = $('[data-side-scrim]'), menuBtn = $('[data-action="menu"]');
  function sideOpen(on) {
    side.classList.toggle('is-open', on); sideScrim.hidden = !on; menuBtn.setAttribute('aria-expanded', on ? 'true' : 'false');
  }
  menuBtn.addEventListener('click', function () { sideOpen(!side.classList.contains('is-open')); });
  sideScrim.addEventListener('click', function () { sideOpen(false); });
  // a page this account can't read opens the nearest one it can (the database draws the same lines)
  function allowed(tab) {
    if (tab === 'crew' && !canMoney()) tab = 'network'; // the crew list holds rates and amounts
    if (canEdit()) return tab;
    // leads, applicants and network sign-ups are for owners and admins; the pipeline is all Reports has without money
    if (tab === 'applicants') return 'jobs';
    if (tab === 'network') return canMoney() ? 'crew' : 'overview';
    if (tab === 'leads' || (tab === 'reports' && !canMoney())) return 'overview';
    return tab;
  }
  function openTab() {
    var parts = (location.hash || '#overview').slice(1).split('/');
    var tab = ALIAS[parts[0]] || parts[0], id = parts[1] || null;
    if (!TITLES[tab]) { tab = 'overview'; id = null; }
    var to = allowed(tab);
    if (to !== tab) { tab = to; id = null; }
    // one address per page: an old or partial one is rewritten in place
    var want = '#' + tab + (id ? '/' + id : '');
    if (location.hash !== want) history.replaceState(null, '', want);
    var item = UNDER[tab] || tab;
    $$('[data-tab]').forEach(function (a) { if (a.getAttribute('data-tab') === item) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    $$('[data-sub]').forEach(function (a) { if (a.getAttribute('data-sub') === tab) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    $$('[data-panel]').forEach(function (p) { p.hidden = p.getAttribute('data-panel') !== tab; });
    $('[data-page-title]').textContent = TITLES[tab];
    var sub = SUBS[tab];
    $('[data-page-sub]').textContent = tab === 'overview' ? overviewSub() : typeof sub === 'function' ? sub() : (sub || '');
    var act = $('[data-page-actions]'); act.innerHTML = '';
    if (actions[tab]) add(act, actions[tab]());
    document.title = TITLES[tab] + ' \u00b7 CCC Admin';
    sideOpen(false);
    closeDrawer(true);
    if (loaders[tab]) loaders[tab]();
    if (id && openers[tab]) openers[tab](id);
  }
  window.addEventListener('hashchange', function () {
    if (!me) return;
    // leaving an unsaved editor asks first; staying puts the address back
    if (drawerGuard && drawerGuard()) {
      var to = location.hash;
      history.replaceState(null, '', drawerHash);
      ask('Leave without saving?', 'Your changes to this item haven\u2019t been saved.', 'Leave', true).then(function (go) {
        if (go) { drawerGuard = null; history.replaceState(null, '', to); openTab(); }
      });
      return;
    }
    openTab();
  });

  // waiting items next to their place in the menu (a count that fails shows nothing rather than 0)
  function badge(key, r, word) {
    var el = $('[data-badge="' + key + '"]');
    if (!el) return;
    el.hidden = !!r.error || !r.count; el.textContent = r.error ? '' : r.count || '';
    if (!r.error) el.setAttribute('aria-label', r.count + ' ' + word);
  }
  function refreshBadges() {
    // new leads, applicants and sign-ups, Sheet issues still open and Sheet writes that failed: for the people who can act on them
    if (!canEdit()) { badge('settings', { count: 0 }, ''); return; }
    [['leads', 'lead_inbox'], ['applicants', 'applicants'], ['network', 'network_profiles']].forEach(function (b) {
      sb.from(b[1]).select('id', { count: 'exact', head: true }).eq('status', 'new').then(function (r) { badge(b[0], r, 'new'); });
    });
    Promise.all([
      sb.from('sync_issues').select('id', { count: 'exact', head: true }).is('resolved_at', null),
      sb.from('sync_outbox').select('id', { count: 'exact', head: true }).eq('status', 'failed')
    ]).then(function (r) {
      badge('settings', r[0].error || r[1].error ? { error: true } : { count: (r[0].count || 0) + (r[1].count || 0) }, 'to look at');
    });
  }

  // ---------- drawer ----------
  var drawer = $('[data-drawer]'), drawerBody = $('[data-drawer-body]'), scrim = $('[data-scrim]');
  var drawerGuard = null, drawerHash = '', drawerFrom = null;
  function openDrawer(content, wide) {
    drawerGuard = null; drawerFrom = document.activeElement;
    drawerBody.innerHTML = ''; add(drawerBody, content);
    drawer.classList.toggle('is-wide', !!wide);
    drawer.hidden = false; scrim.hidden = false; drawer.scrollTop = 0;
    drawerHash = location.hash;
    $('[data-action="close"]').focus();
  }
  function closeDrawer(force) {
    if (drawer.hidden) return;
    if (force !== true && drawerGuard && drawerGuard()) {
      ask('Close without saving?', 'Your changes to this item haven\u2019t been saved.', 'Discard changes', true).then(function (go) { if (go) { drawerGuard = null; closeDrawer(true); } });
      return;
    }
    drawerGuard = null;
    drawer.hidden = true; scrim.hidden = true; drawerBody.innerHTML = '';
    // the address goes back to the list, and focus to where it was
    var tab = (location.hash.slice(1).split('/')[0]) || 'overview';
    if (location.hash.indexOf('/') > -1) history.replaceState(null, '', '#' + tab);
    if (drawerFrom && document.contains(drawerFrom)) drawerFrom.focus();
  }
  $('[data-action="close"]').addEventListener('click', function () { closeDrawer(); });
  scrim.addEventListener('click', function () { closeDrawer(); });
  document.addEventListener('keydown', function (e) {
    // after this key press, or the same Escape would at once dismiss the confirm it opens
    if (e.key === 'Escape' && !drawer.hidden && !askBox.open) { e.preventDefault(); setTimeout(closeDrawer, 0); }
  });
  window.addEventListener('beforeunload', function (e) { if (drawerGuard && drawerGuard()) { e.preventDefault(); e.returnValue = ''; } });
  var sec = function (title) { var s = h('section', { class: 'adm-sec' }, h('h3', { text: title })); for (var i = 1; i < arguments.length; i++) add(s, arguments[i]); return s; };
  var kv = function (pairs) {
    var dl = h('dl', { class: 'adm-kv' });
    pairs.forEach(function (p) { if (p[1] == null || p[1] === '' || (Array.isArray(p[1]) && !p[1].length)) return; dl.appendChild(h('dt', { text: p[0] })); dl.appendChild(h('dd', {}, p[1])); });
    return dl;
  };

  function loadSkills() {
    return sb.from('skills').select('slug, label, grp, active').order('sort').then(function (r) {
      skills = r.data || []; skillLabel = {};
      skills.forEach(function (s) { skillLabel[s.slug] = s.label; });
      Object.keys(KINDS).forEach(function (kind) {
        var panel = $('[data-panel="' + kind + '"]');
        var sel = $('[data-filter="skill"]', panel);
        sel.length = 1;
        skills.forEach(function (s) { sel.appendChild(h('option', { value: s.slug }, s.label)); });
        var st = $('[data-filter="status"]', panel);
        st.length = 1;
        KINDS[kind].statuses.forEach(function (s) { st.appendChild(h('option', { value: s }, s)); });
      });
    });
  }

  // ================= PEOPLE (careers applicants, and the creative network) =================
  function people(kind) {
    var K = KINDS[kind], net = kind === 'network';
    var ap = { panel: $('[data-panel="' + kind + '"]'), from: 0 };
    var apFilter = function () {
      var f = {}; $$('[data-filter]', ap.panel).forEach(function (el) { f[el.getAttribute('data-filter')] = el.value.trim(); }); return f;
    };
    var crafts = function (a) { return (a.skills || []).map(function (s) { return skillLabel[s.skill_slug] || s.skill_slug; }); };
    function apQuery(f, from, to, cols) {
      var sel = cols || 'id, created_at, ' + (net ? 'entity_type' : 'track') + ', name, company_name, email, city, country, status, rating, tags, skills:' + K.skills + '(skill_slug)';
      if (f.skill) sel += ', sf:' + K.skills + '!inner(skill_slug)';
      var q = sb.from(K.table).select(sel, { count: 'exact' }).order('created_at', { ascending: false }).range(from, to);
      ['track', 'entity_type', 'status'].forEach(function (c) { if (f[c]) q = q.eq(c, f[c]); });
      if (f.skill) q = q.eq('sf.skill_slug', f.skill);
      if (f.q) {
        var t = f.q.replace(/["\\,()*%]/g, ' ').replace(/\s+/g, ' ').trim();
        if (t) q = q.or(['name', 'email', 'city', 'country', 'company_name'].map(function (c) { return c + '.ilike."*' + t + '*"'; }).join(','));
      }
      return q;
    }
    function apLoad(more) {
      if (!more) ap.from = 0;
      var tbody = $('[data-rows]', ap.panel);
      apQuery(apFilter(), ap.from, ap.from + PAGE - 1).then(function (r) {
        if (r.error) return fail(r.error);
        if (!more) tbody.innerHTML = '';
        (r.data || []).forEach(function (a) {
          var c = crafts(a);
          tbody.appendChild(h('tr', { onclick: function () { apOpen(a.id); } },
            h('td', {}, date(a.created_at)),
            h('td', {}, a.name, a.company_name ? h('span', { class: 'sub', text: a.company_name }) : null, h('span', { class: 'sub', text: a.email })),
            h('td', {}, net ? (a.entity_type === 'company' ? 'Company' : 'Individual') : (TRACK[a.track] || a.track)),
            h('td', {}, c.slice(0, 3).join(', ') + (c.length > 3 ? ' +' + (c.length - 3) : '')),
            h('td', {}, [a.city, a.country].filter(Boolean).join(', ')),
            h('td', {}, h('span', { class: 'adm-pill' + (a.status === 'new' ? ' is-new' : ''), text: a.status })),
            h('td', {}, a.rating ? '★'.repeat(a.rating) : '')));
        });
        if (!tbody.children.length) tbody.appendChild(h('tr', { class: 'empty' }, h('td', { colspan: 7, text: 'Nobody here yet.' })));
        ap.from += (r.data || []).length;
        $('[data-count]', ap.panel).textContent = (r.count || 0) + ' people';
        $('[data-action="more"]', ap.panel).hidden = ap.from >= (r.count || 0);
      });
    }
    loaders[kind] = function () { apLoad(false); };
    openers[kind] = function (id) { apOpen(id); };
    var apTimer;
    $$('[data-filter]', ap.panel).forEach(function (el) {
      el.addEventListener(el.tagName === 'INPUT' ? 'input' : 'change', function () { clearTimeout(apTimer); apTimer = setTimeout(function () { apLoad(false); }, 250); });
    });
    $('[data-action="more"]', ap.panel).addEventListener('click', function () { apLoad(true); });

    function apOpen(id) {
      var noteOf = function (body) { var n = { body: body, author_email: me.email }; n[K.fk] = id; return n; };
      Promise.all([
        sb.from(K.table).select('*, skills:' + K.skills + '(skill_slug), files:' + K.files + '(id, path, name, size, mime, created_at)' + (net ? '' : ', job:jobs(title)')).eq('id', id).single(),
        sb.from(K.notes).select('id, body, author_email, author_id, created_at').eq(K.fk, id).order('created_at', { ascending: false })
      ]).then(function (res) {
        if (res[0].error) return fail(res[0].error);
        var a = res[0].data, notes = res[1].data || [];
        var ro = !canEdit();
        var wa = a.phone ? a.phone.replace(/[^\d]/g, '') : '';
        var ig = a.instagram ? a.instagram.replace(/^@/, '').replace(/[^A-Za-z0-9._]/g, '') : '';

        var status = select(K.statuses, a.status, { disabled: ro });
        var rating = select([['', '—'], [1, '★'], [2, '★★'], [3, '★★★'], [4, '★★★★'], [5, '★★★★★']], a.rating == null ? '' : a.rating, { disabled: ro });
        var tags = h('input', { type: 'text', value: (a.tags || []).join(', '), placeholder: 'fashion, fast, Jakarta crew', disabled: ro });
        var save = h('button', { class: 'btn', type: 'button', disabled: ro, onclick: function () {
          var t = tags.value.split(',').map(function (x) { return x.trim(); }).filter(Boolean).slice(0, 30);
          sb.from(K.table).update({ status: status.value, rating: rating.value ? +rating.value : null, tags: t }).eq('id', a.id).then(function (r) {
            if (r.error) return fail(r.error);
            toast('Saved.'); apLoad(false); refreshBadges();
          });
        } }, 'Save');

        var noteBox = h('textarea', { placeholder: 'Add a note for the team', maxlength: 4000, disabled: ro });
        var notesList = h('div', { class: 'adm-notes' });
        var drawNotes = function (list) {
          notesList.innerHTML = '';
          list.forEach(function (n) {
            notesList.appendChild(h('div', { class: 'note' }, h('p', { text: n.body }),
              h('span', {}, (n.author_email || 'team') + ' · ' + dateTime(n.created_at),
                (n.author_id === me.id || isOwner()) ? [' · ', h('button', { class: 'adm-link', type: 'button', onclick: function () {
                  sb.from(K.notes).delete().eq('id', n.id).then(function (r) { if (r.error) return fail(r.error); notes = notes.filter(function (x) { return x.id !== n.id; }); drawNotes(notes); });
                } }, 'Delete')] : null)));
          });
        };
        drawNotes(notes);
        var addNote = h('button', { class: 'btn ghost', type: 'button', disabled: ro, onclick: function () {
          var body = noteBox.value.trim(); if (!body) return;
          sb.from(K.notes).insert(noteOf(body)).select('id, body, author_email, author_id, created_at').single().then(function (r) {
            if (r.error) return fail(r.error);
            noteBox.value = ''; notes.unshift(r.data); drawNotes(notes);
          });
        } }, 'Add note');

        var files = h('div', { class: 'adm-files' }, (a.files || []).map(function (f) {
          return h('button', { type: 'button', onclick: function () {
            sb.storage.from(K.bucket).createSignedUrl(f.path, 120).then(function (r) {
              if (r.error) return fail(r.error);
              window.open(r.data.signedUrl, '_blank', 'noopener');
            });
          } }, f.name + (f.size ? ' · ' + (f.size / 1048576).toFixed(1) + ' MB' : ''));
        }));
        var links = h('div', { class: 'adm-links' }, (a.links || []).map(function (u) {
          var ok = safeUrl(u); return ok ? h('a', { href: ok, target: '_blank', rel: 'noopener noreferrer', text: u }) : h('span', { text: u });
        }));

        var del = isOwner() ? h('button', { class: 'adm-link adm-danger', type: 'button', onclick: function () {
          if (!confirm('Delete ' + a.name + ' and their files for good? This can\u2019t be undone.')) return;
          var paths = (a.files || []).map(function (f) { return f.path; });
          (paths.length ? sb.storage.from(K.bucket).remove(paths) : Promise.resolve({})).then(function (r) {
            if (r && r.error) return fail(r.error);
            return sb.from(K.table).delete().eq('id', a.id).then(function (r2) {
              if (r2.error) return fail(r2.error);
              toast('Deleted.'); closeDrawer(true); apLoad(false); refreshBadges();
            });
          });
        } }, 'Delete this person') : null;

        openDrawer([
          h('h2', { text: a.name }),
          h('p', { class: 'lead-line' }, [net ? 'Creative network' : TRACK[a.track], a.entity_type === 'company' ? 'Company' : null, a.company_name, 'since ' + date(a.created_at)].filter(Boolean).join(' · ')),
          sec('Status', h('div', { class: 'adm-controls' },
            h('label', {}, 'Status', status), h('label', {}, 'Rating', rating), h('label', { class: 'wide' }, 'Tags (comma separated)', tags)),
            h('div', { class: 'adm-row' }, save, ro ? h('span', { class: 'adm-note', text: 'Viewers can read only.' }) : null)),
          sec('Contact', kv([
            ['Email', h('a', { href: 'mailto:' + a.email, text: a.email })],
            ['WhatsApp', wa ? h('a', { href: 'https://wa.me/' + wa, target: '_blank', rel: 'noopener noreferrer', text: a.phone }) : a.phone],
            ['Instagram', ig ? h('a', { href: 'https://instagram.com/' + ig, target: '_blank', rel: 'noopener noreferrer', text: '@' + ig }) : null],
            ['Location', [a.city, a.country].filter(Boolean).join(', ')]
          ])),
          sec('Work', kv([
            ['Craft', crafts(a).join(', ')],
            ['Role', net ? null : (a.job ? a.job.title : 'Open application')],
            ['Experience', a.experience_years != null ? a.experience_years + ' years' : null],
            ['Available from', a.available_from ? date(a.available_from) : null],
            ['Works', WORK[a.work_mode]],
            ['Travel', a.can_travel == null ? null : (a.can_travel ? 'Yes' : 'No')],
            ['Languages', (a.languages || []).join(', ')],
            ['Rate', a.rate_note],
            ['Brings', a.equipment ? h('div', { class: 'adm-text', text: a.equipment }) : null]
          ])),
          (a.links && a.links.length) || (a.files && a.files.length) ? sec('Portfolio', links, files) : null,
          a.message ? sec('Message', h('div', { class: 'adm-text', text: a.message })) : null,
          sec('Notes', h('div', { class: 'adm-controls' }, h('label', { class: 'wide' }, 'New note', noteBox)), h('div', { class: 'adm-row' }, addNote), notesList),
          sec('Record', kv([
            ['Heard via', a.source], ['Sent from', a.page], ['Consent', dateTime(a.consent_at)], ['Updated', dateTime(a.updated_at)]
          ]), h('div', { class: 'adm-row' }, del))
        ]);
      }).catch(fail);
    }

    // CSV of everyone matching the current filters (for sharing a shortlist or a crew list)
    $('[data-action="export"]', ap.panel).addEventListener('click', function () {
      var f = apFilter(), rows = [], from = 0;
      var cols = 'created_at, ' + (net ? 'entity_type, company_name' : 'track') + ', name, email, phone, instagram, city, country, work_mode, can_travel, languages, '
        + (net ? 'rate_note' : 'experience_years, available_from') + ', links, status, rating, tags, skills:' + K.skills + '(skill_slug)';
      var next = function () {
        return apQuery(f, from, from + 999, cols).then(function (r) {
          if (r.error) throw r.error;
          rows = rows.concat(r.data || []); from += (r.data || []).length;
          if ((r.data || []).length === 1000 && from < 10000) return next();
        });
      };
      next().then(function () {
        var head = ['Date'].concat(net ? ['Type', 'Company'] : ['Track'],
          ['Name', 'Email', 'WhatsApp', 'Instagram', 'City', 'Country', 'Craft', 'Works', 'Travel', 'Languages'],
          net ? ['Rate'] : ['Experience', 'Available'], ['Links', 'Status', 'Rating', 'Tags']);
        var q = function (v) {
          var s = v == null ? '' : String(v);
          if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // no formulas when opened in a spreadsheet
          return '"' + s.replace(/"/g, '""') + '"';
        };
        var lines = [head.map(q).join(',')].concat(rows.map(function (a) {
          return [date(a.created_at)].concat(net ? [a.entity_type, a.company_name] : [TRACK[a.track]],
            [a.name, a.email, a.phone, a.instagram, a.city, a.country, crafts(a).join('; '),
              WORK[a.work_mode], a.can_travel == null ? '' : (a.can_travel ? 'yes' : 'no'), (a.languages || []).join('; ')],
            net ? [a.rate_note] : [a.experience_years, a.available_from],
            [(a.links || []).join(' '), a.status, a.rating, (a.tags || []).join('; ')]).map(q).join(',');
        }));
        var blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
        var link = h('a', { href: URL.createObjectURL(blob), download: K.csv + '-' + new Date().toISOString().slice(0, 10) + '.csv' });
        document.body.appendChild(link); link.click(); link.remove();
        toast(rows.length + ' people exported.');
      }).catch(fail);
    });
  }
  people('applicants');
  people('network');

  // ================= ROLES (jobs on the Careers page) =================
  var jobsP = { panel: $('[data-panel="jobs"]') };
  var EMP = [['full-time', 'Full-time'], ['contract', 'Contract'], ['part-time', 'Part-time'], ['internship', 'Internship']];
  // the part of the studio a role is listed under on careers/team.html and careers/internships.html
  var DEPT = [['', '—'], ['think', 'Think'], ['direct', 'Direct'], ['create', 'Create'], ['produce', 'Produce']];
  var deptName = function (k) { return (DEPT.filter(function (d) { return d[0] === k; })[0] || [0, ''])[1]; };
  function jobsLoad() {
    sb.from('jobs').select('*').order('sort').order('created_at', { ascending: false }).then(function (r) {
      if (r.error) return fail(r.error);
      var tbody = $('[data-rows]', jobsP.panel); tbody.innerHTML = '';
      (r.data || []).forEach(function (j) {
        tbody.appendChild(h('tr', { onclick: function () { jobOpen(j); } },
          h('td', {}, j.title), h('td', {}, TRACK[j.track]), h('td', {}, j.department ? deptName(j.department) : ''), h('td', {}, (EMP.filter(function (e) { return e[0] === j.employment; })[0] || [0, j.employment])[1]),
          h('td', {}, [j.location, WORK[j.work_mode]].filter(Boolean).join(' · ')),
          h('td', {}, h('span', { class: 'adm-pill' + (j.is_open ? ' is-open' : ''), text: j.is_open ? 'Open' : 'Hidden' }))));
      });
      if (!tbody.children.length) tbody.appendChild(h('tr', { class: 'empty' }, h('td', { colspan: 6, text: 'No roles yet. Open applications are still welcome on the site.' })));
      $('[data-count]', jobsP.panel).textContent = (r.data || []).length + ' roles';
    });
  }
  loaders.jobs = jobsLoad;
  actions.jobs = function () { return canEdit() ? h('button', { class: 'btn', type: 'button', onclick: function () { jobOpen(null); } }, 'New role') : null; };
  function jobOpen(j) {
    var ro = !canEdit();
    j = j || { title: '', track: 'team', department: '', employment: 'full-time', location: '', work_mode: '', summary: '', description: '', is_open: false, sort: 0 };
    var f = {
      title: h('input', { type: 'text', value: j.title, maxlength: 120, disabled: ro }),
      track: select([['team', 'Team'], ['internship', 'Internship']], j.track, { disabled: ro }),
      department: select(DEPT, j.department || '', { disabled: ro }),
      employment: select(EMP, j.employment, { disabled: ro }),
      location: h('input', { type: 'text', value: j.location || '', maxlength: 120, placeholder: 'Jakarta, Indonesia', disabled: ro }),
      work_mode: select([['', '—'], ['onsite', 'On site'], ['remote', 'Remote'], ['hybrid', 'Hybrid']], j.work_mode || '', { disabled: ro }),
      sort: h('input', { type: 'number', value: j.sort || 0, disabled: ro }),
      summary: h('textarea', { value: j.summary || '', maxlength: 400, placeholder: 'One or two lines for the Careers page', disabled: ro }),
      description: h('textarea', { value: j.description || '', maxlength: 8000, placeholder: 'The full brief, shown on the site when someone opens the role', disabled: ro }),
      is_open: h('input', { type: 'checkbox', checked: !!j.is_open, disabled: ro })
    };
    openDrawer([
      h('h2', { text: j.id ? j.title : 'New role' }),
      sec('Role', h('div', { class: 'adm-controls' },
        h('label', { class: 'wide' }, 'Title', f.title), h('label', {}, 'Track', f.track), h('label', {}, 'Section', f.department), h('label', {}, 'Type', f.employment),
        h('label', {}, 'Location', f.location), h('label', {}, 'Work', f.work_mode),
        h('label', { class: 'wide' }, 'Summary', f.summary), h('label', { class: 'wide' }, 'Description', f.description),
        h('label', {}, 'Order (lower first)', f.sort), h('label', { class: 'adm-check' }, f.is_open, 'Show on the Careers page')),
        h('div', { class: 'adm-row' },
          h('button', { class: 'btn', type: 'button', disabled: ro, onclick: function () {
            var row = { title: f.title.value.trim(), track: f.track.value, department: f.department.value || null, employment: f.employment.value, location: f.location.value.trim() || null,
              work_mode: f.work_mode.value || null, summary: f.summary.value.trim() || null, description: f.description.value.trim() || null,
              is_open: f.is_open.checked, sort: +f.sort.value || 0 };
            if (!row.title) return toast('Give the role a title.', true);
            (j.id ? sb.from('jobs').update(row).eq('id', j.id) : sb.from('jobs').insert(row)).then(function (r) {
              if (r.error) return fail(r.error); toast('Saved.'); closeDrawer(true); jobsLoad();
            });
          } }, 'Save'),
          j.id && !ro ? h('button', { class: 'adm-link adm-danger', type: 'button', onclick: function () {
            if (!confirm('Delete the role "' + j.title + '"? Applications for it are kept.')) return;
            sb.from('jobs').delete().eq('id', j.id).then(function (r) { if (r.error) return fail(r.error); toast('Deleted.'); closeDrawer(true); jobsLoad(); });
          } }, 'Delete role') : null))
    ]);
  }

  // ================= OVERVIEW (built by admin/eco/overview.js) =================
  var overviewSub = function () {
    var d = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jakarta', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date());
    return d + ' \u00b7 Jakarta time';
  };

  // ================= WEBSITE & PORTFOLIO =================
  var SERVICES = [['creative-direction', 'Creative Direction'], ['branding', 'Branding'], ['visual-identity', 'Visual Identity'], ['campaign', 'Campaign'],
    ['photography', 'Photography'], ['film', 'Film'], ['motion', 'Motion'], ['illustration', 'Illustration'], ['experience', 'Experience'],
    ['production', 'Production'], ['experimental', 'Experimental']];
  var INDUSTRIES = [['fashion', 'Fashion'], ['sport', 'Sport'], ['food-beverage', 'Food & Beverage']];
  var BUILT_IN = [['MOVANA', 'movana', 2026], ['Whitebeard', 'whitebeard', 2026], ['NOXON', 'noxon', 2026], ['Citarasa Tradisi', 'tradisi', 2026]];
  var RESERVED = BUILT_IN.map(function (b) { return b[1]; }).concat(['view']);
  var IMG_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/avif': 'avif' };
  var MAX_MB = 15;
  var PF_STATUS = { draft: 'Draft', published: 'Published', archived: 'Archived' };
  var SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
  // YouTube and Vimeo, including unlisted Vimeo links (vimeo.com/<id>/<hash>) and Vimeo embed links
  // (player.vimeo.com/video/<id>?h=<hash>). The database checks the same pattern.
  var VIDEO_RE = /^https:\/\/((www\.)?(youtube\.com\/watch\?v=[A-Za-z0-9_-]{6,20}|youtu\.be\/[A-Za-z0-9_-]{6,20}|vimeo\.com\/[0-9]{4,12}(\/[0-9a-f]{6,20})?)|player\.vimeo\.com\/video\/[0-9]{4,12})([?&#][A-Za-z0-9_=&.%-]*)?$/;
  var slugify = function (t) { return (t || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80).replace(/-+$/, ''); };
  var pathsOf = function (it) { return [it.cover_path].concat((it.gallery || []).map(function (g) { return g.path; })).filter(Boolean); };
  var viewUrl = function (slug, preview) { return '/work/view' + (DEV ? '.html' : '') + '?p=' + encodeURIComponent(slug) + (preview ? '&preview=1' : ''); };
  var uuid = function () {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    var b = crypto.getRandomValues(new Uint8Array(16)); b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
    var x = Array.prototype.map.call(b, function (n) { return ('0' + n.toString(16)).slice(-2); }).join('');
    return x.slice(0, 8) + '-' + x.slice(8, 12) + '-' + x.slice(12, 16) + '-' + x.slice(16, 20) + '-' + x.slice(20);
  };
  // database errors in words a person can act on
  var pfError = function (e) {
    var m = (e && e.message) || '';
    if (e && e.code === '23505') return 'That slug is already used by another project. Pick a different one.';
    if (/slug/.test(m)) return 'The slug can only use lowercase letters, numbers and single dashes, and can\u2019t be a built-in project\u2019s name.';
    if (/video_url/.test(m)) return 'The video link must be a YouTube or Vimeo address.';
    if (/gallery/.test(m)) return 'A gallery image isn\u2019t valid. Remove it and upload it again.';
    if (/credits/.test(m)) return 'Every credit needs both a role and a name.';
    if (/row-level security|permission denied/.test(m)) return 'Your role can\u2019t change the portfolio. Ask an owner.';
    return m || 'Something went wrong. Nothing was changed.';
  };

  // drafts are private, so the admin shows them through short-lived signed links
  var thumbCache = {};
  function signed(paths) {
    var need = paths.filter(function (p) { return p && !thumbCache[p]; });
    if (!need.length) return Promise.resolve(thumbCache);
    return sb.storage.from('portfolio-drafts').createSignedUrls(need, 3600).then(function (r) {
      (r.data || []).forEach(function (x) { if (x.signedUrl) thumbCache[x.path] = x.signedUrl; });
      return thumbCache;
    });
  }

  var pf = { panel: $('[data-panel="portfolio"]') };
  actions.portfolio = function () {
    return canEdit() ? h('button', { class: 'btn', type: 'button', onclick: function () { pfOpen(null); } }, 'New portfolio item') : null;
  };
  function pfLoad() {
    var tbody = $('[data-rows]', pf.panel);
    var st = $('[data-pf-filter="status"]', pf.panel).value, term = $('[data-pf-filter="q"]', pf.panel).value.replace(/["\\,()*%]/g, ' ').replace(/\s+/g, ' ').trim();
    var q = sb.from('portfolio_items').select('id, slug, title, client, year, status, featured, sort_order, cover_path, updated_at', { count: 'exact' })
      .order('featured', { ascending: false }).order('sort_order').order('updated_at', { ascending: false }).limit(500);
    if (st === 'active') q = q.in('status', ['draft', 'published']); else if (st) q = q.eq('status', st);
    if (term) q = q.or(['title', 'client', 'slug'].map(function (c) { return c + '.ilike."*' + term + '*"'; }).join(','));
    tbody.innerHTML = '';
    tbody.appendChild(h('tr', { class: 'empty' }, h('td', { colspan: 7, text: 'Loading\u2026' })));
    q.then(function (r) {
      tbody.innerHTML = '';
      if (r.error) {
        $('[data-count]', pf.panel).textContent = '';
        tbody.appendChild(h('tr', { class: 'empty' }, h('td', { colspan: 7, text: 'Couldn\u2019t load the portfolio: ' + r.error.message })));
        return;
      }
      var rows = r.data || [];
      rows.forEach(function (p) {
        var thumb = h('span', {});
        tbody.appendChild(h('tr', { onclick: function () { pfOpen(p.id); } },
          h('td', { class: 'pf-thumb' }, thumb),
          h('td', {}, p.title, p.featured ? h('span', { class: 'pf-star', text: 'Featured' }) : null, h('span', { class: 'sub', text: '/' + p.slug })),
          h('td', {}, p.client || ''), h('td', {}, p.year || ''),
          h('td', {}, h('span', { class: 'adm-pill' + (p.status === 'published' ? ' is-live' : p.status === 'archived' ? ' is-arch' : ''), text: PF_STATUS[p.status] })),
          h('td', {}, String(p.sort_order)), h('td', {}, date(p.updated_at))));
        if (p.cover_path) signed([p.cover_path]).then(function (c) { if (c[p.cover_path]) thumb.style.backgroundImage = 'url("' + c[p.cover_path] + '")'; });
      });
      if (!rows.length) tbody.appendChild(h('tr', { class: 'empty' }, h('td', { colspan: 7, text: term || st !== 'active' ? 'Nothing matches.' : 'No drafts or published items. Add one with \u201cNew portfolio item\u201d; archived items are under the status filter.' })));
      $('[data-count]', pf.panel).textContent = (r.count || 0) + ' items';
    });
  }
  loaders.portfolio = pfLoad;
  openers.portfolio = function (id) { pfOpen(id === 'new' ? null : id); };
  var pfTimer;
  $$('[data-pf-filter]', pf.panel).forEach(function (el) {
    el.addEventListener(el.tagName === 'INPUT' ? 'input' : 'change', function () { clearTimeout(pfTimer); pfTimer = setTimeout(pfLoad, 250); });
  });
  BUILT_IN.forEach(function (b) {
    $('[data-pf-builtin]').appendChild(h('li', {}, h('span', { class: 't', text: b[0] }), h('span', { class: 'adm-pill is-live', text: 'Live' }),
      h('span', { class: 'adm-note', text: String(b[2]) }), h('a', { href: '/work/' + b[1] + (DEV ? '.html' : ''), target: '_blank', rel: 'noopener', text: 'View page' })));
  });

  function pfOpen(id) {
    if (!id) {
      if (!canEdit()) return toast('Viewers can\u2019t add portfolio items.', true);
      return pfEditor(null);
    }
    sb.from('portfolio_items').select('*').eq('id', id).maybeSingle().then(function (r) {
      if (r.error) return fail(r.error);
      if (!r.data) return toast('That portfolio item isn\u2019t there.', true);
      pfEditor(r.data);
    });
  }

  function pfEditor(saved) {
    var ro = !canEdit();
    var isNew = !saved;
    var id = saved ? saved.id : uuid();
    var state = saved ? JSON.parse(JSON.stringify(saved)) : { status: 'draft', gallery: [], credits: [], services: [], industries: [], featured: false, sort_order: 0 };
    var slugTouched = !isNew;
    var busy = false;
    var lastSaved = JSON.stringify(collectFrom(state));
    if (saved) history.replaceState(null, '', '#portfolio/' + id);

    function collectFrom(x) {
      return { slug: x.slug || '', title: x.title || '', client: x.client || null, year: x.year || null, services: x.services || [], industries: x.industries || [],
        summary: x.summary || null, brief: x.brief || null, approach: x.approach || null, outcome: x.outcome || null,
        cover_path: x.cover_path || null, cover_alt: x.cover_alt || null, cover_w: x.cover_w || null, cover_h: x.cover_h || null,
        gallery: x.gallery || [], video_url: x.video_url || null, credits: x.credits || [], seo_title: x.seo_title || null, seo_description: x.seo_description || null,
        featured: !!x.featured, sort_order: x.sort_order || 0 };
    }

    // ---- fields ----
    var input = function (val, attrs) { attrs = attrs || {}; attrs.type = attrs.type || 'text'; attrs.value = val == null ? '' : val; attrs.disabled = ro; return h('input', attrs); };
    var area = function (val, attrs) { attrs = attrs || {}; attrs.value = val || ''; attrs.disabled = ro; return h('textarea', attrs); };
    var f = {
      title: input(state.title, { maxlength: 120, required: true }),
      slug: input(state.slug, { maxlength: 80, required: true, spellcheck: 'false', autocapitalize: 'off' }),
      client: input(state.client, { maxlength: 120 }),
      year: input(state.year, { type: 'number', min: 1990, max: 2100, step: 1, placeholder: String(new Date().getFullYear()) }),
      summary: area(state.summary, { maxlength: 300, rows: 2, placeholder: 'One or two lines. Used on the card and in search results.' }),
      brief: area(state.brief, { maxlength: 4000, rows: 4, placeholder: 'What was asked, and why it mattered.' }),
      approach: area(state.approach, { maxlength: 4000, rows: 4, placeholder: 'How we thought about it and what we made.' }),
      outcome: area(state.outcome, { maxlength: 4000, rows: 3, placeholder: 'What came out of it.' }),
      cover_alt: input(state.cover_alt, { maxlength: 300, placeholder: 'Describe the image for people who can\u2019t see it' }),
      video_url: input(state.video_url, { type: 'url', maxlength: 300, placeholder: 'https://youtu.be/\u2026 or https://vimeo.com/\u2026' }),
      seo_title: input(state.seo_title, { maxlength: 70 }),
      seo_description: area(state.seo_description, { maxlength: 160, rows: 2 }),
      featured: h('input', { type: 'checkbox', checked: !!state.featured, disabled: ro }),
      sort_order: input(state.sort_order || 0, { type: 'number', min: -9999, max: 9999, step: 1 })
    };
    var slugHint = h('span', { class: 'pf-hint' });
    var checks = function (list, chosen, name) {
      return h('div', { class: 'pf-checks', role: 'group', 'aria-label': name }, list.map(function (o) {
        return h('label', {}, h('input', { type: 'checkbox', value: o[0], checked: chosen.indexOf(o[0]) > -1, disabled: ro }), o[1]);
      }));
    };
    var svcBox = checks(SERVICES, state.services || [], 'Services'), indBox = checks(INDUSTRIES, state.industries || [], 'Industries');
    var counter = function (field, max) {
      var c = h('span', { class: 'pf-hint' });
      var upd = function () { c.textContent = field.value.length + ' / ' + max; };
      field.addEventListener('input', upd); upd(); return c;
    };

    // ---- images ----
    var upload = function (file) {
      var ext = IMG_TYPES[file.type];
      if (!ext) return Promise.reject(new Error(file.name + ': use JPG, PNG, WebP or AVIF.'));
      if (file.size > MAX_MB * 1048576) return Promise.reject(new Error(file.name + ' is over ' + MAX_MB + ' MB. Export a smaller version.'));
      var size = (window.createImageBitmap ? createImageBitmap(file).then(function (b) { var s = { w: b.width, h: b.height }; if (b.close) b.close(); return s; })
        : Promise.reject()).catch(function () {
        return new Promise(function (res) { var i = new Image(); i.onload = function () { res({ w: i.naturalWidth, h: i.naturalHeight }); URL.revokeObjectURL(i.src); }; i.onerror = function () { res({ w: 0, h: 0 }); }; i.src = URL.createObjectURL(file); });
      });
      return ensureSaved().then(function () { return size; }).then(function (s) {
        if (!s.w) throw new Error(file.name + ' couldn\u2019t be read as an image.');
        var path = id + '/' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8) + '.' + ext;
        return sb.storage.from('portfolio-drafts').upload(path, file, { contentType: file.type, upsert: false, cacheControl: '31536000' }).then(function (r) {
          if (r.error) throw new Error(file.name + ': ' + r.error.message);
          thumbCache[path] = URL.createObjectURL(file);
          return { path: path, w: s.w, h: s.h };
        });
      });
    };
    // a draft keeps new images at once (nothing is lost if the tab closes); a live item waits for
    // "Save and update live", so visitors never see a half-finished change
    function keepUpload(msg) {
      if (state.status === 'published') { dirtyCheck(); toast(msg + ' Save to put it on the live page.'); return Promise.resolve(); }
      busy = false;
      return save(true).then(function () { toast(msg + ' Saved to the draft.'); }, function () { dirtyCheck(); });
    }
    // images need the item to exist (their folder is its id), so the first upload saves a new item as a draft
    function ensureSaved() {
      if (!isNew) return Promise.resolve();
      var err = check();
      if (err) return Promise.reject(new Error('Before adding images: ' + err));
      return save(true);
    }

    var coverImg = h('div', { class: 'pf-cover-img', text: 'No cover yet' });
    var drawCover = function () {
      coverImg.classList.toggle('has-img', !!state.cover_path);
      coverImg.style.backgroundImage = state.cover_path && thumbCache[state.cover_path] ? 'url("' + thumbCache[state.cover_path] + '")' : '';
      coverImg.textContent = state.cover_path ? '' : 'No cover yet';
    };
    var fileBtn = function (label, multiple, onFiles) {
      var inp = h('input', { type: 'file', accept: Object.keys(IMG_TYPES).join(','), multiple: multiple, disabled: ro, 'aria-label': label });
      inp.addEventListener('change', function () { var files = Array.prototype.slice.call(inp.files); inp.value = ''; if (files.length) onFiles(files); });
      return h('span', { class: 'pf-file' }, h('span', { class: 'btn ghost', text: label }), inp);
    };
    var coverBtn = fileBtn('Upload cover', false, function (files) {
      setBusy(true, 'Uploading cover\u2026');
      upload(files[0]).then(function (x) {
        state.cover_path = x.path; state.cover_w = x.w; state.cover_h = x.h; drawCover();
        return keepUpload('Cover uploaded.');
      }).catch(function (e) { toast(e.message, true); }).then(function () { setBusy(false); });
    });

    var gal = h('div', { class: 'pf-gal' });
    var SIZES = [['full', 'Full width'], ['half', 'Half'], ['third', 'Third']];
    var move = function (list, i, d, redraw) { var j = i + d; if (j < 0 || j >= list.length) return; var t = list[i]; list[i] = list[j]; list[j] = t; redraw(); dirtyCheck(); };
    var drawGallery = function () {
      gal.innerHTML = '';
      state.gallery.forEach(function (g, i) {
        var im = h('div', { class: 'pf-cover-img has-img' });
        if (thumbCache[g.path]) im.style.backgroundImage = 'url("' + thumbCache[g.path] + '")';
        var alt = input(g.alt, { maxlength: 300, placeholder: 'Alt text (required to publish)', 'aria-label': 'Alt text for image ' + (i + 1) });
        alt.addEventListener('input', function () { g.alt = alt.value; dirtyCheck(); });
        var sz = select(SIZES, g.size, { disabled: ro, 'aria-label': 'Width of image ' + (i + 1) });
        sz.addEventListener('change', function () { g.size = sz.value; dirtyCheck(); });
        gal.appendChild(h('div', { class: 'pf-gal-row' }, im, alt, sz, h('div', { class: 'pf-move' },
          h('button', { type: 'button', disabled: ro || i === 0, 'aria-label': 'Move image ' + (i + 1) + ' up', onclick: function () { move(state.gallery, i, -1, drawGallery); } }, '\u2191'),
          h('button', { type: 'button', disabled: ro || i === state.gallery.length - 1, 'aria-label': 'Move image ' + (i + 1) + ' down', onclick: function () { move(state.gallery, i, 1, drawGallery); } }, '\u2193'),
          h('button', { class: 'rm', type: 'button', disabled: ro, 'aria-label': 'Remove image ' + (i + 1), onclick: function () { state.gallery.splice(i, 1); drawGallery(); dirtyCheck(); } }, '\u00d7'))));
      });
      if (!state.gallery.length) gal.appendChild(h('p', { class: 'pf-hint', text: 'No gallery images yet. Images of the same width sit side by side: two halves, or three thirds.' }));
      signed(state.gallery.map(function (g) { return g.path; })).then(function () {
        $$('.pf-gal-row', gal).forEach(function (row, i) { var g = state.gallery[i]; if (g && thumbCache[g.path]) row.firstChild.style.backgroundImage = 'url("' + thumbCache[g.path] + '")'; });
      });
    };
    var galBtn = fileBtn('Add images', true, function (files) {
      if (state.gallery.length + files.length > 40) return toast('A project can hold up to 40 gallery images.', true);
      setBusy(true, 'Uploading ' + files.length + ' image' + (files.length > 1 ? 's' : '') + '\u2026');
      files.reduce(function (p, file) {
        return p.then(function () { return upload(file).then(function (x) { state.gallery.push({ path: x.path, alt: '', size: 'full', w: x.w, h: x.h }); drawGallery(); }); });
      }, Promise.resolve()).then(function () { return keepUpload('Images added. Add alt text to each one.'); })
        .catch(function (e) { toast(e.message, true); }).then(function () { setBusy(false); dirtyCheck(); });
    });

    // ---- credits ----
    var crBox = h('div', { class: 'pf-gal' });
    var drawCredits = function () {
      crBox.innerHTML = '';
      state.credits.forEach(function (c, i) {
        var role = input(c.role, { maxlength: 80, placeholder: 'Role', 'aria-label': 'Credit ' + (i + 1) + ' role' });
        var name = input(c.name, { maxlength: 120, placeholder: 'Name or handle', 'aria-label': 'Credit ' + (i + 1) + ' name' });
        role.addEventListener('input', function () { c.role = role.value; dirtyCheck(); });
        name.addEventListener('input', function () { c.name = name.value; dirtyCheck(); });
        crBox.appendChild(h('div', { class: 'pf-cr-row' }, role, name, h('div', { class: 'pf-move' },
          h('button', { type: 'button', disabled: ro || i === 0, 'aria-label': 'Move credit ' + (i + 1) + ' up', onclick: function () { move(state.credits, i, -1, drawCredits); } }, '\u2191'),
          h('button', { type: 'button', disabled: ro || i === state.credits.length - 1, 'aria-label': 'Move credit ' + (i + 1) + ' down', onclick: function () { move(state.credits, i, 1, drawCredits); } }, '\u2193'),
          h('button', { class: 'rm', type: 'button', disabled: ro, 'aria-label': 'Remove credit ' + (i + 1), onclick: function () { state.credits.splice(i, 1); drawCredits(); dirtyCheck(); } }, '\u00d7'))));
      });
    };
    var addCredit = h('button', { class: 'btn ghost', type: 'button', disabled: ro, onclick: function () {
      if (state.credits.length >= 30) return toast('Up to 30 credits.', true);
      state.credits.push({ role: '', name: '' }); drawCredits(); $$('input', crBox).slice(-2)[0].focus();
    } }, 'Add credit');

    // ---- reading the form ----
    function collect() {
      state.title = f.title.value.trim(); state.slug = f.slug.value.trim(); state.client = f.client.value.trim();
      state.year = f.year.value ? +f.year.value : null;
      state.services = $$('input:checked', svcBox).map(function (i) { return i.value; });
      state.industries = $$('input:checked', indBox).map(function (i) { return i.value; });
      ['summary', 'brief', 'approach', 'outcome', 'cover_alt', 'video_url', 'seo_title', 'seo_description'].forEach(function (k) { state[k] = f[k].value.trim(); });
      state.featured = f.featured.checked; state.sort_order = +f.sort_order.value || 0;
      return collectFrom(state);
    }
    function check() {
      var x = collect();
      if (!x.title) return 'Give the project a title.';
      if (!SLUG_RE.test(x.slug)) return 'The slug can only use lowercase letters, numbers and single dashes.';
      if (RESERVED.indexOf(x.slug) > -1) return '\u201c' + x.slug + '\u201d belongs to a built-in page. Pick another slug.';
      if (x.year != null && (x.year < 1990 || x.year > 2100 || x.year % 1)) return 'The year should be between 1990 and 2100.';
      if (x.video_url && !VIDEO_RE.test(x.video_url)) return 'The video link must be a YouTube or Vimeo address.';
      if (x.credits.some(function (c) { return !c.role.trim() || !c.name.trim(); })) return 'Every credit needs both a role and a name (or remove the empty one).';
      if (x.sort_order < -9999 || x.sort_order > 9999) return 'Order must be between -9999 and 9999.';
      return null;
    }
    // what publishing needs (the database checks the same list)
    function missingForPublish() {
      var x = collect(), miss = [];
      if (!x.summary) miss.push('short description');
      if (!x.cover_path) miss.push('cover image');
      if (!x.cover_alt) miss.push('cover alt text');
      if (!x.year) miss.push('year');
      if (!x.services.length) miss.push('at least one service');
      if (x.gallery.some(function (g) { return !(g.alt || '').trim(); })) miss.push('alt text on every gallery image');
      return miss;
    }
    var dirty = function () { return !ro && JSON.stringify(collect()) !== lastSaved; };

    // ---- the public copies of images follow the item's status ----
    function copyPublic(paths) {
      return paths.reduce(function (p, path) {
        return p.then(function () {
          return sb.storage.from('portfolio-drafts').copy(path, path, { destinationBucket: 'portfolio' }).then(function (r) {
            if (r.error && !/exist|duplicate/i.test(r.error.message)) throw new Error('Image copy failed: ' + r.error.message);
          });
        });
      }, Promise.resolve());
    }
    function removePublic(paths) {
      if (!paths.length) return Promise.resolve();
      return sb.storage.from('portfolio').remove(paths).then(function (r) { if (r.error) throw new Error('Couldn\u2019t take the images offline: ' + r.error.message); });
    }

    function save(silent) {
      var err = check();
      if (err) { toast(err, true); return Promise.reject(new Error(err)); }
      var row = collect(), before = saved ? pathsOf(saved) : [];
      var go = function () {
        setBusy(true, 'Saving\u2026');
        var q = isNew ? sb.from('portfolio_items').insert(Object.assign({ id: id }, row)).select().single()
          : sb.from('portfolio_items').update(row).eq('id', id).select().single();
        return q.then(function (r) {
          if (r.error) throw new Error(pfError(r.error));
          var now = pathsOf(r.data), gone = before.filter(function (p) { return now.indexOf(p) < 0; });
          var sync = r.data.status === 'published' ? copyPublic(now).then(function () { return removePublic(gone); }) : Promise.resolve();
          return sync.then(function () {
            // files no longer used by the item are cleared from the drafts bucket too
            if (gone.length) sb.storage.from('portfolio-drafts').remove(gone);
            saved = r.data; state = JSON.parse(JSON.stringify(r.data)); isNew = false;
            lastSaved = JSON.stringify(collectFrom(state));
            // the rows edit the objects in state, so they're rebuilt around the fresh copy
            drawGallery(); drawCredits();
            history.replaceState(null, '', '#portfolio/' + id);
            if (!silent) toast(saved.status === 'published' ? 'Saved. The live page is updated.' : 'Draft saved.');
            pfLoad(); refreshUi();
          });
        }).catch(function (e) { toast(e.message, true); throw e; }).then(function (v) { setBusy(false); return v; }, function (e) { setBusy(false); throw e; });
      };
      if (saved && saved.status === 'published' && !silent) {
        return ask('Update the live page?', '\u201c' + row.title + '\u201d is published. Saving changes what visitors see on the website right away.', 'Save and update').then(function (ok) {
          if (!ok) throw new Error('cancelled');
          return go();
        });
      }
      return go();
    }
    // Unsaved edits are saved before a preview or a status change. On a published item that would put them on
    // the website, so it asks first, the same way Save does; a draft saves quietly.
    var isLive = function () { return !!(saved && saved.status === 'published'); };
    var saveFirst = function () { return dirty() || isNew ? save(!isLive()) : Promise.resolve(); };

    function setStatus(next, confirmText, okLabel, danger) {
      var title = (collect().title || 'this item');
      var steps = function () {
        setBusy(true, 'Working\u2026');
        return sb.from('portfolio_items').update({ status: next }).eq('id', id).select().single().then(function (r) {
          if (r.error) throw new Error(r.error.code === '22023' ? r.error.message.replace('Missing:', 'Still needed:') : pfError(r.error));
          var paths = pathsOf(r.data);
          var sync = next === 'published'
            ? copyPublic(paths).catch(function (e) {
                // the page can't go live without its images: put it back to draft and say why
                return sb.from('portfolio_items').update({ status: 'draft' }).eq('id', id).then(function () { throw e; });
              })
            : removePublic(paths);
          var was = saved ? saved.status : null;
          return sync.then(function () {
            saved = r.data; state.status = r.data.status; state.published_at = r.data.published_at;
            toast({ published: 'Published. It\u2019s on the Work page now.', draft: was === 'archived' ? 'Restored as a draft.' : 'Back to draft. It\u2019s off the website.', archived: 'Archived. It\u2019s off the website.' }[next]);
            pfLoad(); refreshUi();
          });
        }).catch(function (e) { toast(e.message, true); }).then(function () { setBusy(false); });
      };
      // Taking a live page down: confirm first, then keep any unsaved edits in the draft, so they never go live
      // (and Cancel leaves the live page exactly as it was).
      if (isLive() && next !== 'published') {
        var body = confirmText[1] + (dirty() ? ' Your unsaved changes are kept in the draft.' : '');
        return ask(confirmText[0].replace('%', title), body, okLabel, danger)
          .then(function (ok) { if (ok) return steps().then(function () { if (!isLive() && dirty()) return save(true); }); })
          .catch(function () {});
      }
      return saveFirst().then(function () { return ask(confirmText[0].replace('%', title), confirmText[1], okLabel, danger); })
        .then(function (ok) { if (ok) return steps(); }).catch(function () {});
    }
    var publish = function () {
      var miss = missingForPublish();
      if (check()) return toast(check(), true);
      if (miss.length) return toast('To publish, add: ' + miss.join(', ') + '.', true);
      setStatus('published', ['Publish \u201c%\u201d?', 'It will appear on the Work page for everyone. You can unpublish it at any time.'], 'Publish');
    };
    var unpublish = function () { setStatus('draft', ['Unpublish \u201c%\u201d?', 'It comes off the Work page and its link stops working. It stays here as a draft.'], 'Unpublish', true); };
    var archive = function () { setStatus('archived', ['Archive \u201c%\u201d?', 'It leaves the website and the default list. Nothing is deleted; you can restore it later.'], 'Archive', true); };
    var restore = function () { setStatus('draft', ['Restore \u201c%\u201d as a draft?', 'It comes back to the list as a draft. It won\u2019t be public until you publish it.'], 'Restore'); };
    var preview = function () {
      // open the tab right away (so it isn't blocked), then point it at the page once saved
      var w = window.open('about:blank', '_blank');
      saveFirst().then(function () {
        if (w) { w.opener = null; w.location.href = viewUrl(state.slug, true); } else location.href = viewUrl(state.slug, true);
      }).catch(function () { if (w) w.close(); });
    };

    // ---- the action bar ----
    var pill = h('span', { class: 'adm-pill' }), stateText = h('span', {});
    var bSave = h('button', { class: 'btn', type: 'button', disabled: ro, onclick: function () { save(false).catch(function () {}); } }, 'Save');
    var bPreview = h('button', { class: 'btn ghost', type: 'button', onclick: preview }, 'Preview');
    var bPublish = h('button', { class: 'btn ghost', type: 'button', disabled: ro }, 'Publish');
    var bArchive = h('button', { class: 'btn ghost', type: 'button', disabled: ro }, 'Archive');
    var bView = h('a', { class: 'btn ghost', target: '_blank', rel: 'noopener' }, 'View live');
    function refreshUi() {
      var st = state.status || 'draft';
      pill.className = 'adm-pill' + (st === 'published' ? ' is-live' : st === 'archived' ? ' is-arch' : '');
      pill.textContent = isNew ? 'New draft' : PF_STATUS[st];
      stateText.textContent = ro ? 'Viewers can read only.' : isNew ? 'Not saved yet' : (dirty() ? 'Unsaved changes' : 'Saved ' + ago(saved.updated_at));
      bSave.textContent = st === 'published' ? 'Save and update live' : 'Save draft';
      bPublish.textContent = st === 'published' ? 'Unpublish' : 'Publish';
      bPublish.onclick = st === 'published' ? unpublish : publish;
      bPublish.hidden = st === 'archived';
      bArchive.textContent = st === 'archived' ? 'Restore' : 'Archive';
      bArchive.onclick = st === 'archived' ? restore : archive;
      bArchive.hidden = isNew;
      bPreview.hidden = isNew && ro;
      bView.hidden = st !== 'published' || isNew;
      bView.href = viewUrl(state.slug, false);
      slugHint.textContent = f.slug.value ? 'Address: ' + location.host + '/work/view?p=' + f.slug.value : '';
      if (st === 'published') slugHint.textContent += '. It\u2019s live: changing the slug breaks links already shared.';
    }
    function setBusy(on, text) {
      busy = on;
      [bSave, bPreview, bPublish, bArchive].forEach(function (b) { b.disabled = on || (ro && b !== bPreview); });
      if (on) stateText.textContent = text || 'Working\u2026'; else refreshUi();
    }
    function dirtyCheck() { if (!busy) refreshUi(); }

    f.title.addEventListener('input', function () { if (!slugTouched) f.slug.value = slugify(f.title.value); dirtyCheck(); });
    f.slug.addEventListener('input', function () { slugTouched = true; f.slug.value = f.slug.value.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-{2,}/g, '-'); dirtyCheck(); });

    var form = h('div', { class: 'pf-ed' },
      h('h2', { text: isNew ? 'New portfolio item' : state.title }),
      h('p', { class: 'lead-line', text: isNew ? 'Starts as a private draft.' : 'Created ' + date(state.created_at) + (state.published_at ? ' \u00b7 first published ' + date(state.published_at) : '') }),
      sec('Basics', h('div', { class: 'adm-controls' },
        h('label', { class: 'wide' }, 'Title', f.title),
        h('label', { class: 'wide' }, 'Slug', f.slug, slugHint),
        h('label', {}, 'Client', f.client), h('label', {}, 'Year', f.year)),
        h('div', { class: 'adm-controls', style: 'margin-top:14px' },
          h('label', { class: 'wide' }, 'Services (the Work page filters and the tag line)', svcBox),
          h('label', { class: 'wide' }, 'Industry', indBox))),
      sec('Story', h('div', { class: 'adm-controls' },
        h('label', { class: 'wide' }, 'Short description', f.summary, counter(f.summary, 300)),
        h('label', { class: 'wide' }, 'Brief (optional)', f.brief),
        h('label', { class: 'wide' }, 'Approach (optional)', f.approach),
        h('label', { class: 'wide' }, 'Outcome (optional)', f.outcome),
        h('span', { class: 'pf-hint wide', text: 'Brief, approach and outcome become the paragraphs on the project page. Leave a blank line to start a new paragraph.' }))),
      sec('Cover image', h('div', { class: 'pf-cover' }, coverImg, h('div', { class: 'adm-controls', style: 'grid-template-columns:1fr' },
        h('label', {}, 'Alt text', f.cover_alt),
        h('span', { class: 'pf-hint', text: 'JPG, PNG, WebP or AVIF, up to ' + MAX_MB + ' MB. Shown as the big image at the top of the page and on the Work card (cropped 3:4).' }),
        h('div', { class: 'adm-row' }, coverBtn)))),
      sec('Gallery', h('div', { class: 'adm-row' }, galBtn), gal),
      sec('Film', h('div', { class: 'adm-controls' }, h('label', { class: 'wide' }, 'Video link (optional)', f.video_url,
        h('span', { class: 'pf-hint', text: 'YouTube or Vimeo, unlisted Vimeo links included. Shown above the gallery.' })))),
      sec('Credits', crBox, h('div', { class: 'adm-row' }, addCredit)),
      sec('Search & sharing', h('div', { class: 'adm-controls' },
        h('label', { class: 'wide' }, 'SEO title (optional)', f.seo_title, counter(f.seo_title, 70)),
        h('label', { class: 'wide' }, 'Meta description (optional)', f.seo_description, counter(f.seo_description, 160)),
        h('span', { class: 'pf-hint wide', text: 'Left empty, the title and short description are used.' }))),
      sec('On the Work page', h('div', { class: 'adm-controls' },
        h('label', { class: 'adm-check' }, f.featured, 'Featured: show before the other projects'),
        h('label', {}, 'Order (lower comes first)', f.sort_order))),
      h('div', { class: 'pf-actions' }, h('span', { class: 'pf-state' }, pill, stateText), bSave, bPreview, bView, bPublish, bArchive)
    );
    form.addEventListener('input', dirtyCheck);
    form.addEventListener('change', dirtyCheck);
    openDrawer(form, true);
    drawerGuard = dirty;
    drawCover(); drawGallery(); drawCredits(); refreshUi();
    if (state.cover_path) signed([state.cover_path]).then(drawCover);
    if (isNew) f.title.focus();
  }

  // Full copy of every table as one JSON file (the free backup: download it regularly and keep it somewhere safe)
  var BACKUP = ['inquiries', 'applicants', 'applicant_skills', 'applicant_files', 'applicant_notes',
    'network_profiles', 'network_profile_skills', 'network_profile_files', 'network_profile_notes', 'jobs', 'skills', 'team_members',
    'portfolio_items', 'activity_log', 'clients', 'projects', 'project_money', 'crew', 'kas_entries', 'documents', 'manual_leads',
    'sheet_values', 'sync_outbox', 'sync_changes', 'sync_issues'];
  $('[data-action="backup"]', $('[data-panel="settings"]')).addEventListener('click', function (e) {
    var btn = e.currentTarget, out = { made_at: new Date().toISOString(), tables: {} };
    var grab = function (table, from) {
      return sb.from(table).select('*').range(from, from + 999).then(function (r) {
        if (r.error) throw new Error(table + ': ' + r.error.message);
        out.tables[table] = (out.tables[table] || []).concat(r.data || []);
        if ((r.data || []).length === 1000) return grab(table, from + 1000);
      });
    };
    btn.disabled = true; toast('Preparing backup…');
    BACKUP.reduce(function (p, t) { return p.then(function () { return grab(t, 0); }); }, Promise.resolve()).then(function () {
      var blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
      var link = h('a', { href: URL.createObjectURL(blob), download: 'ccc-backup-' + out.made_at.slice(0, 10) + '.json' });
      document.body.appendChild(link); link.click(); link.remove();
      var n = BACKUP.reduce(function (s, t) { return s + out.tables[t].length; }, 0);
      toast('Backup downloaded: ' + n + ' records.');
    }).catch(fail).then(function () { btn.disabled = false; });
  });

  // for the pages in admin/eco/
  window.cccAdmin = {
    sb: sb, DEV: DEV, SB_URL: SB_URL, $: $, $$: $$, h: h, add: add, sec: sec, kv: kv, select: select, ask: ask, toast: toast, fail: fail,
    date: date, dateTime: dateTime, ago: ago, safeUrl: safeUrl, openDrawer: openDrawer, closeDrawer: closeDrawer,
    guard: function (fn) { drawerGuard = fn; }, onSignedIn: function (fn) { signedIn.push(fn); },
    loaders: loaders, openers: openers, actions: actions, me: function () { return me; },
    canEdit: canEdit, isOwner: isOwner, canMoney: canMoney, refreshBadges: refreshBadges, badge: badge
  };
})();
