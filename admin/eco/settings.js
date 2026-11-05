/* Settings: the team (owners add and remove people and set their role and money access; adding sends an email
   through team-access), the Google Sheet connection with its open issues and change log, and the backup (the owner
   block in index.html, run by admin.js). */
(function () {
  'use strict';
  var A = window.cccAdmin, E = window.eco, sb = A.sb, h = A.h;
  var panel = A.$('[data-panel="settings"]'), teamBox = A.$('[data-set-team]', panel), sheetBox = A.$('[data-set-sheet]', panel);
  var COLS = ['Email', 'Name', 'Role', 'Money', 'Since'];
  var ENV = { dev: 'Development', prod: 'Live' };

  // ---------- the team: roles and the Money switch; owners add and remove people ----------
  var ROLES = [['admin', 'Admin'], ['viewer', 'Viewer']];
  var ROLE_SAYS = { admin: 'Admins can edit, and see leads, applicants and network sign ups.', viewer: 'Viewers only read projects, the schedule and clients.' };
  function codesText(st) {
    if (st.required) return 'Email codes are on for everyone.';
    if (st.mail) return 'Email codes are ready. They turn on for everyone the first time an owner signs in with one.';
    return 'Email codes are off until the Gmail App Password for hello@ is saved in Supabase. Until then the password alone signs in, and adding people waits too.';
  }
  function team() {
    var tbody = h('tbody'), owner = A.isOwner(), st = A.pass() || {};
    teamBox.innerHTML = '';
    A.add(teamBox, [h('h2', { class: 'eco-h', text: 'Team' }),
      owner ? addForm(st) : null,
      h('div', { class: 'adm-table-wrap' }, h('table', { class: 'adm-table is-stack eco-team' }, E.thead(COLS.concat([''])), tbody)),
      h('p', { class: 'eco-note', text: 'People sign in at creativeclubcult.com/admin with their email and password, then a code we email them. '
        + ROLE_SAYS.admin + ' ' + ROLE_SAYS.viewer + ' Money shows amounts, Finance, the Kas and the Sheet’s figures, and owners always have it.'
        + (owner ? '' : ' Only an owner can add people or change what they see.') }),
      owner ? h('p', { class: 'eco-note', text: codesText(st) }) : null]);
    E.waitRow(tbody, COLS.length + 1);
    E.rows(sb.from('team_members').select('user_id, email, full_name, role, can_see_money, created_at').order('created_at')).then(function (list) {
      tbody.innerHTML = '';
      list.forEach(function (m) { tbody.appendChild(member(m)); });
      if (!list.length) E.fullRow(tbody, COLS.length + 1, 'Nobody on the team yet.');
    }, function (e) { E.errRow(tbody, COLS.length + 1, e); });
  }
  // a database answer with no rows means the account may not do it (row level security says nothing more)
  var answered = function (r, ok) {
    if (r.error) return E.failed(r.error);
    if (!r.data || !r.data.length) return A.toast('Your account isn’t allowed to change this.', true);
    ok();
  };
  function member(m) {
    var owner = m.role === 'owner', who = m.full_name || m.email, me = A.me();
    var manage = A.isOwner() && !owner && !(me && me.id === m.user_id);
    var since = 'since ' + E.day(E.jkt(m.created_at));
    var sw = h('input', { type: 'checkbox', checked: owner || m.can_see_money === true, disabled: owner || !A.isOwner(), 'aria-label': 'Money access for ' + who });
    var word = h('span', { text: owner ? 'Always' : m.can_see_money ? 'On' : 'Off' });
    sw.addEventListener('change', function () {
      var want = sw.checked;
      sw.checked = !want; // stays as it was until the database says yes
      A.ask(want ? 'Give ' + who + ' money access?' : 'Take money access from ' + who + '?',
        want ? 'They’ll see amounts, Finance, the Kas and the Sheet’s figures.' : 'They’ll stop seeing amounts, Finance, the Kas and the Sheet’s figures.',
        want ? 'Give access' : 'Take access', !want).then(function (go) {
        if (!go) return;
        sw.disabled = true;
        sb.from('team_members').update({ can_see_money: want }).eq('user_id', m.user_id).select('user_id').then(function (r) {
          sw.disabled = false;
          answered(r, function () {
            m.can_see_money = want; sw.checked = want; word.textContent = want ? 'On' : 'Off';
            A.toast(want ? who + ' sees money now.' : who + ' no longer sees money.');
          });
        }, E.failed);
      });
    });
    var role = manage ? A.select(ROLES, m.role, { class: 'eco-role', 'aria-label': 'Role for ' + who }) : h('span', { class: 'adm-pill', text: m.role });
    var summary = h('td', { class: 'only-s' }, [m.full_name, manage ? null : m.role, since].filter(Boolean).join(' · '));
    if (manage) role.addEventListener('change', function () {
      var want = role.value;
      role.value = m.role; // stays as it was until the database says yes
      A.ask(want === 'admin' ? 'Make ' + who + ' an admin?' : 'Make ' + who + ' a viewer?', ROLE_SAYS[want], 'Change role').then(function (go) {
        if (!go) return;
        role.disabled = true;
        sb.from('team_members').update({ role: want }).eq('user_id', m.user_id).select('user_id').then(function (r) {
          role.disabled = false;
          answered(r, function () {
            m.role = want; role.value = want;
            A.toast(who + (want === 'admin' ? ' is an admin now.' : ' is a viewer now.'));
          });
        }, E.failed);
      });
    });
    var remove = manage ? h('button', { class: 'adm-link adm-danger', type: 'button', text: 'Remove' }) : null;
    if (remove) remove.addEventListener('click', function () {
      A.ask('Remove ' + who + ' from the team?', 'They can’t open the admin any more. Their account stays, so you can add them again later.', 'Remove', true).then(function (go) {
        if (!go) return;
        remove.disabled = true;
        sb.from('team_members').delete().eq('user_id', m.user_id).select('user_id').then(function (r) {
          remove.disabled = false;
          answered(r, function () { A.toast(who + ' is off the team.'); team(); });
        }, E.failed);
      });
    });
    var tr = h('tr', { class: manage ? 'is-managed' : null },
      h('td', { class: 'c-email' }, m.email),
      h('td', { class: 'hide-s' }, m.full_name || ''),
      h('td', { class: manage ? 'c-role' : 'hide-s' }, role),
      h('td', { class: 'c-money' }, h('label', { class: 'eco-switch' }, sw, word)),
      h('td', { class: 'hide-s' }, E.day(E.jkt(m.created_at))),
      summary,
      h('td', { class: 'c-act' }, remove));
    tr.style.cursor = 'default';
    return tr;
  }
  // Add to team (owners): team-access makes the account, adds it and emails a link to set a password
  function addForm(st) {
    var ready = !!st.mail && (!st.required || !!st.verified);
    var email = h('input', { id: 't-email', type: 'email', name: 'email', maxlength: 254, autocomplete: 'off', placeholder: 'name@gmail.com', required: true });
    var name = h('input', { id: 't-name', type: 'text', name: 'name', maxlength: 120, autocomplete: 'off' });
    var role = A.select(ROLES, 'viewer', { id: 't-role', name: 'role' });
    var money = h('input', { type: 'checkbox', name: 'money', 'aria-label': 'Money access' });
    var btn = h('button', { class: 'btn', type: 'submit', disabled: !ready }, 'Add to team');
    var form = h('form', { class: 'eco-team-add', novalidate: true },
      h('div', { class: 'field' }, h('label', { for: 't-email', text: 'Email' }), email),
      h('div', { class: 'field' }, h('label', { for: 't-name', text: 'Name' }), name),
      h('div', { class: 'field' }, h('label', { for: 't-role', text: 'Role' }), role),
      h('label', { class: 'eco-switch' }, money, h('span', { text: 'Money' })),
      btn);
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (btn.disabled) return;
      var addr = email.value.trim(), who = name.value.trim() || addr;
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr)) { A.toast('Enter a valid email.', true); email.focus(); return; }
      A.ask('Add ' + who + (role.value === 'admin' ? ' as an admin?' : ' as a viewer?'),
        'We email ' + addr + ' a link to set a password. ' + ROLE_SAYS[role.value]
          + (money.checked ? ' They’ll also see amounts, Finance, the Kas and the Sheet’s figures.' : ''),
        'Add and send').then(function (go) {
        if (!go) return;
        btn.disabled = true;
        A.teamAccess('invite', { email: addr, name: name.value.trim(), role: role.value, money: money.checked }).then(function (a) {
          btn.disabled = false;
          if (a.status === 200 && a.body.ok) {
            A.toast(a.body.mailed ? who + ' is on the team. The email with their link is on its way.'
              : who + ' is on the team, but the email didn’t go out. They can use Forgot password on the sign in page.', !a.body.mailed);
            team();
            return;
          }
          A.toast(a.body.error || 'Couldn’t add them. Try again.', true);
        }, function (err) { btn.disabled = false; E.failed(err); });
      });
    });
    return h('div', { class: 'eco-team-new' }, form, ready ? null : h('p', { class: 'eco-note', text: st.mail
      ? 'Enter the code from your email first, then you can add people.'
      : 'Adding people sends them an email, so it waits for the Gmail App Password.' }));
  }

  // ---------- the Google Sheet (§3.12): status, open issues, change log ----------
  function sheet() {
    var card = h('div', { class: 'eco-card' }, h('p', { class: 'eco-wait', text: 'Checking the Sheet\u2026' }));
    var issues = h('div', { class: 'eco-block' }), log = h('div', { class: 'eco-block' });
    sheetBox.innerHTML = '';
    A.add(sheetBox, [h('h2', { class: 'eco-h', text: 'Integrations' }), card, issues, log]);
    Promise.all([E.settle(E.data.flow(true)), E.settle(E.data.values()), E.settle(E.data.projects()), E.settle(E.data.clients())]).then(function (r) {
      card.innerHTML = '';
      if (r[0].e) { card.appendChild(h('p', { class: 'eco-err', text: 'Couldn\u2019t check the Sheet. ' + E.ecoError(r[0].e) })); return; }
      var f = r[0].v, s = f.sheet || {}, st = E.sheetState(f), vals = r[1].v || {}, meta = vals.meta ? vals.meta.value || {} : {};
      var seed = meta.version === 'seed', url = E.sheetUrl(vals);
      var count = function (x, one) { return x.e ? null : E.plural(x.v.filter(function (i) { return i.sheet_state === 'present'; }).length, one); };
      var mirrored = [count(r[2], 'project'), count(r[3], 'client')].filter(Boolean).join(', ');
      A.add(card, [
        h('p', { class: 'eco-status' + (st.cls === 'is-err' ? ' is-err' : ''), text: 'Google Sheet \u00b7 ' + st.text.replace(/^Sheet( \u00b7)? ?/, '').replace(/ \u00b7 details$/, '') }),
        E.kv([
          ['Connection', s.connected ? 'Connected' : 'Not connected'],
          ['Environment', meta.env ? (ENV[meta.env] || meta.env) + (seed ? ' \u00b7 a one-time copy of the Sheet' : '') : null],
          ['What the admin shows', r[1].e ? h('span', { class: 'neg', text: E.ecoError(r[1].e) }) : E.fromSheet(vals, vals.meta && vals.meta.seen_at)],
          ['In the admin', mirrored || null],
          ['Last sync', s.last_success_at ? E.stamp(s.last_success_at) : E.quiet('None yet')],
          ['Last error', s.last_error ? h('span', { class: 'neg', text: s.last_error }) : null],
          ['Reading the Sheet', !s.connected ? E.quiet('Not running') : s.pull_enabled === false ? 'Paused' : 'On'],
          ['Writing to the Sheet', !s.connected ? E.quiet('Not running') : s.writes_enabled === false ? 'Paused' : 'On'],
          ['Changes waiting', f.waiting > 0 ? String(f.waiting) : null],
          ['Changes that need a look', f.conflicts > 0 ? String(f.conflicts) : null],
          ['Writes that failed', f.failed > 0 ? h('span', { class: 'neg', text: String(f.failed) }) : null]
        ]),
        h('div', { class: 'eco-top-actions' },
          h('button', { class: 'btn ghost', type: 'button', disabled: true, 'aria-describedby': 'eco-sync-blocked' }, 'Sync now'),
          url ? h('a', { class: 'btn ghost', href: url, target: '_blank', rel: 'noopener noreferrer' }, 'Open the Sheet') : null),
        h('p', { class: 'eco-note', id: 'eco-sync-blocked', text: s.connected
          ? 'Sync now comes in a later version. The Sheet is read on a schedule.'
          : 'Sync now is off: the development copy of the Sheet and its Apps Script web app aren\u2019t set up yet. Until they are, the admin shows the one-time copy above, and changes made in the Sheet don\u2019t reach it.' })
      ]);
    });
    openIssues(issues);
    changeLog(log);
  }
  function openIssues(box) {
    box.appendChild(h('h2', { class: 'eco-h', text: 'Open issues' }));
    var list = h('ul', { class: 'eco-list' }, h('li', { class: 'eco-wait', text: 'Loading\u2026' }));
    box.appendChild(list);
    E.rows(sb.from('sync_issues').select('id, kind, key, message, first_seen_at, last_seen_at').is('resolved_at', null).order('last_seen_at', { ascending: false }).limit(50)).then(function (rows) {
      list.innerHTML = '';
      rows.forEach(function (i) {
        list.appendChild(h('li', {}, h('div', { class: 't' }, i.message || i.kind,
          h('span', { class: 'sub', text: 'First seen ' + E.stamp(i.first_seen_at) + (i.last_seen_at && i.last_seen_at !== i.first_seen_at ? ' \u00b7 last seen ' + E.stamp(i.last_seen_at) : '') }))));
      });
      if (!rows.length) list.appendChild(h('li', { class: 'eco-empty', text: 'No open issues.' }));
    }, function (e) { list.innerHTML = ''; list.appendChild(h('li', { class: 'eco-err', text: E.ecoError(e) })); });
  }
  var said = function (v) {
    if (v == null || v === '') return 'empty';
    if (typeof v === 'number') return E.num(v);
    if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return E.day(v);
    return E.clip(typeof v === 'object' ? JSON.stringify(v) : v, 80);
  };
  var shown = function (v) { return v == null || v === '' ? E.quiet('Empty') : said(v); };
  function changeLog(box) {
    box.appendChild(h('h2', { class: 'eco-h', text: 'Change log' }));
    if (!A.canMoney()) { box.appendChild(h('p', { class: 'adm-note', text: 'The change log shows amounts, so it needs money access.' })); return; }
    var head = ['When', 'Record', 'Field', 'Was', 'Now', 'By'], tbody = h('tbody');
    box.appendChild(h('div', { class: 'adm-table-wrap' }, h('table', { class: 'adm-table is-stack' }, E.thead(head), tbody)));
    E.waitRow(tbody, head.length);
    E.rows(sb.from('sync_changes').select('id, at, source, actor_email, entity, label, field, old_value, new_value, forced').order('at', { ascending: false }).limit(50)).then(function (rows) {
      tbody.innerHTML = '';
      rows.forEach(function (c) {
        var by = c.actor_email || (c.source === 'sheet' ? 'The Sheet' : c.source) || '';
        var tr = h('tr', {},
          h('td', { class: 'hide-s' }, E.stamp(c.at)),
          h('td', {}, c.label || c.entity),
          h('td', { class: 'hide-s' }, c.field || ''),
          h('td', { class: 'hide-s' }, shown(c.old_value)),
          h('td', { class: 'hide-s' }, shown(c.new_value), c.forced ? h('span', { class: 'sub', text: 'Saved over the Sheet\u2019s value' }) : null),
          h('td', { class: 'hide-s' }, by),
          h('td', { class: 'only-s' }, [c.field, 'was ' + said(c.old_value), 'now ' + said(c.new_value), E.stamp(c.at), by].filter(Boolean).join(' \u00b7 ')));
        tr.style.cursor = 'default';
        tbody.appendChild(tr);
      });
      if (!rows.length) E.fullRow(tbody, head.length, 'No changes yet. Edits from the admin and the Sheet are listed here.');
    }, function (e) { E.errRow(tbody, head.length, e); });
  }

  A.loaders.settings = function () { team(); sheet(); };
})();
