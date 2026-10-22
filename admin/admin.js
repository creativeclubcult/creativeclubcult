/* CCC admin: people & vendors, contact inquiries, open roles, team.
   Everything here runs as the signed-in team member; the database decides what they may see and change
   (row level security: viewers read, admins and owners edit, owners delete). Anything typed by the public
   is put on the page as text, never as HTML. */
(function () {
  'use strict';

  var SB_URL = 'https://zneckeqsvwbavqxpolri.supabase.co';
  var SB_KEY = 'sb_publishable_-h0k4-TWYPa03dqcdAg4Eg_53_s0dFU';
  var sb = window.supabase.createClient(SB_URL, SB_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });

  var PAGE = 100;
  var TRACK = { team: 'Team', internship: 'Internship', collaborator: 'Collaborator / Vendor' };
  var STATUS = {
    team: ['new', 'reviewing', 'shortlisted', 'interview', 'hired', 'declined', 'archived'],
    internship: ['new', 'reviewing', 'shortlisted', 'interview', 'hired', 'declined', 'archived'],
    collaborator: ['new', 'verified', 'worked-with', 'favourite', 'not-a-fit', 'archived']
  };
  var ALL_STATUS = ['new', 'reviewing', 'shortlisted', 'interview', 'hired', 'declined', 'verified', 'worked-with', 'favourite', 'not-a-fit', 'archived'];
  var INQ_STATUS = ['new', 'replied', 'in progress', 'won', 'lost', 'spam'];
  var WORK = { onsite: 'On site', remote: 'Remote', hybrid: 'Hybrid', any: 'Any' };

  var me = null, skills = [], skillLabel = {};
  var canEdit = function () { return me && (me.role === 'owner' || me.role === 'admin'); };
  var isOwner = function () { return me && me.role === 'owner'; };

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
    for (var i = 2; i < arguments.length; i++) add(el, arguments[i]);
    return el;
  }
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
      sb.auth.getSession().then(function (s) { route(s.data.session); });
    });
  });
  $$('[data-action="signout"]').forEach(function (b) { b.addEventListener('click', function () { sb.auth.signOut(); }); });

  var routing = false;
  function route(session) {
    if (!session) { me = null; show('login'); return; }
    // the auth library repeats "signed in" when the tab comes back into view: same person, nothing to redo
    // (re-routing would close an open record and lose what was being typed)
    if (me && me.id === session.user.id) return;
    if (routing) return; routing = true;
    sb.from('team_members').select('role, full_name, email').eq('user_id', session.user.id).maybeSingle().then(function (r) {
      routing = false;
      $$('[data-me-email]').forEach(function (el) { el.textContent = session.user.email; });
      if (r.error || !r.data) { show('denied'); return; }
      me = { id: session.user.id, email: session.user.email, role: r.data.role, name: r.data.full_name };
      $('[data-me-role]').textContent = me.role;
      $$('[data-edit-only]').forEach(function (el) { el.hidden = !canEdit(); });
      show('app');
      loadSkills().then(openTab);
    });
  }
  sb.auth.onAuthStateChange(function (event, session) {
    if (event === 'PASSWORD_RECOVERY') { show('reset'); return; }
    if (event === 'SIGNED_OUT') { me = null; show('login'); return; }
    if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') route(session);
  });

  // ---------- tabs ----------
  var loaders = {};
  function openTab() {
    var tab = (location.hash || '#applicants').slice(1);
    if (!loaders[tab]) tab = 'applicants';
    $$('[data-tab]').forEach(function (a) { if (a.getAttribute('data-tab') === tab) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    $$('[data-panel]').forEach(function (p) { p.hidden = p.getAttribute('data-panel') !== tab; });
    closeDrawer();
    loaders[tab]();
  }
  window.addEventListener('hashchange', function () { if (me) openTab(); });

  // ---------- drawer ----------
  var drawer = $('[data-drawer]'), drawerBody = $('[data-drawer-body]'), scrim = $('[data-scrim]');
  function openDrawer(content) { drawerBody.innerHTML = ''; add(drawerBody, content); drawer.hidden = false; scrim.hidden = false; drawer.scrollTop = 0; }
  function closeDrawer() { drawer.hidden = true; scrim.hidden = true; drawerBody.innerHTML = ''; }
  $('[data-action="close"]').addEventListener('click', closeDrawer);
  scrim.addEventListener('click', closeDrawer);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !drawer.hidden) closeDrawer(); });
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
      var sel = $('[data-panel="applicants"] [data-filter="skill"]');
      sel.length = 1;
      skills.forEach(function (s) { sel.appendChild(h('option', { value: s.slug }, s.label)); });
      var st = $('[data-panel="applicants"] [data-filter="status"]');
      st.length = 1;
      ALL_STATUS.forEach(function (s) { st.appendChild(h('option', { value: s }, s)); });
    });
  }

  // ================= PEOPLE (applicants & vendors) =================
  var ap = { panel: $('[data-panel="applicants"]'), from: 0 };
  var apFilter = function () {
    var f = {}; $$('[data-filter]', ap.panel).forEach(function (el) { f[el.getAttribute('data-filter')] = el.value.trim(); }); return f;
  };
  function apQuery(f, from, to, cols) {
    var sel = cols || 'id, created_at, track, entity_type, name, company_name, email, city, country, status, rating, tags, skills:applicant_skills(skill_slug)';
    if (f.skill) sel += ', sf:applicant_skills!inner(skill_slug)';
    var q = sb.from('applicants').select(sel, { count: 'exact' }).order('created_at', { ascending: false }).range(from, to);
    if (f.track) q = q.eq('track', f.track);
    if (f.status) q = q.eq('status', f.status);
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
        var crafts = (a.skills || []).map(function (s) { return skillLabel[s.skill_slug] || s.skill_slug; });
        tbody.appendChild(h('tr', { onclick: function () { apOpen(a.id); } },
          h('td', {}, date(a.created_at)),
          h('td', {}, a.name, a.company_name ? h('span', { class: 'sub', text: a.company_name }) : null, h('span', { class: 'sub', text: a.email })),
          h('td', {}, TRACK[a.track] || a.track),
          h('td', {}, crafts.slice(0, 3).join(', ') + (crafts.length > 3 ? ' +' + (crafts.length - 3) : '')),
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
  loaders.applicants = function () { apLoad(false); };
  var apTimer;
  $$('[data-filter]', ap.panel).forEach(function (el) {
    el.addEventListener(el.tagName === 'INPUT' ? 'input' : 'change', function () { clearTimeout(apTimer); apTimer = setTimeout(function () { apLoad(false); }, 250); });
  });
  $('[data-action="more"]', ap.panel).addEventListener('click', function () { apLoad(true); });

  function apOpen(id) {
    Promise.all([
      sb.from('applicants').select('*, skills:applicant_skills(skill_slug), files:applicant_files(id, path, name, size, mime, created_at), job:jobs(title)').eq('id', id).single(),
      sb.from('applicant_notes').select('id, body, author_email, author_id, created_at').eq('applicant_id', id).order('created_at', { ascending: false })
    ]).then(function (res) {
      if (res[0].error) return fail(res[0].error);
      var a = res[0].data, notes = res[1].data || [];
      var ro = !canEdit();
      var crafts = (a.skills || []).map(function (s) { return skillLabel[s.skill_slug] || s.skill_slug; });
      var wa = a.phone ? a.phone.replace(/[^\d]/g, '') : '';
      var ig = a.instagram ? a.instagram.replace(/^@/, '').replace(/[^A-Za-z0-9._]/g, '') : '';

      var status = select(STATUS[a.track] || ALL_STATUS, a.status, { disabled: ro });
      var rating = select([['', '—'], [1, '★'], [2, '★★'], [3, '★★★'], [4, '★★★★'], [5, '★★★★★']], a.rating == null ? '' : a.rating, { disabled: ro });
      var tags = h('input', { type: 'text', value: (a.tags || []).join(', '), placeholder: 'fashion, fast, Jakarta crew', disabled: ro });
      var save = h('button', { class: 'btn', type: 'button', disabled: ro, onclick: function () {
        var t = tags.value.split(',').map(function (x) { return x.trim(); }).filter(Boolean).slice(0, 30);
        sb.from('applicants').update({ status: status.value, rating: rating.value ? +rating.value : null, tags: t }).eq('id', a.id).then(function (r) {
          if (r.error) return fail(r.error);
          toast('Saved.'); apLoad(false);
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
                sb.from('applicant_notes').delete().eq('id', n.id).then(function (r) { if (r.error) return fail(r.error); notes = notes.filter(function (x) { return x.id !== n.id; }); drawNotes(notes); });
              } }, 'Delete')] : null)));
        });
      };
      drawNotes(notes);
      var addNote = h('button', { class: 'btn ghost', type: 'button', disabled: ro, onclick: function () {
        var body = noteBox.value.trim(); if (!body) return;
        sb.from('applicant_notes').insert({ applicant_id: a.id, body: body, author_email: me.email }).select('id, body, author_email, author_id, created_at').single().then(function (r) {
          if (r.error) return fail(r.error);
          noteBox.value = ''; notes.unshift(r.data); drawNotes(notes);
        });
      } }, 'Add note');

      var files = h('div', { class: 'adm-files' }, (a.files || []).map(function (f) {
        return h('button', { type: 'button', onclick: function () {
          sb.storage.from('applications').createSignedUrl(f.path, 120).then(function (r) {
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
        (paths.length ? sb.storage.from('applications').remove(paths) : Promise.resolve({})).then(function (r) {
          if (r && r.error) return fail(r.error);
          return sb.from('applicants').delete().eq('id', a.id).then(function (r2) {
            if (r2.error) return fail(r2.error);
            toast('Deleted.'); closeDrawer(); apLoad(false);
          });
        });
      } }, 'Delete this person') : null;

      openDrawer([
        h('h2', { text: a.name }),
        h('p', { class: 'lead-line' }, [TRACK[a.track], a.entity_type === 'company' ? 'Company' : null, a.company_name, 'since ' + date(a.created_at)].filter(Boolean).join(' · ')),
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
          ['Craft', crafts.join(', ')],
          ['Role', a.job ? a.job.title : (a.track !== 'collaborator' ? 'Open application' : null)],
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
    var cols = 'created_at, track, entity_type, name, company_name, email, phone, instagram, city, country, work_mode, can_travel, languages, experience_years, available_from, rate_note, links, status, rating, tags, skills:applicant_skills(skill_slug)';
    var next = function () {
      return apQuery(f, from, from + 999, cols).then(function (r) {
        if (r.error) throw r.error;
        rows = rows.concat(r.data || []); from += (r.data || []).length;
        if ((r.data || []).length === 1000 && from < 10000) return next();
      });
    };
    next().then(function () {
      var head = ['Date', 'Track', 'Type', 'Name', 'Company', 'Email', 'WhatsApp', 'Instagram', 'City', 'Country', 'Craft', 'Works', 'Travel', 'Languages', 'Experience', 'Available', 'Rate', 'Links', 'Status', 'Rating', 'Tags'];
      var q = function (v) {
        var s = v == null ? '' : String(v);
        if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // no formulas when opened in a spreadsheet
        return '"' + s.replace(/"/g, '""') + '"';
      };
      var lines = [head.map(q).join(',')].concat(rows.map(function (a) {
        return [date(a.created_at), TRACK[a.track], a.entity_type, a.name, a.company_name, a.email, a.phone, a.instagram, a.city, a.country,
          (a.skills || []).map(function (s) { return skillLabel[s.skill_slug] || s.skill_slug; }).join('; '),
          WORK[a.work_mode], a.can_travel == null ? '' : (a.can_travel ? 'yes' : 'no'), (a.languages || []).join('; '),
          a.experience_years, a.available_from, a.rate_note, (a.links || []).join(' '), a.status, a.rating, (a.tags || []).join('; ')].map(q).join(',');
      }));
      var blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
      var link = h('a', { href: URL.createObjectURL(blob), download: 'ccc-people-' + new Date().toISOString().slice(0, 10) + '.csv' });
      document.body.appendChild(link); link.click(); link.remove();
      toast(rows.length + ' people exported.');
    }).catch(fail);
  });

  // ================= INQUIRIES (contact form) =================
  var inq = { panel: $('[data-panel="inquiries"]') };
  function inqLoad() {
    var st = $('[data-filter="status"]', inq.panel).value;
    var q = sb.from('inquiries').select('*', { count: 'exact' }).order('created_at', { ascending: false }).limit(300);
    if (st) q = q.eq('status', st);
    q.then(function (r) {
      if (r.error) return fail(r.error);
      var tbody = $('[data-rows]', inq.panel); tbody.innerHTML = '';
      (r.data || []).forEach(function (m) {
        tbody.appendChild(h('tr', { onclick: function () { inqOpen(m); } },
          h('td', {}, date(m.created_at)), h('td', {}, m.name, h('span', { class: 'sub', text: m.email })), h('td', {}, m.company || ''),
          h('td', {}, m.inquiry_type), h('td', {}, m.budget || ''), h('td', {}, h('span', { class: 'adm-pill' + (m.status === 'new' ? ' is-new' : ''), text: m.status }))));
      });
      if (!tbody.children.length) tbody.appendChild(h('tr', { class: 'empty' }, h('td', { colspan: 6, text: 'No messages yet.' })));
      $('[data-count]', inq.panel).textContent = (r.count || 0) + ' messages';
    });
  }
  loaders.inquiries = inqLoad;
  $('[data-filter="status"]', inq.panel).addEventListener('change', inqLoad);
  function inqOpen(m) {
    var ro = !canEdit();
    var status = select(INQ_STATUS, m.status, { disabled: ro });
    var notes = h('textarea', { value: m.notes || '', placeholder: 'Notes for the team', disabled: ro });
    openDrawer([
      h('h2', { text: m.name }),
      h('p', { class: 'lead-line', text: m.inquiry_type + ' · ' + dateTime(m.created_at) }),
      sec('Status', h('div', { class: 'adm-controls' }, h('label', {}, 'Status', status), h('label', { class: 'wide' }, 'Notes', notes)),
        h('div', { class: 'adm-row' }, h('button', { class: 'btn', type: 'button', disabled: ro, onclick: function () {
          sb.from('inquiries').update({ status: status.value, notes: notes.value.trim() || null }).eq('id', m.id).then(function (r) {
            if (r.error) return fail(r.error); toast('Saved.'); inqLoad();
          });
        } }, 'Save'))),
      sec('From', kv([
        ['Email', h('a', { href: 'mailto:' + m.email, text: m.email })], ['Company', m.company], ['Reach them via', m.preferred_contact],
        ['Timeline', m.timeline], ['Budget', m.budget], ['Sent from', m.page]
      ])),
      sec('Message', h('div', { class: 'adm-text', text: m.description }))
    ]);
  }

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
  $('[data-action="new-job"]').addEventListener('click', function () { jobOpen(null); });
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
              if (r.error) return fail(r.error); toast('Saved.'); closeDrawer(); jobsLoad();
            });
          } }, 'Save'),
          j.id && !ro ? h('button', { class: 'adm-link adm-danger', type: 'button', onclick: function () {
            if (!confirm('Delete the role "' + j.title + '"? Applications for it are kept.')) return;
            sb.from('jobs').delete().eq('id', j.id).then(function (r) { if (r.error) return fail(r.error); toast('Deleted.'); closeDrawer(); jobsLoad(); });
          } }, 'Delete role') : null))
    ]);
  }

  // ================= TEAM =================
  var teamP = { panel: $('[data-panel="team"]') };
  loaders.team = function () {
    sb.from('team_members').select('email, full_name, role, created_at').order('created_at').then(function (r) {
      if (r.error) return fail(r.error);
      var tbody = $('[data-rows]', teamP.panel); tbody.innerHTML = '';
      (r.data || []).forEach(function (m) {
        var tr = h('tr', {}, h('td', {}, m.email), h('td', {}, m.full_name || ''), h('td', {}, h('span', { class: 'adm-pill', text: m.role })), h('td', {}, date(m.created_at)));
        tr.style.cursor = 'default'; tbody.appendChild(tr);
      });
    });
  };
})();
