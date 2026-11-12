/* CCC admin core: sign in, the sidebar and addresses, drawers and the website portfolio. The pages in admin/eco/
   (overview, leads, clients, projects, people for careers and the creative network, crew, documents, finance,
   reports, settings) build on window.cccAdmin, set at the end of this file.
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
  // address, so the reset form stays up until the new password is saved. Links from team-access emails (an invitation
  // or a reset) look like admin/#set=<token>&t=invite|recovery; they are taken off the address straight away.
  var LINK = /^#set=([\w%-]+)&t=(invite|recovery)$/.exec(location.hash);
  if (LINK) history.replaceState(null, '', location.pathname + location.search);
  var recovering = !!LINK || /type=recovery/.test(location.hash + location.search), linking = !!LINK;
  // the sign in library comes from a CDN: when it didn't load (offline, or blocked), say so rather than wait forever
  if (!window.supabase) {
    Array.prototype.forEach.call(document.querySelectorAll('[data-view]'), function (v) { v.hidden = v.getAttribute('data-view') !== 'offline'; });
    Array.prototype.forEach.call(document.querySelectorAll('[data-view="offline"] [data-action="signout"]'), function (b) { b.hidden = true; });
    var again = document.querySelector('[data-view="offline"] [data-action="recheck"]');
    if (again) again.addEventListener('click', function () { location.reload(); });
    return;
  }
  var sb = window.supabase.createClient(SB_URL, SB_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  Array.prototype.forEach.call(document.querySelectorAll('[data-env]'), function (el) { el.hidden = !DEV; });

  var me = null, signedIn = [];
  var canEdit = function () { return me && (me.role === 'owner' || me.role === 'admin'); };
  var isOwner = function () { return me && me.role === 'owner'; };
  // amounts, Finance, the Kas and the Sheet's figures: owners always, others once an owner turns it on (the database checks again)
  var canMoney = function () { return !!(me && me.money); };

  // ---------- small helpers ----------
  var ROLE_LABEL = { owner: 'Owner', admin: 'Admin', viewer: 'Viewer' };
  // an icon from the sprite in index.html (the mockup's set)
  var SVG = 'http://www.w3.org/2000/svg';
  function icon(name, cls) {
    var s = document.createElementNS(SVG, 'svg'), u = document.createElementNS(SVG, 'use');
    s.setAttribute('class', 'i' + (cls ? ' ' + cls : '')); s.setAttribute('aria-hidden', 'true'); s.setAttribute('focusable', 'false');
    u.setAttribute('href', '#i-' + name); s.appendChild(u);
    return s;
  }
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
  // Two steps: the password (Supabase Auth), then a 6 digit code that the team-access function emails to the person.
  // Once codes are on, the database reads nothing for a sign in that hasn't passed one (20261105_two_step); this page
  // only follows what team-access says.
  var loginForm = $('[data-form="login"]'), loginMsg = $('.adm-msg', loginForm);
  var say = function (el, text, bad) { el.textContent = text; el.classList.toggle('is-error', !!bad); };
  // team-access answers {status, body}; only a failed connection rejects
  function access(action, body) {
    return sb.functions.invoke('team-access', { body: Object.assign({ action: action }, body || {}) }).then(function (r) {
      if (!r.error) return { status: 200, body: r.data || {} };
      var res = r.error.context;
      if (!res || typeof res.json !== 'function') throw r.error;
      return res.json().catch(function () { return {}; }).then(function (b) { return { status: res.status, body: b || {} }; });
    });
  }
  loginForm.addEventListener('submit', function (e) {
    e.preventDefault();
    say(loginMsg, 'Signing in…');
    sb.auth.signInWithPassword({ email: loginForm.email.value.trim(), password: loginForm.password.value }).then(function (r) {
      if (r.error) say(loginMsg, r.error.message, true);
      else { say(loginMsg, ''); loginForm.password.value = ''; }
    });
  });
  // the link comes from team-access (Gmail); before email is set up there, from Supabase Auth as before
  $('[data-action="forgot"]').addEventListener('click', function () {
    var email = loginForm.email.value.trim();
    if (!email) { say(loginMsg, 'Type your email above first.', true); return; }
    say(loginMsg, 'Sending…');
    var viaAuth = function () { return sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname }); };
    access('reset', { email: email }).then(function (a) {
      if (a.status === 200) return { error: null };
      if (a.body.code === 'mail_not_configured') return viaAuth();
      return { error: { message: a.body.error || 'The link couldn’t be sent. Try again.' } };
    }, viaAuth).then(function (r) {
      say(loginMsg, r.error ? r.error.message : 'If that email is on the team, a link to set a new password is on its way.', !!r.error);
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

  // ---------- the code from the email ----------
  var codeForm = $('[data-form="code"]'), codeMsg = $('.adm-msg', codeForm), codeBtn = $('button[type="submit"]', codeForm);
  var skipBtn = $('[data-action="skip-code"]', codeForm);
  var pass = null, checkedAt = 0; // team-access status for this sign in: {member, verified, required, mail, code_live}
  var offline = function () { say(codeMsg, 'Couldn’t reach the admin. Check the connection and try again.', true); };
  function askCode() {
    show('code');
    skipBtn.hidden = true;
    codeForm.code.value = '';
    codeForm.code.focus();
    if (pass.code_live) say(codeMsg, ''); else sendCode();
  }
  // before codes are required, an email problem mustn't lock anyone out: the password alone still works then
  var allowSkip = function () { if (pass && !pass.required) skipBtn.hidden = false; };
  function sendCode() {
    say(codeMsg, 'Sending a code…');
    access('send').then(function (a) {
      if (a.status === 401) return sb.auth.signOut();
      if (a.status === 200 && a.body.verified) return passed();
      if (a.status === 200 && a.body.sent) return say(codeMsg, 'Sent. It can take a minute, so check the spam folder too.');
      if (a.status === 200 && a.body.wait) return say(codeMsg, 'A code is on its way. You can ask for another in ' + a.body.wait + ' seconds.');
      say(codeMsg, a.body.error || 'The code couldn’t be sent. Try again.', true);
      allowSkip();
    }, function () { offline(); allowSkip(); });
  }
  codeForm.addEventListener('submit', function (e) {
    e.preventDefault();
    if (codeBtn.disabled) return;
    var code = codeForm.code.value.replace(/\D/g, '');
    if (code.length !== 6) { say(codeMsg, 'Enter the 6 digit code from the email.', true); return; }
    say(codeMsg, 'Checking…');
    codeBtn.disabled = true;
    access('verify', { code: code }).then(function (a) {
      codeBtn.disabled = false;
      if (a.status === 401) return sb.auth.signOut();
      if (a.status === 200 && a.body.ok) { pass.verified = true; if (a.body.turned_on) pass.required = true; return passed(); }
      say(codeMsg, a.body.error || 'That code didn’t work. Send a new one.', true);
      codeForm.code.select();
    }, function () { codeBtn.disabled = false; offline(); });
  });
  // six digits typed or filled in from the email: check them straight away
  codeForm.code.addEventListener('input', function () {
    if (codeForm.code.value.replace(/\D/g, '').length === 6 && codeForm.requestSubmit) codeForm.requestSubmit();
  });
  $('[data-action="resend"]', codeForm).addEventListener('click', sendCode);
  skipBtn.addEventListener('click', function () { if (pass && !pass.required) passed(); });
  function passed() {
    say(codeMsg, ''); codeForm.code.value = '';
    sb.auth.getSession().then(function (s) { if (s.data.session) enter(s.data.session); else show('login'); });
  }
  $('[data-action="recheck"]').addEventListener('click', function () {
    sb.auth.getSession().then(function (s) { route(s.data.session); });
  });

  // a link from an invitation or a reset email signs the person in, then asks for a password
  if (LINK) sb.auth.verifyOtp({ token_hash: decodeURIComponent(LINK[1]), type: LINK[2] }).then(function (r) {
    linking = false;
    if (!r.error) {
      $('[data-reset-title]').textContent = LINK[2] === 'invite' ? 'Set your password' : 'Set a new password';
      show('reset');
      return;
    }
    recovering = false;
    sb.auth.getSession().then(function (s) {
      route(s.data.session);
      if (!s.data.session) say(loginMsg, 'That link has expired or was used already. Type your email and use Forgot password for a new one.', true);
    });
  });

  // the pages in admin/eco/ load after this file; opening the first page waits for them
  var ready = new Promise(function (go) { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go); else go(); });
  var routing = false;
  function route(session) {
    if (!session) { me = null; pass = null; if (!linking) show('login'); return; }
    // the auth library repeats "signed in" when the tab comes back into view: same person, nothing to redo
    // (re-routing would close an open record and lose what was being typed)
    if (me && me.id === session.user.id) return;
    if (routing) return; routing = true;
    $$('[data-me-email]').forEach(function (el) { el.textContent = session.user.email; });
    access('status').then(function (a) {
      if (a.status === 401) { routing = false; sb.auth.signOut(); return; }
      if (a.status !== 200) throw new Error(a.body.error || 'team-access ' + a.status);
      routing = false;
      pass = a.body; checkedAt = Date.now();
      if (recovering) return; // a reset link turned up meanwhile: the reset form stays
      if (!pass.member) { show('denied'); return; }
      if (!pass.verified && (pass.required || pass.mail)) { askCode(); return; }
      enter(session);
    }).catch(function () { routing = false; if (!recovering) show('offline'); });
  }
  function enter(session) {
    if (routing) return; routing = true;
    sb.from('team_members').select('role, full_name, email, can_see_money').eq('user_id', session.user.id).maybeSingle().then(function (r) {
      routing = false;
      if (recovering) return; // a reset link turned up meanwhile: the reset form stays
      $$('[data-me-email]').forEach(function (el) { el.textContent = session.user.email; });
      if (r.error) { show('offline'); return; }
      if (!r.data) { show('denied'); return; }
      me = { id: session.user.id, email: session.user.email, role: r.data.role, name: r.data.full_name,
        money: r.data.role === 'owner' || r.data.can_see_money === true };
      // the card at the foot of the sidebar: name (or the address before the @), role, an initial
      var who = me.name && String(me.name).trim() ? String(me.name).trim() : me.email.split('@')[0];
      $$('[data-me-name]').forEach(function (el) { el.textContent = who; });
      $$('[data-me-role]').forEach(function (el) { el.textContent = ROLE_LABEL[me.role] || me.role; });
      $$('[data-me-initial]').forEach(function (el) { el.textContent = who.charAt(0).toUpperCase(); });
      $$('[data-edit-only]').forEach(function (el) { el.hidden = !canEdit(); });
      $$('[data-owner-only]').forEach(function (el) { el.hidden = !isOwner(); });
      $$('[data-money-only]').forEach(function (el) { el.hidden = !canMoney(); });
      $$('[data-edit-or-money]').forEach(function (el) { el.hidden = !canEdit() && !canMoney(); });
      $$('[data-env]').forEach(function (el) { el.hidden = !DEV; });
      show('app');
      refreshBadges();
      ready.then(function () {
        signedIn.forEach(function (fn) { fn(me); });
        openTab();
      });
    });
  }
  sb.auth.onAuthStateChange(function (event, session) {
    if (event === 'PASSWORD_RECOVERY') { recovering = true; show('reset'); return; }
    // a fresh page after signing out: nothing one person loaded stays in memory or on the page for the next
    if (event === 'SIGNED_OUT') { recovering = false; pass = null; var was = me; me = null; show('login'); if (was) location.reload(); return; }
    // the reset link's own sign-in must not swap the reset form for the dashboard
    if (recovering && session) { show('reset'); return; }
    if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') route(session);
    if (event === 'TOKEN_REFRESHED') recheck();
  });
  // a sign in can lose its pass while the page is open (codes switched on, taken off the team): look again now and then
  function recheck() {
    if (!me || Date.now() - checkedAt < 600000) return;
    checkedAt = Date.now();
    access('status').then(function (a) {
      if (a.status === 401) return sb.auth.signOut();
      if (a.status === 200 && (!a.body.member || (a.body.required && !a.body.verified))) location.reload();
    }, function () {});
  }
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') recheck(); });

  // ---------- sections (sidebar) ----------
  // #tab or #tab/<record id>; old addresses keep working
  var loaders = {}, openers = {}, actions = {};
  var TITLES = { overview: 'Overview', leads: 'Leads', clients: 'Clients', projects: 'Projects', calendar: 'Calendar', crew: 'Crew & Vendors',
    network: 'Crew & Vendors', documents: 'Documents', finance: 'Finance', reports: 'Reports', portfolio: 'Website & Portfolio',
    applicants: 'Careers', jobs: 'Careers', settings: 'Settings' };
  var ALIAS = { inquiries: 'leads', team: 'settings', careers: 'applicants' };
  // pages where #tab/<id> is a page of its own rather than a drawer over the list
  var PAGED = { projects: true };
  // a page inside another sidebar item (its tabs show at the top of the page)
  var UNDER = { applicants: 'careers', jobs: 'careers', network: 'crew' };
  // one short line under each page title
  var SUBS = {
    leads: 'Contact form messages and the leads you add',
    clients: 'From the Client tab in the Sheet',
    // projects: set by projects.js once the list is in (how many are active, how many in all)
    calendar: function () {
      var k = ['Shoots', 'file deadlines'].concat(canMoney() ? ['payments'] : [], canEdit() ? ['lead follow ups'] : []);
      return k.slice(0, -1).join(', ') + ' and ' + k[k.length - 1] + ', month by month';
    },
    // the mockup's line; each part only for those who can open it (the crew list needs money access, the network an owner or admin)
    crew: function () { return crewSub(); },
    network: function () { return crewSub(); },
    documents: function () { return canMoney() ? 'Quotes, invoices, receipts, contracts and briefs in Google Drive' : 'Contracts, briefs and other project files in Google Drive'; },
    finance: 'What to collect and the Kas, from the Sheet',
    reports: function () { return canMoney() ? 'The year from the Keuangan tab, checked against each project' : 'Leads by source and month'; },
    portfolio: 'Projects for the Work page. Drafts stay private until you publish.',
    applicants: 'Applications for the team and internships, and the roles on the Careers page',
    jobs: function () { return canEdit() ? 'Applications for the team and internships, and the roles on the Careers page' : 'The roles on the Careers page'; },
    // the mockup's line, with what this account sees there (bank details with money access, backups for owners)
    settings: function () {
      var k = ['Who can use the admin', 'the Google Sheet connection'].concat(canMoney() ? ['bank details'] : [], isOwner() ? ['backups'] : []);
      return k.slice(0, -1).join(', ') + ' and ' + k[k.length - 1];
    }
  };
  var crewSub = function () {
    return canMoney() && canEdit() ? 'The crew list from the Sheet, and people who want to work with us'
      : canMoney() ? 'The crew list from the Sheet, with rates and what each person is owed' : 'People who want to work with us';
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
    // the Overview opens on its photo greeting (built by overview.js); every other page names itself in a plain header
    var hero = tab === 'overview';
    $('[data-head]').hidden = hero;
    $('[data-page-title]').textContent = TITLES[tab];
    var sub = SUBS[tab];
    $('[data-page-sub]').textContent = hero ? '' : typeof sub === 'function' ? sub() : (sub || '');
    var act = $('[data-page-actions]'); act.innerHTML = '';
    if (actions[tab] && !hero) add(act, actions[tab]());
    document.title = TITLES[tab] + ' | CCC Admin';
    sideOpen(false);
    closeDrawer(true);
    pageGuard = null; pageHash = '';
    if (loaders[tab]) loaders[tab]();
    if (id && openers[tab]) openers[tab](id);
  }
  window.addEventListener('hashchange', function () {
    if (!me) return;
    // leaving an unsaved editor (in a drawer or on a page of its own) asks first; staying puts the address back
    var inDrawer = !!(drawerGuard && drawerGuard()), onPage = !inDrawer && !!(pageGuard && pageGuard());
    if (inDrawer || onPage) {
      var to = location.hash;
      history.replaceState(null, '', inDrawer ? drawerHash : pageHash);
      ask('Leave without saving?', 'Your changes haven\u2019t been saved.', 'Leave', true).then(function (go) {
        if (go) { drawerGuard = null; pageGuard = null; history.replaceState(null, '', to); openTab(); }
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
  var drawerGuard = null, drawerHash = '', drawerFrom = null, pageGuard = null, pageHash = '';
  function openDrawer(content, wide) {
    // drawn again in place (after a save, say): focus goes back to what opened it in the first place, not to a button that is gone
    var was = document.activeElement;
    if (drawer.hidden || !drawer.contains(was)) drawerFrom = was;
    drawerGuard = null;
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
    // the address goes back to the list, and focus to where it was; on the way to another page (a month on the
    // Calendar, say) the new address stays as it is
    // (a page of its own keeps its address: the drawer only sat over it)
    var tab = (location.hash.slice(1).split('/')[0]) || 'overview', own = drawerHash.slice(1).split('/')[0] || 'overview';
    if (location.hash.indexOf('/') > -1 && tab === own && !PAGED[tab]) history.replaceState(null, '', '#' + tab);
    // when the list behind was drawn again meanwhile (after a save, say), to the same record's link in the new list
    var back = drawerFrom;
    if (back && !document.contains(back)) {
      var href = back.getAttribute && back.getAttribute('href');
      back = href ? $$('a[href]').filter(function (a) { return a.getAttribute('href') === href && a.offsetParent !== null; })[0] : null;
    }
    if (back) back.focus();
  }
  $('[data-action="close"]').addEventListener('click', function () { closeDrawer(); });
  scrim.addEventListener('click', function () { closeDrawer(); });
  document.addEventListener('keydown', function (e) {
    // after this key press, or the same Escape would at once dismiss the confirm it opens
    if (e.key === 'Escape' && !drawer.hidden && !askBox.open) { e.preventDefault(); setTimeout(closeDrawer, 0); }
  });
  window.addEventListener('beforeunload', function (e) {
    if ((drawerGuard && drawerGuard()) || (pageGuard && pageGuard())) { e.preventDefault(); e.returnValue = ''; }
  });
  var sec = function (title) { var s = h('section', { class: 'adm-sec' }, h('h3', { text: title })); for (var i = 1; i < arguments.length; i++) add(s, arguments[i]); return s; };
  var kv = function (pairs) {
    var dl = h('dl', { class: 'adm-kv' });
    pairs.forEach(function (p) { if (p[1] == null || p[1] === '' || (Array.isArray(p[1]) && !p[1].length)) return; dl.appendChild(h('dt', { text: p[0] })); dl.appendChild(h('dd', {}, p[1])); });
    return dl;
  };

  // ================= OVERVIEW (built by admin/eco/overview.js) =================
  var overviewSub = function () {
    return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jakarta', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date());
  };
  // Jakarta time: morning until 11, afternoon until 15, evening after; the first name when the team list has one
  var greeting = function () {
    var hr = +new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jakarta', hour: 'numeric', hourCycle: 'h23' }).format(new Date());
    var part = hr >= 4 && hr < 11 ? 'Good morning' : hr >= 11 && hr < 15 ? 'Good afternoon' : 'Good evening';
    var first = me && me.name ? String(me.name).trim().split(/\s+/)[0] : '';
    return first ? part + ', ' + first : part;
  };

  // ================= WEBSITE & PORTFOLIO =================
  var SERVICES = [['creative-direction', 'Creative Direction'], ['branding', 'Branding'], ['visual-identity', 'Visual Identity'], ['campaign', 'Campaign'],
    ['photography', 'Photography'], ['film', 'Film'], ['motion', 'Motion'], ['illustration', 'Illustration'], ['experience', 'Experience'],
    ['production', 'Production'], ['experimental', 'Experimental']];
  var INDUSTRIES = [['fashion', 'Fashion'], ['sport', 'Sport'], ['food-beverage', 'Food & Beverage']];
  // Services and industries of the owner's own, typed in the editor beside the lists above (20261112_portfolio_categories:
  // services_custom and industries_custom). The database checks the same rule: 2 to 30 characters of letters A to Z,
  // digits, single spaces and & + / . ' with a hyphen only inside a word, and up to 6 of each kind on a project.
  var OWN_MAX = 6, OWN_LEN = 30;
  var OWN_RE = /^[A-Za-z0-9&+\/.']+(-[A-Za-z0-9&+\/.']+)*( [A-Za-z0-9&+\/.']+(-[A-Za-z0-9&+\/.']+)*)*$/;
  // A label's key, as the database's private.category_key and the Work page's filter: case, spaces and signs don't
  // count and the word "and" counts as "&", so Food and Beverage is food-beverage like Food & Beverage. A label that is
  // only "and" keeps it. Two labels are one when their keys are.
  var catKey = function (t) {
    var s = String(t || '').toLowerCase(), slug = function (x) { return x.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); };
    return slug(s.replace(/\band\b/g, '-')) || slug(s);
  };
  var catSame = function (a, b) { return catKey(a) === catKey(b); };
  var byLabel = function (a, b) { return a.localeCompare(b, 'en', { sensitivity: 'base' }); };
  // the case studies written into the site's code, with the picture their Work card uses
  var BUILT_IN = [['MOVANA', 'movana', 2026, 'movana/thumb.jpg'], ['Whitebeard', 'whitebeard', 2026, 'whitebeard/tshirt.jpg'],
    ['NOXON', 'noxon', 2026, 'noxon/thumb.jpg'], ['Citarasa Tradisi', 'tradisi', 2026, 'tradisi/lychee-poster.jpg']];
  var RESERVED = BUILT_IN.map(function (b) { return b[1]; }).concat(['view']);
  var IMG_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/avif': 'avif' };
  // a photo can be picked at up to 30 MB; it is made web sized before upload (see processImage)
  var MAX_MB = 30;
  // the status as a pill; a published item is on the website, so it reads Live like the built in pages
  var PF_PILL = { draft: ['draft', 'Draft'], published: ['paid', 'Live'], archived: ['brief', 'Archived'] };
  var SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
  // YouTube and Vimeo, including unlisted Vimeo links (vimeo.com/<id>/<hash>) and Vimeo embed links
  // (player.vimeo.com/video/<id>?h=<hash>). The database checks the same pattern.
  var VIDEO_RE = /^https:\/\/((www\.)?(youtube\.com\/watch\?v=[A-Za-z0-9_-]{6,20}|youtu\.be\/[A-Za-z0-9_-]{6,20}|vimeo\.com\/[0-9]{4,12}(\/[0-9a-f]{6,20})?)|player\.vimeo\.com\/video\/[0-9]{4,12})([?&#][A-Za-z0-9_=&.%-]*)?$/;
  var slugify = function (t) { return (t || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80).replace(/-+$/, ''); };
  // every file an item uses: its cover, the gallery, and an uploaded film with its poster
  var pathsOf = function (it) { return [it.cover_path].concat((it.gallery || []).map(function (g) { return g.path; }), [it.video_path, it.video_poster_path]).filter(Boolean); };
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
    // a column this admin writes that the database doesn't have yet (the film's columns before 20261112_portfolio_video)
    if (e && (e.code === 'PGRST204' || /schema cache/i.test(m))) return 'The database isn’t ready for this version of the admin yet. Nothing was saved.';
    // the publish guard (a live item's row is checked on every save): what is still missing
    if (e && e.code === '22023') return m.replace('Missing:', 'Still needed:');
    if (/slug/.test(m)) return 'The slug can only use lowercase letters, numbers and single dashes, and can’t be a built-in project’s name.';
    // the uploaded film's rules (20261112_portfolio_video)
    if (/one_film/.test(m)) return 'A project shows one film: an uploaded video or a link, not both.';
    if (/video_poster/.test(m)) return 'The video’s poster isn’t valid. Choose a frame for it again.';
    if (/video_path|video_size/.test(m)) return 'The uploaded video isn’t valid. Remove it and upload it again.';
    if (/video_url/.test(m)) return 'The video link must be a YouTube or Vimeo address.';
    if (/gallery/.test(m)) return 'A gallery image isn’t valid. Remove it and upload it again.';
    if (/credits/.test(m)) return 'Every credit needs both a role and a name.';
    // services and industries of your own (20261112_portfolio_categories)
    if (/categories_apart/.test(m)) return 'A label of your own can be a service or an industry, not both.';
    if (/services_custom/.test(m)) return 'A service of your own can’t be saved. Use 2 to 30 letters, numbers, spaces or & + / . ’ and up to 6 on a project.';
    if (/industries_custom/.test(m)) return 'An industry of your own can’t be saved. Use 2 to 30 letters, numbers, spaces or & + / . ’ and up to 6 on a project.';
    if (/row-level security|permission denied/.test(m)) return 'Your role can’t change the portfolio. Ask an owner.';
    return m || 'Something went wrong. Nothing was changed.';
  };
  // a day as the other pages write it (3 Nov 2026, in Jakarta)
  var pday = function (t) { var E = window.eco; return t ? E.day(E.jkt(t)) : ''; };
  var pfUid = 0;

  // Drafts are private, so the admin shows them through signed links that last an hour. A link is asked for again
  // after 50 minutes; an image just uploaded is shown from the file itself.
  var thumbCache = {}, thumbUntil = {};
  function signed(paths) {
    var now = Date.now();
    var need = paths.filter(function (p, i) { return p && paths.indexOf(p) === i && !(thumbCache[p] && thumbUntil[p] > now); });
    if (!need.length) return Promise.resolve(thumbCache);
    return sb.storage.from('portfolio-drafts').createSignedUrls(need, 3600).then(function (r) {
      (r.data || []).forEach(function (x) { if (x.signedUrl) { thumbCache[x.path] = x.signedUrl; thumbUntil[x.path] = now + 3e6; } });
      return thumbCache;
    });
  }
  // a cover in a card or in the editor: the picture, or a few words on why there isn't one
  function pfCover(box, path) {
    var url = path && thumbCache[path], tags = $('.tags', box);
    var put = function (el) { box.insertBefore(el, tags); };
    var none = function (t) { box.classList.add('ph'); put(icon('image')); put(h('span', { text: t })); };
    if (!url) return none(path ? 'The cover couldn’t be loaded' : 'No cover yet');
    var img = h('img', { src: url, alt: '', decoding: 'async' });
    img.addEventListener('error', function () { img.remove(); none('The cover couldn’t be loaded'); }, { once: true });
    put(img);
  }

  // ---- photos: checked, made web sized in the browser, uploaded ----
  // A photo (cover or gallery) can be picked at up to 30 MB. Before upload it is decoded the right way up (the
  // camera's orientation applied), scaled down to at most 2560 px on the long edge (never up) and encoded again:
  // WebP where this browser makes it, else JPEG, or PNG for a picture that really has see through pixels. Encoding
  // again leaves the camera's metadata (EXIF, GPS) behind. The buckets take 15 MB a file (their limit stays), so a
  // result still bigger than that is skipped. One file at a time, and each bitmap and canvas is let go of straight
  // after, so a phone doesn't run out of memory.
  var LONG_EDGE = 2560, STORE_MAX = 15728640;
  var OUT_EXT = { 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png' };
  var TYPE_ALIAS = { 'image/jpg': 'image/jpeg', 'image/pjpeg': 'image/jpeg' };
  var EXT_TYPE = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', avif: 'image/avif' };
  // why a file was left out, for one file and for several, as the message words it
  var SKIP = {
    type: ['use JPG, PNG, WebP or AVIF', 'use JPG, PNG, WebP or AVIF'],
    size: ['it’s over ' + MAX_MB + ' MB', 'they’re over ' + MAX_MB + ' MB'],
    decode: ['it couldn’t be read as an image', 'they couldn’t be read as images'],
    encode: ['it couldn’t be resized', 'they couldn’t be resized'],
    big: ['it’s still over 15 MB after resizing', 'they’re still over 15 MB after resizing'],
    full: ['the gallery holds up to 40 images', 'the gallery holds up to 40 images']
  };
  var skipped = function (why) { var e = new Error(SKIP[why][0]); e.skip = why; return e; };
  // the type a picked file is taken as (a file the system didn't type, or typed only as bytes, goes by its extension),
  // or null
  var photoType = function (file) {
    var t = String(file.type || '').toLowerCase(), m;
    t = TYPE_ALIAS[t] || t;
    if ((!t || t === 'application/octet-stream') && (m = /\.([a-z0-9]+)$/i.exec(file.name || ''))) t = EXT_TYPE[m[1].toLowerCase()] || '';
    return IMG_TYPES[t] ? t : null;
  };
  // the checks made on every picked file before any is worked on: null, or why it is left out ('type' or 'size')
  var photoCheck = function (file) { return !photoType(file) ? 'type' : file.size > MAX_MB * 1048576 ? 'size' : null; };
  // whether canvas.toBlob gives WebP in this browser (asked once)
  var webpOk = null;
  function canWebp() {
    if (!webpOk) webpOk = new Promise(function (go) {
      var c = document.createElement('canvas'); c.width = c.height = 1;
      try { c.toBlob(function (b) { go(!!b && b.type === 'image/webp'); }, 'image/webp', 0.82); } catch (e) { go(false); }
    });
    return webpOk;
  }
  // whether any pixel is less than fully opaque, read about 4 MB of rows at a time
  function seeThrough(x, w, hgt) {
    var rows = Math.max(1, Math.floor(1048576 / w));
    for (var y = 0; y < hgt; y += rows) {
      var d = x.getImageData(0, y, w, Math.min(rows, hgt - y)).data;
      for (var i = 3; i < d.length; i += 4) if (d[i] < 255) return true;
    }
    return false;
  }
  // processImage(file) -> Promise<{ blob, ext, type, w, h }>: the web sized file to store, its extension and type
  // (from the encoded result) and its size in pixels. It fails with an Error whose .skip says why
  // ('type', 'size', 'decode', 'encode' or 'big'; SKIP has the words).
  function processImage(file) {
    var type = photoType(file);
    if (!type) return Promise.reject(skipped('type'));
    if (file.size > MAX_MB * 1048576) return Promise.reject(skipped('size'));
    var url = URL.createObjectURL(file), img = new Image(), bmp = null, cv = null, jpeg = type === 'image/jpeg';
    var free = function () {
      if (bmp && bmp.close) bmp.close();
      if (cv) cv.width = cv.height = 0; // gives the canvas memory back now rather than at the next clean up
      img.onload = img.onerror = null; img.removeAttribute('src'); URL.revokeObjectURL(url);
    };
    // what the file is goes by its first bytes where they can be read (a JPEG starts FF D8 FF), not by its name: a
    // PNG saved as .jpg keeps its see through pixels
    return bytesOf(file, 0, 3).then(function (b) {
      var u = new Uint8Array(b);
      jpeg = u.length === 3 && u[0] === 0xFF && u[1] === 0xD8 && u[2] === 0xFF;
    }, function () {}).then(function () {
      return new Promise(function (go, no) {
        // the size it shows at (the camera's orientation applied), read without decoding the pixels yet
        img.onload = go; img.onerror = function () { no(skipped('decode')); };
        img.src = url;
      });
    }).then(function () {
      var w = img.naturalWidth, hgt = img.naturalHeight;
      if (!w || !hgt) throw skipped('decode');
      var k = Math.min(1, LONG_EDGE / Math.max(w, hgt)), tw = Math.max(1, Math.round(w * k)), th = Math.max(1, Math.round(hgt * k));
      // Decoded straight at the web size where the browser can (far less memory on a phone). Only the width is asked
      // for, so the height it comes back with shows whether the camera's orientation was applied; a browser that
      // can't do this, or hands the picture back on its side, has it drawn from the <img> instead.
      var dec = Promise.resolve(null);
      if (window.createImageBitmap) {
        try {
          dec = createImageBitmap(file, { imageOrientation: 'from-image', resizeWidth: tw, resizeQuality: 'high' }).then(function (b) {
            if (Math.abs(b.width / b.height - tw / th) <= 0.01 * tw / th) return b;
            if (b.close) b.close();
            return null;
          }, function () { return null; });
        } catch (e) { dec = Promise.resolve(null); }
      }
      return dec.then(function (b) {
        bmp = b;
        cv = document.createElement('canvas'); cv.width = tw; cv.height = th;
        // a file that can hold see through pixels is read back once drawn, so its canvas stays readable
        var x = cv.getContext('2d', jpeg ? undefined : { willReadFrequently: true });
        if (!x) throw skipped('encode');
        x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
        x.drawImage(b || img, 0, 0, tw, th);
        if (bmp && bmp.close) bmp.close();
        bmp = null;
        var clear = !jpeg && seeThrough(x, tw, th);
        return canWebp().then(function (webp) {
          var out = webp ? ['image/webp', 0.82] : clear ? ['image/png'] : ['image/jpeg', 0.85];
          return new Promise(function (go, no) { cv.toBlob(function (blob) { if (blob) go(blob); else no(skipped('encode')); }, out[0], out[1]); });
        }).then(function (blob) {
          if (!OUT_EXT[blob.type]) throw skipped('encode');
          if (blob.size > STORE_MAX) throw skipped('big');
          return { blob: blob, ext: OUT_EXT[blob.type], type: blob.type, w: tw, h: th };
        });
      });
    }).then(function (out) { free(); return out; }, function (e) { free(); throw e && e.skip ? e : skipped('decode'); });
  }
  // a new name for an item's file: <item uuid>/<base36 time>-<random>.<ext> (the storage rules expect this shape)
  var pfPath = function (item, ext) { return item + '/' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8) + '.' + ext; };
  // pfBuckets(path) -> { draft, live }: where an item's file lives, its private draft and its public copy while the
  // item is live. Films (.mp4) have their own pair; pictures, film posters among them, are in the photo pair.
  var isFilm = function (p) { return /\.mp4$/.test(p || ''); };
  var pfBuckets = function (path) {
    return isFilm(path) ? { draft: 'portfolio-video-drafts', live: 'portfolio-video' } : { draft: 'portfolio-drafts', live: 'portfolio' };
  };
  // an upload's error in words a person can act on
  var upErr = function (e) {
    var m = (e && e.message) || '';
    if (/Failed to fetch|NetworkError|Load failed|network/i.test(m)) return 'the connection failed';
    if (/row-level security|permission|Unauthorized|403/i.test(m)) return 'your role can’t upload images';
    return m || 'the upload failed';
  };
  // putDraft(path, blob, onRetry) -> Promise: one file into its private drafts bucket (cached for a year: every name is
  // new). A failed upload is tried once more, onRetry() first; a name already taken on that second try means the first
  // one got through. It fails with an Error marked .upload.
  function putDraft(path, blob, onRetry) {
    var send = function () {
      return Promise.resolve().then(function () {
        return sb.storage.from(pfBuckets(path).draft).upload(path, blob, { contentType: blob.type, upsert: false, cacheControl: '31536000' });
      }).then(function (r) { if (r && r.error) throw r.error; });
    };
    return send().catch(function () {
      if (onRetry) onRetry();
      return new Promise(function (go) { setTimeout(go, 1000); }).then(send).catch(function (e) {
        if (/already exists|duplicate/i.test((e && e.message) || '')) return;
        var err = new Error(upErr(e)); err.upload = true; throw err;
      });
    });
  }
  // copyPublic(paths, done) -> Promise: the public copies of an item's files, under the same names. A copy that is
  // already there counts as made; done (an array, optional) collects the copies this call made, so a step that fails
  // after them can take them off again.
  function copyPublic(paths, done) {
    return paths.reduce(function (p, path) {
      return p.then(function () {
        var b = pfBuckets(path);
        return sb.storage.from(b.draft).copy(path, path, { destinationBucket: b.live }).then(function (r) {
          if (r.error && !/exist|duplicate/i.test(r.error.message)) throw new Error((isFilm(path) ? 'Video' : 'Image') + ' copy failed: ' + r.error.message);
          if (!r.error && done) done.push(path);
        });
      });
    }, Promise.resolve());
  }
  var byBucket = function (paths, which) {
    var m = {};
    paths.forEach(function (p) { var b = pfBuckets(p)[which]; (m[b] = m[b] || []).push(p); });
    return m;
  };
  // removePublic(paths) -> Promise: the public copies come off (one request a bucket)
  function removePublic(paths) {
    var m = byBucket(paths, 'live');
    return Promise.all(Object.keys(m).map(function (b) {
      return sb.storage.from(b).remove(m[b]).then(function (r) {
        if (r.error) throw new Error('Couldn’t take the ' + (b === 'portfolio-video' ? 'video' : 'images') + ' offline: ' + r.error.message);
      });
    }));
  }
  // removeDrafts(paths): draft files nothing uses any more, best effort (one left behind costs space, nothing else)
  function removeDrafts(paths) {
    var m = byBucket(paths, 'draft');
    Object.keys(m).forEach(function (b) { sb.storage.from(b).remove(m[b]).then(function () {}, function () {}); });
  }
  var forgetThumb = function (p) { if (thumbUntil[p] === Infinity) URL.revokeObjectURL(thumbCache[p]); delete thumbCache[p]; delete thumbUntil[p]; };
  var listOf = function (a) { return a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]; };
  var sentence = function (s) { return String(s || '').trim().replace(/\.?$/, '.'); };
  // skipNote([[name, why, detail]]) -> one message for the files left out, by reason:
  // "a.jpg and b.jpg were skipped: they’re over 30 MB. c.jpg couldn’t be uploaded: the connection failed."
  function skipNote(skips) {
    var groups = [], by = {};
    skips.forEach(function (s) {
      var k = s[1] + '|' + (s[2] || '');
      if (!by[k]) groups.push(by[k] = { why: s[1], detail: s[2], names: [] });
      by[k].names.push(s[0]);
    });
    return groups.map(function (g) {
      var many = g.names.length > 1, names = listOf(g.names);
      if (g.why === 'upload') return names + ' couldn’t be uploaded: ' + sentence(g.detail);
      return names + (many ? ' were' : ' was') + ' skipped: ' + SKIP[g.why][many ? 1 : 0] + '.';
    }).join(' ');
  }
  // a message that stays up long enough to read: one naming several files stays longer than the usual few seconds
  var pfNote = function (msg, err) {
    toast(msg, err);
    var el = $('[data-toast]');
    clearTimeout(toast.t);
    toast.t = setTimeout(function () { el.hidden = true; }, Math.max(err ? 6000 : 2500, Math.min(20000, msg.length * 60)));
  };
  // Files dragged in from the computer: the area shows it takes them (the dashed edge of "Add a cover") and a drop
  // hands them over. can() says whether it takes files right now (not while an upload runs).
  var hasFiles = function (e) { var t = e.dataTransfer && e.dataTransfer.types; return !!t && Array.prototype.indexOf.call(t, 'Files') > -1; };
  function dropOn(el, onFiles, can) {
    var depth = 0, off = function () { depth = 0; el.classList.remove('is-over'); };
    el.classList.add('pf-drop');
    el.addEventListener('dragenter', function (e) { if (!hasFiles(e)) return; e.preventDefault(); depth++; el.classList.toggle('is-over', can()); });
    el.addEventListener('dragover', function (e) { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = can() ? 'copy' : 'none'; });
    el.addEventListener('dragleave', function (e) { if (hasFiles(e) && --depth <= 0) off(); });
    el.addEventListener('drop', function (e) {
      if (!hasFiles(e)) return;
      e.preventDefault(); off();
      var files = Array.prototype.slice.call(e.dataTransfer.files || []);
      if (files.length && can()) onFiles(files);
    });
  }
  // a file let go of beside the drop areas while an editor is open does nothing (the browser would open it in place
  // of the admin and lose what was typed)
  document.addEventListener('dragover', function (e) {
    if (pf.body && document.contains(pf.body) && hasFiles(e) && !e.defaultPrevented) { e.preventDefault(); e.dataTransfer.dropEffect = 'none'; }
  });
  document.addEventListener('drop', function (e) { if (pf.body && document.contains(pf.body) && hasFiles(e)) e.preventDefault(); });

  // ---- films: an MP4 checked in the browser, a poster taken from one of its frames, uploaded with a progress bar ----
  // A project's film can be an MP4 uploaded here (H.264 video, up to 20 MB: the buckets' own limit) instead of a
  // YouTube link. Before anything is sent the file is checked: its type and size, the codec its video track names
  // (read from the file's own boxes), and that this browser plays it (a <video> on the local file gives its size and
  // length, and the poster frame). The storage the whole project uses is asked for too: the Free plan holds 1 GB for
  // everything, and a film is stored twice while it is live (its draft and its public copy).
  var VID_MAX = 20971520, VID_ROOM = 700 * 1048576;
  // a file's size as the messages write it, rounded up so a file just over the limit never reads as the limit
  var mbOf = function (b) { var m = b / 1048576; return (m >= 100 ? Math.ceil(m) : Math.ceil(m * 10) / 10) + ' MB'; };
  // the kind of file picked: 'mp4', 'mov' (QuickTime, which phones and editing apps often export) or null. An .m4v
  // (Final Cut, Compressor, QuickTime and HandBrake name their MP4 exports so; Safari types it video/x-m4v) is an MP4,
  // stored as one: its codec is checked like any other.
  var filmType = function (file) {
    var t = String(file.type || '').toLowerCase(), m = /\.([a-z0-9]+)$/i.exec(file.name || ''), ext = m ? m[1].toLowerCase() : '';
    var untyped = !t || t === 'application/octet-stream';
    if (t === 'video/quicktime' || (untyped && ext === 'mov')) return 'mov';
    if (t === 'video/mp4' || t === 'video/x-m4v' || (untyped && (ext === 'mp4' || ext === 'm4v'))) return 'mp4';
    return null;
  };
  // the video codecs named in a refusal; anything else that isn't H.264 gets the plain message
  var CODEC = { hvc1: 'HEVC (H.265)', hev1: 'HEVC (H.265)', dvh1: 'HEVC (H.265)', dvhe: 'HEVC (H.265)', av01: 'AV1', vp09: 'VP9', vp08: 'VP8',
    apch: 'ProRes', apcn: 'ProRes', apcs: 'ProRes', apco: 'ProRes', ap4h: 'ProRes', ap4x: 'ProRes' };
  // an iPhone or iPad (iPadOS names itself a Mac with touch): one picked from its photo library comes as a MOV, while
  // an MP4 kept in Files comes as it is
  var IOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (/Mac/.test(navigator.platform || '') && navigator.maxTouchPoints > 1);
  var FILM_SAY = {
    type: 'This file isn’t an MP4 video. Export it as MP4 (H.264), up to 20 MB.',
    mov: 'MOV files can’t be uploaded. Export the video as MP4 (H.264), up to 20 MB.' + (IOS ? ' On iPhone or iPad, save the MP4 to Files and pick it with Choose File.' : ''),
    read: 'This file couldn’t be read as an MP4 video. Export it again as MP4 (H.264).',
    none: 'This file has no video in it.',
    play: 'This video couldn’t be played in this browser. Export it as MP4 (H.264) and try again.',
    frame: 'A frame of this video couldn’t be read for the poster. Try again, or export the video again.',
    check: 'Couldn’t check storage space. Try again.',
    full: 'Storage is almost full, so this video wasn’t uploaded. Remove videos or images you no longer need, then try again.'
  };
  // filmErr(why, more) -> an Error whose .film says why a film was turned down (FILM_SAY has the words)
  var filmErr = function (why, more) { var e = new Error(why); e.film = why; if (more) e.more = more; return e; };
  // the message for a film turned down
  var filmSay = function (e) {
    if (e.film === 'size') return 'This video is ' + mbOf(e.more) + '. Videos can be up to 20 MB. Export it at 1080p, about 4 Mbps.';
    if (e.film === 'codec') {
      var c = CODEC[e.more];
      if (c === CODEC.hvc1) return 'This video is HEVC (H.265), which some browsers can’t play. Export it as MP4 (H.264).';
      return c ? 'This video is ' + c + ', not H.264. Export it as MP4 (H.264).' : 'This video isn’t H.264. Export it as MP4 (H.264).';
    }
    return FILM_SAY[e.film] || FILM_SAY.read;
  };
  var cancelled = function () { var e = new Error('Upload cancelled.'); e.cancelled = true; return e; };
  // part of a file as bytes
  var bytesOf = function (file, at, n) {
    var part = file.slice(at, at + n);
    if (part.arrayBuffer) return part.arrayBuffer();
    return new Promise(function (go, no) { var r = new FileReader(); r.onload = function () { go(r.result); }; r.onerror = function () { no(r.error); }; r.readAsArrayBuffer(part); });
  };
  var fourcc = function (v, at) { return String.fromCharCode(v.getUint8(at), v.getUint8(at + 1), v.getUint8(at + 2), v.getUint8(at + 3)); };
  // the boxes inside a box of an MP4 (each one a size, a type, then its content): [{ type, at, end }], at being where
  // its content starts
  var boxesIn = function (v, from, to) {
    var out = [];
    for (var at = from; at + 8 <= to;) {
      var len = v.getUint32(at), type = fourcc(v, at + 4), head = 8;
      if (len === 1) { if (at + 16 > to) break; len = v.getUint32(at + 8) * 4294967296 + v.getUint32(at + 12); head = 16; } else if (len === 0) len = to - at;
      if (len < head || at + len > to) break;
      out.push({ type: type, at: at + head, end: at + len });
      at += len;
    }
    return out;
  };
  var boxOf = function (list, type) { return list.filter(function (b) { return b.type === type; })[0] || null; };
  // filmCodec(file) -> Promise<code>: the four letter code of the first video track's format ('avc1' for H.264,
  // 'hvc1' for HEVC...), or '' when the file has no video track. Only the boxes' heads are read on the way to the
  // movie box ('moov', at the start or the end of the file), then that box alone, then the heads of the boxes after
  // it (see rest). Fails with .film 'read' when the file isn't an MP4, or is cut short.
  function filmCodec(file) {
    var size = file.size, TOP = ['ftyp', 'styp', 'moov', 'mdat', 'free', 'skip', 'wide', 'pdin', 'uuid'];
    var plain = function (t) { return /^[\x20-\x7e]{4}$/.test(t); };
    // After the movie box, the boxes left are walked to the end of the file: one that runs past it (the media box of
    // a file only half copied, say) turns the file down. Bytes after the last box that aren't a box are let be.
    var AFTER = TOP.concat(['moof', 'mfra', 'sidx', 'ssix', 'emsg', 'prft', 'meta', 'udta']);
    function rest(at, n) {
      if (at + 8 > size || n > 2000) return Promise.resolve();
      return bytesOf(file, at, 16).then(function (buf) {
        var v = new DataView(buf), len = v.getUint32(0), type = fourcc(v, 4), head = 8;
        if (AFTER.indexOf(type) < 0 || len === 0) return;
        if (len === 1) { if (buf.byteLength < 16) throw filmErr('read'); len = v.getUint32(8) * 4294967296 + v.getUint32(12); head = 16; }
        if (len < head) return;
        if (at + len > size) throw filmErr('read');
        return rest(at + len, n + 1);
      });
    }
    function walk(at, n) {
      if (at + 8 > size || n > 200) return Promise.reject(filmErr('read'));
      return bytesOf(file, at, 16).then(function (buf) {
        if (buf.byteLength < 8) throw filmErr('read');
        var v = new DataView(buf), len = v.getUint32(0), type = fourcc(v, 4), head = 8;
        if (len === 1) { if (buf.byteLength < 16) throw filmErr('read'); len = v.getUint32(8) * 4294967296 + v.getUint32(12); head = 16; } else if (len === 0) len = size - at;
        if (!plain(type) || (!n && TOP.indexOf(type) < 0) || len < head || at + len > size) throw filmErr('read');
        if (type !== 'moov') return walk(at + len, n + 1);
        if (len > 64 * 1048576) throw filmErr('read');
        var end = at + len;
        return bytesOf(file, at + head, len - head).then(function (m) {
          var mv = new DataView(m), traks = boxesIn(mv, 0, mv.byteLength).filter(function (b) { return b.type === 'trak'; });
          for (var i = 0; i < traks.length; i++) {
            var mdia = boxOf(boxesIn(mv, traks[i].at, traks[i].end), 'mdia');
            if (!mdia) continue;
            var inMdia = boxesIn(mv, mdia.at, mdia.end), hdlr = boxOf(inMdia, 'hdlr');
            // the handler's type sits after its version, flags and a reserved word: 'vide' for a video track
            if (!hdlr || hdlr.end - hdlr.at < 12 || fourcc(mv, hdlr.at + 8) !== 'vide') continue;
            var minf = boxOf(inMdia, 'minf'), stbl = minf && boxOf(boxesIn(mv, minf.at, minf.end), 'stbl');
            var stsd = stbl && boxOf(boxesIn(mv, stbl.at, stbl.end), 'stsd');
            // the sample description: version and flags, the number of entries, then the first entry's size and format
            if (!stsd || stsd.end - stsd.at < 16 || !mv.getUint32(stsd.at + 4)) throw filmErr('read');
            return fourcc(mv, stsd.at + 12);
          }
          return '';
        }).then(function (code) { return rest(end, n + 1).then(function () { return code; }); });
      });
    }
    return walk(0, 0).catch(function (e) { throw e && e.film ? e : filmErr('read'); });
  }
  // filmProbe(url) -> Promise<video>: a <video> on the local file, loaded as far as its metadata, so its size and
  // length are known. Fails with .film 'play' when this browser can't read the file. (Its frames come with filmAt: an
  // iPhone loads a video only as far as its metadata until it is played or moved.)
  function filmProbe(url) {
    var v = h('video', { playsinline: true, preload: 'auto' });
    // muted while it is checked: phones load a silent video's frames without a tap first (onFilm gives the sound back)
    v.muted = true;
    return new Promise(function (go, no) {
      var end = function () { clearTimeout(t); v.onloadedmetadata = v.onerror = null; };
      var t = setTimeout(function () { end(); no(filmErr('play')); }, 20000);
      v.onloadedmetadata = function () { end(); if (v.videoWidth && v.videoHeight && isFinite(v.duration) && v.duration > 0) go(v); else no(filmErr('play')); };
      v.onerror = function () { end(); no(filmErr('play')); };
      v.src = url;
    });
  }
  // filmAt(v, t, why) -> Promise: the <video> has the frame at time t on screen. A video that waited to be asked is
  // loaded. One held at its metadata (an iPhone loads a video's frames only once it is played or moved) is moved to
  // t, which makes it load that frame, and played for a moment, muted, if a few seconds bring nothing. Fails with
  // .film why ('frame' unless said) when the frame doesn't come within 20 seconds.
  function filmAt(v, t, why) {
    why = why || 'frame';
    var to = function () { return Math.max(0, Math.min(t, v.duration - 0.05)); };
    // ok() is asked at each event, and the promise waits until it says yes
    var wait = function (types, ok, start) {
      return new Promise(function (go, no) {
        var done = false, timers = [];
        var off = function () { done = true; timers.forEach(clearTimeout); types.concat('error').forEach(function (k) { v.removeEventListener(k, on); }); };
        var on = function (e) { if (done) return; if (e.type === 'error') { off(); no(filmErr(why)); } else if (ok(e)) { off(); go(); } };
        timers.push(setTimeout(function () { if (!done) { off(); no(filmErr(why)); } }, 20000));
        types.concat('error').forEach(function (k) { v.addEventListener(k, on); });
        if (start) start(function () { return done; }, timers);
      });
    };
    var move = function () { if (v.readyState >= 1 && !v.seeking) v.currentTime = to(); };
    var loaded = v.readyState >= 2 ? Promise.resolve() : wait(['loadedmetadata', 'loadeddata', 'canplay', 'seeked'], function (e) {
      if (v.readyState >= 2) return true;
      if (e.type === 'loadedmetadata') move();
      return false;
    }, function (over, timers) {
      if (v.preload === 'none' || v.networkState === 3) { v.preload = 'auto'; v.load(); } else move();
      timers.push(setTimeout(function () {
        if (over() || v.readyState >= 2) return;
        var muted = v.muted, back = function () { v.pause(); v.muted = muted; };
        v.muted = true;
        try { var p = v.play(); if (p && p.then) p.then(back, back); else back(); } catch (e) { back(); }
      }, 4000));
    });
    return loaded.then(function () {
      if (!v.seeking && Math.abs(v.currentTime - to()) < 0.001) return;
      return wait(['seeked', 'loadeddata', 'canplay', 'timeupdate'], function () { return !v.seeking && v.readyState >= 2; }, function () {
        if (Math.abs(v.currentTime - to()) >= 0.001) v.currentTime = to();
      });
    });
  }
  // what came out of drawing a frame: '' (a picture), 'empty' (nothing was drawn) or 'black' (one flat black), read
  // from a 16 px copy. A canvas that can't be read back (another site's film without CORS) says '': toBlob tells.
  function frameShows(cv) {
    var s = document.createElement('canvas'); s.width = s.height = 16;
    var x = s.getContext('2d', { willReadFrequently: true });
    try {
      x.drawImage(cv, 0, 0, 16, 16);
      var d = x.getImageData(0, 0, 16, 16).data, seen = false, top = 0;
      for (var i = 0; i < d.length; i += 4) { if (d[i + 3]) seen = true; top = Math.max(top, d[i], d[i + 1], d[i + 2]); }
      return !seen ? 'empty' : top < 8 ? 'black' : '';
    } catch (e) { return ''; } finally { s.width = s.height = 0; }
  }
  // filmFrame(video, t, why) -> Promise<{ blob, ext, type, w, h, t }>: the frame at time t as a poster, made the way
  // the photos are (at most 2560 px on the long edge, WebP where this browser makes it, else JPEG); t is the time it
  // was taken at. A draw that brings nothing (an iPhone may hand a paused video's frame over only after it moves) is
  // tried once more a hair further on; a frame that is still flat black is kept, as the film may really be black there.
  // Fails with .film 'frame' (why, when said, if the frame never loads).
  function filmFrame(v, t, why) {
    var cv = null, at = 0;
    return filmAt(v, t, why).then(function () {
      var w = v.videoWidth, ht = v.videoHeight;
      if (!w || !ht) throw filmErr('frame');
      var k = Math.min(1, LONG_EDGE / Math.max(w, ht)), tw = Math.max(1, Math.round(w * k)), th = Math.max(1, Math.round(ht * k));
      cv = document.createElement('canvas'); cv.width = tw; cv.height = th;
      var x = cv.getContext('2d');
      if (!x) throw filmErr('frame');
      x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
      var draw = function () { x.clearRect(0, 0, tw, th); x.drawImage(v, 0, 0, tw, th); at = v.currentTime; return frameShows(cv); };
      if (!draw()) return;
      var near = at + 0.002 <= v.duration - 0.05 ? at + 0.002 : Math.max(0, at - 0.002);
      return filmAt(v, near).then(function () { if (draw() === 'empty') throw filmErr('frame'); });
    }).then(function () {
      return canWebp().then(function (webp) {
        var out = webp ? ['image/webp', 0.82] : ['image/jpeg', 0.85];
        // a frame of a video from another site without CORS can't be read back (toBlob throws)
        return new Promise(function (go, no) {
          try { cv.toBlob(function (b) { if (b) go(b); else no(filmErr('frame')); }, out[0], out[1]); } catch (e) { no(filmErr('frame')); }
        });
      }).then(function (blob) {
        if (!OUT_EXT[blob.type] || blob.size > STORE_MAX) throw filmErr('frame');
        return { blob: blob, ext: OUT_EXT[blob.type], type: blob.type, w: cv.width, h: cv.height, t: at };
      });
    }).then(function (out) { if (cv) cv.width = cv.height = 0; return out; }, function (e) { if (cv) cv.width = cv.height = 0; throw e && e.film ? e : filmErr('frame'); });
  }
  // storageUsed() -> Promise<bytes>: what every bucket of the project holds now (owners and admins may ask). Any
  // failure, or an answer that isn't a number, fails with .film 'check': it is never taken as 0.
  function storageUsed() {
    return Promise.resolve().then(function () { return sb.rpc('portfolio_storage_used'); }).then(function (r) {
      var d = r && !r.error ? r.data : null;
      var n = typeof d === 'number' ? d : typeof d === 'string' && /^\d+$/.test(d) ? +d : NaN;
      if (!isFinite(n) || n < 0) throw filmErr('check');
      return n;
    }, function () { throw filmErr('check'); });
  }
  // a refused upload in words a person can act on
  var filmUpErr = function (code, msg) {
    if (code === 413 || /maximum allowed size|too large/i.test(msg)) return 'storage turned it down as too big';
    if (code === 415 || /mime type/i.test(msg)) return 'storage takes MP4 files only';
    if (/jwt|token/i.test(msg)) return 'your sign in has ended. Reload the page and sign in again';
    if (code === 401 || code === 403 || /row-level security|unauthorized|permission/i.test(msg)) return 'your role can’t upload videos';
    if (code === 409 || /already exists|duplicate/i.test(msg)) return 'a file with this name is already there. Try again';
    if (code >= 500) return 'storage had a problem. Try again in a minute';
    return msg || 'the upload failed';
  };
  // xhrUpload(bucket, path, body, opts) -> { done, abort }: one file sent straight to Storage's upload endpoint with
  // XMLHttpRequest, which (unlike the Supabase library's fetch) reports how much has gone up. opts: { type (its
  // content type), onProgress(loaded, total), onRetry() }. It never overwrites (x-upsert false) and is cached for a
  // year (every name is new). A dropped or stalled connection is tried once more, onRetry() first; a name already
  // taken on that second try means the first one got through. done fails with an Error marked .upload (and .net when
  // the connection was the problem), or .cancelled after abort(). Storage decides what it takes (its bucket rules and
  // policies); the checks before it are for the person only.
  function xhrUpload(bucket, path, body, opts) {
    opts = opts || {};
    var xhr = null, stop = false;
    var url = SB_URL + '/storage/v1/object/' + bucket + '/' + path.split('/').map(encodeURIComponent).join('/');
    var fail = function (msg, net) { var e = new Error(msg); e.upload = true; if (net) e.net = true; return e; };
    var token = function () {
      return Promise.resolve().then(function () { return sb.auth.getSession(); }).then(function (r) {
        var s = r && r.data && r.data.session;
        if (!s || !s.access_token) throw fail('your sign in has ended. Reload the page and sign in again');
        return s.access_token;
      }, function () { throw fail('the connection failed', true); });
    };
    function once(tok, again) {
      return new Promise(function (go, no) {
        if (stop) return no(cancelled());
        var x = xhr = new XMLHttpRequest(), last = Date.now(), limit = 60000;
        // no progress for a minute (two once everything is sent and the answer is awaited): dropped, and tried again
        var watch = setInterval(function () { if (Date.now() - last > limit) x.abort(); }, 5000);
        var end = function (f) { clearInterval(watch); f(); };
        x.open('POST', url, true);
        x.setRequestHeader('authorization', 'Bearer ' + tok);
        x.setRequestHeader('apikey', SB_KEY);
        x.setRequestHeader('x-upsert', 'false');
        x.setRequestHeader('content-type', opts.type || body.type);
        x.setRequestHeader('cache-control', 'max-age=31536000');
        if (x.upload) {
          x.upload.onprogress = function (e) { last = Date.now(); if (opts.onProgress && e.lengthComputable) opts.onProgress(e.loaded, e.total); };
          x.upload.onload = function () { last = Date.now(); limit = 120000; };
        }
        x.onload = function () {
          end(function () {
            if (x.status >= 200 && x.status < 300) return go();
            var j = {};
            try { j = JSON.parse(x.responseText || '{}') || {}; } catch (e) { j = {}; }
            // Storage words an error as { statusCode, error, message }; the code in the body is the one that counts
            var code = +j.statusCode || x.status, msg = String(j.message || j.error || '');
            if (again && (code === 409 || /already exists|duplicate/i.test(msg))) return go();
            if (x.status === 0 || (x.status >= 502 && x.status <= 504)) return no(fail('the connection failed', true));
            no(fail(filmUpErr(code, msg)));
          });
        };
        x.onerror = x.ontimeout = function () { end(function () { no(fail('the connection failed', true)); }); };
        x.onabort = function () { end(function () { no(stop ? cancelled() : fail('the connection stalled', true)); }); };
        x.send(body);
      });
    }
    var done = token().then(function (tok) { return once(tok, false); }).catch(function (e) {
      if (!e || !e.net || stop) throw e;
      if (opts.onRetry) opts.onRetry();
      return new Promise(function (go) { setTimeout(go, 1000); }).then(token).then(function (tok) { return once(tok, true); });
    });
    return { done: done, abort: function () { stop = true; if (xhr) xhr.abort(); } };
  }
  // signedFilm(path) -> Promise<url>: a signed link to a film draft for an hour (asked for again after 50 minutes, as
  // the pictures' are); a film uploaded in this tab plays from the file itself
  function signedFilm(path) {
    var now = Date.now();
    if (thumbCache[path] && thumbUntil[path] > now) return Promise.resolve(thumbCache[path]);
    return Promise.resolve().then(function () { return sb.storage.from(pfBuckets(path).draft).createSignedUrl(path, 3600); }).then(function (r) {
      if (!r || r.error || !r.data || !r.data.signedUrl) throw new Error((r && r.error && r.error.message) || 'no link');
      thumbCache[path] = r.data.signedUrl; thumbUntil[path] = now + 3e6;
      return r.data.signedUrl;
    });
  }
  // m:ss, for the frame picker read out
  var clock = function (s) { s = Math.max(0, Math.floor(s || 0)); return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2); };

  // ---- the gallery's layout: the rows of the project page, and sizes from each photo's shape ----
  // a photo's shape: its width over its height, or 0 when that isn't known
  var shapeOf = function (g) { var w = +(g && g.w), ht = +(g && g.h); return w > 0 && ht > 0 ? w / ht : 0; };
  // galleryRows(gallery) -> the rows the project page draws (portfolio.js follows the same rule). Neighbours of the
  // same size share a row, up to one, two or three across (an unknown size counts as full). A row is a list of
  // { g, share }: share is the part of the row's width (the gaps left out) the photo takes, and a row's shares add up
  // to 1. A photo alone takes the whole row. Photos side by side are as wide as their shape asks, so they end at one
  // height; a row with a photo of unknown shape has equal columns.
  function galleryRows(gallery) {
    var rows = [], run = null;
    (gallery || []).forEach(function (g) {
      var across = g.size === 'half' ? 2 : g.size === 'third' ? 3 : 1;
      if (!run || run.across !== across || run.list.length >= across) rows.push(run = { across: across, list: [] });
      run.list.push(g);
    });
    return rows.map(function (r) {
      var shapes = r.list.map(shapeOf), known = shapes.every(Boolean), sum = shapes.reduce(function (s, x) { return s + x; }, 0);
      return r.list.map(function (g, i) { return { g: g, share: known ? shapes[i] / sum : 1 / r.list.length }; });
    });
  }
  // autoSizes(gallery) -> a size for each photo from its shape alone ('full', 'half' or 'third'), or null for a photo
  // whose shape isn't known (it keeps its size). Wide photos (width over height 1.2 or more) take the full width.
  // Portrait and square photos next to each other pair as halves; in a run of an odd number of them (three or more)
  // the last three share a row as thirds, and one alone takes the full width.
  var WIDE = 1.2;
  function autoSizes(gallery) {
    var list = gallery || [], out = [], i = 0;
    var tall = function (k) { var s = k < list.length && shapeOf(list[k]); return !!s && s < WIDE; };
    while (i < list.length) {
      if (!tall(i)) { out.push(shapeOf(list[i]) ? 'full' : null); i++; continue; }
      var j = i;
      while (tall(j)) j++;
      var n = j - i, thirds = n > 1 && n % 2 ? 3 : 0;
      for (var k = 0; k < n; k++) out.push(n === 1 ? 'full' : k < n - thirds ? 'half' : 'third');
      i = j;
    }
    return out;
  }
  // the drag handle's icon, and the film's (a film, play and pause), in the sprite's style (index.html's sprite has
  // none of them)
  (function () {
    var sprite = $('.adm-sprite');
    if (!sprite) return;
    [['grip', [['path', { d: 'M9.5 6.5h.01M14.5 6.5h.01M9.5 12h.01M14.5 12h.01M9.5 17.5h.01M14.5 17.5h.01' }]]],
      ['film', [['rect', { x: '3.5', y: '5.5', width: '17', height: '13', rx: '2.2' }], ['path', { d: 'm10.3 9.4 4.5 2.6-4.5 2.6z' }]]],
      ['play', [['path', { d: 'M8.5 6.3v11.4l9.2-5.7z' }]]],
      ['pause', [['path', { d: 'M9 6.5v11M15 6.5v11' }]]]].forEach(function (s) {
      if (document.getElementById('i-' + s[0])) return;
      var sym = document.createElementNS(SVG, 'symbol');
      sym.setAttribute('id', 'i-' + s[0]); sym.setAttribute('viewBox', '0 0 24 24');
      s[1].forEach(function (part) {
        var el = document.createElementNS(SVG, part[0]);
        Object.keys(part[1]).forEach(function (k) { el.setAttribute(k, part[1][k]); });
        sym.appendChild(el);
      });
      sprite.appendChild(sym);
    });
  })();

  // ---- the list: drafts and published items as cards, by status; the built in pages below them ----
  // body: the open editor's form, while there is one; own: whether this database keeps services and industries of
  // your own (null until the list says); listed: the list's answer, for the editor's chips
  var pf = { panel: $('[data-panel="portfolio"]'), ui: null, got: null, turn: 0, view: 'active', from: null, body: null, own: null, listed: null };
  var PF_TABS = [['active', 'Draft & published'], ['draft', 'Draft'], ['published', 'Published'], ['archived', 'Archived'], ['', 'Everything']];
  var PF_NONE = { active: 'No drafts or published items yet.', draft: 'No drafts.', published: 'Nothing is published yet.', archived: 'Nothing is archived.', '': 'No portfolio items yet.' };
  var inView = function (st, v) { return v === 'active' ? st !== 'archived' : !v || st === v; };
  actions.portfolio = function () {
    // a plain start, with no project to fill it from
    return canEdit() ? h('a', { class: 'btn lime', href: '#portfolio/new', onclick: function () { pf.from = null; } }, icon('plus', 's'), 'New portfolio item') : null;
  };
  function pfBuild() {
    if (pf.ui) return;
    var ui = pf.ui = { tabs: h('div', { class: 'tabs', role: 'group', 'aria-label': 'Show' }), tab: {}, count: h('span', { class: 'muted' }),
      note: h('p', { class: 'lnote', hidden: true }), state: h('div', { class: 'lstate', hidden: true }),
      grid: h('section', { class: 'pfgrid', 'aria-label': 'Portfolio items', hidden: true }) };
    PF_TABS.forEach(function (t) {
      ui.tab[t[0]] = h('button', { type: 'button', 'aria-pressed': String(t[0] === pf.view), onclick: function () {
        if (pf.view === t[0]) return;
        pf.view = t[0];
        PF_TABS.forEach(function (x) { ui.tab[x[0]].setAttribute('aria-pressed', String(x[0] === pf.view)); });
        pfDraw();
      } }, t[1], h('span', { class: 'c' }));
      ui.tabs.appendChild(ui.tab[t[0]]);
    });
    pf.panel.innerHTML = '';
    add(pf.panel, [h('div', { class: 'bar' }, ui.tabs, ui.count), ui.note, ui.state, ui.grid,
      h('div', { class: 'sec-h' }, h('h2', { id: 'pf-built', text: 'Built into the site' }), h('p', { text: 'Part of the site’s code, so the developer changes these' })),
      h('section', { class: 'pfgrid', 'aria-labelledby': 'pf-built' }, BUILT_IN.map(function (b) {
        return h('article', { class: 'pfc' },
          h('div', { class: 'pfc-img' }, h('img', { src: '/images/projects/' + b[3], alt: '', loading: 'lazy', decoding: 'async' })),
          h('div', { class: 'pfc-b' }, h('div', { class: 'pfc-t' }, h('b', { text: b[0] }), h('span', { class: 'pill paid', text: 'Live' })),
            h('span', { text: String(b[2]) }),
            h('a', { class: 'btn sm', href: '/work/' + b[1] + (DEV ? '.html' : ''), target: '_blank', rel: 'noopener', 'aria-label': 'View the ' + b[0] + ' page' }, icon('ext', 's'), 'View page')));
      }))]);
  }
  function pfState(text, err, retry) {
    var s = pf.ui.state;
    s.innerHTML = ''; s.hidden = !text;
    if (text) add(s, [h('p', { class: 'empty' + (err ? ' is-err' : ''), text: text }), retry ? h('button', { class: 'btn sm', type: 'button', onclick: retry }, 'Try again') : null]);
  }
  function pfCard(p) {
    var pl = PF_PILL[p.status] || ['draft', p.status], who = [p.client, p.year].filter(Boolean).join(', ');
    var box = h('div', { class: 'pfc-img' }, p.featured ? h('span', { class: 'tags' }, h('span', { class: 'tag lime', text: 'Featured' })) : null);
    // a cover waits for its signed link; without one the card says so at once
    if (p.cover_path) box.setAttribute('data-cover', p.cover_path); else pfCover(box, null);
    return h('a', { class: 'pfc', href: '#portfolio/' + p.id }, box,
      h('div', { class: 'pfc-b' }, h('div', { class: 'pfc-t' }, h('b', { text: p.title }), h('span', { class: 'pill ' + pl[0], text: pl[1] })),
        who ? h('span', { text: who }) : null, h('span', { text: 'Updated ' + pday(p.updated_at) })));
  }
  function pfDraw() {
    var ui = pf.ui, all = pf.got;
    if (!all) return;
    PF_TABS.forEach(function (t) { $('.c', ui.tab[t[0]]).textContent = String(all.filter(function (p) { return inView(p.status, t[0]); }).length); });
    var list = all.filter(function (p) { return inView(p.status, pf.view); });
    ui.count.textContent = window.eco.plural(list.length, 'item');
    ui.grid.innerHTML = '';
    add(ui.grid, list.map(pfCard));
    ui.grid.hidden = !list.length;
    pfState(list.length ? null : PF_NONE[pf.view] + (canEdit() && (pf.view === 'active' || !pf.view) ? ' Start one with New portfolio item.' : ''));
    // the covers of this draw, signed in one request
    var boxes = $$('[data-cover]', ui.grid);
    var paint = function () { boxes.forEach(function (b) { pfCover(b, b.getAttribute('data-cover')); }); };
    if (boxes.length) signed(boxes.map(function (b) { return b.getAttribute('data-cover'); })).then(paint, paint);
  }
  function pfLoad() {
    pfBuild();
    var ui = pf.ui, mine = ++pf.turn;
    // a first visit waits; a return keeps the cards on screen until the new ones are here
    if (!pf.got) { ui.grid.hidden = true; pfState('Loading the portfolio…'); }
    var bad = function (e) {
      if (mine !== pf.turn) return;
      pf.got = null; ui.grid.hidden = true; ui.note.hidden = true; ui.count.textContent = '';
      PF_TABS.forEach(function (t) { $('.c', ui.tab[t[0]]).textContent = ''; });
      pfState('Couldn’t load the portfolio. ' + window.eco.ecoError(e), true, pfLoad);
    };
    // with each item's services and industries of your own, for the editor's chips. A database from before
    // 20261112_portfolio_categories answers 42703 (no such column), and the list is asked for again without them.
    var ask = function (own) {
      return sb.from('portfolio_items').select('id, slug, title, client, year, status, featured, sort_order, cover_path, updated_at'
          + (own ? ', services_custom, industries_custom' : ''), { count: 'exact' })
        .order('featured', { ascending: false }).order('sort_order').order('updated_at', { ascending: false }).limit(500)
        .then(function (r) {
          if (own && r.error && r.error.code === '42703') return ask(false);
          if (!r.error) pf.own = own;
          return r;
        });
    };
    (pf.listed = ask(pf.own !== false))
      .then(function (r) {
        if (r.error) return bad(r.error);
        if (mine !== pf.turn) return;
        pf.got = r.data || [];
        // past the first 500 the counts would leave items out, so the page says so
        ui.note.hidden = !(r.count > pf.got.length);
        ui.note.textContent = 'Only the first ' + pf.got.length + ' of ' + r.count + ' items are here, so the counts leave some out.';
        pfDraw();
      }, bad);
  }
  // The labels of your own that drafts and live items use, for the editor's chips: { services: [], industries: [] }
  // in alphabetical order, one label per key. null while this database has none of them, or the list can't tell.
  function pfVocab() {
    var none = function () { return pf.own ? { services: [], industries: [] } : null; };
    return (pf.listed || Promise.resolve(null)).then(function (r) {
      if (!r || r.error || !pf.own) return none();
      var out = { services: [], industries: [] };
      (r.data || []).forEach(function (p) {
        if (p.status === 'archived') return;
        ['services', 'industries'].forEach(function (k) {
          (p[k + '_custom'] || []).forEach(function (t) {
            if (!out[k].some(function (x) { return catSame(x, t); })) out[k].push(t);
          });
        });
      });
      out.services.sort(byLabel); out.industries.sort(byLabel);
      return out;
    }, none);
  }
  loaders.portfolio = pfLoad;
  openers.portfolio = function (id) { var from = pf.from; pf.from = null; pfOpen(id === 'new' ? null : id, from); };

  function pfOpen(id, from) {
    if (!id) {
      if (!canEdit()) return toast('Viewers can’t add portfolio items.', true);
      return pfEditor(null, from);
    }
    sb.from('portfolio_items').select('*').eq('id', id).maybeSingle().then(function (r) {
      if (r.error) return fail(r.error);
      if (!r.data) return toast('That portfolio item isn’t there.', true);
      pfEditor(r.data);
    }, fail);
  }

  // ---- the editor: one item in a wide drawer, its state and actions in a bar that stays at the bottom ----
  function pfEditor(saved, from) {
    var E = window.eco, ro = !canEdit();
    var isNew = !saved;
    var id = saved ? saved.id : uuid();
    var state = saved ? JSON.parse(JSON.stringify(saved)) : { status: 'draft', gallery: [], credits: [], services: [], industries: [], featured: false, sort_order: 0, project_id: null };
    // started from a project: its name, client and year, and the link back to it
    if (from) { state.title = from.title || ''; state.slug = slugify(state.title); state.client = from.client || null; state.year = from.year || null; state.project_id = from.id; }
    // services and industries of your own: kept in alphabetical order, as their chips stand. withOwn: this database has
    // them (the saved row carries the columns, or the list was read with them); until then the fields stay hidden and
    // a save leaves the columns out, so an admin ahead of its database still saves everything else.
    state.services_custom = (state.services_custom || []).slice().sort(byLabel);
    state.industries_custom = (state.industries_custom || []).slice().sort(byLabel);
    var withOwn = saved ? 'services_custom' in saved : pf.own === true;
    var slugTouched = !isNew;
    var busy = false;
    var lastSaved = JSON.stringify(collectFrom(state));
    if (saved) history.replaceState(null, '', '#portfolio/' + id);

    function collectFrom(x) {
      return { slug: x.slug || '', title: x.title || '', client: x.client || null, year: x.year || null, services: x.services || [], industries: x.industries || [],
        // services and industries of your own (20261112_portfolio_categories), as typed
        services_custom: x.services_custom || [], industries_custom: x.industries_custom || [],
        summary: x.summary || null, brief: x.brief || null, approach: x.approach || null, outcome: x.outcome || null,
        cover_path: x.cover_path || null, cover_alt: x.cover_alt || null, cover_w: x.cover_w || null, cover_h: x.cover_h || null,
        gallery: x.gallery || [], video_url: x.video_url || null, credits: x.credits || [], seo_title: x.seo_title || null, seo_description: x.seo_description || null,
        // an uploaded film (20261112_portfolio_video): its draft, its poster and its size in pixels
        video_path: x.video_path || null, video_poster_path: x.video_poster_path || null, video_w: x.video_w || null, video_h: x.video_h || null,
        featured: !!x.featured, sort_order: x.sort_order || 0, project_id: x.project_id || null };
    }

    // ---- fields ----
    var input = function (val, attrs) { attrs = attrs || {}; attrs.type = attrs.type || 'text'; attrs.value = val == null ? '' : val; attrs.disabled = ro; return h('input', attrs); };
    var area = function (val, attrs) { attrs = attrs || {}; attrs.value = val || ''; attrs.disabled = ro; return h('textarea', attrs); };
    var f = {
      title: input(state.title, { maxlength: 120, required: true, autocomplete: 'off' }),
      slug: input(state.slug, { maxlength: 80, required: true, spellcheck: 'false', autocapitalize: 'off', autocomplete: 'off' }),
      client: input(state.client, { maxlength: 120, autocomplete: 'off' }),
      year: input(state.year, { type: 'number', min: 1990, max: 2100, step: 1, inputmode: 'numeric', placeholder: String(new Date().getFullYear()) }),
      summary: area(state.summary, { maxlength: 300, rows: 3, placeholder: 'One or two lines for the Work card and search results' }),
      brief: area(state.brief, { maxlength: 4000, rows: 4, placeholder: 'Optional. What was asked, and why it mattered' }),
      approach: area(state.approach, { maxlength: 4000, rows: 4, placeholder: 'Optional. How we thought about it and what we made' }),
      outcome: area(state.outcome, { maxlength: 4000, rows: 3, placeholder: 'Optional. What came out of it' }),
      cover_alt: input(state.cover_alt, { maxlength: 300, placeholder: 'What the image shows', autocomplete: 'off' }),
      video_url: input(state.video_url, { type: 'url', maxlength: 300, placeholder: 'YouTube link', autocomplete: 'off' }),
      seo_title: input(state.seo_title, { maxlength: 70, autocomplete: 'off' }),
      seo_description: area(state.seo_description, { maxlength: 160, rows: 2 }),
      featured: h('input', { type: 'checkbox', checked: !!state.featured, disabled: ro }),
      sort_order: input(state.sort_order || 0, { type: 'number', min: -9999, max: 9999, step: 1 })
    };
    // a help line read out as the field's description, not as part of its name
    var help = function (field, text) {
      var s = h('span', { class: 'help', id: 'pf-h' + (++pfUid), 'aria-hidden': 'true', text: text });
      field.setAttribute('aria-describedby', ((field.getAttribute('aria-describedby') || '') + ' ' + s.id).trim());
      return s;
    };
    var counted = function (label, field, max) {
      var c = h('span', { class: 'cnt', id: 'pf-c' + (++pfUid), 'aria-hidden': 'true' });
      var upd = function () { c.textContent = field.value.length + '/' + max; };
      field.setAttribute('aria-describedby', c.id);
      field.addEventListener('input', upd); upd();
      return h('label', { class: 'f' }, h('span', { class: 'row' }, label, c), field);
    };
    // on a live item a second line warns that a new slug breaks shared links (and is read out only then)
    var slugHint = help(f.slug, ''), liveHint = h('span', { class: 'hint', id: 'pf-h' + (++pfUid), 'aria-hidden': 'true', hidden: true, text: 'It’s live, so a new slug breaks the links already shared.' });
    // Services and Industry: chips that stay pressed. The fixed list first, then the labels of your own in alphabetical
    // order: this item's, and the ones other drafts and live items use, so a label is typed once and picked after that.
    // Under them a field adds one (or a few, split by commas); it shows once this database is known to keep them.
    var chips = function (label, list, chosen, kind) {
      var lid = 'pf-l' + (++pfUid), box = h('div', { class: 'chips', role: 'group', 'aria-labelledby': lid });
      var g = { kind: kind, box: box };
      g.chip = function (value, text, on, own) {
        var b = h('button', { type: 'button', value: value, 'data-own': own ? '' : null, 'aria-pressed': String(on), disabled: ro }, text);
        b.addEventListener('click', function () {
          var on = b.getAttribute('aria-pressed') !== 'true';
          // a label of your own picked from the list follows the rules a typed one does: up to 6, and not both kinds
          if (on && own && g.say) {
            var other = g.other && $$('button[aria-pressed="true"]', g.other.box).filter(function (x) { return catSame(x.textContent, b.textContent); })[0];
            if (other) { ownSay(g, '“' + other.textContent + '” is already ' + (g.kind === 'services' ? 'an industry' : 'a service') + ' here.', true); return; }
            if ($$('button[data-own][aria-pressed="true"]', box).length >= OWN_MAX) { ownSay(g, 'Up to ' + OWN_MAX + ' ' + g.kind + ' of your own on a project.', true); return; }
            if (g.say.textContent) ownSay(g, '');
          }
          b.setAttribute('aria-pressed', String(on)); dirtyCheck();
        });
        return b;
      };
      list.forEach(function (o) { box.appendChild(g.chip(o[0], o[1], chosen.indexOf(o[0]) > -1, false)); });
      // b (a new chip) takes its place among the labels of your own, which follow the fixed ones
      g.place = function (b) {
        $$('button[data-own]', box).concat(b ? [b] : []).sort(function (x, y) { return byLabel(x.value, y.value); })
          .forEach(function (x) { box.appendChild(x); });
      };
      // the chip that already stands for a label (by its name, so Food and Beverage finds Food & Beverage)
      g.has = function (t) { return $$('button', box).filter(function (b) { return catSame(b.textContent, t); })[0]; };
      if (!ro) {
        var a = kind === 'services' ? 'a service' : 'an industry';
        g.input = h('input', { type: 'text', maxlength: 120, placeholder: 'Add ' + a, 'aria-label': 'Add ' + a + ' of your own',
          autocomplete: 'off', autocapitalize: 'words', enterkeyhint: 'done' });
        g.add = h('button', { class: 'btn', type: 'button' }, icon('plus', 's'), 'Add');
        g.say = h('span', { class: 'help pf-own-say', 'aria-live': 'polite' });
        g.row = h('div', { class: 'pf-own', hidden: !withOwn }, g.input, g.add);
        g.add.addEventListener('click', function () { if (!tidy(g.input.value)) g.input.focus(); else addOwn(g); });
        g.input.addEventListener('keydown', function (e) {
          if (e.key !== 'Enter' || e.isComposing) return;
          e.preventDefault();
          // on a phone the keyboard's Done closes it once the label is in; on a computer the field stays for the next
          if (!addOwn(g) && window.matchMedia && matchMedia('(pointer: coarse)').matches) g.input.blur();
        });
        g.input.addEventListener('input', function () { if (g.say.textContent) ownSay(g, ''); });
      }
      g.el = h('div', { class: 'f full' }, h('span', { id: lid, text: label }), box, g.row || null, g.say || null);
      return g;
    };
    var svc = chips('Services', SERVICES, state.services || [], 'services'), ind = chips('Industry', INDUSTRIES, state.industries || [], 'industries');
    svc.other = ind; ind.other = svc;
    state.services_custom.forEach(function (t) { svc.box.appendChild(svc.chip(t, t, true, true)); });
    state.industries_custom.forEach(function (t) { ind.box.appendChild(ind.chip(t, t, true, true)); });
    // what the other drafts and live items use joins as chips not pressed
    pfVocab().then(function (v) {
      if (!v || !alive()) return;
      withOwn = true;
      [[svc, v.services], [ind, v.industries]].forEach(function (x) {
        x[1].forEach(function (t) { if (!x[0].has(t)) x[0].box.appendChild(x[0].chip(t, t, false, true)); });
        x[0].place();
        if (x[0].row) x[0].row.hidden = false;
      });
    });
    // a typed label tidied: curly apostrophes made straight (an iPhone types ’), spaces single, none at either end
    var tidy = function (t) { return String(t || '').replace(/[‘’ʼ]/g, '\'').replace(/\s+/g, ' ').trim(); };
    var ownSay = function (g, text, bad) {
      g.say.textContent = text; g.say.classList.toggle('is-err', !!bad);
      if (bad) g.input.setAttribute('aria-invalid', 'true'); else g.input.removeAttribute('aria-invalid');
    };
    // One label: { note } once it is picked (a new chip, or the one that already stands for it), or { bad: why not }
    function takeOwn(g, t) {
      var mine = $$('button[data-own][aria-pressed="true"]', g.box).length;
      var full = { bad: 'Up to ' + OWN_MAX + ' ' + g.kind + ' of your own on a project.' };
      if (t.length < 2) return { bad: 'Use at least 2 characters.' };
      if (t.length > OWN_LEN) return { bad: 'Keep it to ' + OWN_LEN + ' characters.' };
      if (!OWN_RE.test(t) || !/[A-Za-z0-9]/.test(t)) return { bad: 'Use letters, numbers, spaces and & + / . ’ only.' };
      var same = g.has(t);
      if (same) {
        if (same.getAttribute('aria-pressed') === 'true') return { note: '“' + same.textContent + '” is picked already.' };
        if (same.hasAttribute('data-own') && mine >= OWN_MAX) return full;
        same.setAttribute('aria-pressed', 'true');
        return { note: same.textContent === t ? '' : 'Picked “' + same.textContent + '” from the list.' };
      }
      var other = g.other.has(t);
      if (other) return { bad: '“' + other.textContent + '” is already ' + (g.kind === 'services' ? 'an industry' : 'a service') + '.' };
      if (mine >= OWN_MAX) return full;
      g.place(g.chip(t, t, true, true));
      return { note: '' };
    }
    // Add: every label in the field (split by commas). What can't be added stays in the field with the reason under it.
    // Returns that reason, or '' when everything went in.
    function addOwn(g) {
      var parts = g.input.value.split(',').map(tidy).filter(Boolean), keep = [], bad = '', notes = [];
      parts.forEach(function (t) {
        var r = takeOwn(g, t);
        if (r.bad) { keep.push(t); bad = bad || r.bad; } else if (r.note) notes.push(r.note);
      });
      g.input.value = keep.join(', ');
      ownSay(g, bad || notes.join(' '), !!bad);
      dirtyCheck();
      return bad;
    }
    var ownTyped = function () { return [svc, ind].some(function (g) { return !!g.input && !!tidy(g.input.value); }); };
    // The project it came from: linked, the project page lists the item and its portfolio step is done. Until the
    // list is in (or when it can't load) the current link stays as an option, so a save never drops it.
    var proj = h('select', { disabled: ro }, h('option', { value: '' }, 'Not linked'));
    var projHelp = help(proj, 'The project page then lists this item.');
    if (state.project_id) proj.appendChild(h('option', { value: state.project_id, selected: true }, 'Loading the projects…'));
    E.data.projects().then(function (list) {
      var keep = proj.value, seen = false;
      proj.length = 1;
      list.filter(function (p) { return (p.sheet_state === 'present' && !p.archived_at) || p.id === keep; }).forEach(function (p) {
        if (p.id === keep) seen = true;
        proj.appendChild(h('option', { value: p.id, selected: p.id === keep }, E.pname(p)));
      });
      if (keep && !seen) proj.appendChild(h('option', { value: keep, selected: true }, 'A project that isn’t listed'));
    }, function () {
      proj.disabled = true;
      if (proj.length > 1) proj.options[1].textContent = 'The linked project';
      projHelp.textContent = 'The projects couldn’t be loaded, so the link stays as it is.';
    });

    // ---- images ----
    // Photos go through processImage (web size, the camera's metadata left behind) and putDraft (one more try when an
    // upload fails). fresh: files uploaded while this editor is open that no saved version uses yet (a save clears
    // the ones it leaves unused). altMarks: the gallery images marked as still needing alt text, until it is typed (by
    // path, so a redraw of the gallery keeps them).
    var fresh = [], altMarks = [];
    // the editor is still open: one closed during an upload stops it and keeps nothing from it
    var alive = function () { return document.contains(body); };
    // the line in the bar while photos are worked on: the file, and how many of the batch are done (kept together
    // when the line wraps)
    var line = function (name, done, total, again) {
      return (again ? 'Trying ' + name + ' again' : 'Resizing and uploading ' + name) + (total > 1 ? ' (' + done + '\u00a0of\u00a0' + total + '\u00a0done)' : '');
    };
    var busyLine = function (t) { if (busy) stateText.textContent = t; };
    // A draft keeps new images at once (nothing is lost if the tab closes); a live item waits for "Save and update
    // live", so visitors never see a half-finished change. When the draft can't be saved, the new files stay in the
    // editor as an unsaved change: Save draft keeps them, and closing without saving takes them out of storage again
    // (see filmLeft). what: the files added ('images', 'cover'...), many when there are several. It ends with what to say.
    function keepUpload(said, what, many) {
      if (isLive()) { dirtyCheck(); return Promise.resolve(said.live); }
      busy = false;
      return save(true).then(function () { return said.draft; }, function (e) {
        dirtyCheck();
        throw new Error('The draft couldn’t be saved: ' + sentence(e.message) + ' The new ' + what + (many ? ' are' : ' is') +
          ' in the editor. Save the draft to keep ' + (many ? 'them.' : 'it.'));
      });
    }
    // images need the item to exist (their folder is its id), so the first upload saves a new item as a draft; what:
    // what is being added, for the message ('images' unless said)
    function ensureSaved(what) {
      if (!isNew) return Promise.resolve();
      var err = check();
      if (err) return Promise.reject(new Error('Before adding ' + (what || 'images') + ': ' + err));
      return save(true);
    }
    // a draft is saved after its upload, so the form has to be fine to save before any file is touched
    var notReady = function (what) { var err = !isLive() && check(); return err ? 'Before adding ' + (what || 'images') + ': ' + err : null; };
    // one photo made web sized and uploaded under a new name ({ path, w, h }; null when the editor was closed
    // meanwhile). Until a reload its thumbnail is the uploaded file itself.
    var put = function (file, done, total) {
      return processImage(file).then(function (x) {
        if (!alive()) return null;
        return ensureSaved().then(function () {
          setBusy(true, line(file.name, done, total));
          var path = pfPath(id, x.ext);
          return putDraft(path, x.blob, function () { busyLine(line(file.name, done, total, true)); }).then(function () {
            fresh.push(path);
            thumbCache[path] = URL.createObjectURL(x.blob); thumbUntil[path] = Infinity;
            return { path: path, w: x.w, h: x.h };
          });
        });
      });
    };
    var failNote = function (file, e) {
      return e && e.skip ? skipNote([[file.name, e.skip]]) : e && e.upload ? skipNote([[file.name, 'upload', e.message]]) : (e && e.message) || 'Something went wrong.';
    };
    // a file picker opened by a button, so the button is what a keyboard reaches
    var fileInput = function (multiple, onFiles) {
      var inp = h('input', { type: 'file', accept: Object.keys(IMG_TYPES).join(','), multiple: multiple, hidden: true, tabindex: '-1', 'aria-hidden': 'true' });
      inp.addEventListener('change', function () { var files = Array.prototype.slice.call(inp.files); inp.value = ''; if (files.length) onFiles(files); });
      return inp;
    };
    var pick = function (inp) { return function () { if (!busy && !ro) inp.click(); }; };

    var onCover = function (files) {
      if (busy || ro) return;
      var file = files[0], why = photoCheck(file), wait = !why && notReady();
      if (why) return pfNote(skipNote([[file.name, why]]), true);
      if (wait) return toast(wait, true);
      setBusy(true, line(file.name, 0, 1));
      put(file, 0, 1).then(function (x) {
        // closed meanwhile: the upload comes off again with the editor's other unsaved files (filmLeft)
        if (!x || !alive()) return;
        state.cover_path = x.path; state.cover_w = x.w; state.cover_h = x.h; drawCover();
        return keepUpload({ draft: 'Cover uploaded. Saved to the draft.', live: 'Cover uploaded. Save to put it on the live page.' }, 'cover')
          .then(function (msg) { toast(msg); });
      }).catch(function (e) { pfNote(failNote(file, e), true); }).then(function () { setBusy(false); });
    };
    var coverFile = fileInput(false, onCover), coverBox = h('div', {});
    var coverBtn = ro ? null : h('button', { class: 'btn sm', type: 'button', onclick: pick(coverFile) }, icon('image', 's'), 'Replace cover');
    // tried: the signed link has been asked for, so a cover without one couldn't be loaded
    function drawCover(tried) {
      coverBox.innerHTML = '';
      var box;
      if (state.cover_path) {
        box = h('div', { class: 'pfc-img' });
        if (tried || thumbCache[state.cover_path]) pfCover(box, state.cover_path);
      } else if (ro) {
        box = h('div', { class: 'pfc-img' }); pfCover(box, null);
      } else {
        // a picture can also be dropped on it
        box = h('button', { class: 'drop', type: 'button', onclick: pick(coverFile) }, icon('image'), 'Add a cover');
        box.addEventListener('dragover', function (e) { e.preventDefault(); box.classList.add('is-over'); });
        box.addEventListener('dragleave', function () { box.classList.remove('is-over'); });
        box.addEventListener('drop', function (e) {
          e.preventDefault(); box.classList.remove('is-over');
          var files = Array.prototype.slice.call((e.dataTransfer && e.dataTransfer.files) || []);
          if (files.length && !busy) onCover(files);
        });
      }
      coverBox.appendChild(box);
      if (coverBtn) coverBtn.hidden = !state.cover_path;
    }

    // the rows of the gallery and the credits move up and down, and come out, with these; moved(j), when given, hears
    // where a row went
    var move = function (list, i, d, redraw, box, moved) {
      var j = i + d;
      if (j < 0 || j >= list.length) return;
      var t = list[i]; list[i] = list[j]; list[j] = t; redraw(); dirtyCheck();
      var row = $$('.pfrow', box)[j], b = row && $(d < 0 ? '.up' : '.dn', row);
      if (b && b.disabled) b = $(d < 0 ? '.dn' : '.up', row);
      if (b) b.focus();
      if (moved) moved(j);
    };
    var mover = function (list, i, what, redraw, box, then, moved) {
      if (ro) return null;
      var n = i + 1;
      return h('div', { class: 'mv' },
        h('button', { class: 'up', type: 'button', disabled: i === 0, 'aria-label': 'Move ' + what + ' ' + n + ' up', onclick: function () { move(list, i, -1, redraw, box, moved); } }, icon('chev')),
        h('button', { class: 'dn', type: 'button', disabled: i === list.length - 1, 'aria-label': 'Move ' + what + ' ' + n + ' down', onclick: function () { move(list, i, 1, redraw, box, moved); } }, icon('chev')),
        h('button', { class: 'rm', type: 'button', 'aria-label': 'Remove ' + what + ' ' + n, onclick: function () {
          list.splice(i, 1); redraw(); dirtyCheck();
          var rows = $$('.pfrow', box), next = rows[Math.min(i, rows.length - 1)];
          if (next) $('.rm', next).focus(); else if (then) then.focus();
        } }, icon('x')));
    };

    // Photos for the gallery, picked or dropped: every file is checked first, then the good ones are made web sized
    // and uploaded one at a time. What uploaded stays when a later file fails: it goes into the gallery and is saved.
    // One message names every file left out, and why. The gallery holds 40; files past that are skipped by name.
    // The new photos get sizes from their shape as they arrive (fitNew); the photos already there keep theirs.
    function addPhotos(files) {
      if (busy || ro) return;
      var skips = [], todo = [], batch = [];
      files.forEach(function (f) { var why = photoCheck(f); if (why) skips.push([f.name, why]); else todo.push(f); });
      var wait = todo.length && notReady();
      if (wait) return toast(wait, true);
      if (!todo.length) return pfNote(skipNote(skips), true);
      // stop: why the rest of the batch can't go up (a new item that couldn't be saved); those files are named with it
      var stop = null;
      autoNew = [];
      setBusy(true, line(todo[0].name, 0, todo.length));
      todo.reduce(function (p, file, i) {
        return p.then(function () {
          if (!alive()) return;
          if (stop) return skips.push([file.name, 'upload', stop]);
          if (state.gallery.length >= 40) return skips.push([file.name, 'full']);
          busyLine(line(file.name, i, todo.length));
          return put(file, i, todo.length).then(function (x) {
            if (!x) return;
            batch.push(x.path);
            state.gallery.push({ path: x.path, alt: '', size: 'full', w: x.w, h: x.h });
            autoNew.push(x.path); fitNew();
            drawGallery();
          }, function (e) {
            if (e && e.skip) return skips.push([file.name, e.skip]);
            if (!(e && e.upload)) stop = (e && e.message) || 'something went wrong';
            skips.push([file.name, 'upload', stop || e.message]);
          });
        });
      }, Promise.resolve()).then(function () {
        // closed meanwhile: what went up comes off again with the editor's other unsaved files (filmLeft)
        if (!alive()) return;
        var said = skips.length ? skipNote(skips) : '', one = batch.length === 1;
        if (!batch.length) return pfNote(said + (files.length > 1 ? ' No images were added.' : ''), true);
        return keepUpload(said ? {
          draft: said + (one ? ' The other image was saved.' : ' The other images were saved.'),
          live: said + (one ? ' The other image is added. Save to put it on the live page.' : ' The other images are added. Save to put them on the live page.')
        } : {
          draft: one ? 'Image added. Add alt text to it. Saved to the draft.' : 'Images added. Add alt text to each one. Saved to the draft.',
          live: one ? 'Image added. Add alt text to it. Save to put it on the live page.' : 'Images added. Add alt text to each one. Save to put them on the live page.'
        }, one ? 'image' : 'images', !one).then(function (msg) { pfNote(msg, !!said); }, function (e) { pfNote(e.message + (said ? ' ' + said : ''), true); });
      }).catch(function (e) { toast((e && e.message) || 'Something went wrong.', true); }).then(function () { autoNew = []; setBusy(false); });
    }
    var galFile = fileInput(true, addPhotos);
    var galBtn = ro ? null : h('button', { class: 'btn sm', type: 'button', onclick: pick(galFile) }, icon('plus', 's'), 'Add images');
    // autoNew: the photos of the batch going up now that still have the size their shape gave them (a size picked by
    // hand, or a row moved, ends that)
    var autoNew = [];
    // every size set again from each photo's shape (autoSizes); a photo of unknown shape keeps its size
    var galAuto = ro ? null : h('button', { class: 'btn sm quiet pf-auto', type: 'button', onclick: function () {
      if (busy) return;
      var sizes = autoSizes(state.gallery), kept = sizes.indexOf(null) > -1;
      state.gallery.forEach(function (g, i) { if (sizes[i]) g.size = sizes[i]; });
      autoNew = [];
      drawGallery(); dirtyCheck();
      toast('Sizes set from each image’s shape.' + (kept ? ' Images of unknown shape kept their size.' : ''));
    } }, 'Auto layout');
    var galList = h('div', { class: 'pfrows' }), galNone = h('p', { class: 'empty', text: 'No gallery images yet.' });
    var galHelp = h('p', { class: 'help', text: ro ? 'Images of the same width sit side by side, two halves or three thirds.'
      : 'New images get a size from their shape. Auto layout sets every size again; change any size by hand after.' });
    var galFiles = ro ? null : h('p', { class: 'help', text: 'JPG, PNG, WebP or AVIF, up to ' + MAX_MB + ' MB. Large photos are resized to ' + LONG_EDGE + ' px for the web before upload.' });
    // the layout preview: the gallery as the project page lays it out (galleryRows), small. It is only to look at;
    // each image's size select says the same in words.
    var galPage = h('div', { class: 'pfl-page' }), galView = h('div', { class: 'pfl', 'aria-hidden': 'true' },
      h('span', { class: 'pfl-k', text: 'Layout preview' }), h('div', { class: 'pfl-box' }, galPage));
    // where a moved row went, read out
    var galSaid = h('p', { class: 'sr', role: 'status', 'aria-live': 'polite' });
    var galTell = function (t) { galSaid.textContent = ''; setTimeout(function () { galSaid.textContent = t; }, 50); };
    var SIZES = [['full', 'Full width'], ['half', 'Half'], ['third', 'Third']];
    // the photos of this batch still sized by their shape: each run of them next to each other is sized again as one,
    // so a pair or a row of three forms as the photos arrive
    function fitNew() {
      var g = state.gallery, i = 0;
      var auto = function (k) { return k < g.length && autoNew.indexOf(g[k].path) > -1; };
      while (i < g.length) {
        if (!auto(i)) { i++; continue; }
        var j = i;
        while (auto(j)) j++;
        var run = g.slice(i, j), sizes = autoSizes(run);
        run.forEach(function (x, k) { if (sizes[k]) x.size = sizes[k]; });
        i = j;
      }
    }
    var handSized = function (g) { var k = autoNew.indexOf(g.path); if (k > -1) autoNew.splice(k, 1); };
    // a row moved by hand (its buttons or its handle): read out where it went; the new photos keep the sizes they have
    var galMoved = function (j) { autoNew = []; galTell('Moved to position ' + (j + 1) + ' of ' + state.gallery.length + '.'); };
    // shown: the photos as last drawn, row by row
    var shown = [];
    function drawGallery() {
      if (drag) dragEnd(false);
      // a redraw (a photo just uploaded, say) keeps the cursor in the alt text being typed, on the same photo when the
      // order changed (after a save the photos are new copies, found by their path)
      var was = document.activeElement, at = -1, sel = null, keep = null;
      if (was && was.tagName === 'INPUT' && galList.contains(was)) {
        at = $$('.pfrow', galList).indexOf(was.closest('.pfrow'));
        keep = shown[at] || null;
        try { sel = [was.selectionStart, was.selectionEnd]; } catch (e) { sel = null; }
      }
      galList.innerHTML = '';
      state.gallery.forEach(function (g, i) {
        var n = i + 1, th = h('span', { class: 'th', 'aria-hidden': 'true' });
        if (thumbCache[g.path]) th.style.backgroundImage = 'url("' + thumbCache[g.path] + '")';
        var alt = input(g.alt, { maxlength: 300, placeholder: 'Alt text, needed to publish', autocomplete: 'off' });
        // marked while publishing still needs it; the mark goes as soon as there is text
        if (altMarks.indexOf(g.path) > -1) alt.setAttribute('aria-invalid', 'true');
        alt.addEventListener('input', function () {
          g.alt = alt.value;
          var k = altMarks.indexOf(g.path);
          if (k > -1 && alt.value.trim()) { altMarks.splice(k, 1); alt.removeAttribute('aria-invalid'); }
          dirtyCheck();
        });
        var sz = select(SIZES, g.size, { disabled: ro });
        sz.addEventListener('change', function () { g.size = sz.value; handSized(g); drawPreview(); dirtyCheck(); });
        // dragged by its handle (mouse, pen or touch); the up and down buttons do the same from a keyboard
        var grip = ro ? null : h('span', { class: 'grip', title: 'Drag to move', 'aria-hidden': 'true' }, icon('grip'));
        if (grip) grip.addEventListener('pointerdown', function (e) { dragStart(e, i); });
        galList.appendChild(h('div', { class: ro ? 'pfrow' : 'pfrow has-grip' }, grip, th,
          h('label', { class: 'f alt' }, h('span', { class: 'sr', text: 'Alt text for image ' + n }), alt),
          h('label', { class: 'f sz' }, h('span', { class: 'sr', text: 'Width of image ' + n }), sz),
          mover(state.gallery, i, 'image', drawGallery, galList, galBtn, galMoved)));
      });
      shown = state.gallery.slice();
      var k = keep ? state.gallery.indexOf(keep) : at;
      if (keep && k < 0) k = state.gallery.map(function (g) { return g.path; }).indexOf(keep.path);
      var back = k > -1 && $$('.pfrow .alt input', galList)[k];
      if (back) { back.focus({ preventScroll: true }); if (sel) try { back.setSelectionRange(sel[0], sel[1]); } catch (e) { sel = null; } }
      galNone.hidden = !!state.gallery.length; galHelp.hidden = !state.gallery.length;
      if (galAuto) galAuto.hidden = !state.gallery.length;
      drawPreview();
      signed(state.gallery.map(function (g) { return g.path; })).then(function () {
        $$('.pfrow', galList).forEach(function (row, i) {
          var g = state.gallery[i], th = $('.th', row);
          if (g && th && thumbCache[g.path]) th.style.backgroundImage = 'url("' + thumbCache[g.path] + '")';
        });
        paintPreview();
      }, function () {});
    }
    // the preview's pictures as [img, path], so a link signed later fills them in
    var galPics = [];
    function drawPreview() {
      galPage.innerHTML = ''; galPics = [];
      galleryRows(state.gallery).forEach(function (row) {
        var el = h('div', { class: 'pfl-row' });
        row.forEach(function (c) {
          var img = h('img', { alt: '', loading: 'lazy', decoding: 'async' });
          // the shape stored with the photo (its file's own); one of unknown shape takes its file's once that loads
          if (shapeOf(c.g)) img.style.aspectRatio = (+c.g.w) + ' / ' + (+c.g.h);
          // as wide as its share of the row (grow factors scaled up: below a total of 1 a flex row leaves part of its
          // width empty)
          img.style.flex = (c.share * 1000).toFixed(3) + ' 1 0';
          galPics.push([img, c.g.path]);
          el.appendChild(img);
        });
        galPage.appendChild(el);
      });
      paintPreview();
      galView.hidden = !state.gallery.length;
    }
    var paintPreview = function () {
      galPics.forEach(function (p) { var u = thumbCache[p[1]]; if (u && p[0].getAttribute('src') !== u) p[0].src = u; });
    };

    // ---- a gallery row moved by its handle: mouse, pen or touch (pointer events) ----
    // The row dims, a violet line shows where it will land, and the drawer scrolls by itself while the pointer is near
    // its top or bottom edge (the bar at its foot counts as the bottom). Escape, or a redraw meanwhile, puts it back.
    var drag = null;
    // the nearest box around el that scrolls (the drawer), or null
    var scrollBox = function (el) {
      for (var p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        var oy = getComputedStyle(p).overflowY;
        if ((oy === 'auto' || oy === 'scroll') && p.scrollHeight > p.clientHeight) return p;
      }
      return null;
    };
    // where a row let go of at y lands: before the first row whose middle is below y, else at the end
    var dropAt = function (y) {
      var rows = $$('.pfrow', galList);
      for (var k = 0; k < rows.length; k++) { var r = rows[k].getBoundingClientRect(); if (y < r.top + r.height / 2) return k; }
      return rows.length;
    };
    function dragMark() {
      var rows = $$('.pfrow', galList), to = drag.to = dropAt(drag.y), stay = to === drag.from || to === drag.from + 1;
      rows.forEach(function (r, k) {
        r.classList.toggle('is-over', !stay && k === to);
        r.classList.toggle('is-end', !stay && to === rows.length && k === rows.length - 1);
      });
    }
    function dragStart(e, i) {
      if (ro || drag || !e.isPrimary || e.button !== 0) return;
      e.preventDefault();
      // the moves keep coming here when the pointer leaves the handle or the window
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch (x) { /* a pointer the browser didn't make can't be held */ }
      drag = { from: i, to: i, id: e.pointerId, y0: e.clientY, y: e.clientY, on: false, box: scrollBox(galList), raf: 0 };
      window.addEventListener('pointermove', dragMove, true);
      window.addEventListener('pointerup', dragUp, true);
      window.addEventListener('pointercancel', dragCancel, true);
      window.addEventListener('keydown', dragKey, true);
    }
    function dragMove(e) {
      if (!drag || e.pointerId !== drag.id) return;
      drag.y = e.clientY;
      if (!drag.on) {
        // a few pixels first, so a press on the handle alone moves nothing
        if (Math.abs(drag.y - drag.y0) < 4) return;
        drag.on = true;
        galList.classList.add('is-sorting');
        var row = $$('.pfrow', galList)[drag.from];
        if (row) row.classList.add('is-drag');
        drag.raf = requestAnimationFrame(dragScroll);
      }
      dragMark();
    }
    function dragScroll() {
      if (!drag) return;
      var b = drag.box;
      if (b) {
        var r = b.getBoundingClientRect(), bottom = r.bottom, EDGE = 56, v = 0;
        if (b.contains(foot)) bottom = Math.min(bottom, foot.getBoundingClientRect().top);
        if (drag.y < r.top + EDGE) v = drag.y - (r.top + EDGE);
        else if (drag.y > bottom - EDGE) v = drag.y - (bottom - EDGE);
        if (v) {
          // faster the nearer the edge, at most 18 px a frame
          var was = b.scrollTop;
          b.scrollTop = was + Math.max(-18, Math.min(18, Math.round(v / 3)));
          if (b.scrollTop !== was) dragMark();
        }
      }
      drag.raf = requestAnimationFrame(dragScroll);
    }
    function dragEnd(apply) {
      var d = drag;
      if (!d) return;
      drag = null;
      cancelAnimationFrame(d.raf);
      window.removeEventListener('pointermove', dragMove, true);
      window.removeEventListener('pointerup', dragUp, true);
      window.removeEventListener('pointercancel', dragCancel, true);
      window.removeEventListener('keydown', dragKey, true);
      galList.classList.remove('is-sorting');
      $$('.pfrow', galList).forEach(function (r) { r.classList.remove('is-drag', 'is-over', 'is-end'); });
      if (!apply || !d.on || d.to === d.from || d.to === d.from + 1 || !alive()) return;
      var j = d.to > d.from ? d.to - 1 : d.to;
      state.gallery.splice(j, 0, state.gallery.splice(d.from, 1)[0]);
      drawGallery(); dirtyCheck(); galMoved(j);
    }
    var dragUp = function (e) { if (drag && e.pointerId === drag.id) dragEnd(true); };
    var dragCancel = function (e) { if (drag && e.pointerId === drag.id) dragEnd(false); };
    // Escape puts the row back and leaves the drawer open
    var dragKey = function (e) { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); dragEnd(false); } };
    // the gallery images publishing still needs alt text for: each marked, and the first one takes the cursor
    function markAlt() {
      altMarks = state.gallery.filter(function (g) { return !(g.alt || '').trim(); }).map(function (g) { return g.path; });
      drawGallery();
      var first = $('.alt input[aria-invalid="true"]', galList);
      if (first) { first.focus({ preventScroll: true }); first.scrollIntoView({ block: 'center' }); }
    }
    // What publishing still needs, in one message. Gallery images without alt text are marked (see markAlt) and the
    // message points at them. goal: 'publish', or 'update' for a save of a live item.
    var ALT_MISS = 'alt text on every gallery image';
    function needs(miss, goal) {
      var rest = miss.filter(function (m) { return m !== ALT_MISS; }), alt = rest.length < miss.length;
      var to = goal === 'publish' ? 'publish' : 'update the live page';
      if (alt) markAlt();
      pfNote(rest.length ? 'To ' + to + ', add: ' + listOf(rest.concat(alt ? ['alt text on the marked images'] : [])) + '.'
        : 'Add alt text to the marked images to ' + to + '.', true);
    }

    // ---- credits ----
    var crList = h('div', { class: 'pfrows' }), crNone = h('p', { class: 'empty', text: 'No credits yet.' });
    var addCredit = ro ? null : h('button', { class: 'btn sm', type: 'button', onclick: function () {
      if (state.credits.length >= 30) return toast('Up to 30 credits.', true);
      state.credits.push({ role: '', name: '' }); drawCredits(); dirtyCheck(); $$('input', crList).slice(-2)[0].focus();
    } }, icon('plus', 's'), 'Add credit');
    function drawCredits() {
      crList.innerHTML = '';
      state.credits.forEach(function (c, i) {
        var n = i + 1;
        var role = input(c.role, { maxlength: 80, placeholder: 'Role', autocomplete: 'off' });
        var name = input(c.name, { maxlength: 120, placeholder: 'Name or handle', autocomplete: 'off' });
        role.addEventListener('input', function () { c.role = role.value; dirtyCheck(); });
        name.addEventListener('input', function () { c.name = name.value; dirtyCheck(); });
        crList.appendChild(h('div', { class: 'pfrow cr' },
          h('label', { class: 'f' }, h('span', { class: 'sr', text: 'Role, credit ' + n }), role),
          h('label', { class: 'f' }, h('span', { class: 'sr', text: 'Name, credit ' + n }), name),
          mover(state.credits, i, 'credit', drawCredits, crList, addCredit)));
      });
      crNone.hidden = !!state.credits.length;
    }

    // ---- film: an uploaded MP4 with a poster taken from one of its frames, or a YouTube link ----
    // film.up: the upload running now ({ name, at, again, stop, task }); film.v: the <video> shown, for film.path;
    // film.moved: the frame on screen isn't the poster (the slider or play moved it); film.want: where the slider asked
    // to go while the video was still loading; film.left: the editor has closed; film.on: a picked video is being
    // checked and uploaded (its link field waits meanwhile). filmNew: the films and posters uploaded while this editor
    // is open; once it closes, the ones no saved version uses come off again (a film is up to 20 MB of the project's
    // storage).
    var film = { up: null, v: null, path: null, moved: false, want: null, left: false, on: false }, filmNew = [];
    var FILM_HELP = 'MP4 (H.264), up to 20 MB. Plays when a visitor presses play.';
    var LINK_HELP = 'Shown above the gallery. Use YouTube: Vimeo is blocked on some Indonesian networks.';
    var linkHelp = help(f.video_url, LINK_HELP), filmBox = h('div', { class: 'pfv-box' });
    // .m4v is how Apple's apps name an MP4 (Safari types it video/x-m4v)
    var filmFile = ro ? null : h('input', { type: 'file', accept: 'video/mp4,.mp4,video/x-m4v,.m4v', hidden: true, tabindex: '-1', 'aria-hidden': 'true' });
    if (filmFile) filmFile.addEventListener('change', function () { var files = Array.prototype.slice.call(filmFile.files); filmFile.value = ''; if (files.length) onFilm(files); });
    var pickFilm = function () { if (!busy && !ro && !film.up) filmFile.click(); };
    var filmBtn = ro ? null : h('button', { class: 'btn sm', type: 'button', onclick: pickFilm }, icon('film', 's'), 'Upload a video');
    var posterBtn = ro ? null : h('button', { class: 'btn sm', type: 'button', onclick: function () { setPoster(); } }, 'Use this frame as the poster');
    var replaceBtn = ro ? null : h('button', { class: 'btn sm quiet', type: 'button', onclick: pickFilm }, 'Replace video');
    var removeBtn = ro ? null : h('button', { class: 'btn sm quiet', type: 'button', 'aria-label': 'Remove the video', onclick: function () { removeFilm(); } }, 'Remove');
    // the upload: the file's name (read out as it changes), Cancel, and a thin bar with no figure on it
    var upName = h('span', { role: 'status' }), upFill = h('i', {});
    var upBar = h('span', { class: 'pfv-bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '0' }, upFill);
    var cancelBtn = h('button', { class: 'btn sm quiet', type: 'button', 'aria-label': 'Cancel the upload', onclick: function () {
      var u = film.up;
      if (!u || u.stop) return;
      u.stop = true; cancelBtn.disabled = true;
      if (u.task) u.task.abort();
    } }, 'Cancel');
    var barAt = function (k) {
      var pc = Math.max(0, Math.min(100, Math.round(k * 100)));
      upFill.style.width = pc + '%'; upBar.setAttribute('aria-valuenow', String(pc));
    };
    // the uploaded film: its frame with a play button, and a slider to pick the poster's frame (editors)
    var playBtn = h('button', { class: 'pfv-play', type: 'button', 'aria-label': 'Play the video', onclick: function () {
      var v = film.v;
      if (!v) return;
      if (v.paused || v.ended) { var p = v.play(); if (p && p.catch) p.catch(function () {}); } else v.pause();
    } }, icon('play'));
    var playIcon = function (on) {
      var u = $('use', playBtn);
      if (u) u.setAttribute('href', '#i-' + (on ? 'pause' : 'play'));
      playBtn.setAttribute('aria-label', on ? 'Pause the video' : 'Play the video');
    };
    var scrub = ro ? null : h('input', { class: 'pfv-scrub', type: 'range', min: '0', max: '1000', step: '1', value: '0', 'aria-label': 'Frame of the video' });
    var filmNote = h('p', { class: 'help pfv-err', role: 'status', hidden: true });
    var scrubText = function () {
      var v = film.v;
      if (scrub && v && isFinite(v.duration) && v.duration) scrub.setAttribute('aria-valuetext', clock(v.currentTime) + ' of ' + clock(v.duration));
    };
    // the frame at k (0 to 1) of the film; a film that hasn't loaded yet (its signed link waits to be asked, to spare
    // the storage traffic) loads first
    function seekFilm(k) {
      var v = film.v;
      if (!v) return;
      if (!v.paused) v.pause();
      if (v.readyState < 1 || !isFinite(v.duration) || !v.duration) {
        film.want = k;
        if (v.preload === 'none') { v.preload = 'auto'; if (v.getAttribute('src')) v.load(); }
        return;
      }
      v.currentTime = Math.max(0, Math.min(v.duration - 0.05, k * v.duration));
      scrubText();
    }
    if (scrub) scrub.addEventListener('input', function () { film.moved = true; seekFilm(+scrub.value / 1000); });
    // the <video> the editor shows for the film at path
    function useFilm(v, path) {
      releaseFilm();
      film.v = v; film.path = path; film.moved = false; film.want = null;
      if (scrub) { scrub.value = '0'; scrub.removeAttribute('aria-valuetext'); }
      v.addEventListener('play', function () { if (film.v === v) { film.moved = true; playIcon(true); } });
      v.addEventListener('pause', function () { if (film.v === v) playIcon(false); });
      v.addEventListener('timeupdate', function () {
        if (film.v !== v || !isFinite(v.duration) || !v.duration) return;
        if (scrub && !v.paused) scrub.value = String(Math.round(v.currentTime / v.duration * 1000));
        scrubText();
      });
      v.addEventListener('loadedmetadata', function () {
        if (film.v !== v) return;
        if (film.want != null) { var k = film.want; film.want = null; seekFilm(k); }
        scrubText();
      });
      v.addEventListener('error', function () {
        if (film.v === v && v.getAttribute('src')) { filmNote.textContent = 'The video couldn’t be loaded. Reload the page to try again.'; filmNote.hidden = false; }
      });
      playIcon(false);
      return v;
    }
    function releaseFilm() {
      var v = film.v;
      film.v = null; film.path = null; film.moved = false; film.want = null;
      if (!v) return;
      try { v.pause(); } catch (e) { /* nothing was playing */ }
      v.removeAttribute('src'); v.removeAttribute('poster');
      try { v.load(); } catch (e) { /* let go of already */ }
    }
    // the film of the item now: a file uploaded in this tab plays from the file itself; one saved before plays from a
    // signed link of its draft, loaded only once the person plays it or moves the slider (the poster shows until then)
    function filmVideo() {
      var path = state.video_path;
      if (film.v && film.path === path) return film.v;
      var v = useFilm(h('video', { playsinline: true, preload: 'none' }), path);
      // read back for a poster, so asked for with CORS
      v.crossOrigin = 'anonymous';
      if (thumbCache[path] && thumbUntil[path] === Infinity) { v.preload = 'auto'; v.src = thumbCache[path]; }
      else signedFilm(path).then(function (u) { if (film.v === v) v.src = u; }, function () {
        if (film.v === v) { filmNote.textContent = 'The video couldn’t be loaded. Reload the page to try again.'; filmNote.hidden = false; }
      });
      return v;
    }
    function filmPoster() {
      var v = film.v, p = state.video_poster_path;
      if (!v) return;
      if (!p) return v.removeAttribute('poster');
      if (thumbCache[p] && thumbUntil[p] > Date.now()) { if (v.getAttribute('poster') !== thumbCache[p]) v.poster = thumbCache[p]; return; }
      signed([p]).then(function () { if (film.v === v && state.video_poster_path === p && thumbCache[p]) v.poster = thumbCache[p]; }, function () {});
    }
    function drawFilm() {
      var has = !!state.video_path;
      // the link field says which film the project shows
      f.video_url.placeholder = has ? 'The uploaded video is used' : 'YouTube link';
      linkHelp.textContent = has ? 'A project shows one film. Remove the uploaded video to use a link.' : LINK_HELP;
      f.video_url.disabled = ro || !!film.up || film.on;
      filmBox.innerHTML = '';
      if (film.up) {
        var u = film.up;
        upName.innerHTML = '';
        add(upName, [u.again ? 'Trying ' : 'Uploading ', h('b', { text: u.name }), u.again ? ' again' : '']);
        upBar.setAttribute('aria-label', 'Uploading ' + u.name);
        cancelBtn.disabled = u.stop;
        barAt(u.at);
        filmBox.appendChild(h('div', { class: 'pfv-up' }, h('div', { class: 'pfv-line' }, upName, cancelBtn), upBar));
      } else if (has) {
        var v = filmVideo();
        filmPoster();
        var left = h('div', { class: 'pfv-pick' }, h('div', { class: 'pfv-frame' }, v, playBtn), scrub, filmNote);
        filmBox.appendChild(ro ? h('div', { class: 'pfv-done' }, left) : h('div', { class: 'pfv-done' }, left, h('div', { class: 'fstack' },
          h('div', {}, posterBtn), h('p', { class: 'help', text: FILM_HELP }), h('div', { class: 'pfv-acts' }, replaceBtn, removeBtn))));
      } else if (!ro) {
        releaseFilm();
        filmBox.appendChild(h('div', { class: 'pfv' }, filmBtn, h('p', { class: 'help', text: FILM_HELP })));
      }
      filmBox.hidden = !filmBox.firstChild;
    }
    // the keyboard's place: when it was on a film control that is gone now (a view swapped, a button disabled while
    // something ran), it goes to the given one; focus anywhere else stays where it is
    var filmKeys = function (to) {
      var a = document.activeElement;
      if (to && !to.disabled && alive() && (!a || a === document.body || filmBox.contains(a))) to.focus({ preventScroll: true });
    };
    // A video picked or dropped: checked (its type and size, its codec, that it plays here), its poster frame taken (a
    // second in, or the middle of a shorter film), the room in storage asked for, then uploaded with a bar and Cancel,
    // its poster after it. The upload takes the link's place. A draft keeps it at once; a live item waits for a save.
    function onFilm(files) {
      if (busy || ro || film.up) return;
      if (files.length > 1) return toast('Upload one video at a time.', true);
      var file = files[0], kind = filmType(file);
      if (kind !== 'mp4') return pfNote(FILM_SAY[kind === 'mov' ? 'mov' : 'type'], true);
      if (file.size > VID_MAX) return pfNote(filmSay(filmErr('size', file.size)), true);
      // a draft is saved after the upload, so the form has to be fine to save; the link comes out with the upload, so
      // it isn't held against it
      var linkWas = f.video_url.value;
      f.video_url.value = '';
      var wait = notReady('a video');
      f.video_url.value = linkWas;
      if (wait) return toast(wait, true);
      var url = URL.createObjectURL(file), v = null, shot = null, up = null, placed = false, path = null, ppath = null;
      var was = { link: linkWas };
      var stopped = function () { return !alive() || !!(up && up.stop); };
      if (film.v) film.v.pause();
      setBusy(true, 'Checking the video…');
      // the upload takes the link's place, so a link typed meanwhile would be lost: the field waits until the end
      film.on = true; f.video_url.disabled = true;
      filmCodec(file).then(function (c) {
        if (!c) throw filmErr('none');
        if (c !== 'avc1' && c !== 'avc3') throw filmErr('codec', c);
        return filmProbe(url);
      }).then(function (x) {
        v = x;
        var t0 = v.duration > 1 ? 1 : v.duration / 2;
        // a file this browser reads but can't show a frame of can't be played here either
        return filmFrame(v, t0, 'play').then(function (s) { shot = s; shot.t = t0; });
      }).then(function () {
        if (stopped()) throw cancelled();
        return storageUsed();
      }).then(function (used) {
        // the film is stored twice while it is live (its draft and its public copy)
        if (used + 2 * file.size > VID_ROOM) throw filmErr('full');
        if (stopped()) throw cancelled();
        f.video_url.value = '';
        return ensureSaved('a video');
      }).then(function () {
        if (stopped()) throw cancelled();
        path = pfPath(id, 'mp4');
        up = film.up = { name: file.name, at: 0, again: false, stop: false, task: null };
        setBusy(true, 'Uploading the video…');
        drawFilm(); filmKeys(cancelBtn);
        up.task = xhrUpload(pfBuckets(path).draft, path, file, { type: 'video/mp4',
          onProgress: function (a, b) { if (film.up === up && b) { up.at = a / b; barAt(up.at); } },
          onRetry: function () { if (film.up !== up) return; up.again = true; up.at = 0; drawFilm(); busyLine('Trying the upload again…'); } });
        return up.task.done;
      }).then(function () {
        if (stopped()) { removeDrafts([path]); throw cancelled(); }
        up.at = 1; barAt(1);
        busyLine('Saving the poster…');
        ppath = pfPath(id, shot.ext);
        return putDraft(ppath, shot.blob, function () { busyLine('Trying the poster again…'); }).catch(function (e) {
          removeDrafts([path]);
          if (e) e.poster = true;
          throw e;
        });
      }).then(function () {
        if (stopped()) { removeDrafts([path, ppath]); throw cancelled(); }
        fresh.push(path, ppath); filmNew.push(path, ppath);
        thumbCache[path] = url; thumbUntil[path] = Infinity;
        thumbCache[ppath] = URL.createObjectURL(shot.blob); thumbUntil[ppath] = Infinity;
        placed = true; film.up = null;
        state.video_path = path; state.video_poster_path = ppath; state.video_w = v.videoWidth; state.video_h = v.videoHeight; state.video_url = null;
        // the probe is shown as it is, on the poster's frame, with its sound back for the play button
        v.muted = false;
        useFilm(v, path);
        if (scrub) scrub.value = String(Math.round(shot.t / v.duration * 1000));
        drawFilm(); scrubText();
        var out = was.link.trim() ? ' The video link was taken out.' : '';
        return keepUpload({ draft: 'Video uploaded.' + out + ' Saved to the draft.', live: 'Video uploaded.' + out + ' Save to put it on the live page.' }, 'video');
      }).then(function (msg) { pfNote(msg); }, function (e) {
        film.up = null;
        if (!placed) {
          if (v) { v.removeAttribute('src'); try { v.load(); } catch (x) { /* let go of already */ } }
          URL.revokeObjectURL(url);
          // the link comes back when the video didn't go in
          if (alive()) f.video_url.value = was.link;
        }
        if (!alive()) return;
        drawFilm();
        if (e && e.cancelled) return toast('Upload cancelled.');
        pfNote(e && e.film ? filmSay(e) : e && e.upload ? (e.poster ? 'The poster couldn’t be uploaded: ' : 'The video couldn’t be uploaded: ') + sentence(e.message)
          : (e && e.message) || 'Something went wrong.', true);
      }).then(function () {
        film.on = false; f.video_url.disabled = ro || !!film.up;
        setBusy(false); filmKeys(state.video_path ? posterBtn : filmBtn);
      });
    }
    // the frame on screen becomes the poster (made and uploaded the way the first one was)
    function setPoster() {
      var v = film.v;
      if (busy || ro || !v || !state.video_path) return;
      // (a film saved without a poster has none yet, whatever frame is on screen)
      if (!film.moved && state.video_poster_path) return toast('This frame is already the poster.');
      var wait = notReady('a poster');
      if (wait) return toast(wait, true);
      if (!v.paused) v.pause();
      // p: the new poster's name; at: the time of the frame it was taken from
      var p = null, at = -1;
      setBusy(true, 'Saving the poster…');
      // a film still loading (moved before its data came) is let to reach the frame asked for first
      var meta = v.readyState >= 1 ? Promise.resolve() : new Promise(function (go, no) {
        var t = setTimeout(function () { off(); no(filmErr('frame')); }, 20000);
        var off = function () { clearTimeout(t); v.removeEventListener('loadedmetadata', ok); v.removeEventListener('error', bad); };
        var ok = function () { off(); setTimeout(go, 0); }, bad = function () { off(); no(filmErr('frame')); };
        v.addEventListener('loadedmetadata', ok); v.addEventListener('error', bad);
        if (v.preload === 'none') { v.preload = 'auto'; if (v.getAttribute('src')) v.load(); }
      });
      meta.then(function () { return filmFrame(v, v.currentTime); }).then(function (x) {
        if (!alive() || film.v !== v) return null;
        p = pfPath(id, x.ext); at = x.t;
        // the slider shows the frame taken (a move made just before it was drawn went back to it)
        if (scrub && !v.seeking && Math.abs(v.currentTime - at) < 0.001) { scrub.value = String(Math.round(at / v.duration * 1000)); scrubText(); }
        return putDraft(p, x.blob, function () { busyLine('Trying the poster again…'); }).then(function () {
          if (!alive() || film.v !== v) { removeDrafts([p]); return null; }
          fresh.push(p); filmNew.push(p);
          thumbCache[p] = URL.createObjectURL(x.blob); thumbUntil[p] = Infinity;
          state.video_poster_path = p;
          // the frame on screen is the poster now, unless the slider or play moved it while this one was saved
          if (!v.seeking && Math.abs(v.currentTime - at) < 0.001) film.moved = false;
          filmPoster();
          return keepUpload({ draft: 'Poster set. Saved to the draft.', live: 'Poster set. Save to put it on the live page.' }, 'poster');
        });
      }).then(function (msg) { if (msg) toast(msg); }, function (e) {
        if (!alive()) return;
        pfNote(e && e.film ? FILM_SAY.frame : e && e.upload ? 'The poster couldn’t be uploaded: ' + sentence(e.message) : (e && e.message) || 'Something went wrong.', true);
      }).then(function () { setBusy(false); filmKeys(posterBtn); });
    }
    function removeFilm(quiet) {
      if (busy || ro || !state.video_path) return;
      state.video_path = state.video_poster_path = state.video_w = state.video_h = null;
      releaseFilm();
      drawFilm(); dirtyCheck();
      if (quiet) return;
      toast(isLive() ? 'Video removed. Save to take it off the live page.' : 'Video removed. Save the draft to keep this change.');
      if (filmBtn) filmBtn.focus();
    }
    // A link typed while there is an uploaded video: a project shows one film, so the video comes off first (when
    // asked), or the link does
    var asking = false;
    f.video_url.addEventListener('input', function () {
      if (!state.video_path || asking || !f.video_url.value.trim()) return;
      if (busy) { f.video_url.value = ''; dirtyCheck(); return toast('Wait until the save is done, then add the link.', true); }
      asking = true;
      ask('Remove the uploaded video?', 'A project shows one film. To use this link, the uploaded video comes off when you save.', 'Remove video', true).then(function (ok) {
        asking = false;
        if (ok) removeFilm(true); else { f.video_url.value = ''; dirtyCheck(); }
        f.video_url.focus();
      });
    });
    // The editor closed (or another opened in its place): an upload still running stops, and what was uploaded here
    // (films, posters, photos, a cover) that no saved version uses comes off again. A saved version is the editor's
    // last save or the row as the database has it now (a save whose answer was lost may still have written it); when
    // the row can't be read, the files stay. While a step runs (a save, say) this waits for it (setBusy).
    function filmLeft() {
      film.left = true;
      if (film.up) { film.up.stop = true; if (film.up.task) film.up.task.abort(); }
      if (busy) return;
      releaseFilm();
      var mine = filmNew.concat(fresh).filter(function (p, i, all) { return all.indexOf(p) === i; });
      filmNew = []; fresh = [];
      if (!mine.length) return;
      // the whole row, so a database without the film's columns yet still answers
      sb.from('portfolio_items').select('*').eq('id', id).maybeSingle().then(function (r) {
        if (!r || r.error) return;
        var keep = (saved ? pathsOf(saved) : []).concat(r.data ? pathsOf(r.data) : []);
        var drop = mine.filter(function (p) { return keep.indexOf(p) < 0; });
        if (drop.length) { removeDrafts(drop); drop.forEach(forgetThumb); }
      }, function () {});
    }

    // ---- reading the form ----
    function collect() {
      state.title = f.title.value.trim(); state.slug = f.slug.value.trim(); state.client = f.client.value.trim();
      state.year = f.year.value ? +f.year.value : null;
      // the pressed chips in the order they stand: the fixed list's keys, then the labels of your own
      var picked = function (g, own) { return $$('button[aria-pressed="true"]', g.box).filter(function (b) { return b.hasAttribute('data-own') === own; }).map(function (b) { return b.value; }); };
      state.services = picked(svc, false); state.industries = picked(ind, false);
      state.services_custom = picked(svc, true); state.industries_custom = picked(ind, true);
      ['summary', 'brief', 'approach', 'outcome', 'cover_alt', 'video_url', 'seo_title', 'seo_description'].forEach(function (k) { state[k] = f[k].value.trim(); });
      state.featured = f.featured.checked; state.sort_order = +f.sort_order.value || 0;
      state.project_id = proj.value || null;
      return collectFrom(state);
    }
    function check() {
      var x = collect();
      if (!x.title) return 'Give the project a title.';
      if (!SLUG_RE.test(x.slug)) return 'The slug can only use lowercase letters, numbers and single dashes.';
      if (RESERVED.indexOf(x.slug) > -1) return '“' + x.slug + '” belongs to a built-in page. Pick another slug.';
      if (x.year != null && (x.year < 1990 || x.year > 2100 || x.year % 1)) return 'The year should be between 1990 and 2100.';
      if (x.video_url && !VIDEO_RE.test(x.video_url)) return 'The video link must be a YouTube or Vimeo address.';
      if (x.video_url && x.video_path) return 'A project shows one film. Remove the uploaded video to use the link.';
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
      // the Work page files every project under a service from the fixed list (the database asks the same)
      if (!x.services.length) miss.push(x.services_custom.length ? 'a service from the list' : 'at least one service');
      if (x.gallery.some(function (g) { return !(g.alt || '').trim(); })) miss.push(ALT_MISS);
      if (x.video_path && !x.video_poster_path) miss.push('video poster');
      return miss;
    }
    // a label typed in a field of your own and not added yet counts as a change too
    var dirty = function () { return !ro && (JSON.stringify(collect()) !== lastSaved || ownTyped()); };

    // Saving. On a live item the new images are copied to the public bucket first, then the row is written, then the
    // public copies nothing uses any more come off. When a copy fails the row isn't written, so the live page keeps
    // what it had, and the copies just made come off again. Files no saved version uses leave the drafts bucket.
    function save(silent) {
      // a label still in a field of your own goes in first, as Add would; one that can't stops the save
      // (not in the quiet save after an upload: half typed text stays in its field until the owner adds it or saves)
      var owe = silent ? '' : [svc, ind].map(function (g) { return g.input && tidy(g.input.value) ? addOwn(g) : ''; }).filter(Boolean)[0];
      if (owe) { toast(owe, true); return Promise.reject(new Error(owe)); }
      var err = check();
      if (err) { toast(err, true); return Promise.reject(new Error(err)); }
      // a live item is checked the way publishing is (the database turns the save down otherwise)
      var miss = isLive() ? missingForPublish() : [];
      if (miss.length) { needs(miss, 'update'); return Promise.reject(new Error('Still needed: ' + miss.join(', '))); }
      // what is saved: the form as it is now, copied (text typed while the save is on its way isn't part of it)
      var sent = JSON.stringify(collect()), row = JSON.parse(sent), before = saved ? pathsOf(saved) : [];
      // a database without services and industries of your own gets the row without them
      if (!withOwn) { delete row.services_custom; delete row.industries_custom; }
      var go = function () {
        var live = isLive(), copied = [], late = '';
        var add = live ? pathsOf(row).filter(function (p) { return before.indexOf(p) < 0; }) : [];
        var undo = function () { if (copied.length) removePublic(copied).catch(function () {}); };
        setBusy(true, !add.length ? 'Saving…' : add.some(isFilm) ? 'Copying the new files to the website…' : 'Copying the new images to the website…');
        return copyPublic(add, copied).catch(function (e) {
          undo();
          throw new Error(sentence(e.message) + ' Nothing was saved, so the live page hasn’t changed.');
        }).then(function () {
          stateText.textContent = 'Saving…';
          return isNew ? sb.from('portfolio_items').insert(Object.assign({ id: id, status: 'draft' }, row)).select().single()
            : sb.from('portfolio_items').update(row).eq('id', id).select().single();
        }).then(function (r) {
          // turned down, so the row is as it was and the copies made for it come off again (when the answer was lost
          // the row may be written, so they stay)
          if (r.error) { if (r.error.code) undo(); throw new Error(pfError(r.error)); }
          var now = pathsOf(r.data), gone = before.filter(function (p) { return now.indexOf(p) < 0; });
          var pub = r.data.status === 'published';
          // published meanwhile (in another tab, say): its images are copied now, as publishing does
          var sync = pub && !live ? copyPublic(now) : Promise.resolve();
          return sync.then(function () { if (pub || live) return removePublic(gone); }).catch(function (e) { late = e.message; }).then(function () {
            // files no saved version uses leave the drafts bucket: the ones taken out, and uploads left unused
            var unused = gone.concat(fresh.filter(function (p) { return now.indexOf(p) < 0; }));
            removeDrafts(unused); unused.forEach(forgetThumb); fresh = [];
            // The editor keeps what it shows: alt text or a credit typed while the save was on its way stays, and
            // reads as an unsaved change. The fields the database keeps (the status, its times) come from the row.
            saved = r.data; isNew = false;
            Object.keys(r.data).forEach(function (k) { if (!(k in row)) state[k] = r.data[k]; });
            lastSaved = sent;
            history.replaceState(null, '', '#portfolio/' + id);
            if (late) pfNote('Saved. ' + sentence(late), true);
            else if (!silent) toast(saved.status === 'published' ? 'Saved. The live page is updated.' : 'Draft saved.');
            // the project pages and the Overview count linked items, so they read the list again
            E.forget(); pfLoad(); refreshUi();
          });
        }).catch(function (e) { pfNote(e.message, true); throw e; }).then(function (v) { setBusy(false); return v; }, function (e) { setBusy(false); throw e; });
      };
      if (saved && saved.status === 'published' && !silent) {
        return ask('Update the live page?', '“' + row.title + '” is published. Saving changes what visitors see on the website right away.', 'Save and update').then(function (ok) {
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
        setBusy(true, 'Working…');
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
            toast({ published: 'Published. It’s on the Work page now.', draft: was === 'archived' ? 'Restored as a draft.' : 'Back to draft. It’s off the website.', archived: 'Archived. It’s off the website.' }[next]);
            E.forget(); pfLoad(); refreshUi();
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
      if (miss.length) return needs(miss, 'publish');
      setStatus('published', ['Publish “%”?', 'It will appear on the Work page for everyone. You can unpublish it at any time.'], 'Publish');
    };
    var unpublish = function () { setStatus('draft', ['Unpublish “%”?', 'It comes off the Work page and its link stops working. It stays here as a draft.'], 'Unpublish', true); };
    var archive = function () { setStatus('archived', ['Archive “%”?', 'It leaves the website and the default list. Nothing is deleted; you can restore it later.'], 'Archive', true); };
    var restore = function () { setStatus('draft', ['Restore “%” as a draft?', 'It comes back to the list as a draft. It won’t be public until you publish it.'], 'Restore'); };
    var preview = function () {
      // open the tab right away (so it isn't blocked), then point it at the page once saved
      var w = window.open('about:blank', '_blank');
      saveFirst().then(function () {
        if (w) { w.opener = null; w.location.href = viewUrl(state.slug, true); } else location.href = viewUrl(state.slug, true);
      }).catch(function () { if (w) w.close(); });
    };

    // ---- the bar at the bottom: the state, then the actions, the main one last ----
    var pill = h('span', { class: 'pill' }), stateText = h('span', {});
    var bArchive = h('button', { class: 'btn quiet', type: 'button' }, 'Archive');
    var bUnpublish = h('button', { class: 'btn', type: 'button', onclick: function () { unpublish(); } }, 'Unpublish');
    var bPreview = h('button', { class: 'btn', type: 'button', onclick: preview }, 'Preview');
    var bView = h('a', { class: 'btn', target: '_blank', rel: 'noopener' }, icon('ext', 's'), 'View live');
    var bSave = h('button', { class: 'btn', type: 'button', onclick: function () { save(false).catch(function () {}); } }, 'Save draft');
    var bPublish = h('button', { class: 'btn lime', type: 'button', onclick: function () { publish(); } }, 'Publish');
    var head = E.dhead(h('span', { class: 'code', 'aria-hidden': 'true' }, icon('image')), ' ', ' ');
    var hTitle = $('h2', head), hSub = $('p', head);
    function refreshUi() {
      var st = state.status || 'draft', live = st === 'published', arch = st === 'archived';
      var pl = isNew ? ['draft', 'New draft'] : PF_PILL[st] || ['draft', st];
      pill.className = 'pill ' + pl[0]; pill.textContent = pl[1];
      stateText.textContent = ro ? 'Read only' : isNew ? 'Not saved yet' : (dirty() ? 'Unsaved changes' : 'Saved ' + ago(saved.updated_at));
      hTitle.textContent = isNew ? 'New portfolio item' : saved.title;
      // published_at is when it last went live
      hSub.textContent = isNew ? 'Starts as a private draft' : 'Created ' + pday(saved.created_at) + (live && saved.published_at ? ', live since ' + pday(saved.published_at) : '');
      bSave.textContent = live ? 'Save and update live' : 'Save draft';
      bSave.className = 'btn' + (live ? ' lime' : '');
      bArchive.textContent = arch ? 'Restore' : 'Archive';
      bArchive.className = 'btn' + (arch ? '' : ' quiet');
      bArchive.onclick = arch ? restore : archive;
      bArchive.hidden = ro || isNew;
      bUnpublish.hidden = ro || !live;
      bPublish.hidden = ro || live || arch;
      bSave.hidden = ro;
      bPreview.hidden = live;
      bView.hidden = !live || isNew;
      // the live page is at the saved slug, whatever the field says now
      bView.href = viewUrl(saved ? saved.slug : state.slug, false);
      slugHint.textContent = f.slug.value ? 'Address: ' + location.host + '/work/view?p=' + f.slug.value : 'Made from the title';
      liveHint.hidden = !live;
      f.slug.setAttribute('aria-describedby', slugHint.id + (live ? ' ' + liveHint.id : ''));
    }
    function setBusy(on, text) {
      busy = on;
      [bSave, bPreview, bPublish, bUnpublish, bArchive, coverBtn, galBtn, galAuto, addCredit, filmBtn, posterBtn, replaceBtn, removeBtn, svc.add, ind.add].forEach(function (b) { if (b) b.disabled = on; });
      if (on) stateText.textContent = text || 'Working…'; else refreshUi();
      // the editor closed while something ran: what the film left behind comes off now
      if (!on && film.left) filmLeft();
    }
    function dirtyCheck() { if (!busy) refreshUi(); }

    f.title.addEventListener('input', function () { if (!slugTouched) f.slug.value = slugify(f.title.value); });
    f.slug.addEventListener('input', function () { slugTouched = true; f.slug.value = f.slug.value.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-{2,}/g, '-'); });

    // photos dropped anywhere on the gallery go the way picked ones do; Auto layout sits beside Add images
    var galSec = E.dsec('Gallery', galBtn, galList, galNone, galHelp, galFiles, galView, galSaid, galFile);
    if (galAuto) galBtn.parentNode.insertBefore(galAuto, galBtn);
    if (!ro) dropOn(galSec, addPhotos, function () { return !busy; });
    // a video dropped anywhere on Film goes the way a picked one does
    var filmSec = E.dsec('Film', null, filmBox, h('label', { class: 'f' }, 'Video link', f.video_url, linkHelp), filmFile);
    if (!ro) dropOn(filmSec, onFilm, function () { return !busy && !film.up; });
    var body = pf.body = h('div', { class: 'dr-body' },
      E.dsec('Basics', null, h('div', { class: 'fgrid' },
          h('label', { class: 'f full' }, 'Title', f.title),
          h('label', { class: 'f full' }, 'Slug', f.slug, slugHint, liveHint),
          h('label', { class: 'f' }, 'Client', f.client), h('label', { class: 'f' }, 'Year', f.year),
          h('label', { class: 'f full' }, 'Project', proj, projHelp)),
        svc.el, ind.el),
      E.dsec('Story', null, counted('Short description', f.summary, 300),
        h('label', { class: 'f' }, 'Brief', f.brief), h('label', { class: 'f' }, 'Approach', f.approach), h('label', { class: 'f' }, 'Outcome', f.outcome),
        h('p', { class: 'help', text: 'Brief, approach and outcome become the paragraphs on the project page. A blank line starts a new paragraph.' })),
      E.dsec('Cover image', null, h('div', { class: 'cover' }, coverBox, h('div', { class: 'fstack' },
        h('label', { class: 'f' }, 'Alt text', f.cover_alt),
        ro ? null : h('p', { class: 'help', text: 'JPG, PNG, WebP or AVIF, up to ' + MAX_MB + ' MB. Cropped to 3:4 on the Work card.' }),
        coverBtn ? h('div', {}, coverBtn) : null)), coverFile),
      galSec,
      filmSec,
      E.dsec('Credits', addCredit, crList, crNone),
      E.dsec('Search and sharing', null, counted('SEO title', f.seo_title, 70), counted('Meta description', f.seo_description, 160),
        h('p', { class: 'help', text: 'Left empty, the title and short description are used.' })),
      E.dsec('On the Work page', null, h('div', { class: 'fgrid' },
        h('label', { class: 'chk' }, f.featured, 'Featured, shown before the other projects'),
        h('label', { class: 'f' }, 'Order (lower comes first)', f.sort_order))));
    var foot = h('div', { class: 'dr-foot' }, h('span', { class: 'dst', role: 'status' }, pill, stateText), bArchive, bUnpublish, bPreview, bView, bSave, bPublish);
    body.addEventListener('input', dirtyCheck);
    body.addEventListener('change', dirtyCheck);
    openDrawer([head, body, foot], true);
    // an upload still running counts as a change that isn't saved
    drawerGuard = function () { return dirty() || !!film.up; };
    // the editor closed, or another opened in its place (see filmLeft)
    var closed = new MutationObserver(function () { if (!alive()) { closed.disconnect(); filmLeft(); } });
    closed.observe(drawerBody, { childList: true });
    drawCover(); drawGallery(); drawCredits(); drawFilm(); refreshUi();
    if (state.cover_path) signed([state.cover_path]).then(function () { drawCover(true); }, function () { drawCover(true); });
    if (isNew) f.title.focus();
  }

  // Full copy of every table as one JSON file (the free backup: download it regularly and keep it somewhere safe).
  // Settings draws the button (owners). A table this copy of the database doesn't have yet (the invoice link tables
  // before their migration) is left out and named in the file; any other failure stops the backup.
  var BACKUP = ['inquiries', 'applicants', 'applicant_skills', 'applicant_files', 'applicant_notes',
    'network_profiles', 'network_profile_skills', 'network_profile_files', 'network_profile_notes', 'jobs', 'skills', 'team_members',
    'portfolio_items', 'activity_log', 'clients', 'projects', 'project_money', 'crew', 'kas_entries', 'documents', 'manual_leads',
    'sheet_values', 'sync_outbox', 'sync_changes', 'sync_issues', 'pay_settings', 'pay_links'];
  var notHere = function (e) { return !!e && (e.code === '42P01' || e.code === 'PGRST205' || /does not exist|schema cache/i.test(e.message || '')); };
  function backup(btn) {
    var out = { made_at: new Date().toISOString(), tables: {}, not_in_this_database: [] };
    var grab = function (table, from) {
      return sb.from(table).select('*').range(from, from + 999).then(function (r) {
        if (r.error) {
          if (from === 0 && notHere(r.error)) { out.not_in_this_database.push(table); return; }
          throw new Error(table + ': ' + r.error.message);
        }
        out.tables[table] = (out.tables[table] || []).concat(r.data || []);
        if ((r.data || []).length === 1000) return grab(table, from + 1000);
      });
    };
    btn.disabled = true; toast('Preparing backup…');
    BACKUP.reduce(function (p, t) { return p.then(function () { return grab(t, 0); }); }, Promise.resolve()).then(function () {
      if (!out.not_in_this_database.length) delete out.not_in_this_database;
      var url = URL.createObjectURL(new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' }));
      // named by the day in Jakarta
      var link = h('a', { href: url, download: 'ccc-backup-' + (window.eco ? window.eco.today() : out.made_at.slice(0, 10)) + '.json' });
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
      var n = Object.keys(out.tables).reduce(function (s, t) { return s + out.tables[t].length; }, 0);
      toast('Backup downloaded: ' + n + ' records.');
    }).catch(fail).then(function () { btn.disabled = false; });
  }

  // for the pages in admin/eco/
  window.cccAdmin = {
    sb: sb, DEV: DEV, SB_URL: SB_URL, $: $, $$: $$, h: h, add: add, sec: sec, kv: kv, select: select, ask: ask, toast: toast, fail: fail,
    date: date, dateTime: dateTime, ago: ago, safeUrl: safeUrl, openDrawer: openDrawer, closeDrawer: closeDrawer,
    guard: function (fn) { drawerGuard = fn; }, onSignedIn: function (fn) { signedIn.push(fn); },
    // a page of its own with an editor on it (#projects/<id>): leaving it asks first while fn() says there are changes
    pageGuard: function (fn) { pageGuard = fn || null; pageHash = fn ? location.hash : ''; },
    loaders: loaders, openers: openers, actions: actions, me: function () { return me; },
    canEdit: canEdit, isOwner: isOwner, canMoney: canMoney, refreshBadges: refreshBadges, badge: badge,
    pass: function () { return pass; }, teamAccess: access, icon: icon, greeting: function () { return greeting(); }, backup: backup,
    today: function () { return overviewSub(); }, sideOpen: function (on) { sideOpen(on); },
    // the project page starts a portfolio item from a project ({ id, title, client, year }), filled in and linked to it
    newPortfolioFor: function (p) { pf.from = p; location.hash = '#portfolio/new'; }
  };
})();
