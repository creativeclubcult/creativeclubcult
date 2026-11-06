/* Careers (applicants and open roles) and the Network tab of Crew & Vendors: the people who wrote in through the
   Careers page, and the roles listed on it. Careers applicants (team, internship) and the creative network
   (collaborators, vendors) stay apart: the same screens, but separate tables, file buckets and statuses.
   Applicants and the network are for owners and admins (the database checks again); everyone on the team reads the
   roles, and owners and admins change them. What people typed on the website goes on the page as text, never as HTML.
   Loaded before crew.js, which puts its figures and tabs on top of the Network tab. */
(function () {
  'use strict';
  if (!window.cccAdmin) return; // admin.js stopped early: the sign in library didn't load
  var A = window.cccAdmin, E = window.eco, sb = A.sb, h = A.h, I = A.icon;
  var PAGE = 100, BOARD_MAX = 500, LANE_SHOW = 20;
  var TRACK = { team: 'Team', internship: 'Internship', collaborator: 'Collaborator' };
  var WORK = { onsite: 'On site', remote: 'Remote', hybrid: 'Hybrid', any: 'Any' };
  var NET_ST = [['new', 'New'], ['verified', 'Verified'], ['worked-with', 'Worked with'], ['favourite', 'Favourite'], ['not-a-fit', 'Not a fit'], ['archived', 'Archived']];
  var APP_ST = [['new', 'New'], ['reviewing', 'Reviewing'], ['shortlisted', 'Shortlisted'], ['interview', 'Interview'], ['hired', 'Hired'], ['declined', 'Declined'], ['archived', 'Archived']];
  var LABEL = {};
  NET_ST.concat(APP_ST).forEach(function (s) { LABEL[s[0]] = s[1]; });
  var TONE = { 'new': 'new', reviewing: 'busy', shortlisted: 'sent', interview: 'sent', hired: 'deal', declined: 'off', archived: 'off',
    verified: 'deal', 'worked-with': 'yes', favourite: 'paid', 'not-a-fit': 'off' };
  var KINDS = {
    applicants: { table: 'applicants', skills: 'applicant_skills', files: 'applicant_files', notes: 'applicant_notes', fk: 'applicant_id',
      bucket: 'applications', csv: 'ccc-applicants', statuses: APP_ST, one: 'applicant', many: 'applicants' },
    network: { table: 'network_profiles', skills: 'network_profile_skills', files: 'network_profile_files', notes: 'network_profile_notes', fk: 'profile_id',
      bucket: 'network', csv: 'ccc-network', statuses: NET_ST, one: 'person', many: 'people' }
  };
  var empty = function (t, err) { return h('p', { class: 'empty' + (err ? ' is-err' : ''), text: t }); };
  var pill = function (s) { return h('span', { class: 'pill ' + (TONE[s] || 'off'), text: LABEL[s] || s || 'No status' }); };
  var when = function (t) { return E.day(E.jkt(t)); };
  var place = function (a) { return [a.city, a.country].filter(Boolean).join(', '); };
  var roleOf = function (a) { return a.job && a.job.title ? a.job.title : a.position || 'Open application'; };
  var size = function (b) { return !b ? null : b < 1048576 ? Math.max(1, Math.round(b / 1024)) + ' KB' : (b / 1048576).toFixed(1) + ' MB'; };
  // a plain click opens the record over the list; a click with a modifier opens it in a new tab as a link does
  var go = function (fn, x) {
    return function (e) {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button) return;
      e.preventDefault(); fn(x);
    };
  };
  // a request that can fail answers {error} instead of throwing
  var safe = function (q) { return q.then(function (r) { return r; }, function (e) { return { error: e || new Error('Failed') }; }); };
  function state(box, text, err, retry) {
    box.innerHTML = ''; box.hidden = !text;
    if (text) A.add(box, [empty(text, err), retry ? h('button', { class: 'btn sm', type: 'button', onclick: retry }, 'Try again') : null]);
  }

  // ---------- crafts (the skills list) for the filters and the rows ----------
  var skillP = null, skillList = null, skillLabel = {}, skillFail = false;
  function fillCrafts() {
    A.$$('select[data-filter="skill"]').forEach(function (sel) {
      // when the list couldn't be loaded the filter has nothing to offer, so it steps aside until it loads
      sel.hidden = skillFail && !skillList;
      if (!skillList || sel.length > 1) return;
      skillList.forEach(function (s) { sel.appendChild(h('option', { value: s.slug }, s.label)); });
    });
  }
  function skills() {
    if (!skillP) {
      skillP = E.rows(sb.from('skills').select('slug, label').order('sort')).then(function (list) {
        skillList = list; skillLabel = {}; skillFail = false;
        list.forEach(function (s) { skillLabel[s.slug] = s.label; });
        fillCrafts();
        return list;
      });
      skillP.catch(function () { skillP = null; skillFail = true; fillCrafts(); });
    }
    return skillP;
  }
  var crafts = function (a) { return (a.skills || []).map(function (s) { return skillLabel[s.skill_slug] || s.skill_slug; }); };

  // ---------- the filters in a bar, and the list query they make ----------
  var filters = function (box) {
    var f = {};
    A.$$('[data-filter]', box).forEach(function (el) { f[el.getAttribute('data-filter')] = el.value.trim(); });
    return f;
  };
  var filtered = function (f) { return Object.keys(f).some(function (k) { return !!f[k]; }); };
  function query(K, f, cols) {
    var q = sb.from(K.table).select(cols + (f.skill ? ', sf:' + K.skills + '!inner(skill_slug)' : ''), { count: 'exact' }).order('created_at', { ascending: false });
    ['track', 'entity_type', 'status'].forEach(function (c) { if (f[c]) q = q.eq(c, f[c]); });
    if (f.skill) q = q.eq('sf.skill_slug', f.skill);
    var t = E.search(f.q);
    if (t) q = q.or(['name', 'email', 'city', 'country', 'company_name'].map(function (c) { return c + '.ilike."*' + t + '*"'; }).join(','));
    return q;
  }
  function refilter(box, fn) {
    var t;
    A.$$('[data-filter]', box).forEach(function (el) {
      el.addEventListener(el.tagName === 'INPUT' ? 'input' : 'change', function () { clearTimeout(t); t = setTimeout(fn, 250); });
    });
  }

  // ---------- the Network tab of Crew & Vendors (its markup is in index.html) ----------
  var NP = A.$('[data-panel="network"]'), NK = KINDS.network;
  var net = { body: A.$('[data-rows]', NP), tbl: A.$('table', NP), state: A.$('[data-state]', NP), count: A.$('[data-count]', NP),
    more: A.$('[data-action="more"]', NP), from: 0, turn: 0 };
  NET_ST.forEach(function (s) { A.$('select[data-filter="status"]', NP).appendChild(h('option', { value: s[0] }, s[1])); });
  var NET_COLS = 'id, created_at, entity_type, name, company_name, email, city, country, status, skills:network_profile_skills(skill_slug)';
  var openNet = function (id) { open('network', id); };
  function netRow(a) {
    var href = '#network/' + a.id, c = crafts(a);
    var sub = a.company_name || (c.length ? c.slice(0, 3).join(', ') + (c.length > 3 ? ' and ' + (c.length - 3) + ' more' : '') : '');
    return h('tr', { 'data-href': href },
      h('td', {}, h('div', { class: 'pj' }, h('span', { class: 'av v', 'aria-hidden': 'true', text: E.initial(a.name) }),
        h('div', {}, h('b', {}, h('a', { href: href, onclick: go(openNet, a.id), text: a.name })), sub ? h('span', { text: sub }) : null))),
      h('td', { 'data-l': 'Kind', text: a.entity_type === 'company' ? 'Company' : 'Individual' }),
      h('td', { 'data-l': 'Location', class: place(a) ? null : 'muted', text: place(a) || 'Not given' }),
      h('td', { 'data-l': 'Status' }, pill(a.status)),
      h('td', { 'data-l': 'Joined', class: 'muted', text: when(a.created_at) }),
      h('td', { class: 'go' }, I('chev', 's')));
  }
  function netLoad(more) {
    var mine = ++net.turn, f = filters(NP);
    if (!more) net.from = 0;
    if (!more && !net.body.children.length) { net.tbl.hidden = true; state(net.state, 'Loading the network…'); }
    net.more.disabled = true;
    Promise.all([E.settle(skills()), safe(query(NK, f, NET_COLS).range(net.from, net.from + PAGE - 1))]).then(function (r) {
      if (mine !== net.turn) return;
      var res = r[1], list = res.data || [];
      net.more.disabled = false;
      if (res.error) {
        if (more) return E.failed(res.error);
        net.body.innerHTML = ''; net.tbl.hidden = true; net.more.hidden = true; net.count.textContent = '';
        return state(net.state, E.ecoError(res.error), true, function () { netLoad(false); });
      }
      if (!more) net.body.innerHTML = '';
      list.forEach(function (a) { net.body.appendChild(netRow(a)); });
      net.from += list.length;
      var n = res.count == null ? net.from : res.count;
      net.tbl.hidden = !net.from;
      state(net.state, net.from ? '' : filtered(f) ? 'No one matches these filters.' : 'No one has joined the network yet. People join from the Careers page.');
      net.count.textContent = E.plural(n, 'person', 'people');
      net.more.hidden = net.from >= n;
    });
  }
  refilter(NP, function () { netLoad(false); });
  net.more.addEventListener('click', function () { netLoad(true); });
  // crew.js wraps this loader to put the figures and the tabs on top
  A.loaders.network = function () { netLoad(false); };
  A.openers.network = openNet;
  A.actions.network = function () { return A.canEdit() ? exportBtn('network') : null; };

  // ---------- Careers: the two tabs above both lists ----------
  function careersNav(which) {
    var tab = function (id, label) {
      return h('a', { href: '#' + id, 'data-sub': id, 'aria-current': which === id ? 'page' : null }, label, h('span', { class: 'c', 'data-c': id }));
    };
    return h('nav', { class: 'tabs', 'aria-label': 'Careers', hidden: !A.canEdit() }, tab('applicants', 'Applicants'), tab('jobs', 'Open roles'));
  }
  // how many applicants and roles there are, beside the tab names (a count that fails stays blank, never 0)
  function tabCounts() {
    if (!A.canEdit()) return;
    ['applicants', 'jobs'].forEach(function (t) {
      safe(sb.from(t).select('id', { count: 'exact', head: true })).then(function (r) {
        A.$$('[data-c="' + t + '"]').forEach(function (el) { el.textContent = r.error || r.count == null ? '' : String(r.count); });
      });
    });
  }

  // ---------- Careers: applicants, as a board by status ----------
  var AP = A.$('[data-panel="applicants"]'), AK = KINDS.applicants, app = null;
  var LANES = APP_ST.slice(0, 5);
  var APP_COLS = 'id, created_at, track, position, name, email, city, country, status, rating, job:jobs(title), skills:applicant_skills(skill_slug)';
  var openApp = function (id) { open('applicants', id); };
  function appBuild() {
    if (app) return;
    app = { bar: h('div', { class: 'bar' }), count: h('span', { class: 'muted' }), note: h('p', { class: 'lnote', hidden: true }),
      state: h('div', { class: 'lstate', hidden: true }), board: h('div', { class: 'board', hidden: true }),
      x: h('p', { class: 'lane-x', hidden: true }), rest: h('div', { class: 'board', id: 'ap-rest', hidden: true }), turn: 0, got: null, showRest: false };
    A.add(app.bar, [careersNav('applicants'),
      h('label', { class: 'field sm' }, I('search', 's'),
        h('input', { type: 'search', placeholder: 'Search name, email, city', 'data-filter': 'q', 'aria-label': 'Search applicants', autocomplete: 'off' })),
      h('select', { class: 'field', 'data-filter': 'track', 'aria-label': 'Track' }, h('option', { value: '' }, 'Every track'),
        h('option', { value: 'team' }, 'Team'), h('option', { value: 'internship' }, 'Internship')),
      h('select', { class: 'field', 'data-filter': 'skill', 'aria-label': 'Craft' }, h('option', { value: '' }, 'Any craft')),
      app.count]);
    fillCrafts();
    refilter(app.bar, appLoad);
    AP.innerHTML = '';
    A.add(AP, h('section', { class: 'card tablecard', 'aria-label': 'Applicants' }, app.bar, app.note, app.state, app.board, app.x, app.rest));
  }
  function appCard(a) {
    return h('a', { class: 'ac', href: '#applicants/' + a.id, onclick: go(openApp, a.id) },
      h('div', { class: 'ac-t' }, h('span', { class: 'av', 'aria-hidden': 'true', text: E.initial(a.name) }),
        h('div', {}, h('b', { text: a.name }), h('span', { text: roleOf(a) }))),
      h('div', { class: 'ac-m' },
        a.track ? h('span', { class: 'tag', text: TRACK[a.track] || a.track }) : null,
        a.city ? h('span', { class: 'tag', text: a.city }) : null,
        h('span', { class: 'tag' }, I('clock'), h('span', { class: 'sr', text: 'Applied ' }), E.shortStamp(a.created_at))));
  }
  // a lane shows its first 20 cards; the rest come on request, with the cursor on the first of them
  function lane(label, list) {
    var n = list.length;
    var box = h('section', { class: 'lane', 'aria-label': label + ', ' + E.plural(n, 'applicant') },
      h('h3', { class: 'lane-h' }, label, h('span', { class: 'c', 'aria-hidden': 'true', text: String(n) })));
    list.slice(0, LANE_SHOW).forEach(function (a) { box.appendChild(appCard(a)); });
    if (!n) box.appendChild(h('p', { class: 'none', text: 'No one here' }));
    if (n > LANE_SHOW) {
      var more = h('button', { class: 'btn sm quiet lane-more', type: 'button', onclick: function () {
        var first = null;
        list.slice(LANE_SHOW).forEach(function (a) { var c = appCard(a); first = first || c; box.insertBefore(c, more); });
        more.remove();
        if (first) first.focus();
      } }, 'Show ' + (n - LANE_SHOW) + ' more');
      box.appendChild(more);
    }
    return box;
  }
  function appLoad() {
    var mine = ++app.turn, f = filters(app.bar);
    if (!app.got) { app.board.hidden = app.x.hidden = app.rest.hidden = true; state(app.state, 'Loading applicants…'); }
    Promise.all([E.settle(skills()), safe(query(AK, f, APP_COLS).limit(BOARD_MAX))]).then(function (r) {
      if (mine !== app.turn) return;
      var res = r[1];
      if (res.error) {
        app.got = null; app.board.hidden = app.x.hidden = app.rest.hidden = app.note.hidden = true; app.count.textContent = '';
        return state(app.state, E.ecoError(res.error), true, appLoad);
      }
      app.got = res.data || [];
      var n = res.count == null ? app.got.length : res.count;
      app.count.textContent = E.plural(n, 'applicant');
      app.note.hidden = n <= app.got.length;
      app.note.textContent = 'Showing the newest ' + app.got.length + ' applicants. Search or filter to find someone older.';
      if (!app.got.length) {
        app.board.hidden = app.x.hidden = app.rest.hidden = true;
        return state(app.state, filtered(f) ? 'No applicants match these filters.' : 'No applications yet. They come in from the Careers page.');
      }
      state(app.state, '');
      drawBoard();
    });
  }
  function drawBoard() {
    var by = {}, order = APP_ST.map(function (s) { return s[0]; });
    app.got.forEach(function (a) { (by[a.status] = by[a.status] || []).push(a); });
    app.board.innerHTML = ''; app.board.hidden = false;
    LANES.forEach(function (s) { app.board.appendChild(lane(s[1], by[s[0]] || [])); });
    // declined, archived and any older status: counted under the board, shown on request
    var rest = Object.keys(by).filter(function (k) { return !LANES.some(function (s) { return s[0] === k; }); })
      .sort(function (a, b) { return (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99); });
    app.rest.innerHTML = '';
    rest.forEach(function (k) { app.rest.appendChild(lane(LABEL[k] || k, by[k])); });
    app.x.innerHTML = ''; app.x.hidden = false;
    if (!rest.length) { app.x.textContent = 'No one declined or archived.'; app.rest.hidden = true; return; }
    var said = rest.map(function (k) { return by[k].length + ' ' + (LABEL[k] || k).toLowerCase(); });
    var line = said.length > 1 ? said.slice(0, -1).join(', ') + ' and ' + said[said.length - 1] : said[0];
    var btn = h('button', { class: 'btn sm quiet', type: 'button', 'aria-controls': 'ap-rest', 'aria-expanded': String(app.showRest), onclick: function () {
      app.showRest = !app.showRest; app.rest.hidden = !app.showRest;
      btn.setAttribute('aria-expanded', String(app.showRest)); btn.textContent = app.showRest ? 'Hide them' : 'Show them';
    } }, app.showRest ? 'Hide them' : 'Show them');
    A.add(app.x, [h('span', { text: line + '.' }), ' ', btn]);
    app.rest.hidden = !app.showRest;
  }
  A.loaders.applicants = function () { appBuild(); appLoad(); tabCounts(); };
  A.openers.applicants = openApp;
  A.actions.applicants = function () { return A.canEdit() ? exportBtn('applicants') : null; };

  // ---------- Export CSV: everyone matching the filters on screen (a shortlist, a crew list) ----------
  function exportBtn(kind) {
    var b = h('button', { class: 'btn', type: 'button', onclick: function () {
      b.disabled = true;
      exportCsv(kind).then(function () { b.disabled = false; }, function (e) { b.disabled = false; E.failed(e); });
    } }, I('in', 's'), 'Export CSV');
    return b;
  }
  function exportCsv(kind) {
    var K = KINDS[kind], isNet = kind === 'network';
    if (!isNet) appBuild();
    var f = filters(isNet ? NP : app.bar), rows = [], from = 0, capped = false;
    var cols = 'created_at, ' + (isNet ? 'entity_type, company_name' : 'track, position, job:jobs(title)') + ', name, email, phone, instagram, city, country, work_mode, can_travel, languages, '
      + (isNet ? 'rate_note' : 'experience_years, available_from') + ', links, status, rating, tags, skills:' + K.skills + '(skill_slug)';
    var next = function () {
      return query(K, f, cols).range(from, from + 999).then(function (r) {
        if (r.error) throw r.error;
        var got = r.data || [];
        rows = rows.concat(got); from += got.length;
        if (got.length === 1000) { if (from < 10000) return next(); capped = true; }
      });
    };
    return skills().catch(function () { return null; }).then(next).then(function () {
      var head = ['Date'].concat(isNet ? ['Kind', 'Company'] : ['Track', 'Role'],
        ['Name', 'Email', 'WhatsApp', 'Instagram', 'City', 'Country', 'Craft', 'Works', 'Travel', 'Languages'],
        isNet ? ['Rate'] : ['Experience (years)', 'Available from'], ['Links', 'Status', 'Rating', 'Tags']);
      E.csv(K.csv, head, rows.map(function (a) {
        return [when(a.created_at)].concat(isNet ? [a.entity_type === 'company' ? 'Company' : 'Individual', a.company_name] : [TRACK[a.track] || a.track, roleOf(a)],
          [a.name, a.email, a.phone, a.instagram, a.city, a.country, crafts(a).join('; '),
            WORK[a.work_mode] || '', a.can_travel == null ? '' : a.can_travel ? 'Yes' : 'No', (a.languages || []).join('; ')],
          isNet ? [a.rate_note] : [a.experience_years, a.available_from ? E.day(a.available_from) : ''],
          [(a.links || []).join(' '), LABEL[a.status] || a.status, a.rating, (a.tags || []).join('; ')]);
      }));
      A.toast(capped ? 'The first ' + rows.length + ' ' + K.many + ' exported. Filter the list to export the rest.' : E.plural(rows.length, K.one, K.many) + ' exported.');
    });
  }

  // ---------- one person: an applicant, or someone in the network ----------
  function open(kind, id, keep) {
    var K = KINDS[kind];
    var miss = function () {
      A.toast(kind === 'network' ? 'That person isn’t in the network any more.' : 'That applicant isn’t here any more.', true);
      if (location.hash.indexOf('#' + kind + '/') === 0) E.setHash(kind);
    };
    if (!E.isId(id)) return miss();
    var cols = '*, skills:' + K.skills + '(skill_slug), files:' + K.files + '(id, path, name, size, mime, created_at)' + (kind === 'applicants' ? ', job:jobs(title)' : '');
    Promise.all([safe(sb.from(K.table).select(cols).eq('id', id).maybeSingle()), notesOf(K, id), E.settle(skills())]).then(function (r) {
      if (r[0].error) return E.failed(r[0].error);
      if (!r[0].data) return miss();
      show(kind, r[0].data, r[1], keep);
    });
  }
  var notesOf = function (K, id) { return E.settle(E.rows(sb.from(K.notes).select('id, body, author_email, author_id, created_at').eq(K.fk, id).order('created_at', { ascending: false }))); };
  // the list behind the drawer, drawn again after a change (the Network tab with its figures on top)
  function reload(kind) {
    if (kind === 'network') { if (!NP.hidden) A.loaders.network(); }
    else if (app && !AP.hidden) { appLoad(); tabCounts(); }
  }
  var tagList = function (s) { return String(s || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean).slice(0, 30); };

  // a private file opens through a link that works for two minutes; the tab opens at the click, so no popup blocker stops it
  function openFile(K, f) {
    var w = window.open('', '_blank');
    var fail = function (e) { if (w) w.close(); E.failed(e || new Error('The file couldn’t be opened.')); };
    sb.storage.from(K.bucket).createSignedUrl(f.path, 120).then(function (r) {
      if (r.error || !r.data) return fail(r.error);
      if (w) { w.opener = null; w.location.href = r.data.signedUrl; } else window.open(r.data.signedUrl, '_blank', 'noopener');
    }, fail);
  }

  function show(kind, a, notesR, keep) {
    var K = KINDS[kind], isNet = kind === 'network', me = A.me() || {};
    // status, rating and tags are picked here and saved together
    var pick = { status: a.status, rating: a.rating || null };
    var steps = K.statuses.some(function (s) { return s[0] === a.status; }) || !a.status ? K.statuses : K.statuses.concat([[a.status, LABEL[a.status] || a.status]]);
    var chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Status' });
    steps.forEach(function (s) {
      chips.appendChild(h('button', { type: 'button', 'aria-pressed': String(s[0] === pick.status), 'data-v': s[0], onclick: function () {
        pick.status = s[0];
        A.$$('button', chips).forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-v') === pick.status)); });
      } }, s[1]));
    });
    var stars = h('div', { class: 'stars', role: 'group', 'aria-label': 'Rating' });
    var paint = function () {
      A.$$('button', stars).forEach(function (b) {
        var k = +b.getAttribute('data-star');
        b.classList.toggle('on', !!pick.rating && k <= pick.rating);
        b.setAttribute('aria-pressed', String(k === pick.rating));
      });
    };
    [1, 2, 3, 4, 5].forEach(function (k) {
      // the same star again takes the rating off
      stars.appendChild(h('button', { type: 'button', 'data-star': k, 'aria-label': k + ' of 5', onclick: function () { pick.rating = pick.rating === k ? null : k; paint(); } }, I('star')));
    });
    paint();
    var tags = h('input', { type: 'text', value: (a.tags || []).join(', '), placeholder: 'fashion, fast, Jakarta crew', maxlength: 600, autocomplete: 'off' });
    var changed = function () { return pick.status !== a.status || pick.rating !== (a.rating || null) || tagList(tags.value).join('\n') !== (a.tags || []).join('\n'); };
    var save = h('button', { class: 'btn sm', type: 'button', 'data-k': 'save-status', onclick: function () {
      var next = { status: pick.status, rating: pick.rating, tags: tagList(tags.value) };
      save.disabled = true;
      safe(sb.from(K.table).update(next).eq('id', a.id).select('id')).then(function (r) {
        save.disabled = false;
        if (r.error) return E.failed(r.error);
        if (!r.data || !r.data.length) return A.toast('Your account isn’t allowed to change this person.', true);
        Object.assign(a, next);
        tags.value = next.tags.join(', ');
        A.toast('Saved.'); A.refreshBadges(); reload(kind);
      });
    } }, 'Save');

    // notes for the team, newest first; the writer of a note and owners can delete it
    var notes = notesR.e ? null : notesR.v.slice();
    var noteBox = h('textarea', { placeholder: 'Add a note for the team', maxlength: 4000 });
    var noteList = h('div');
    var drawNotes = function () {
      noteList.innerHTML = '';
      if (!notes) return A.add(noteList, [empty(E.ecoError(notesR.e), true), h('button', { class: 'btn sm', type: 'button', onclick: loadNotes }, 'Try again')]);
      if (!notes.length) return A.add(noteList, empty('No notes yet.'));
      A.add(noteList, h('ul', { class: 'notes' }, notes.map(function (n) {
        var mine = (me.id && n.author_id === me.id) || A.isOwner();
        return h('li', {}, h('p', { text: n.body }),
          h('div', { class: 'by' }, h('span', { text: [n.author_email || 'The team', E.stamp(n.created_at)].filter(Boolean).join(', ') }),
            mine ? h('button', { class: 'btn sm quiet danger', type: 'button', onclick: function () { dropNote(n); } }, 'Delete') : null));
      })));
    };
    function loadNotes() { notesOf(K, a.id).then(function (x) { notesR = x; notes = x.e ? null : x.v.slice(); drawNotes(); }); }
    function dropNote(n) {
      A.ask('Delete this note?', 'It can’t be brought back.', 'Delete note', true).then(function (yes) {
        if (!yes) return;
        safe(sb.from(K.notes).delete().eq('id', n.id).select('id')).then(function (r) {
          if (r.error) return E.failed(r.error);
          if (!r.data || !r.data.length) return A.toast('Only the person who wrote a note, or an owner, can delete it.', true);
          notes = notes.filter(function (x) { return x.id !== n.id; });
          drawNotes(); noteBox.focus(); A.toast('Note deleted.');
        });
      });
    }
    var addNote = h('button', { class: 'btn sm', type: 'button', onclick: function () {
      var body = noteBox.value.trim();
      if (!body) { noteBox.focus(); return A.toast('Write the note first.', true); }
      var row = { body: body, author_email: me.email || null };
      row[K.fk] = a.id;
      addNote.disabled = true;
      safe(sb.from(K.notes).insert(row).select('id, body, author_email, author_id, created_at').single()).then(function (r) {
        addNote.disabled = false;
        if (r.error) return E.failed(r.error);
        noteBox.value = '';
        if (notes) { notes.unshift(r.data); drawNotes(); } else loadNotes();
        A.toast('Note added.');
      });
    } }, 'Add note');
    drawNotes();

    var c = crafts(a);
    var work = [
      ['Craft', c.join(', ')],
      isNet ? null : ['Role', roleOf(a)],
      ['Experience', a.experience_years != null ? E.plural(a.experience_years, 'year') : null],
      ['Available from', a.available_from ? E.day(a.available_from) : null],
      ['Works', WORK[a.work_mode]],
      ['Travel', a.can_travel == null ? null : a.can_travel ? 'Yes' : 'No'],
      ['Languages', (a.languages || []).join(', ')],
      ['Rate', a.rate_note],
      ['Brings', a.equipment ? h('span', { class: 'pre', text: a.equipment }) : null]
    ].filter(function (p) { return p && p[1] != null && p[1] !== ''; });
    var docs = (a.links || []).map(function (u) {
      var ok = A.safeUrl(u);
      var kids = [h('span', { class: 'nic' }, I('link', 's')), h('div', {}, h('b', { text: u }), h('span', { text: 'Link' })), ok ? I('ext', 's') : null];
      return h('li', {}, ok ? h('a', { class: 'doc', href: ok, target: '_blank', rel: 'noopener noreferrer' }, kids) : h('div', { class: 'doc' }, kids));
    }).concat((a.files || []).map(function (f) {
      return h('li', {}, h('button', { class: 'doc', type: 'button', onclick: function () { openFile(K, f); } },
        h('span', { class: 'nic' }, I('docs', 's')), h('div', {}, h('b', { text: f.name || 'File' }), h('span', { text: ['File', size(f.size)].filter(Boolean).join(', ') })), I('ext', 's')));
    }));
    var record = [['Heard via', a.source], ['Sent from', a.page], ['Consent', a.consent_at ? E.stamp(a.consent_at) : null],
      ['Updated', a.updated_at && a.updated_at !== a.created_at ? E.stamp(a.updated_at) : null]].filter(function (p) { return p[1]; });

    var del = A.isOwner() ? h('div', { class: 'formacts' }, h('button', { class: 'btn sm quiet danger', type: 'button', onclick: function () {
      A.ask('Delete ' + a.name + '?', 'Their details, files and notes are deleted for good. This can’t be undone.', 'Delete for good', true).then(function (yes) {
        if (!yes) return;
        var paths = (a.files || []).map(function (f) { return f.path; }).filter(Boolean);
        (paths.length ? sb.storage.from(K.bucket).remove(paths) : Promise.resolve({})).then(function (r) {
          if (r && r.error) throw r.error;
          return sb.from(K.table).delete().eq('id', a.id).select('id');
        }).then(function (r) {
          if (r.error) throw r.error;
          if (!r.data || !r.data.length) return A.toast('Only owners can delete people.', true);
          A.guard(null); A.toast(a.name + ' deleted.'); A.closeDrawer(true); A.refreshBadges(); reload(kind);
        }).catch(E.failed);
      });
    } }, 'Delete this person')) : null;

    var sub = (isNet ? [a.entity_type === 'company' ? 'Company' : 'Individual', a.company_name] : [TRACK[a.track] || a.track])
      .concat(['since ' + when(a.created_at)]).filter(Boolean).join(', ');
    E.drawer(kind, a.id, [
      E.dhead(h('span', { class: 'av v', 'aria-hidden': 'true', text: E.initial(a.name) }), a.name, sub, place(a) ? [place(a)] : null),
      h('div', { class: 'dr-body' },
        E.dsec('Status', null, chips, h('div', { class: 'rate' }, h('span', { text: 'Rating' }), stars),
          h('label', { class: 'f' }, 'Tags', tags), h('div', { class: 'formacts' }, save)),
        E.dsec('Contact', null, E.props([['Email', E.mailLink(a.email) || E.quiet('Not given')], ['WhatsApp', E.phoneLink(a.phone)],
          ['Instagram', E.igLink(a.instagram)], ['Location', place(a) || null]])),
        E.dsec('Work', null, work.length ? E.props(work) : empty(docs.length ? 'No craft or rate shared yet.' : 'No craft, rate or links shared yet.')),
        docs.length ? E.dsec('Portfolio', null, h('ul', { class: 'docs' }, docs)) : null,
        a.message ? E.dsec('Message', null, h('blockquote', { class: 'quote pre', text: a.message })) : null,
        E.dsec('Notes', null, h('label', { class: 'f' }, 'New note', noteBox), h('div', { class: 'formacts' }, addNote), noteList),
        record.length ? E.dsec('Record', null, E.props(record)) : null,
        del)
    ], keep);
    A.guard(function () { return changed() || !!noteBox.value.trim(); });
  }

  // ---------- Careers: the open roles on the Careers page ----------
  var JP = A.$('[data-panel="jobs"]'), job = null;
  var EMP = [['full-time', 'Full time'], ['contract', 'Contract'], ['part-time', 'Part time'], ['internship', 'Internship']];
  // the part of the studio a role is listed under on the Careers page; a role without one shows under More roles
  var DEPT = [['think', 'Think'], ['direct', 'Direct'], ['create', 'Create'], ['produce', 'Produce']];
  var WORKS = [['onsite', 'On site'], ['remote', 'Remote'], ['hybrid', 'Hybrid']];
  var labelOf = function (list, v) { var x = list.filter(function (o) { return o[0] === v; })[0]; return x ? x[1] : v || ''; };
  function jobBuild() {
    if (job) return;
    job = { count: h('span', { class: 'muted' }), state: h('div', { class: 'lstate', hidden: true }), body: h('tbody'), turn: 0, got: null };
    job.tbl = h('table', { class: 'tbl people roles', hidden: true },
      h('thead', {}, h('tr', {}, ['Role', 'Track', 'Section', 'Type', 'Location', 'On the site'].map(function (t) { return h('th', { text: t }); }),
        h('th', {}, h('span', { class: 'sr', text: 'Open' })))), job.body);
    job.none = h('div', { class: 'emptyx', hidden: true }, h('span', { class: 'nic violet' }, I('careers')), h('b', { text: 'No roles yet' }),
      h('p', { text: 'Open applications are still welcome on the site.' }));
    JP.innerHTML = '';
    A.add(JP, h('section', { class: 'card tablecard', 'aria-label': 'Open roles' }, h('div', { class: 'bar' }, careersNav('jobs'), job.count), job.state, job.tbl, job.none));
  }
  function jobRow(j) {
    var href = '#jobs/' + j.id, loc = [j.location, WORK[j.work_mode]].filter(Boolean).join(', ');
    return h('tr', { 'data-href': href },
      h('td', {}, h('div', { class: 'pj' }, h('div', {}, h('b', {}, h('a', { href: href, onclick: go(jobShow, j), text: j.title })),
        j.summary ? h('span', { text: j.summary }) : null))),
      h('td', { 'data-l': 'Track', text: TRACK[j.track] || j.track }),
      h('td', { 'data-l': 'Section', class: j.department ? null : 'muted', text: j.department ? labelOf(DEPT, j.department) : 'More roles' }),
      h('td', { 'data-l': 'Type', text: labelOf(EMP, j.employment) }),
      h('td', { 'data-l': 'Location', class: loc ? null : 'muted', text: loc || 'Not given' }),
      h('td', { 'data-l': 'On the site' }, h('span', { class: 'pill ' + (j.is_open ? 'deal' : 'off'), text: j.is_open ? 'Shown' : 'Hidden' })),
      h('td', { class: 'go' }, I('chev', 's')));
  }
  function jobLoad() {
    jobBuild();
    var mine = ++job.turn;
    if (!job.got) { job.tbl.hidden = job.none.hidden = true; state(job.state, 'Loading the roles…'); }
    safe(sb.from('jobs').select('*').order('sort').order('created_at', { ascending: false })).then(function (r) {
      if (mine !== job.turn) return;
      if (r.error) {
        job.got = null; job.tbl.hidden = job.none.hidden = true; job.count.textContent = '';
        return state(job.state, E.ecoError(r.error), true, jobLoad);
      }
      job.got = r.data || [];
      state(job.state, '');
      job.body.innerHTML = '';
      job.got.forEach(function (j) { job.body.appendChild(jobRow(j)); });
      job.tbl.hidden = !job.got.length; job.none.hidden = !!job.got.length;
      job.count.textContent = job.got.length ? E.plural(job.got.length, 'role') : '';
    });
  }
  function jobShow(j) { if (A.canEdit()) jobForm(j); else jobView(j); }
  var jobMark = function () { return h('span', { class: 'av', 'aria-hidden': 'true' }, I('careers')); };
  var onSite = function (j) { return j.is_open ? 'Shown on the Careers page' : 'Hidden from the Careers page'; };
  // viewers read a role
  function jobView(j) {
    E.drawer('jobs', j.id, [
      E.dhead(jobMark(), j.title, onSite(j)),
      h('div', { class: 'dr-body' },
        E.dsec('Role', null, E.props([['Track', TRACK[j.track] || j.track], ['Section', j.department ? labelOf(DEPT, j.department) : 'More roles'],
          ['Type', labelOf(EMP, j.employment)], ['Location', j.location], ['Work', WORK[j.work_mode]]])),
        j.summary ? E.dsec('Summary', null, h('p', { class: 'txt', text: j.summary })) : null,
        j.description ? E.dsec('Description', null, h('p', { class: 'txt', text: j.description })) : null)
    ]);
  }
  // one choice from a few, as chips; an optional one can be pressed again to leave it empty
  function chipPick(label, opts, current, optional) {
    var val = current || '';
    var box = h('div', { class: 'chips', role: 'group', 'aria-label': label });
    opts.forEach(function (o) {
      box.appendChild(h('button', { type: 'button', 'aria-pressed': String(o[0] === val), 'data-v': o[0], onclick: function () {
        val = optional && val === o[0] ? '' : o[0];
        A.$$('button', box).forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-v') === val)); });
      } }, o[1]));
    });
    return { box: box, val: function () { return val; } };
  }
  // owners and admins add and change roles (a new one stays off the site until it is ticked)
  function jobForm(j) {
    var isNew = !j;
    j = j || { title: '', track: 'team', department: null, employment: 'full-time', location: '', work_mode: null, summary: '', description: '', is_open: false, sort: 0 };
    var f = {
      title: h('input', { type: 'text', maxlength: 120, autocomplete: 'off', value: j.title || '' }),
      track: chipPick('Track', [['team', 'Team'], ['internship', 'Internship']], j.track),
      dept: chipPick('Section', DEPT, j.department, true),
      emp: chipPick('Type', EMP, j.employment),
      location: h('input', { type: 'text', maxlength: 120, autocomplete: 'off', placeholder: 'Jakarta, Indonesia', value: j.location || '' }),
      sort: h('input', { type: 'number', step: 1, value: String(j.sort || 0) }),
      work: chipPick('Work', WORKS, j.work_mode, true),
      summary: h('textarea', { maxlength: 400, placeholder: 'One or two lines for the Careers page', value: j.summary || '' }),
      description: h('textarea', { maxlength: 8000, placeholder: 'The full brief, shown on the site when someone opens the role', value: j.description || '' }),
      open: h('input', { type: 'checkbox', checked: !!j.is_open })
    };
    var row = function () {
      return { title: f.title.value.trim(), track: f.track.val(), department: f.dept.val() || null, employment: f.emp.val(),
        location: f.location.value.trim() || null, work_mode: f.work.val() || null, summary: f.summary.value.trim() || null,
        description: f.description.value.trim() || null, is_open: f.open.checked, sort: Math.round(+f.sort.value) || 0 };
    };
    var base = JSON.stringify(row());
    var msg = h('span', { class: 'muted', role: 'status' });
    var say = function (t, err) { msg.textContent = t || ''; msg.classList.toggle('neg', !!err); };
    var done = function (t) { A.guard(null); A.toast(t); A.closeDrawer(true); jobLoad(); tabCounts(); };
    var save = h('button', { class: 'btn lime', type: 'button', onclick: function () {
      var r = row();
      f.title.removeAttribute('aria-invalid'); f.sort.removeAttribute('aria-invalid');
      if (!r.title) { say('Give the role a title.', true); f.title.setAttribute('aria-invalid', 'true'); f.title.focus(); return; }
      if (Math.abs(r.sort) > 1000000) { say('Use a smaller number for the order.', true); f.sort.setAttribute('aria-invalid', 'true'); f.sort.focus(); return; }
      save.disabled = true; say('Saving…');
      safe(isNew ? sb.from('jobs').insert(r).select('id') : sb.from('jobs').update(r).eq('id', j.id).select('id')).then(function (res) {
        save.disabled = false;
        if (res.error) return say(E.ecoError(res.error), true);
        if (!res.data || !res.data.length) return say('Your account isn’t allowed to change roles.', true);
        done(isNew ? 'Role added.' : 'Saved.');
      });
    } }, 'Save');
    var del = isNew ? null : h('button', { class: 'btn sm quiet danger', type: 'button', onclick: function () {
      A.ask('Delete the role “' + j.title + '”?', 'It comes off the Careers page. Applications for it are kept.', 'Delete role', true).then(function (yes) {
        if (!yes) return;
        safe(sb.from('jobs').delete().eq('id', j.id).select('id')).then(function (res) {
          if (res.error) return E.failed(res.error);
          if (!res.data || !res.data.length) return A.toast('Your account isn’t allowed to delete roles.', true);
          done('Role deleted.');
        });
      });
    } }, 'Delete role');
    var chipField = function (label, c, help) { return h('div', { class: 'f' }, h('span', { text: label }), c.box, help ? h('span', { class: 'help', text: help }) : null); };
    E.drawer(isNew ? null : 'jobs', isNew ? null : j.id, [
      E.dhead(jobMark(), isNew ? 'New role' : j.title, isNew ? 'Stays off the Careers page until you tick Show on the Careers page.' : onSite(j)),
      h('div', { class: 'dr-body' },
        h('label', { class: 'f' }, 'Title', f.title),
        chipField('Track', f.track),
        chipField('Section', f.dept, 'Where it shows on the Careers page. Left empty, it shows under More roles.'),
        chipField('Type', f.emp),
        h('div', { class: 'fgrid' }, h('label', { class: 'f' }, 'Location', f.location), h('label', { class: 'f' }, 'Order (lower first)', f.sort)),
        chipField('Work', f.work),
        h('label', { class: 'f' }, 'Summary', f.summary),
        h('label', { class: 'f' }, 'Description', f.description),
        h('label', { class: 'chk' }, f.open, 'Show on the Careers page'),
        h('div', { class: 'formacts' }, save, h('button', { class: 'btn quiet', type: 'button', onclick: function () { A.closeDrawer(); } }, 'Cancel'), msg),
        del ? h('div', { class: 'formacts' }, del) : null)
    ]);
    A.guard(function () { return JSON.stringify(row()) !== base; });
    if (isNew) f.title.focus();
  }
  A.loaders.jobs = function () { jobLoad(); tabCounts(); };
  A.openers.jobs = function (id) {
    if (!E.isId(id)) return;
    safe(sb.from('jobs').select('*').eq('id', id).maybeSingle()).then(function (r) {
      if (r.error) return E.failed(r.error);
      if (!r.data) { A.toast('That role isn’t on the list any more.', true); E.setHash('jobs'); return; }
      jobShow(r.data);
    });
  };
  A.actions.jobs = function () { return A.canEdit() ? h('button', { class: 'btn lime', type: 'button', onclick: function () { jobForm(null); } }, I('plus', 's'), 'New role') : null; };
})();
