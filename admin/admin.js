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
  // the case studies written into the site's code, with the picture their Work card uses
  var BUILT_IN = [['MOVANA', 'movana', 2026, 'movana/thumb.jpg'], ['Whitebeard', 'whitebeard', 2026, 'whitebeard/tshirt.jpg'],
    ['NOXON', 'noxon', 2026, 'noxon/thumb.jpg'], ['Citarasa Tradisi', 'tradisi', 2026, 'tradisi/lychee-poster.jpg']];
  var RESERVED = BUILT_IN.map(function (b) { return b[1]; }).concat(['view']);
  var IMG_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/avif': 'avif' };
  var MAX_MB = 15;
  // the status as a pill; a published item is on the website, so it reads Live like the built in pages
  var PF_PILL = { draft: ['draft', 'Draft'], published: ['paid', 'Live'], archived: ['brief', 'Archived'] };
  var SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
  // YouTube and Vimeo, including unlisted Vimeo links (vimeo.com/<id>/<hash>) and Vimeo embed links
  // (player.vimeo.com/video/<id>?h=<hash>). The database checks the same pattern.
  var VIDEO_RE = /^https:\/\/((www\.)?(youtube\.com\/watch\?v=[A-Za-z0-9_-]{6,20}|youtu\.be\/[A-Za-z0-9_-]{6,20}|vimeo\.com\/[0-9]{4,12}(\/[0-9a-f]{6,20})?)|player\.vimeo\.com\/video\/[0-9]{4,12})([?&#][A-Za-z0-9_=&.%-]*)?$/;
  var slugify = function (t) { return (t || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80).replace(/-+$/, ''); };
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
    if (/slug/.test(m)) return 'The slug can only use lowercase letters, numbers and single dashes, and can’t be a built-in project’s name.';
    if (/video_url/.test(m)) return 'The video link must be a YouTube or Vimeo address.';
    if (/gallery/.test(m)) return 'A gallery image isn’t valid. Remove it and upload it again.';
    if (/credits/.test(m)) return 'Every credit needs both a role and a name.';
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

  // ---- the list: drafts and published items as cards, by status; the built in pages below them ----
  var pf = { panel: $('[data-panel="portfolio"]'), ui: null, got: null, turn: 0, view: 'active', from: null };
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
    sb.from('portfolio_items').select('id, slug, title, client, year, status, featured, sort_order, cover_path, updated_at', { count: 'exact' })
      .order('featured', { ascending: false }).order('sort_order').order('updated_at', { ascending: false }).limit(500)
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
    var slugTouched = !isNew;
    var busy = false;
    var lastSaved = JSON.stringify(collectFrom(state));
    if (saved) history.replaceState(null, '', '#portfolio/' + id);

    function collectFrom(x) {
      return { slug: x.slug || '', title: x.title || '', client: x.client || null, year: x.year || null, services: x.services || [], industries: x.industries || [],
        summary: x.summary || null, brief: x.brief || null, approach: x.approach || null, outcome: x.outcome || null,
        cover_path: x.cover_path || null, cover_alt: x.cover_alt || null, cover_w: x.cover_w || null, cover_h: x.cover_h || null,
        gallery: x.gallery || [], video_url: x.video_url || null, credits: x.credits || [], seo_title: x.seo_title || null, seo_description: x.seo_description || null,
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
      video_url: input(state.video_url, { type: 'url', maxlength: 300, placeholder: 'YouTube or Vimeo link', autocomplete: 'off' }),
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
    // Services and Industry: chips that stay pressed
    var chips = function (label, list, chosen) {
      var lid = 'pf-l' + (++pfUid), box = h('div', { class: 'chips', role: 'group', 'aria-labelledby': lid });
      list.forEach(function (o) {
        var b = h('button', { type: 'button', value: o[0], 'aria-pressed': String(chosen.indexOf(o[0]) > -1), disabled: ro }, o[1]);
        b.addEventListener('click', function () { b.setAttribute('aria-pressed', String(b.getAttribute('aria-pressed') !== 'true')); dirtyCheck(); });
        box.appendChild(b);
      });
      return { el: h('div', { class: 'f full' }, h('span', { id: lid, text: label }), box), box: box };
    };
    var svc = chips('Services', SERVICES, state.services || []), ind = chips('Industry', INDUSTRIES, state.industries || []);
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
    var upload = function (file) {
      var ext = IMG_TYPES[file.type];
      if (!ext) return Promise.reject(new Error(file.name + ': use JPG, PNG, WebP or AVIF.'));
      if (file.size > MAX_MB * 1048576) return Promise.reject(new Error(file.name + ' is over ' + MAX_MB + ' MB. Export a smaller version.'));
      var size = (window.createImageBitmap ? createImageBitmap(file).then(function (b) { var s = { w: b.width, h: b.height }; if (b.close) b.close(); return s; })
        : Promise.reject()).catch(function () {
        return new Promise(function (res) { var i = new Image(); i.onload = function () { res({ w: i.naturalWidth, h: i.naturalHeight }); URL.revokeObjectURL(i.src); }; i.onerror = function () { res({ w: 0, h: 0 }); }; i.src = URL.createObjectURL(file); });
      });
      return ensureSaved().then(function () { return size; }).then(function (s) {
        if (!s.w) throw new Error(file.name + ' couldn’t be read as an image.');
        var path = id + '/' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8) + '.' + ext;
        return sb.storage.from('portfolio-drafts').upload(path, file, { contentType: file.type, upsert: false, cacheControl: '31536000' }).then(function (r) {
          if (r.error) throw new Error(file.name + ': ' + r.error.message);
          thumbCache[path] = URL.createObjectURL(file); thumbUntil[path] = Infinity;
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
    // a file picker opened by a button, so the button is what a keyboard reaches
    var fileInput = function (multiple, onFiles) {
      var inp = h('input', { type: 'file', accept: Object.keys(IMG_TYPES).join(','), multiple: multiple, hidden: true, tabindex: '-1', 'aria-hidden': 'true' });
      inp.addEventListener('change', function () { var files = Array.prototype.slice.call(inp.files); inp.value = ''; if (files.length) onFiles(files); });
      return inp;
    };
    var pick = function (inp) { return function () { if (!busy && !ro) inp.click(); }; };

    var onCover = function (files) {
      setBusy(true, 'Uploading the cover…');
      upload(files[0]).then(function (x) {
        state.cover_path = x.path; state.cover_w = x.w; state.cover_h = x.h; drawCover();
        return keepUpload('Cover uploaded.');
      }).catch(function (e) { toast(e.message, true); }).then(function () { setBusy(false); });
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

    // the rows of the gallery and the credits move up and down, and come out, with these
    var move = function (list, i, d, redraw, box) {
      var j = i + d;
      if (j < 0 || j >= list.length) return;
      var t = list[i]; list[i] = list[j]; list[j] = t; redraw(); dirtyCheck();
      var row = $$('.pfrow', box)[j], b = row && $(d < 0 ? '.up' : '.dn', row);
      if (b && b.disabled) b = $(d < 0 ? '.dn' : '.up', row);
      if (b) b.focus();
    };
    var mover = function (list, i, what, redraw, box, then) {
      if (ro) return null;
      var n = i + 1;
      return h('div', { class: 'mv' },
        h('button', { class: 'up', type: 'button', disabled: i === 0, 'aria-label': 'Move ' + what + ' ' + n + ' up', onclick: function () { move(list, i, -1, redraw, box); } }, icon('chev')),
        h('button', { class: 'dn', type: 'button', disabled: i === list.length - 1, 'aria-label': 'Move ' + what + ' ' + n + ' down', onclick: function () { move(list, i, 1, redraw, box); } }, icon('chev')),
        h('button', { class: 'rm', type: 'button', 'aria-label': 'Remove ' + what + ' ' + n, onclick: function () {
          list.splice(i, 1); redraw(); dirtyCheck();
          var rows = $$('.pfrow', box), next = rows[Math.min(i, rows.length - 1)];
          if (next) $('.rm', next).focus(); else if (then) then.focus();
        } }, icon('x')));
    };

    var galFile = fileInput(true, function (files) {
      if (state.gallery.length + files.length > 40) return toast('A project can hold up to 40 gallery images.', true);
      setBusy(true, 'Uploading ' + E.plural(files.length, 'image') + '…');
      files.reduce(function (p, file) {
        return p.then(function () { return upload(file).then(function (x) { state.gallery.push({ path: x.path, alt: '', size: 'full', w: x.w, h: x.h }); drawGallery(); }); });
      }, Promise.resolve()).then(function () { return keepUpload('Images added. Add alt text to each one.'); })
        .catch(function (e) { toast(e.message, true); }).then(function () { setBusy(false); dirtyCheck(); });
    });
    var galBtn = ro ? null : h('button', { class: 'btn sm', type: 'button', onclick: pick(galFile) }, icon('plus', 's'), 'Add images');
    var galList = h('div', { class: 'pfrows' }), galNone = h('p', { class: 'empty', text: 'No gallery images yet.' });
    var galHelp = h('p', { class: 'help', text: 'Images of the same width sit side by side, two halves or three thirds.' });
    var SIZES = [['full', 'Full width'], ['half', 'Half'], ['third', 'Third']];
    function drawGallery() {
      galList.innerHTML = '';
      state.gallery.forEach(function (g, i) {
        var n = i + 1, th = h('span', { class: 'th', 'aria-hidden': 'true' });
        if (thumbCache[g.path]) th.style.backgroundImage = 'url("' + thumbCache[g.path] + '")';
        var alt = input(g.alt, { maxlength: 300, placeholder: 'Alt text, needed to publish', autocomplete: 'off' });
        alt.addEventListener('input', function () { g.alt = alt.value; dirtyCheck(); });
        var sz = select(SIZES, g.size, { disabled: ro });
        sz.addEventListener('change', function () { g.size = sz.value; dirtyCheck(); });
        galList.appendChild(h('div', { class: 'pfrow' }, th,
          h('label', { class: 'f alt' }, h('span', { class: 'sr', text: 'Alt text for image ' + n }), alt),
          h('label', { class: 'f sz' }, h('span', { class: 'sr', text: 'Width of image ' + n }), sz),
          mover(state.gallery, i, 'image', drawGallery, galList, galBtn)));
      });
      galNone.hidden = !!state.gallery.length; galHelp.hidden = !state.gallery.length;
      signed(state.gallery.map(function (g) { return g.path; })).then(function () {
        $$('.pfrow', galList).forEach(function (row, i) { var g = state.gallery[i]; if (g && thumbCache[g.path]) row.firstChild.style.backgroundImage = 'url("' + thumbCache[g.path] + '")'; });
      }, function () {});
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

    // ---- reading the form ----
    function collect() {
      state.title = f.title.value.trim(); state.slug = f.slug.value.trim(); state.client = f.client.value.trim();
      state.year = f.year.value ? +f.year.value : null;
      state.services = $$('button[aria-pressed="true"]', svc.box).map(function (b) { return b.value; });
      state.industries = $$('button[aria-pressed="true"]', ind.box).map(function (b) { return b.value; });
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
      return sb.storage.from('portfolio').remove(paths).then(function (r) { if (r.error) throw new Error('Couldn’t take the images offline: ' + r.error.message); });
    }

    function save(silent) {
      var err = check();
      if (err) { toast(err, true); return Promise.reject(new Error(err)); }
      var row = collect(), before = saved ? pathsOf(saved) : [];
      var go = function () {
        setBusy(true, 'Saving…');
        var q = isNew ? sb.from('portfolio_items').insert(Object.assign({ id: id, status: 'draft' }, row)).select().single()
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
            // the project pages and the Overview count linked items, so they read the list again
            E.forget(); pfLoad(); refreshUi();
          });
        }).catch(function (e) { toast(e.message, true); throw e; }).then(function (v) { setBusy(false); return v; }, function (e) { setBusy(false); throw e; });
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
      if (miss.length) return toast('To publish, add: ' + miss.join(', ') + '.', true);
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
      [bSave, bPreview, bPublish, bUnpublish, bArchive, coverBtn, galBtn, addCredit].forEach(function (b) { if (b) b.disabled = on; });
      if (on) stateText.textContent = text || 'Working…'; else refreshUi();
    }
    function dirtyCheck() { if (!busy) refreshUi(); }

    f.title.addEventListener('input', function () { if (!slugTouched) f.slug.value = slugify(f.title.value); });
    f.slug.addEventListener('input', function () { slugTouched = true; f.slug.value = f.slug.value.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-{2,}/g, '-'); });

    var body = h('div', { class: 'dr-body' },
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
      E.dsec('Gallery', galBtn, galList, galNone, galHelp, galFile),
      E.dsec('Film', null, h('label', { class: 'f' }, 'Video link', f.video_url, help(f.video_url, 'Shown above the gallery. Unlisted Vimeo links work too.'))),
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
    drawerGuard = dirty;
    drawCover(); drawGallery(); drawCredits(); refreshUi();
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
