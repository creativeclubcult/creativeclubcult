/* Settings, as in the mockup: the team (owners add and remove people and set their role and money access; adding
   sends an email through team-access), CCC's bank details for invoice links (money access reads them, owners change
   them), the Google Sheet connection with Sync now (editors; sheets-sync checks the role again), the open issues
   (editors can mark one as handled), the backup (owners) and the change log (money access). The database checks
   every write; the buttons only follow what it allows. */
(function () {
  'use strict';
  if (!window.cccAdmin) return; // admin.js stopped early: the sign in library didn't load
  var A = window.cccAdmin, E = window.eco, sb = A.sb, h = A.h, I = A.icon;
  var panel = A.$('[data-panel="settings"]');

  // a database answer with no rows means the account may not do it (row level security says nothing more)
  var answered = function (r, ok) {
    if (r.error) return E.failed(r.error);
    if (!r.data || !r.data.length) return A.toast('Your account isn’t allowed to change this.', true);
    ok();
  };
  var state = function (box, text, err, retry) {
    box.innerHTML = '';
    A.add(box, [h('p', { class: 'empty' + (err ? ' is-err' : ''), text: text }), retry ? h('button', { class: 'btn sm', type: 'button', onclick: retry }, 'Try again') : null]);
  };
  // a switch as in the mockup: a button with role switch, its word beside it
  function tog(on, word, label, off) {
    return h('button', { class: 'tog', type: 'button', role: 'switch', 'aria-checked': String(!!on), 'aria-label': label, disabled: !!off },
      h('i', { 'aria-hidden': 'true' }), h('span', { text: word }));
  }
  var setTog = function (b, on, word) { b.setAttribute('aria-checked', String(!!on)); b.lastChild.textContent = word; };
  var isOn = function (b) { return b.getAttribute('aria-checked') === 'true'; };

  // ---------- the team ----------
  var ROLES = [['admin', 'Admin'], ['viewer', 'Viewer']];
  var WORD = { owner: 'Owner', admin: 'Admin', viewer: 'Viewer' };
  var RANK = { owner: 0, admin: 1, viewer: 2 };
  var ROLE_SAYS = { admin: 'Admins can edit, and see leads, applicants and network sign ups.', viewer: 'Viewers only read projects, the schedule and clients.' };
  var TILES = [['Owner', 'Everything, plus the team'], ['Admin', 'Edits, and sees leads, applicants and network sign ups'],
    ['Viewer', 'Reads projects, the schedule and clients'], ['Money', 'Shows amounts, Finance, the Kas and the Sheet’s figures. Owners always have it.']];
  var people = null; // the team as last read, so the change log can name who made a change
  var teamRows = function () {
    if (!people) people = E.rows(sb.from('team_members').select('user_id, email, full_name, role, can_see_money, created_at').order('created_at'));
    return people;
  };
  // how people sign in, as it is right now (the emailed code turns on once the Gmail App Password is saved)
  function signText(st, owner) {
    if (st.required) return 'Sign in is email and password, then a code sent by email.';
    if (!owner) return 'Sign in is email and password.';
    if (st.mail) return 'Sign in is email and password. The code by email turns on for everyone the first time an owner signs in with one.';
    return 'Sign in is email and password for now. The code by email, and adding people, wait for the Gmail App Password for hello@ in Supabase.';
  }
  function team(card) {
    var owner = A.isOwner(), st = A.pass() || {};
    var count = h('span', { class: 'aside' }), tbody = h('tbody');
    var head = h('h2', { id: 'tm-h', text: 'Team', tabindex: '-1' });
    var note = h('p', { class: 'src', id: 'tm-sign' }, I('lock'), h('span', { text: signText(st, owner) }));
    card.innerHTML = '';
    A.add(card, [h('header', { class: 'card-h' }, head, count),
      h('table', { class: 'tbl compact team' },
        h('thead', {}, h('tr', {}, ['Person', 'Role', 'Money', 'Since'].map(function (t) { return h('th', { text: t }); }).concat(h('th', {}, h('span', { class: 'sr', text: 'Remove' }))))),
        tbody),
      h('div', { class: 'roles' }, TILES.map(function (t) { return h('div', {}, h('b', { text: t[0] }), h('span', { text: t[1] })); })),
      owner ? addForm(st, card) : null, note]);
    var wait = function (text, err, retry) {
      tbody.innerHTML = '';
      var td = h('td', { colspan: '5' });
      state(td, text, err, retry);
      tbody.appendChild(h('tr', {}, td));
    };
    wait('Loading the team…');
    people = null;
    teamRows().then(function (list) {
      tbody.innerHTML = '';
      list = list.slice().sort(function (a, b) { return (RANK[a.role] - RANK[b.role]) || String(a.created_at).localeCompare(String(b.created_at)); });
      list.forEach(function (m) { tbody.appendChild(member(m, card)); });
      count.textContent = E.plural(list.length, 'person', 'people');
      if (!list.length) wait('Nobody on the team yet.');
    }, function (e) { people = null; count.textContent = ''; wait('Couldn’t load the team. ' + E.ecoError(e), true, function () { team(card); }); });
    return head;
  }
  function member(m, card) {
    var me = A.me(), mine = !!(me && me.id === m.user_id), who = m.full_name || m.email;
    var manage = A.isOwner() && m.role !== 'owner' && !mine;
    var money = m.role === 'owner' || m.can_see_money === true;
    var sw = tog(money, m.role === 'owner' ? 'Always' : money ? 'On' : 'Off', 'Money for ' + who, !manage);
    var role = manage ? A.select(ROLES, m.role, { class: 'field', 'aria-label': 'Role for ' + who }) : document.createTextNode(WORD[m.role] || m.role);
    var remove = manage ? h('button', { class: 'btn sm quiet danger', type: 'button', 'aria-label': 'Remove ' + who }, 'Remove') : null;
    if (manage) {
      sw.addEventListener('click', function () {
        var want = !isOn(sw);
        A.ask(want ? 'Give ' + who + ' money access?' : 'Take money access from ' + who + '?',
          want ? 'They’ll see amounts, Finance, the Kas and the Sheet’s figures.' : 'They’ll stop seeing amounts, Finance, the Kas and the Sheet’s figures.',
          want ? 'Give access' : 'Take access', !want).then(function (go) {
          if (!go) return;
          sw.disabled = true;
          sb.from('team_members').update({ can_see_money: want }).eq('user_id', m.user_id).select('user_id').then(function (r) {
            sw.disabled = false;
            answered(r, function () {
              m.can_see_money = want; setTog(sw, want, want ? 'On' : 'Off');
              A.toast(want ? who + ' sees money now.' : who + ' no longer sees money.');
            });
          }, function (e) { sw.disabled = false; E.failed(e); });
        });
      });
      role.addEventListener('change', function () {
        var want = role.value;
        role.value = m.role; // stays as it was until the database says yes
        A.ask(want === 'admin' ? 'Make ' + who + ' an admin?' : 'Make ' + who + ' a viewer?', ROLE_SAYS[want], 'Change role').then(function (go) {
          if (!go) return;
          role.disabled = true;
          sb.from('team_members').update({ role: want }).eq('user_id', m.user_id).select('user_id').then(function (r) {
            role.disabled = false;
            answered(r, function () { m.role = want; role.value = want; A.toast(who + (want === 'admin' ? ' is an admin now.' : ' is a viewer now.')); });
          }, function (e) { role.disabled = false; E.failed(e); });
        });
      });
      remove.addEventListener('click', function () {
        A.ask('Remove ' + who + ' from the team?', 'They can’t open the admin any more. Their account stays, so you can add them again later.', 'Remove', true).then(function (go) {
          if (!go) return;
          remove.disabled = true;
          sb.from('team_members').delete().eq('user_id', m.user_id).select('user_id').then(function (r) {
            remove.disabled = false;
            // the list is drawn again, so the cursor goes to the card's heading instead of a button that is gone
            answered(r, function () { A.toast(who + ' is off the team.'); team(card).focus(); });
          }, function (e) { remove.disabled = false; E.failed(e); });
        });
      });
    }
    return h('tr', {},
      h('td', {}, h('div', { class: 'pj' }, h('span', { class: 'av', 'aria-hidden': 'true', text: E.initial(who) }),
        h('div', {}, h('b', {}, who, mine ? h('span', { class: 'tag', text: 'You' }) : null), m.full_name ? h('span', { text: m.email }) : null))),
      h('td', { 'data-l': 'Role' }, role),
      h('td', { 'data-l': 'Money' }, sw),
      h('td', { 'data-l': 'Since', class: 'muted' }, E.day(E.jkt(m.created_at))),
      h('td', { class: remove ? 'num' : null }, remove));
  }
  // Add to team (owners): team-access makes the account, adds it and emails a link to set a password
  function addForm(st, card) {
    var ready = !!st.mail && (!st.required || !!st.verified);
    var email = h('input', { type: 'email', name: 'email', maxlength: 254, autocomplete: 'off', placeholder: 'name@example.com', required: true });
    var name = h('input', { type: 'text', name: 'name', maxlength: 120, autocomplete: 'off', placeholder: 'Full name' });
    var role = A.select(ROLES, 'viewer', { name: 'role' });
    var money = tog(false, 'Off', 'Money for the new person');
    money.addEventListener('click', function () { var on = !isOn(money); setTog(money, on, on ? 'On' : 'Off'); });
    var btn = h('button', { class: 'btn lime', type: 'submit', disabled: !ready, 'aria-describedby': ready ? null : 'tm-sign' }, I('plus', 's'), 'Add to team');
    var form = h('form', { class: 'addteam', novalidate: true, 'aria-label': 'Add someone to the team' },
      h('label', { class: 'f' }, 'Email', email),
      h('label', { class: 'f' }, 'Name', name),
      h('label', { class: 'f' }, 'Role', role),
      h('div', { class: 'f' }, h('span', { 'aria-hidden': 'true', text: 'Money' }), h('div', {}, money)),
      btn);
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (btn.disabled) return;
      var addr = email.value.trim(), who = name.value.trim() || addr, give = isOn(money);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr)) { A.toast('Enter a valid email.', true); email.focus(); return; }
      A.ask('Add ' + who + (role.value === 'admin' ? ' as an admin?' : ' as a viewer?'),
        'We email ' + addr + ' a link to set a password. ' + ROLE_SAYS[role.value]
          + (give ? ' They’ll also see amounts, Finance, the Kas and the Sheet’s figures.' : ''),
        'Add and send').then(function (go) {
        if (!go) return;
        btn.disabled = true;
        A.teamAccess('invite', { email: addr, name: name.value.trim(), role: role.value, money: give }).then(function (a) {
          btn.disabled = false;
          if (a.status === 200 && a.body.ok) {
            A.toast(a.body.mailed ? who + ' is on the team. The email with their link is on its way.'
              : who + ' is on the team, but the email didn’t go out. They can use Forgot password on the sign in page.', !a.body.mailed);
            team(card);
            return;
          }
          A.toast(a.body.error || 'Couldn’t add them. Try again.', true);
        }, function (err) { btn.disabled = false; E.failed(err); });
      });
    });
    return form;
  }

  // ---------- CCC's bank details: the page an invoice link opens shows them next to the invoice ----------
  var ACCOUNT = /^[0-9][0-9 ]{3,39}$/;
  var missing = function (e) { return !!e && (e.code === '42P01' || e.code === 'PGRST205' || /does not exist|schema cache/i.test(e.message || '')); };
  function bank(card) {
    var body = h('div', { class: 'bank-b' });
    card.innerHTML = '';
    A.add(card, [h('header', { class: 'card-h' }, h('h2', { id: 'bank-h', text: 'Bank details' })),
      h('p', { class: 'muted', text: 'Invoice links show these to the client, next to the invoice.' }), body]);
    state(body, 'Loading…');
    E.rows(sb.from('pay_settings').select('bank_name, account_no, account_name, note, updated_at').limit(1)).then(function (rows) {
      body.innerHTML = '';
      var row = rows[0] || null;
      A.add(body, A.isOwner() ? bankForm(row, card) : bankRead(row));
    }, function (e) {
      state(body, missing(e) ? 'Bank details aren’t set up on this copy of the admin yet.' : 'Couldn’t load the bank details. ' + E.ecoError(e), true, missing(e) ? null : function () { bank(card); });
    });
  }
  function bankRead(row) {
    if (!row) return [h('p', { class: 'empty', text: 'No bank details yet. An owner adds them here.' })];
    return [E.props([['Bank', row.bank_name], ['Account number', row.account_no], ['Account holder', row.account_name], ['Note for the client', row.note]]),
      h('p', { class: 'help', text: 'Only an owner can change these.' })];
  }
  function bankForm(row, card) {
    var x = row || {};
    var f = {
      bank_name: h('input', { type: 'text', maxlength: 60, autocomplete: 'off', value: x.bank_name || '' }),
      account_no: h('input', { type: 'text', inputmode: 'numeric', maxlength: 40, autocomplete: 'off', value: x.account_no || '' }),
      account_name: h('input', { type: 'text', maxlength: 120, autocomplete: 'off', value: x.account_name || '' }),
      note: h('textarea', { maxlength: 500, rows: 3, value: x.note || '' })
    };
    var msg = h('span', { class: 'help', role: 'status' });
    var say = function (t, err) { msg.textContent = t; msg.classList.toggle('neg', !!err); };
    var btn = h('button', { class: 'btn lime', type: 'submit' }, 'Save bank details');
    var form = h('form', { class: 'fgrid', novalidate: true, 'aria-labelledby': 'bank-h' },
      h('label', { class: 'f' }, 'Bank', f.bank_name),
      h('label', { class: 'f' }, 'Account number', f.account_no),
      h('label', { class: 'f full' }, 'Account holder', f.account_name),
      h('label', { class: 'f full' }, 'Note for the client', f.note, h('span', { class: 'help', text: 'Shown on the client’s payment page, so write it in Indonesian.' })),
      h('div', { class: 'formacts full' }, btn, msg));
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var v = { bank_name: f.bank_name.value.trim(), account_no: f.account_no.value.trim().replace(/\s+/g, ' '), account_name: f.account_name.value.trim(), note: f.note.value.trim() || null };
      if (!v.bank_name) { say('Fill in the bank.', true); f.bank_name.focus(); return; }
      if (!ACCOUNT.test(v.account_no)) { say('The account number takes digits only, 4 to 40 of them.', true); f.account_no.focus(); return; }
      if (!v.account_name) { say('Fill in the account holder.', true); f.account_name.focus(); return; }
      btn.disabled = true; say('Saving…');
      // one row only: change it when it is there, add it the first time
      var q = row ? sb.from('pay_settings').update(v).eq('id', true) : sb.from('pay_settings').insert(Object.assign({ id: true }, v));
      q.select('id').then(function (r) {
        btn.disabled = false;
        if (r.error) { say(E.ecoError(r.error), true); return; }
        if (!r.data || !r.data.length) { say('Your account isn’t allowed to change this.', true); return; }
        A.toast('Bank details saved.');
        bank(card);
      }, function (err) { btn.disabled = false; say(E.ecoError(err), true); });
    });
    return [form, x.updated_at ? h('p', { class: 'help', text: 'Last changed ' + E.stamp(x.updated_at) + '.' }) : null];
  }

  // ---------- the Google Sheet: how it is read and written, and Sync now ----------
  // sheets-sync answers a full sync from editors at most every 15 seconds; its answer, read whatever the status
  var callSync = function () {
    return sb.functions.invoke('sheets-sync', { body: {} }).then(function (r) {
      if (!r.error) return { status: 200, body: r.data || {} };
      var res = r.error.context;
      if (!res || typeof res.json !== 'function') throw r.error;
      return res.json().catch(function () { return {}; }).then(function (b) { return { status: res.status, body: b || {} }; });
    });
  };
  function syncSays(a) {
    var b = a.body || {};
    if (b.skipped === 'busy') return 'The Sheet is busy with another sync. Try again in a minute.';
    if (b.skipped === 'paused') return 'Reading the Sheet is paused, so nothing was read.';
    if (b.skipped === 'backoff') return 'The last syncs failed, so the next one waits until ' + E.stamp(b.until) + '.';
    return b.error || 'The sync didn’t run. Try again.';
  }
  function sheet(card, cards) {
    var pill = h('span', { class: 'pill', hidden: true });
    var sync = A.canEdit() ? h('button', { class: 'btn sm', type: 'button', disabled: true }, I('sync', 's'), h('span', { text: 'Sync now' })) : null;
    var body = h('div', {});
    card.innerHTML = '';
    A.add(card, [h('header', { class: 'card-h' }, h('h2', { id: 'sh-h', text: 'Google Sheet', tabindex: '-1' }), pill, sync), body]);
    state(body, 'Checking the Sheet…');
    Promise.all([E.settle(E.data.flow(true)), E.settle(E.data.values()), E.settle(E.data.projects()), E.settle(E.data.clients())]).then(function (r) {
      if (r[0].e) { state(body, 'Couldn’t check the Sheet. ' + E.ecoError(r[0].e), true, function () { sheet(card, cards); }); return; }
      var f = r[0].v, s = f.sheet || {}, vals = r[1].v || {}, meta = vals.meta ? vals.meta.value || {} : {};
      var on = !!s.connected, seed = meta.version === 'seed', url = E.sheetUrl(vals);
      var stopped = on && (s.status === 'error' || f.failed > 0);
      pill.hidden = false;
      pill.className = 'pill ' + (!on ? 'off' : stopped ? 'late' : 'yes');
      pill.textContent = !on ? 'Not connected' : stopped ? 'Sync stopped' : 'Connected';
      // the projects and clients the Sheet has now; a list that failed to load is left out, never counted as 0
      var count = function (x, one) { return x.e ? null : E.plural(x.v.filter(function (i) { return i.sheet_state === 'present'; }).length, one); };
      var inSheet = [count(r[2], 'project'), count(r[3], 'client')].filter(Boolean).join(', ');
      var quiet = function (t) { return h('span', { class: 'muted', text: t }); };
      var lastRead = s.last_success_at ? E.stamp(s.last_success_at)
        : r[1].e ? h('span', { class: 'neg', text: 'Couldn’t check. ' + E.ecoError(r[1].e) })
        : seed && vals.meta && vals.meta.seen_at ? 'A snapshot from ' + E.stamp(vals.meta.seen_at) : quiet('None yet');
      body.innerHTML = '';
      A.add(body, [E.props([
        ['Reading the Sheet', !on ? quiet('Not running') : s.pull_enabled === false ? 'Paused'
          : h('span', {}, 'Every minute, 06:00 to 23:59 WIB', h('br'), quiet('Every 10 minutes at night'))],
        ['Writing to the Sheet', !on ? quiet('Not running') : s.writes_enabled === false ? h('span', { class: 'pill off', text: 'Paused' }) : h('span', { class: 'pill yes', text: 'On' })],
        ['Last read', lastRead],
        ['In the Sheet', inSheet || null],
        ['Last error', s.last_error ? h('span', { class: 'neg', text: s.last_error }) : null],
        ['Changes waiting', f.waiting > 0 ? String(f.waiting) : null],
        ['Changes that need a look', f.conflicts > 0 ? String(f.conflicts) : null],
        ['Writes that failed', f.failed > 0 ? h('span', { class: 'neg', text: String(f.failed) }) : null],
        ['Spreadsheet', url ? h('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, 'Open in Google Sheets', I('ext', 's')) : null]
      ]),
      on ? null : h('p', { class: 'help', id: 'sh-off', text: 'Sync now is off: the development copy of the Sheet and its Apps Script web app aren’t set up yet. '
        + 'Until they are, the admin shows the snapshot above, and changes made in the Sheet don’t reach it.' })]);
      if (!sync) return;
      sync.disabled = !on || s.pull_enabled === false;
      if (!on) sync.setAttribute('aria-describedby', 'sh-off');
      sync.onclick = function () {
        sync.disabled = true; sync.lastChild.textContent = 'Syncing…';
        callSync().then(function (a) {
          var b = a.body || {};
          if (a.status === 200 && !b.error && ['busy', 'paused', 'backoff'].indexOf(b.skipped) < 0) {
            A.toast(b.idle || b.stale ? 'Synced. Nothing changed in the Sheet.' : 'Synced with the Sheet.');
            // what the sync brought in: the Sheet card, the issues and the change log are read again, and the cursor
            // goes to the Sheet card's heading in place of the button drawn again
            E.forget(); A.refreshBadges(); cards.forEach(function (c) { c[1](c[0], cards); });
            A.$('h2', card).focus();
            return;
          }
          A.toast(syncSays(a), true);
        }, function (e) { A.toast(E.ecoError(e), true); }).then(function () {
          if (sync.isConnected) { sync.disabled = false; sync.lastChild.textContent = 'Sync now'; }
        });
      };
    });
  }

  // ---------- open issues: what the last sync found in the Sheet; editors can mark one as handled ----------
  function issues(card) {
    var badge = h('span', { class: 'badge', hidden: true }), body = h('div', {});
    card.innerHTML = '';
    A.add(card, [h('header', { class: 'card-h' }, h('h2', { id: 'is-h', text: 'Open issues', tabindex: '-1' }), badge), body]);
    state(body, 'Loading…');
    E.rows(sb.from('sync_issues').select('id, kind, key, message, first_seen_at, last_seen_at').is('resolved_at', null).order('last_seen_at', { ascending: false }).limit(50)).then(function (rows) {
      body.innerHTML = '';
      badge.hidden = !rows.length; badge.textContent = rows.length || '';
      if (!rows.length) { state(body, 'No open issues.'); return; }
      body.appendChild(h('ul', { class: 'issues' }, rows.map(function (i) {
        var seen = 'First seen ' + E.stamp(i.first_seen_at) + '.'
          + (i.last_seen_at && i.last_seen_at !== i.first_seen_at ? ' Last seen ' + E.stamp(i.last_seen_at) + '.' : '');
        var done = A.canEdit() ? h('button', { class: 'btn sm', type: 'button' }, 'Mark as handled') : null;
        if (done) done.addEventListener('click', function () {
          A.ask('Mark this issue as handled?', 'It leaves the list. If the Sheet still has the problem, the next sync lists it again.', 'Mark as handled').then(function (go) {
            if (!go) return;
            done.disabled = true;
            // the database stamps when and who, and refuses an issue that a sync or someone else settled first
            sb.from('sync_issues').update({ resolution: 'handled' }).eq('id', i.id).select('id').then(function (r) {
              done.disabled = false;
              var first = !!r.error && r.error.code === '22023';
              if (r.error && !first) return E.failed(r.error);
              if (!first && (!r.data || !r.data.length)) return A.toast('Your account isn’t allowed to change this.', true);
              A.toast(first ? 'This issue is already settled.' : 'Marked as handled.');
              // the list is drawn again; the cursor goes to the card's heading
              A.refreshBadges(); issues(card); A.$('h2', card).focus();
            }, function (e) { done.disabled = false; E.failed(e); });
          });
        });
        return h('li', {}, h('span', { class: 'nic amber', 'aria-hidden': 'true' }, I('alert')),
          h('div', {}, h('b', { text: i.message || i.kind }), h('span', { text: seen }), done));
      })));
    }, function (e) { badge.hidden = true; state(body, 'Couldn’t load the open issues. ' + E.ecoError(e), true, function () { issues(card); }); });
  }
  // ---------- the backup (owners): every record in one JSON file, made by admin.js ----------
  function backup(card) {
    var btn = h('button', { class: 'btn', type: 'button' }, I('db', 's'), 'Download backup');
    btn.addEventListener('click', function () { A.backup(btn); });
    card.innerHTML = '';
    A.add(card, [h('header', { class: 'card-h' }, h('h2', { id: 'bk-h', text: 'Backup' })),
      h('p', { text: 'Every record in one file. Uploaded files stay in Supabase.' }), btn]);
  }

  // ---------- the change log (money access): edits from the admin and the Sheet ----------
  var MONEY_FIELD = /total|amount|cost|price|fee|paid|received|outstanding|budget|omset|nominal/i;
  var fieldName = function (f) { var s = String(f || '').replace(/_/g, ' ').trim(); return s ? s.charAt(0).toUpperCase() + s.slice(1) : 'A value'; };
  var said = function (c, v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return MONEY_FIELD.test(c.field || '') ? E.rp(v) : E.num(v);
    if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return E.day(v);
    return E.clip(typeof v === 'object' ? JSON.stringify(v) : String(v), 80);
  };
  // "4 Nov, 13:20" this year, "4 Nov 2025, 13:20" before
  var when = function (t) { var s = E.stamp(t); return E.shortStamp(t) + ', ' + s.slice(s.lastIndexOf(', ') + 2); };
  var SHOW = 8;
  function changeLog(card) {
    var body = h('div', {});
    card.innerHTML = '';
    A.add(card, [h('header', { class: 'card-h' }, h('h2', { id: 'cl-h', text: 'Change log' }), h('span', { class: 'aside', text: 'Edits from the admin and the Sheet' })), body]);
    state(body, 'Loading…');
    Promise.all([
      E.rows(sb.from('sync_changes').select('id, at, source, actor_email, entity, label, field, old_value, new_value, forced').order('at', { ascending: false }).limit(50)),
      E.settle(teamRows())
    ]).then(function (r) {
      var rows = r[0], names = {};
      (r[1].v || []).forEach(function (m) { if (m.email && m.full_name) names[m.email.toLowerCase()] = m.full_name; });
      body.innerHTML = '';
      if (!rows.length) { state(body, 'No changes yet. Edits from the admin and the Sheet are listed here.'); return; }
      var items = rows.map(function (c) {
        var was = said(c, c.old_value), now = said(c, c.new_value), sheetSide = c.source === 'sheet';
        var by = c.actor_email ? names[c.actor_email.toLowerCase()] || c.actor_email : null;
        var what = now == null ? ' cleared' : was == null ? ' set to ' + now : ' changed to ' + now;
        var sub = (was == null ? 'Was empty.' : 'Was ' + was + '.') + ' '
          + (sheetSide ? 'Changed in the Sheet.' : by ? 'Changed by ' + by + ' in the admin.' : 'Changed in the admin.')
          + (c.forced ? ' Saved over the Sheet’s value.' : '');
        return h('li', {},
          h('span', { class: 'av', 'aria-hidden': 'true' }, sheetSide ? I('sheet') : by ? E.initial(by) : I('edit')),
          h('p', {}, h('b', { text: fieldName(c.field) }), (c.label || c.entity ? ' on ' + (c.label || c.entity) : '') + what, h('span', { text: sub })),
          h('time', { datetime: c.at, text: when(c.at) }));
      });
      var list = h('ul', { class: 'hist chlog' }, items.slice(0, SHOW));
      body.appendChild(list);
      if (items.length > SHOW) {
        var more = h('button', { class: 'btn sm', type: 'button' }, 'Show ' + (items.length - SHOW) + ' more');
        more.addEventListener('click', function () {
          A.add(list, items.slice(SHOW)); more.remove();
          // the first of the newly shown changes takes the cursor's place
          items[SHOW].tabIndex = -1; items[SHOW].focus();
        });
        body.appendChild(h('div', { class: 'chmore' }, more));
      }
    }, function (e) { state(body, 'Couldn’t load the change log. ' + E.ecoError(e), true, function () { changeLog(card); }); });
  }

  // ---------- the page ----------
  // in the mockup's order: the team, the Sheet beside its open issues and the backup, the change log. The bank details,
  // which came after the mockup, sit under the Sheet
  function draw() {
    var card = function (cls, label) { return h('section', { class: 'card' + (cls ? ' ' + cls : ''), 'aria-labelledby': label }); };
    var teamCard = card('full', 'tm-h');
    var sheetCard = card('', 'sh-h'), issuesCard = card('', 'is-h');
    var bankCard = A.canMoney() ? card('bankcard', 'bank-h') : null;
    var backupCard = A.isOwner() ? card('bk', 'bk-h') : null;
    var logCard = A.canMoney() ? card('full', 'cl-h') : null;
    panel.innerHTML = '';
    panel.appendChild(h('div', { class: 'sgrid' }, teamCard, bankCard ? h('div', { class: 'scol' }, sheetCard, bankCard) : sheetCard,
      h('div', { class: 'scol' }, issuesCard, backupCard), logCard));
    // what Sync now draws again once the Sheet has been read
    var after = [[issuesCard, issues]].concat(logCard ? [[logCard, changeLog]] : []);
    team(teamCard);
    if (bankCard) bank(bankCard);
    sheet(sheetCard, [[sheetCard, sheet]].concat(after));
    issues(issuesCard);
    if (backupCard) backup(backupCard);
    if (logCard) changeLog(logCard);
  }
  A.loaders.settings = draw;
})();
