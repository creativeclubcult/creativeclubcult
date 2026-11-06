// The client's invoice page at /pay#<token>. The token stays after the #, so it never reaches a server log or a
// Referer header. The page asks the pay-page function for that one invoice and CCC's bank details, and sends
// "Saya sudah transfer". Everything the client reads here is Indonesian.
(function () {
  'use strict';

  var LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  var FN = (LOCAL ? 'https://jvhhcehzhgpcphtpynnx.supabase.co' : 'https://zneckeqsvwbavqxpolri.supabase.co') + '/functions/v1/pay-page';
  var KEY = LOCAL ? 'sb_publishable_4h3nPS3LkYpy8xOe2vEM_A_y9ffqKEY' : 'sb_publishable_-h0k4-TWYPa03dqcdAg4Eg_53_s0dFU';
  var MAIL = 'hello@creativeclubcult.com';
  var NAME = 'Creative Club Cult';

  var $ = function (id) { return document.getElementById(id); };
  // 43 characters of base64url; punctuation a chat app glued to the end of the link is let go
  var found = /^#([A-Za-z0-9_-]{43})(?![A-Za-z0-9_-])/.exec(location.hash);
  var token = found ? found[1] : '';
  var owed = null, accountNo = '';

  // ---------- Indonesian money and dates, as the emails write them ----------
  var RP = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 });
  var rupiah = function (n) { return RP.format(n).replace(/ /g, ' '); };
  var BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  var JKT = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Jakarta', year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  function jkt(s) {
    var o = {};
    JKT.formatToParts(new Date(s)).forEach(function (p) { o[p.type] = p.value; });
    return o;
  }
  /** "20 November 2026" from 2026-11-20, or from a moment as the day it is in Jakarta */
  function tanggal(s) {
    if (!s) return '';
    var d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (d) return +d[3] + ' ' + BULAN[+d[2] - 1] + ' ' + d[1];
    if (isNaN(Date.parse(s))) return '';
    var p = jkt(s);
    return +p.day + ' ' + BULAN[+p.month - 1] + ' ' + p.year;
  }
  var jam = function (s) { var p = jkt(s); return p.hour + '.' + p.minute + ' WIB'; };
  // a figure the server didn't send stays empty: it is never shown as Rp 0
  var num = function (v) { return typeof v === 'number' && isFinite(v) ? v : null; };

  // ---------- small DOM helpers ----------
  function mailLink() {
    var a = document.createElement('a');
    a.href = 'mailto:' + MAIL;
    a.textContent = MAIL;
    return a;
  }
  /** fill a paragraph from strings and nodes and show it, or hide it when there is nothing */
  function put(id, parts) {
    var el = $(id);
    el.textContent = '';
    if (parts) el.append.apply(el, [].concat(parts));
    el.hidden = !parts;
  }
  function row(id, value) {
    $('row-' + id).hidden = value == null || value === '';
    if (value != null) $(id).textContent = value;
  }
  function say(text) {
    var live = $('live');
    live.textContent = '';
    setTimeout(function () { live.textContent = text; }, 50);
  }

  // ---------- talking to pay-page ----------
  function call(body) {
    var ctl = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = ctl ? setTimeout(function () { ctl.abort(); }, 15000) : 0;
    return fetch(FN, {
      method: 'POST',
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      headers: { 'Content-Type': 'application/json', apikey: KEY },
      body: JSON.stringify(body),
      signal: ctl ? ctl.signal : undefined,
    }).then(function (res) {
      return res.json().then(function (data) { return { status: res.status, data: data }; }, function () { return { status: res.status, data: null }; });
    }, function () {
      return { status: 0, data: null };
    }).then(function (r) {
      clearTimeout(timer);
      return r;
    });
  }

  // ---------- the states before there is a bill ----------
  function message(title, parts, retry) {
    $('bill').hidden = true;
    $('msg').hidden = false;
    $('msg-title').textContent = title;
    put('msg-text', parts);
    $('retry').hidden = !retry;
    $('main').setAttribute('aria-busy', 'false');
    document.title = 'Tagihan dari ' + NAME;
    if (parts) say(title);
  }
  var gone = function () { message('Link ini sudah tidak berlaku.', ['Kalau masih ada tagihan yang perlu dibayar, minta link baru ke ', mailLink(), '.']); };
  var incomplete = function () { message('Link ini tidak lengkap.', ['Buka lagi link dari email atau WhatsApp kami. Kalau tetap tidak bisa, minta link baru ke ', mailLink(), '.']); };
  var busy = function () { message('Terlalu banyak permintaan.', ['Tunggu sebentar, lalu coba lagi.'], true); };
  var failed = function () { message('Tagihan belum bisa dimuat.', ['Periksa koneksi internet, lalu coba lagi.'], true); };

  function load() {
    message('Memuat tagihan…', null, false);
    $('main').setAttribute('aria-busy', 'true');
    return call({ action: 'view', token: token }).then(function (r) {
      if (r.status === 200 && r.data && r.data.invoice) return show(r.data);
      if (r.status === 404) return gone();
      if (r.status === 429) return busy();
      failed();
    });
  }

  // ---------- the bill ----------
  function show(s) {
    var i = s.invoice, b = s.bank;
    owed = num(i.owed);
    var total = num(i.total), paid = num(i.paid);
    var settled = owed === 0;
    var part = owed !== null && owed > 0 && paid !== null && paid > 0 && total !== null && total > owed;

    $('msg').hidden = true;
    $('bill').hidden = false;
    $('main').setAttribute('aria-busy', 'false');
    document.title = 'Tagihan ' + (i.doc_no ? i.doc_no + ' ' : '') + 'dari ' + NAME;

    $('bill-title').textContent = i.client ? 'Tagihan untuk ' + i.client : 'Tagihan dari ' + NAME;
    put('bill-what', i.title || null);

    if (settled) {
      $('owed-label').textContent = 'Status';
      $('owed').textContent = 'Lunas';
      put('owed-note', 'Tagihan ini sudah dibayar penuh. Terima kasih!');
    } else if (owed === null) {
      $('owed-label').textContent = 'Jumlah tagihan';
      $('owed').textContent = '';
      put('owed-note', ['Jumlahnya sedang kami perbarui. Tanyakan jumlah pastinya ke ', mailLink(), ' sebelum transfer.']);
    } else {
      $('owed-label').textContent = part ? 'Sisa tagihan' : 'Jumlah tagihan';
      $('owed').textContent = rupiah(owed);
      put('owed-note', null);
    }
    $('owed').hidden = owed === null;

    row('doc', i.doc_no || null);
    row('due', settled ? null : tanggal(i.due_on) || null);
    row('total', (part || settled) && total !== null ? rupiah(total) : null);
    row('paid', part ? rupiah(paid) : null);

    // paid in full: nothing to transfer and nothing to confirm
    $('act').hidden = settled;
    $('bill').classList.toggle('is-single', settled);

    if (b) {
      $('bank-rows').hidden = false;
      $('bank-name').textContent = b.bank;
      $('bank-no').textContent = b.account_no;
      $('bank-holder').textContent = b.account_name;
      accountNo = String(b.account_no).replace(/[\s.-]/g, '');
      $('row-amount').hidden = owed === null;
      if (owed !== null) $('bank-amount').textContent = rupiah(owed);
      put('bank-note', b.note || null);
      put('bank-none', null);
    } else {
      $('bank-rows').hidden = true;
      put('bank-note', null);
      put('bank-none', ['Nomor rekening belum ada di halaman ini. Tanyakan cara pembayarannya ke ', mailLink(), '.']);
    }

    $('confirm-form').hidden = false;
    status('');
    put('confirm-done', null);
    if (s.said_paid_at) done(s.said_paid_at, false);
    put('expiry', s.expires_at ? 'Link ini berlaku sampai ' + tanggal(s.expires_at) + '.' : null);
  }

  // ---------- copy the account number and the amount ----------
  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return fallback(text); });
    }
    return Promise.resolve(fallback(text));
  }
  function fallback(text) {
    var box = document.createElement('textarea');
    box.value = text;
    box.setAttribute('readonly', '');
    box.className = 'pay-copybox';
    document.body.appendChild(box);
    box.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    box.remove();
    return ok;
  }
  function copy(btn, text, what) {
    copyText(text).then(function (ok) {
      clearTimeout(btn.timer);
      btn.textContent = ok ? 'Tersalin' : 'Salin';
      btn.classList.toggle('is-done', ok);
      say(ok ? what + ' tersalin.' : what + ' belum bisa disalin otomatis. Tekan lama angkanya untuk menyalin.');
      btn.timer = setTimeout(function () { btn.textContent = 'Salin'; btn.classList.remove('is-done'); }, 2000);
    });
  }
  $('copy-no').addEventListener('click', function () { copy(this, accountNo, 'Nomor rekening'); });
  $('copy-amount').addEventListener('click', function () { if (owed !== null) copy(this, String(owed), 'Jumlah'); });

  // ---------- "Saya sudah transfer" ----------
  function status(text, error) {
    var p = $('paid-status');
    p.textContent = text || '';
    p.classList.toggle('is-error', !!error);
  }
  function done(at, focus) {
    $('confirm-form').hidden = true;
    status('');
    var when = at && !isNaN(Date.parse(at)) ? ' pada ' + tanggal(at) + ' pukul ' + jam(at) : '';
    put('confirm-done', 'Terima kasih. Konfirmasi transfer sudah kami terima' + when + '. Tim kami akan mengeceknya.');
    if (focus) $('confirm-done').focus();
  }
  $('paid-btn').addEventListener('click', function () {
    var btn = this;
    btn.disabled = true;
    status('Mengirim konfirmasi…');
    call({ action: 'paid', token: token, note: $('note').value }).then(function (r) {
      btn.disabled = false;
      if (r.status === 200 && r.data && r.data.ok) return done(r.data.at, true);
      if (r.status === 404) return gone();
      if (r.status === 409) {
        // the invoice was settled in the meantime
        $('confirm-form').hidden = true;
        status('');
        put('confirm-done', (r.data && r.data.error) || 'Tagihan ini sudah lunas. Terima kasih!');
        return $('confirm-done').focus();
      }
      if (r.status === 429) return status('Terlalu banyak permintaan. Tunggu sebentar, lalu coba lagi.', true);
      status('Konfirmasi belum terkirim. Periksa koneksi internet, lalu coba lagi.', true);
    });
  });

  $('retry').addEventListener('click', load);
  // another link pasted into the same tab
  addEventListener('hashchange', function () { location.reload(); });

  if (token) load();
  else incomplete();
})();
