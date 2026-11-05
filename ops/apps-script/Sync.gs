/** Sync.gs: bridge between the CCC admin (Supabase) and this Sheet. Code.gs is not modified.
 *  Script lock everywhere: LockService.getDocumentLock() is null in a web app.
 *
 *  Rules for this file (DESIGN.md §4.1):
 *  - every top-level name starts with sync, api_ or SYNC_ (all files share one global scope), plus doPost;
 *  - no top-level code reads Code.gs constants (REKAP, CLIENT, ...); they are used only inside functions;
 *  - no onOpen / onEdit / onChange / doGet here;
 *  - Code.gs functions with UI, the active sheet or the document lock are never called; their UI-free
 *    logic is mirrored and marked "mirror of <fn> in Code.gs".
 *  Reused from Code.gs (read-only): nextInvoiceNo_, pad3_, todayText_, getOrCreate_,
 *  cccFolder_, PROJECT_SUBFOLDERS, equipmentRows_, rapikanAlat_, clean_, REKAP, CLIENT, TEMPLATE, NON_RAB, INVOICE_FOLDER,
 *  PROJECT_FOLDER, DRIVE_ROOT, FK, FK_OPERASIONAL, FK_BELUM, KAS_KATEGORI, and DRIVE_ROOT_ID when Code.gs has it
 *  (the live root in the Shared Drive "CCC" is found by id; a DEV copy sets it to '').
 *
 *  Wire format (edge → here): POST body {v:1, ts, nonce, sheet, op, key, attempt, args:"<JSON>", sig}
 *  sig = hex HMAC-SHA256(SYNC_SECRET, v\nts\nnonce\nsheet\nop\nkey\nattempt\nargs). Reply: always HTTP 200
 *  {ok:true, data, v, ms} or {ok:false, code, message, current, v, ms}.
 *  Here → bridge: POST JSON with headers X-CCC-Time (seconds) and X-CCC-Sig = hex HMAC(`${t}.${body}`).
 *  Pairing (the only unsigned calls): here → bridge {kind:'pair', v:1, sheet, env, r}; the bridge asks this web
 *  app {v:1, op:'pair_check'} for SHA-256(r) and only then answers with a new SYNC_SECRET. Nobody types the secret.
 */
const SYNC_VERSION = '1.3.0';
// the live Sheet: "CCC - RAB & Keuangan" in the Shared Drive "CCC" of hello@creativeclubcult.com (since 2026-11-04)
const SYNC_PROD_SHEET = '1a5bRCaYtcTrhDyJtpaeCAQeKV58-kvd3NOfuJWGkVtM';
// the live Sheet before 2026-11-04, kept in the personal Drive as an archive
const SYNC_RETIRED_SHEETS = ['1lGOYzhB6TpamLVsf79P3cpLNPHfzFt6W7SeSbdxYZfw'];
const SYNC_LIVE_DRIVE_ROOT = '01_CCC - Creative Club Cult';
// the bridge each environment syncs with; Script Property SYNC_BRIDGE_URL overrides it
const SYNC_BRIDGE = {
  dev: 'https://jvhhcehzhgpcphtpynnx.supabase.co/functions/v1/sheets-bridge',
  prod: 'https://zneckeqsvwbavqxpolri.supabase.co/functions/v1/sheets-bridge',
};
const SYNC_ERR_RE = /^#(REF!|N\/A|VALUE!|DIV\/0!|NAME\?|NUM!|ERROR!|NULL!)/;
const SYNC_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SYNC_TAB_RE = /^\d{3} /;

const SYNC_HEAD = {
  rekap: ['No', 'Nama Tab', 'No. Invoice', 'Client', 'Project', 'Tanggal', 'Grand Total (Rp)', 'DP (Rp)', 'Pelunasan (Rp)',
    'Status', 'Catatan', 'Tgl File Final', 'Jatuh Tempo', 'DP Diterima (Rp)', 'Tgl DP', 'Pelunasan Diterima (Rp)',
    'Tgl Pelunasan', 'Total Dibayar (Rp)', 'Sisa Tagihan (Rp)', 'Status Bayar', 'Biaya Keluar Manual (Rp)', 'Omset (Rp)',
    'Biaya Keluar (Rp)', 'Profit (Rp)', 'Margin', 'Kunci Harga'],
  kas: ['Tanggal', 'Jenis', 'Kategori', 'Project (tab RAB)', 'Keterangan', 'Dibayar ke / Dari', 'Nominal (Rp)', 'Status',
    'Metode', 'Bukti (link)', 'Catatan'],
  client: ['Nama Client', 'Kode', 'PIC / Kontak', 'No. HP', 'Email', 'NPWP', 'Alamat', 'Catatan'],
  crew: ['Role', 'Nama', 'Rate (Rp)', 'Satuan Rate', 'No. HP', 'Catatan', 'Belum Dibayar (Rp)', 'Dibayar Tahun Ini (Rp)'],
  status: ['Draft', 'Dikirim', 'Deal', 'Lunas', 'Batal'],
};

// Rekap B..Z → snapshot field names (column number → key)
const SYNC_REKAP_COLS = {
  2: 'tab_name', 3: 'invoice_no', 4: 'client_label', 5: 'title', 6: 'quote_date', 7: 'grand_total', 8: 'dp_amount',
  9: 'final_amount', 10: 'status', 11: 'note_text', 12: 'final_file_date', 13: 'payment_due', 14: 'dp_received',
  15: 'dp_date', 16: 'final_received', 17: 'final_date', 18: 'paid_total', 19: 'outstanding', 20: 'pay_status',
  21: 'cost_override', 22: 'revenue', 23: 'cost', 24: 'profit', 25: 'margin', 26: 'gear_note',
};
// the Rekap input cells the admin may write (column numbers); everything else in Rekap is a formula or a spill
const SYNC_REKAP_SET = {
  status: [10, 'list'], final_file_date: [12, 'date'], dp_received: [14, 'money'], dp_date: [15, 'date'],
  final_received: [16, 'money'], final_date: [17, 'date'], cost_override: [21, 'money'],
};
// RAB header cells: field → [cell, label cell, label text, type]
const SYNC_TAB_FIELDS = {
  doc_type: ['A5', null, null, 'list'],
  title: ['H8', 'H7', 'SUMMARY', 'text'],
  client_label: ['F11', 'D11', 'CLIENT', 'text'],
  product: ['F12', 'D12', 'PRODUCT', 'text'],
  photographer: ['C13', 'A13', 'PHOTOGRAPHER', 'text'],
  quote_date: ['F14', 'D14', 'TANGGAL', 'date_text'],
  locations: ['C16', 'A16', 'NO. OF LOCATION', 'text'],
  shooting_days: ['C17', 'A17', 'SHOOTING DAYS', 'text'],
  usage: ['F17', 'D17', 'USAGE', 'text'],
  location: ['C18', 'A18', 'LOCATION', 'text'],
  language: ['F18', 'D18', 'LANGUAGE', 'text'],
};
// % rows: field → [label column, label text, value column]
const SYNC_PCT = {
  discount_pct: ['F', 'DISKON', 'G'], ppn_pct: ['F', 'PPN', 'G'], dp_pct: ['F', 'DP', 'G'],
  pph23_pct: ['I', 'PPH 23 DIPOTONG CLIENT', 'J'], net_profit_pct: ['I', 'NET PROFIT', 'J'],
};
// ALOKASI DANA block (I:M, two rows under ALAT BELUM DIKUNCI), one row each:
// [key, label in I, J (a fixed % or a formula), formula in L, format copied from: 'item' OMSET row, 'total' TOTAL BIAYA
// KELUAR row, 'input' PPh 23 row]. {P} {PR} ... are the block's rows in order, {OMSET} and {COST} the summary rows above.
// Labels must not equal the ones the Rekap and syncRabRead_ look up (OMSET, PROFIT, MARGIN, ...).
const SYNC_ALOKASI = [
  ['price', 'Harga project (Omset)', 1, '=L{OMSET}', 'item'],
  ['pr', 'Fee PR / freelance', 0.05, '=ROUND(L{P}*J{PR};0)', 'item'],
  ['internal', 'Fee internal (yang bawa project)', 0.03, '=ROUND(L{P}*J{IN};0)', 'item'],
  ['shared', 'DANA DIBAGI', 1, '=L{P}-L{PR}-L{IN}', 'total'],
  ['net_profit', 'Net profit', 0.25, '=ROUND(L{SH}*J{NP};0)', 'input'],
  ['kas', 'Kas CCC', 0.05, '=ROUND(L{SH}*J{KAS};0)', 'item'],
  ['budget', 'BUDGET PRODUKSI', '=1-J{NP}-J{KAS}', '=L{SH}-L{NP}-L{KAS}', 'total'],
  ['production_cost', 'Biaya produksi (RAB)', null, '=M{COST}', 'item'],
  ['left', 'SISA BUDGET', null, '=L{BUD}-L{PC}', 'total'],
];
const SYNC_ALOKASI_ROWS = ['P', 'PR', 'IN', 'SH', 'NP', 'KAS', 'BUD', 'PC', 'LEFT'];
// breakdown sections (column-A title → key, editable columns for M6)
const SYNC_SECTIONS = [
  ['PRE-PRODUCTION', 'pre', [1, 2, 4, 5, 6, 7]],
  ['TALENT & MODEL', 'talent', [1, 2, 4, 5, 7]],
  ['PRODUCTION CREW', 'crew', [1, 2, 3, 4, 5, 7]],
  ['LOCATION & PERMIT', 'location', [1, 2, 4, 5, 6, 7]],
  ['ART, PROPERTY & WARDROBE', 'art', [1, 2, 4, 5, 6, 7]],
  ['TRANSPORTATION & ACCOMMODATION', 'transport', [1, 2, 4, 5, 6, 7]],
  ['KONSUMSI / CATERING', 'catering', [1, 2, 4, 5, 6, 7]],
  ['POST PRODUCTION', 'post', [1, 2, 4, 5, 6, 7]],
  ['LAIN-LAIN (OTHERS)', 'others', [1, 2, 4, 5, 6, 7]],
];
const SYNC_EQ_GROUPS = ['CAMERA', 'LENS', 'CAMERA SUPPORT', 'BACKGROUND', 'LIGHTING', 'LIGHTING SUPPORT', 'AUDIO', 'LAINNYA'];
// RAB line fields (M6): field → [column, value type]. A section writes only the columns SYNC_SECTIONS lists for it.
const SYNC_LINE_FIELDS = { no: [1, 'int'], desc: [2, 'text'], person: [3, 'text'], cost: [4, 'money'], qty: [5, 'num'],
  unit: [6, 'text'], days: [7, 'num'] };
// equipment: I the item (Katalog N "Name (Vendor)" or typed), J qty and K days (the Sheet's lists 1 to 30), L manual price
const SYNC_EQ_FIELDS = { item: [9, 'text'], qty: [10, 'n30'], days: [11, 'n30'], manual_price: [12, 'money'] };
const SYNC_DOC_TYPES = ['PENAWARAN', 'INVOICE', 'KWITANSI'];
const SYNC_KAS_KEYS = ['entry_date', 'kind', 'category', 'project_tab', 'description', 'counterparty', 'amount', 'paid',
  'method', 'proof_url', 'note'];
const SYNC_KAS_TYPES = ['date', 'list', 'text', 'list', 'text', 'text', 'money', 'list', 'list', 'text', 'text'];
const SYNC_CLIENT_COLS = { name: 1, code: 2, pic: 3, phone: 4, email: 5, npwp: 6, address: 7, note: 8 };
const SYNC_CREW_COLS = { role: 1, name: 2, rate: 3, rate_unit: 4, phone: 5, note: 6, unpaid: 7, paid_this_year: 8 };
// mirror of the export URL options in exportPdf (Code.gs)
const SYNC_PDF_OPTS = '&size=A4&portrait=true&fitw=true&gridlines=false&printtitle=false&sheetnames=false'
  + '&pagenum=UNDEFINED&fzr=false&printnotes=false&horizontal_alignment=CENTER'
  + '&top_margin=0.5&bottom_margin=0.5&left_margin=0.5&right_margin=0.5';

// =====================================================================================================
// Entry points
// =====================================================================================================

function doPost(e) {
  const t0 = Date.now();
  let out;
  try {
    const req = JSON.parse(e.postData.contents);
    if (req && req.op === 'pair_check') {
      out = { ok: true, data: syncPairCheck_() };
    } else {
      const ctx = syncAuth_(req);
      const op = syncOps_()[req.op];
      if (!op || (op.devOnly && ctx.env !== 'dev')) throw syncErr_('invalid', 'Unknown op');
      const args = JSON.parse(req.args || '{}');
      out = { ok: true, data: op.write ? syncRun_(ctx, req.key, Number(req.attempt) || 1, op, args) : op.fn(ctx, args) };
    }
  } catch (err) {
    out = { ok: false, code: err.code || 'error', message: String(err.message || err).slice(0, 300), current: err.current || null };
  }
  out.v = SYNC_VERSION; out.ms = Date.now() - t0;
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

/** Time trigger (every 10 min): the fallback path through Edge sheets-bridge (DESIGN.md §4.6). */
function syncTick() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('SYNC_SHEET_ID');
  let active = null;
  try { active = SpreadsheetApp.getActive(); } catch (err) { return; }
  if (!id || !active || active.getId() !== id) return;
  const ctx = syncCtx_(id);
  const base = { v: 1, sheet: id, env: ctx.env };
  try {
    const hello = syncSend_(Object.assign({ kind: 'hello', version: SYNC_VERSION, seq: Number(props.getProperty('SYNC_SEQ') || 0),
      last_error: props.getProperty('SYNC_LAST_ERROR') || null }, base));
    props.deleteProperty('SYNC_LAST_ERROR');
    if (hello.snapshot) {
      const data = api_snapshot(ctx, { have: hello.have || {}, known_gids: hello.known_gids || [], tabs: 'none',
        form_check: ctx.env === 'prod' });
      if (!data.skipped) syncSend_(Object.assign({ kind: 'snapshot', data: data }, base));
    }
    const ops = Array.isArray(hello.ops) ? hello.ops : [];
    if (ops.length) {
      const table = syncOps_();
      const results = ops.map(function (o) {
        try {
          const op = table[o.op];
          if (!op || !op.write) throw syncErr_('invalid', 'Unknown op');
          return { op_id: o.op_id, ok: true, data: syncRun_(ctx, o.op_id, Number(o.attempt) || 1, op, o.args || {}) };
        } catch (err) {
          return { op_id: o.op_id, ok: false, code: err.code || 'error', message: String(err.message || err).slice(0, 300),
            current: err.current || null };
        }
      });
      syncSend_(Object.assign({ kind: 'results', results: results }, base));
    }
  } catch (err) {
    props.setProperty('SYNC_LAST_ERROR', (new Date().toISOString() + ' ' + String(err.message || err)).slice(0, 300));
  }
}

/** Run once from the editor of the Sheet that should sync (container context). */
function syncSetup() {
  const ss = SpreadsheetApp.getActive();
  const props = PropertiesService.getScriptProperties();
  const id = ss.getId();
  syncRetired_(id);
  const env = id === SYNC_PROD_SHEET ? 'prod' : 'dev';
  if (env === 'dev' && syncLiveDriveRoot_()) {
    throw new Error('This is a copy, but Code.gs still uses the live Drive root. Run syncSetupDevCopy() after changing DRIVE_ROOT and DRIVE_ROOT_ID.');
  }
  syncBridgeUrl_(env);
  props.setProperty('SYNC_SHEET_ID', id);
  if (!/^[0-9a-f]{64}$/i.test(props.getProperty('SYNC_SECRET') || '')) syncPair_(id, env);
  const formId = PropertiesService.getDocumentProperties().getProperty('formKasId');
  if (env === 'prod' && formId) props.setProperty('SYNC_FORM_ID', formId);
  else props.deleteProperty('SYNC_FORM_ID');
  if (!props.getProperty('SYNC_WRITES')) props.setProperty('SYNC_WRITES', 'off');
  // seq starts at the clock (seconds), so it is above any seq a seed import or an earlier copy committed
  if (!props.getProperty('SYNC_SEQ')) props.setProperty('SYNC_SEQ', String(Math.floor(Date.now() / 1000)));
  syncUninstall();
  ScriptApp.newTrigger('syncTick').timeBased().everyMinutes(10).create();
  const triggers = ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction(); });
  Logger.log('Sync %s ready: env=%s sheet=%s writes=%s form=%s triggers=%s', SYNC_VERSION, env, id,
    props.getProperty('SYNC_WRITES'), props.getProperty('SYNC_FORM_ID') ? 'yes' : 'no', triggers.join(','));
  return { env: env, sheet: id, triggers: triggers };
}

/** DEV copy only: detach the copy from the live Form and Drive folders, then set it up. */
function syncSetupDevCopy() {
  const ss = SpreadsheetApp.getActive();
  syncRetired_(ss.getId());
  if (ss.getId() === SYNC_PROD_SHEET) throw new Error('This is the live Sheet. syncSetupDevCopy() only runs in a copy.');
  if (syncLiveDriveRoot_()) {
    throw new Error('Change DRIVE_ROOT in this copy\'s Code.gs first (for example "99_CCC DEV") and set DRIVE_ROOT_ID to \'\', so the copy never writes to live Drive folders.');
  }
  PropertiesService.getDocumentProperties().deleteProperty('formKasId');
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const k = ss.getSheetByName(REKAP).getRange('K9:K208');
    k.setValues(k.getDisplayValues());                                   // no live folder links in the copy
    SpreadsheetApp.flush();
  } finally { lock.releaseLock(); }
  const props = PropertiesService.getScriptProperties();
  props.deleteProperty('SYNC_SEQ');
  props.deleteProperty('SYNC_FORM_ID');
  props.setProperty('SYNC_SHEET_ID', ss.getId());
  return syncSetup();
}

/** Run from the editor to pair again (a new shared secret), for example after the admin's database was reset.
 *  Needs the web app deployed and pairing opened on the admin side. */
function syncPair() {
  const id = PropertiesService.getScriptProperties().getProperty('SYNC_SHEET_ID');
  if (!id || SpreadsheetApp.getActive().getId() !== id) throw new Error('Run syncSetup() (syncSetupDevCopy() in a copy) first.');
  syncPair_(id, id === SYNC_PROD_SHEET ? 'prod' : 'dev');
  Logger.log('Paired: sheet=%s', id);
}

/** Removes the syncTick trigger only (onChangeRab and kasDariForm stay). */
function syncUninstall() {
  ScriptApp.getProjectTriggers().filter(function (t) { return t.getHandlerFunction() === 'syncTick'; })
    .forEach(function (t) { ScriptApp.deleteTrigger(t); });
}

/** Run from the editor (or op `selftest`). Logs and returns a report; changes nothing. */
function syncSelfTest() {
  const id = PropertiesService.getScriptProperties().getProperty('SYNC_SHEET_ID') || SpreadsheetApp.getActive().getId();
  const report = api_selftest(syncCtx_(id), {});
  Logger.log(JSON.stringify(report, null, 2));
  return report;
}

/** Run from the editor: the admin may write to this Sheet (Script Property SYNC_WRITES). */
function syncWritesOn() {
  PropertiesService.getScriptProperties().setProperty('SYNC_WRITES', 'on');
  Logger.log('Writes from the admin: on');
}

/** Run from the editor: pause the admin's writes to this Sheet. */
function syncWritesOff() {
  PropertiesService.getScriptProperties().setProperty('SYNC_WRITES', 'off');
  Logger.log('Writes from the admin: off');
}

/** Run from the editor: adds the ALOKASI DANA block to the template and to every v2 RAB tab that doesn't have it yet.
 *  A tab whose target rows aren't empty is left alone and named in the log. Changes nothing else. */
function syncAlokasiSetup() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const report = SpreadsheetApp.getActive().getSheets().filter(function (sh) {
      const n = sh.getName();
      return (n === TEMPLATE || SYNC_TAB_RE.test(n)) && String(sh.getRange('I13').getDisplayValue()).trim().toUpperCase() === 'NO. URUT INVOICE';
    }).map(function (sh) { return sh.getName() + ': ' + syncAlokasiTab_(sh); });
    SpreadsheetApp.flush();
    Logger.log(report.join('\n'));
    return report;
  } finally { lock.releaseLock(); }
}

function syncAlokasiTab_(sh) {
  const labels = sh.getRange(20, 9, 41, 1).getDisplayValues().map(function (r) { return String(r[0]).trim().toUpperCase(); });
  const at = function (label, prefix) {
    for (let i = 0; i < labels.length; i++) if (labels[i] === label || (prefix && labels[i].indexOf(label) === 0)) return 20 + i;
    return 0;
  };
  if (at('ALOKASI DANA')) return 'already there';
  const src = { head: at('RINGKASAN INTERNAL'), total: at('TOTAL BIAYA KELUAR'), item: at('OMSET'), input: at('PPH 23', true) };
  const end = at('ALAT BELUM DIKUNCI');
  if (!src.head || !src.total || !src.item || !src.input || !end) return 'skipped, the internal summary is not complete';
  const top = end + 2, n = SYNC_ALOKASI.length + 1;
  if (top + n - 1 > 60) return 'skipped, no room above row 60';
  const area = sh.getRange(top, 9, n, 5);
  const used = area.getValues().some(function (r) { return r.some(function (v) { return v !== ''; }); }) ||
    area.getFormulas().some(function (r) { return r.some(function (f) { return f; }); }) || area.getMergedRanges().length > 0;
  if (used) return 'skipped, ' + area.getA1Notation() + ' is not empty';

  const rows = { OMSET: src.item, COST: src.total };
  SYNC_ALOKASI_ROWS.forEach(function (k, i) { rows[k] = top + 1 + i; });
  const fill = function (f) { return f.replace(/\{([A-Z]+)\}/g, function (_, k) { return rows[k]; }); };
  const fmt = function (from, to) {
    sh.getRange(from, 9, 1, 5).copyTo(sh.getRange(to, 9, 1, 5), SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
  };
  fmt(src.head, top);
  sh.getRange(top, 9, 1, 5).setValues([['ALOKASI DANA', '%', '', 'NOMINAL', '']]);
  SYNC_ALOKASI.forEach(function (d, i) {
    const r = top + 1 + i;
    fmt(src[d[4]], r);
    sh.getRange(r, 9).setValue(d[1]);
    if (typeof d[2] === 'number') sh.getRange(r, 10).setValue(d[2]);
    else if (d[2]) sh.getRange(r, 10).setFormula(fill(d[2]));
    sh.getRange(r, 12).setFormula(fill(d[3]));
  });
  sh.getRange(top + 1, 10, SYNC_ALOKASI.length, 1).setNumberFormat('0%').setHorizontalAlignment('center');
  sh.getRange(rows.NP, 10).setDataValidation(SpreadsheetApp.newDataValidation().requireNumberBetween(0.1, 0.25)
    .setAllowInvalid(false).setHelpText('Net profit 10% sampai 25%.').build());
  const cf = sh.getConditionalFormatRules();
  cf.push(SpreadsheetApp.newConditionalFormatRule().whenNumberLessThan(0).setFontColor('#cc0000')
    .setRanges([sh.getRange(rows.LEFT, 12)]).build());
  sh.setConditionalFormatRules(cf);
  const note = syncProtected_(sh, rows.NP, 10) ? ', but J' + rows.NP + ' is protected so the admin cannot change Net profit' : '';
  return 'added at ' + area.getA1Notation() + note;
}

// =====================================================================================================
// Core
// =====================================================================================================

function syncOps_() {
  return {
    ping: { fn: api_ping },
    snapshot: { fn: api_snapshot },
    rab: { fn: api_rab },
    catalog: { fn: api_catalog },
    scan_docs: { fn: api_scan_docs },
    selftest: { fn: api_selftest },
    formula_fingerprint: { fn: api_formula_fingerprint, devOnly: true },
    project_set: { fn: api_project_set, write: true },
    rab_meta: { fn: api_rab_meta, write: true },
    lock_prices: { fn: api_lock_prices, write: true },
    export_pdf: { fn: api_export_pdf, write: true, after: syncExportAfter_ },
    create_rab: { fn: api_create_rab, write: true, after: syncCreateAfter_ },
    kas_add: { fn: api_kas_add, write: true },
    kas_update: { fn: api_kas_update, write: true },
    kas_delete: { fn: api_kas_delete, write: true },
    client_upsert: { fn: api_client_upsert, write: true },
    crew_upsert: { fn: api_crew_upsert, write: true },
    rab_line_set: { fn: api_rab_line_set, write: true },
    rab_line_add: { fn: api_rab_line_add, write: true },
    rab_line_clear: { fn: api_rab_line_clear, write: true },
    rab_internal: { fn: api_rab_internal, write: true },
  };
}

function syncCtx_(id) {
  syncRetired_(id);
  const ss = SpreadsheetApp.openById(id);
  return { ss: ss, id: id, tz: ss.getSpreadsheetTimeZone(), env: id === SYNC_PROD_SHEET ? 'prod' : 'dev' };
}

function syncAuth_(req) {
  const props = PropertiesService.getScriptProperties();
  const secret = props.getProperty('SYNC_SECRET');
  const id = props.getProperty('SYNC_SHEET_ID');
  if (!secret || !id) throw syncErr_('not_configured', 'Sync is not set up in this Sheet (run syncSetup).');
  if (!req || req.v !== 1) throw syncErr_('invalid', 'Unsupported request version');
  const ts = Number(req.ts);
  if (!isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 300) throw syncErr_('stale', 'Request time is off by more than 5 minutes');
  if (req.sheet !== id) throw syncErr_('wrong_sheet', 'This request is for another Sheet');
  const nonce = String(req.nonce || '');
  if (!SYNC_UUID_RE.test(nonce)) throw syncErr_('invalid', 'Bad nonce');
  const msg = [req.v, req.ts, nonce, req.sheet, req.op, req.key == null ? '' : req.key, req.attempt, req.args].join('\n');
  if (!syncEq_(syncHex_(Utilities.computeHmacSha256Signature(msg, secret, Utilities.Charset.UTF_8)), String(req.sig || '').toLowerCase())) {
    throw syncErr_('bad_sig', 'Bad signature');
  }
  const cache = CacheService.getScriptCache();
  if (cache.get('nonce:' + nonce)) throw syncErr_('replay', 'This request was already used');
  cache.put('nonce:' + nonce, '1', 600);
  let active = null;
  try { active = SpreadsheetApp.getActive(); } catch (err) { active = null; }
  if (active && active.getId() !== id) throw syncErr_('wrong_sheet', 'This script belongs to another Sheet (copied script?)');
  return syncCtx_(id);
}

function syncRun_(ctx, key, attempt, op, args) {
  if (!/^[0-9a-f-]{36}$/.test(String(key))) throw syncErr_('invalid', 'Op id');
  if (PropertiesService.getScriptProperties().getProperty('SYNC_WRITES') !== 'on') throw syncErr_('writes_off', 'Sheet writes are paused');
  const cache = CacheService.getScriptCache();
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) throw syncErr_('busy', 'The Sheet is busy');
  let data;
  try {
    const hit = cache.get('op:' + key);
    if (hit) return JSON.parse(hit);
    const seq = syncNextSeq_();
    data = op.fn(ctx, args, { seq: seq, attempt: attempt, key: key });
    SpreadsheetApp.flush();
    data.seq = seq;
  } finally { lock.releaseLock(); }
  if (op.after) { try { op.after(ctx, args, data); } catch (err) { data.after_error = String(err.message).slice(0, 200); } }
  const s = JSON.stringify(data);
  if (s.length < 90000) cache.put('op:' + key, s, 21600);
  return data;
}

function syncNextSeq_() {                       // call only while holding the script lock
  const p = PropertiesService.getScriptProperties();
  const n = Number(p.getProperty('SYNC_SEQ') || 0) + 1;
  p.setProperty('SYNC_SEQ', String(n));
  return n;
}

// The only function that writes cells. All checks run before the first write; a bad result undoes everything.
// opts: force (skip the expect check), watch (more sheets to guard), skipFormulaRows, check (a function giving '' when
// the block adds up, else what's wrong: run before the write, which is then refused, and after it, which is then
// undone like a formula-guard trip).
function syncWrite_(ctx, writes, opts) {
  opts = opts || {};
  const rekap = ctx.ss.getSheetByName(REKAP);
  const watch = (opts.watch || []).slice();
  writes.forEach(w => { if (watch.indexOf(w.sh) < 0) watch.push(w.sh); });
  if (watch.indexOf(rekap) < 0) watch.push(rekap);
  const before = watch.map(s => ({ h: syncFormulaHash_(s, opts.skipFormulaRows), e: syncErrorCells_(s) }));
  const todo = [], undo = [], noop = [];
  writes.forEach(w => {
    const cell = w.sh.getRange(w.r, w.c);
    if (cell.getFormula()) throw syncErr_('formula_guard', 'Refused: ' + syncA1_(w) + ' holds a formula');
    if (syncProtected_(w.sh, w.r, w.c)) throw syncErr_('formula_guard', 'Refused: ' + syncA1_(w) + ' is protected');
    if (w.spillCheck && syncSpillColumn_(w.sh, w.spillCheck, w.c)) throw syncErr_('formula_guard', 'Refused: ' + syncA1_(w) + ' is filled by a formula');
    const val = syncValue_(w.field, w.v, ctx.tz, w.list, w.type);
    const cur = cell.getValue();
    if (syncSame_(cur, val, ctx.tz)) { noop.push(w.field); return; }                       // retry or already done
    if (!opts.force && w.expect !== undefined && !syncSame_(cur, w.expect, ctx.tz))
      throw syncErr_('conflict', 'Changed in the Sheet: ' + w.field, { field: w.field, sheet_value: syncCell_(cur, ctx.tz), you_saw: w.expect });
    todo.push([cell, val]); undo.push([cell, cur]);
  });
  // a block that already doesn't add up is the Sheet's problem, not this write's: refuse without tripping the guard
  // (needs_sheet: the admin shows this sentence as it is)
  const pre = todo.length && opts.check ? opts.check() : '';
  if (pre) throw syncErr_('needs_sheet', pre + '. Nothing was written: fix that in the Sheet first.');
  todo.forEach(t => t[0].setValue(t[1]));
  SpreadsheetApp.flush();
  const broken = syncBroken_(watch, before, opts.skipFormulaRows) || (todo.length && opts.check ? opts.check() : '');
  if (broken) {
    undo.forEach(u => u[0].setValue(u[1]));
    SpreadsheetApp.flush();
    syncGuardTrip_();
    throw syncGuardErr_(broken);
  }
  return { written: writes.map(w => w.field).filter(f => noop.indexOf(f) < 0), noop: noop };
}

/** Two formula-guard trips within 24 h switch Sheet writes off (Script Property SYNC_WRITES=off). */
function syncGuardTrip_() {
  const p = PropertiesService.getScriptProperties();
  const now = Date.now();
  const trips = String(p.getProperty('SYNC_GUARD_TRIPS') || '').split(',').map(Number)
    .filter(function (t) { return t && now - t < 86400000; });
  trips.push(now);
  p.setProperty('SYNC_GUARD_TRIPS', trips.join(','));
  if (trips.length >= 2) p.setProperty('SYNC_WRITES', 'off');
}

/** Post-checks for writes that don't go through syncWrite_ (new Kas row, new tab): formula hash + new errors.
 *  The check returns what broke, '' when nothing did. */
function syncWatch_(sheets) {
  const before = sheets.map(s => ({ h: syncFormulaHash_(s), e: syncErrorCells_(s) }));
  return function () { return syncBroken_(sheets, before); };
}

/** "Crew: formulas changed; Rekap Project: new errors V9 V10" for the sheets that changed since `before`, else ''. */
function syncBroken_(sheets, before, skipRows) {
  return sheets.map(function (s, i) {
    const changed = syncFormulaHash_(s, skipRows) !== before[i].h;
    const errors = syncNewErrors_(before[i].e, syncErrorCells_(s));
    if (!changed && !errors.length) return '';
    const what = [];
    if (changed) what.push('formulas changed');
    if (errors.length) what.push('new errors ' + errors.slice(0, 5).join(' '));
    return s.getName() + ': ' + what.join(', ');
  }).filter(String).join('; ');
}

/** The guard's error; `broken` reaches the outbox (current) and the execution log. */
function syncGuardErr_(broken) {
  console.warn('Formula guard: ' + broken);
  return syncErr_('formula_guard', 'That change would have broken a formula in the Sheet, so nothing was written.', { broken: broken });
}

function syncSend_(msg) {
  const url = syncBridgeUrl_(msg.env);
  const secret = PropertiesService.getScriptProperties().getProperty('SYNC_SECRET');
  if (!secret) throw new Error('SYNC_SECRET not set (run syncSetup)');
  const body = JSON.stringify(msg);
  const t = String(Math.floor(Date.now() / 1000));
  const sig = syncHex_(Utilities.computeHmacSha256Signature(t + '.' + body, secret, Utilities.Charset.UTF_8));
  const res = UrlFetchApp.fetch(url, {
    method: 'post', contentType: 'application/json', payload: body, muteHttpExceptions: true,
    headers: { 'X-CCC-Time': t, 'X-CCC-Sig': sig },
  });
  const code = res.getResponseCode();
  if (code !== 200) throw new Error('bridge ' + code + ': ' + res.getContentText().slice(0, 200));
  return JSON.parse(res.getContentText() || '{}');
}

function syncBridgeUrl_(env) {
  const url = PropertiesService.getScriptProperties().getProperty('SYNC_BRIDGE_URL') || SYNC_BRIDGE[env] || '';
  if (!/^https:\/\/[a-z0-9]{20}\.supabase\.co\/functions\/v1\/sheets-bridge$/.test(url)) {
    throw new Error('SYNC_BRIDGE_URL must be https://<ref>.supabase.co/functions/v1/sheets-bridge');
  }
  return url;
}

/** Gets the shared secret from the bridge without anyone typing it. Sends a random r; the bridge asks this script's
 *  deployed web app for SHA-256(r) (op pair_check), so only this script can pair, then answers with a new secret. */
/** True while Code.gs can still reach the live Drive tree: the live DRIVE_ROOT name, or any DRIVE_ROOT_ID (only
 *  the live Sheet finds its root by id). A DEV copy needs another DRIVE_ROOT and DRIVE_ROOT_ID = ''. */
function syncLiveDriveRoot_() {
  return DRIVE_ROOT === SYNC_LIVE_DRIVE_ROOT || (typeof DRIVE_ROOT_ID === 'string' && DRIVE_ROOT_ID !== '');
}

/** Code.gs's Drive root without creating it: by DRIVE_ROOT_ID when Code.gs has one, else by name. */
function syncDriveRoot_() {
  if (typeof DRIVE_ROOT_ID === 'string' && DRIVE_ROOT_ID) return DriveApp.getFolderById(DRIVE_ROOT_ID);
  const it = DriveApp.getFoldersByName(DRIVE_ROOT);
  return it.hasNext() ? it.next() : null;
}

function syncPair_(id, env) {
  const props = PropertiesService.getScriptProperties();
  const r = syncHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,
    Utilities.getUuid() + Utilities.getUuid() + Date.now(), Utilities.Charset.UTF_8));
  props.setProperty('SYNC_PAIR', r);
  props.setProperty('SYNC_PAIR_UNTIL', String(Date.now() + 120000));
  try {
    const res = UrlFetchApp.fetch(syncBridgeUrl_(env), {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      payload: JSON.stringify({ kind: 'pair', v: 1, sheet: id, env: env, r: r }),
    });
    let body = {};
    try { body = JSON.parse(res.getContentText() || '{}'); } catch (err) { body = {}; }
    if (res.getResponseCode() !== 200 || !/^[0-9a-f]{64}$/.test(String(body.secret || ''))) {
      throw new Error('Pairing with the admin failed (' + res.getResponseCode() + '): '
        + String(body.error || res.getContentText()).slice(0, 200));
    }
    props.setProperty('SYNC_SECRET', body.secret);
  } finally {
    props.deleteProperty('SYNC_PAIR');
    props.deleteProperty('SYNC_PAIR_UNTIL');
  }
}

/** Op pair_check (unsigned): only while syncPair_ waits for the bridge, the hash of its r; refused otherwise. */
function syncPairCheck_() {
  const props = PropertiesService.getScriptProperties();
  const r = props.getProperty('SYNC_PAIR') || '';
  if (!r || Number(props.getProperty('SYNC_PAIR_UNTIL') || 0) < Date.now()) throw syncErr_('not_pairing', 'No pairing in progress');
  return { h: syncHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, r, Utilities.Charset.UTF_8)) };
}

// =====================================================================================================
// Guards
// =====================================================================================================

function syncHead_(sh, row, col, want, label) {
  const got = sh.getRange(row, col, 1, want.length).getDisplayValues()[0].map(function (x) { return String(x).trim(); });
  for (let i = 0; i < want.length; i++) {
    if (got[i] !== want[i]) {
      throw syncErr_('layout', label + ' header changed at ' + syncColName_(col + i) + row + ': expected "' + want[i]
        + '", found "' + got[i] + '". Sync paused for ' + label + '.');
    }
  }
}

function syncNoFormula_(range) {
  const f = range.getFormulas();
  for (let i = 0; i < f.length; i++) for (let j = 0; j < f[i].length; j++) {
    if (f[i][j]) throw syncErr_('formula_guard', 'Refused: ' + range.getSheet().getName() + '!' + syncColName_(range.getColumn() + j) + (range.getRow() + i) + ' holds a formula');
  }
}

function syncProtected_(sh, r, c) {
  const inside = function (rg) {
    return r >= rg.getRow() && r <= rg.getLastRow() && c >= rg.getColumn() && c <= rg.getLastColumn();
  };
  const ranges = sh.getProtections(SpreadsheetApp.ProtectionType.RANGE);
  for (let i = 0; i < ranges.length; i++) if (inside(ranges[i].getRange())) return true;
  const whole = sh.getProtections(SpreadsheetApp.ProtectionType.SHEET);
  for (let i = 0; i < whole.length; i++) {
    if (!whole[i].getUnprotectedRanges().some(inside)) return true;
  }
  return false;
}

/** In a RAB breakdown section, a column holding a formula on the section's first item row is a spill column. */
function syncSpillColumn_(sh, section, c) {
  return !!sh.getRange(section.first, c).getFormula();
}

/** Digest of the formula cells (position + formula). Independent of the data range size, which grows when a
 *  new row is written (hashing the whole getFormulas() grid would trip the guard on every new Client row). */
function syncFormulaHash_(sh, skipRows) {
  // The whole grid, not getDataRange(): the data range can grow during a write, and a formula it then takes in
  // (Crew G4:H4 above an empty list) would read as a changed formula.
  const f = sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns()).getFormulas();
  const out = [];
  for (let i = 0; i < f.length; i++) {
    if (skipRows && skipRows.indexOf(i + 1) >= 0) continue;
    for (let j = 0; j < f[i].length; j++) if (f[i][j]) out.push((i + 1) + ',' + (j + 1) + '=' + f[i][j]);
  }
  return syncDigest_(out.join('\n'));
}

function syncErrorCells_(sh) {
  const v = sh.getDataRange().getValues();
  const out = [];
  for (let i = 0; i < v.length; i++) for (let j = 0; j < v[i].length; j++) {
    if (typeof v[i][j] === 'string' && SYNC_ERR_RE.test(v[i][j])) out.push(syncColName_(j + 1) + (i + 1));
  }
  return out;
}

function syncNewErrors_(before, after) {
  const seen = {};
  before.forEach(function (a) { seen[a] = true; });
  return after.filter(function (a) { return !seen[a]; });
}

// =====================================================================================================
// Helpers
// =====================================================================================================

/** The live Sheet before 2026-11-04 stays in the personal Drive as an archive and never syncs, as prod or as dev. */
function syncRetired_(id) {
  if (SYNC_RETIRED_SHEETS.indexOf(id) >= 0) {
    throw syncErr_('retired', 'This Sheet is the archived live Sheet from before 2026-11-04. Sync runs in its copy in hello@ (Shared Drive "CCC").');
  }
}

function syncErr_(code, message, current) {
  const e = new Error(message);
  e.code = code;
  if (current !== undefined) e.current = current;
  return e;
}

function syncHex_(bytes) {
  return bytes.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

function syncEq_(a, b) {                         // constant time for equal lengths
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

function syncDigest_(o) {
  return syncHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, typeof o === 'string' ? o : JSON.stringify(o), Utilities.Charset.UTF_8));
}

function syncColName_(c) {
  let s = '';
  for (; c > 0; c = Math.floor((c - 1) / 26)) s = String.fromCharCode(65 + ((c - 1) % 26)) + s;
  return s;
}

function syncA1_(w) {
  return w.sh.getName() + '!' + syncColName_(w.c) + w.r;
}

/** A cell as the snapshot carries it: number raw, Date → "yyyy-MM-dd", error → {err}, '' → null. */
function syncCell_(v, tz) {
  if (v === '' || v === null || v === undefined) return null;
  if (v instanceof Date) return Utilities.formatDate(v, tz, 'yyyy-MM-dd');
  if (typeof v === 'string' && SYNC_ERR_RE.test(v)) return { err: v };
  return v;
}

/** Normalised for comparisons: dates → ISO, numbers → numbers, text trimmed (a leading ' dropped), '' → null. */
function syncNorm_(v, tz) {
  if (v === '' || v === null || v === undefined) return null;
  if (v instanceof Date) return Utilities.formatDate(v, tz, 'yyyy-MM-dd');
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  let s = String(v).trim();
  if (s.charAt(0) === "'") s = s.slice(1).trim();
  if (s === '') return null;
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return s;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (m) return m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
  return s;
}

function syncSame_(a, b, tz) {
  const x = syncNorm_(a, tz), y = syncNorm_(b, tz);
  if (typeof x === 'number' && typeof y === 'string' && /^-?\d+(\.\d+)?$/.test(y)) return x === Number(y);
  if (typeof y === 'number' && typeof x === 'string' && /^-?\d+(\.\d+)?$/.test(x)) return y === Number(x);
  return x === y;
}

/** The value to write, typed and validated. null / '' clears the cell. */
function syncValue_(field, v, tz, list, type) {
  if (v === null || v === undefined || v === '') return '';
  switch (type || 'text') {
    case 'money':
      if (typeof v !== 'number' || v !== Math.round(v) || v < 0 || v > 1e12) throw syncErr_('invalid', field + ' must be a whole amount in Rupiah');
      return v;
    case 'int':
      if (typeof v !== 'number' || v !== Math.round(v) || v < 0 || v > 1e6) throw syncErr_('invalid', field + ' must be a whole number');
      return v;
    case 'num':                                                            // RAB qty and days: up to 2 decimals
      if (typeof v !== 'number' || !(v >= 0 && v <= 1e6) || Math.abs(Math.round(v * 100) - v * 100) > 1e-6) {
        throw syncErr_('invalid', field + ' must be a number with at most 2 decimals');
      }
      return v;
    case 'n30':                                                            // gear qty and days: the Sheet's list 1 to 30
      if (typeof v !== 'number' || v !== Math.round(v) || v < 1 || v > 30) throw syncErr_('invalid', field + ' must be a whole number from 1 to 30');
      return v;
    case 'pct':
      if (typeof v !== 'number' || !(v >= 0 && v <= 1)) throw syncErr_('invalid', field + ' must be between 0% and 100%');
      return v;
    case 'date':
    case 'date_text': {
      const s = String(v);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw syncErr_('invalid', field + ' must be a date');
      const d = Utilities.parseDate(s, tz, 'yyyy-MM-dd');
      if (Utilities.formatDate(d, tz, 'yyyy-MM-dd') !== s) throw syncErr_('invalid', field + ' is not a real date');
      return type === 'date' ? d : Utilities.formatDate(d, tz, 'dd/MM/yyyy');   // date_text: like todayText_ (in_ID parses it)
    }
    case 'list':
      if (!list || list.indexOf(String(v)) < 0) throw syncErr_('invalid', field + ' must be one of: ' + (list || []).join(', '));
      return String(v);
    case 'phone': {
      const s = String(v).trim();
      if (s.length > 60) throw syncErr_('invalid', field + ' is too long');
      return /^[0-9+=\-@]/.test(s) ? "'" + s : s;                        // keep the leading 0 / + as text
    }
    default: {
      const s = String(v).trim();
      if (s.length > 1000) throw syncErr_('invalid', field + ' is longer than 1000 characters');
      return /^[=+\-@]/.test(s) ? "'" + s : s;                            // never a formula
    }
  }
}

/** Tab name rules: ' → ’ (INDIRECT quoting), no [ ] * ? / \ :, ≤ max. */
function syncName_(s, max) {
  return String(s).replace(/'/g, '’').replace(/[\[\]*?\/\\:]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max || 100).trim();
}

function syncLink_(rt) {
  if (!rt) return null;
  const whole = rt.getLinkUrl();
  if (whole) return whole;
  const runs = rt.getRuns();
  for (let i = 0; i < runs.length; i++) if (runs[i].getLinkUrl()) return runs[i].getLinkUrl();
  return null;
}

function syncSheetByGid_(ctx, gid) {
  const n = Number(gid);
  const sh = ctx.ss.getSheets().filter(function (s) { return s.getSheetId() === n; })[0];
  if (!sh || !SYNC_TAB_RE.test(sh.getName())) throw syncErr_('not_found', "This project's tab isn't in the Sheet anymore");
  return sh;
}

function syncTabsList_(ctx) {
  return ctx.ss.getSheets().filter(function (s) { return SYNC_TAB_RE.test(s.getName()); })
    .map(function (s) { return { name: s.getName(), gid: s.getSheetId(), sh: s }; });
}

function syncPushErrors_(errors, section, sheet, values, rowOffset, colOffset, limit) {
  let n = 0;
  for (let i = 0; i < values.length; i++) for (let j = 0; j < values[i].length; j++) {
    const v = values[i][j];
    if (typeof v === 'string' && SYNC_ERR_RE.test(v)) {
      if (n++ >= (limit || 50)) return;
      errors.push({ section: section, sheet: sheet, cell: syncColName_(colOffset + j) + (rowOffset + i), value: v.slice(0, 20) });
    }
  }
}

// =====================================================================================================
// Readers
// =====================================================================================================

function api_ping(ctx, a) {
  if (ctx.env === 'dev' && a && a.sleep_ms) Utilities.sleep(Math.min(Number(a.sleep_ms) || 0, 30000));
  return { sheet: ctx.id, env: ctx.env, tz: ctx.tz, version: SYNC_VERSION,
    seq: Number(PropertiesService.getScriptProperties().getProperty('SYNC_SEQ') || 0) };
}

/** DESIGN.md §3.4.3-3.4.4. The whole read happens inside the script lock with a settled re-read. */
function api_snapshot(ctx, a) {
  a = a || {};
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return { skipped: 'busy' };
  try {
    const have = a.have || {};
    const seq = syncNextSeq_();
    const index = syncTabsIndex_(ctx, a.known_gids || []);
    const rekapSh = ctx.ss.getSheetByName(REKAP);
    const labels = rekapSh.getRange(4, 6, 1, 5).getDisplayValues()[0].map(function (x) { return String(x).trim(); }).filter(String);
    const out = {
      meta: {
        sheet: ctx.id, env: ctx.env, tz: ctx.tz, version: SYNC_VERSION, seq: seq, read_at: new Date().toISOString(),
        tabs: index.tabs, unknown_tabs: index.unknown,
        labels: { status: labels, kas_categories: (typeof KAS_KATEGORI !== 'undefined' ? KAS_KATEGORI : []).slice() },
        tabs_mode: Array.isArray(a.tabs) ? 'list' : (a.tabs || 'none'),
      },
      tabs: [], scanned: [], errors: [], form_missing: null,
    };
    const readers = {
      rekap: function () { return syncRekapRead_(ctx); },
      kas: function () { return syncKasRead_(ctx); },
      client: function () { return syncTableRead_(ctx, 'client'); },
      crew: function () { return syncTableRead_(ctx, 'crew'); },
      keuangan: function () { return syncKeuanganRead_(ctx); },
    };
    const first = {};
    Object.keys(readers).forEach(function (k) {
      try { first[k] = readers[k](); } catch (err) {
        if (err.code !== 'layout') throw err;
        out[k] = { error: 'layout', message: String(err.message).slice(0, 300) };
      }
    });

    // tabs to read: 'active' = Rekap status Draft/Dikirim/Deal, 'all', or a list of gids
    let want = [];
    if (a.tabs === 'all') want = index.tabs.map(function (t) { return t.gid; });
    else if (Array.isArray(a.tabs)) want = a.tabs.map(Number);
    else if (a.tabs === 'active' && first.rekap) {
      const active = {};
      first.rekap.data.rows.forEach(function (r) {
        if (['Draft', 'Dikirim', 'Deal'].indexOf(String(r.status)) >= 0 && r.tab_name) active[String(r.tab_name).trim()] = true;
      });
      want = index.tabs.filter(function (t) { return active[t.name.trim()]; }).map(function (t) { return t.gid; });
    }
    const tabFirst = {};
    index.tabs.filter(function (t) { return want.indexOf(t.gid) >= 0; }).slice(0, 40).forEach(function (t) {
      tabFirst[t.gid] = { name: t.name, read: syncRabRead_(index.sheets[t.gid], ctx.tz) };
    });

    // settled read: whatever changed is read again after 1.5 s; a difference means someone is mid-edit
    const changed = Object.keys(first).filter(function (k) { return first[k].digest !== have[k]; });
    const tabChanged = Object.keys(tabFirst).filter(function (g) { return tabFirst[g].read.digest !== have['tab:' + g]; });
    if (changed.length || tabChanged.length) Utilities.sleep(1500);
    const unsettled = {};
    changed.forEach(function (k) {
      let again = null;
      try { again = readers[k](); } catch (err) { again = null; }
      if (!again || again.digest !== first[k].digest) unsettled[k] = true;
    });
    tabChanged.forEach(function (g) {
      const again = syncRabRead_(index.sheets[g], ctx.tz);
      if (again.digest !== tabFirst[g].read.digest) unsettled['tab:' + g] = true;
    });

    Object.keys(first).forEach(function (k) {
      const r = first[k];
      out.scanned.push(k);
      Array.prototype.push.apply(out.errors, r.errors);
      if (unsettled[k]) out[k] = { digest: r.digest, unsettled: true };
      else if (r.digest === have[k]) out[k] = { digest: r.digest, same: true };
      else out[k] = { digest: r.digest, data: r.data };
    });
    Object.keys(tabFirst).forEach(function (g) {
      const t = tabFirst[g], r = t.read, gid = Number(g), key = 'tab:' + g;
      if (r.error) { out.tabs.push({ gid: gid, name: t.name, error: 'layout', message: r.error }); return; }
      out.scanned.push(key);
      Array.prototype.push.apply(out.errors, r.errors.map(function (e) { return Object.assign({ section: key, sheet: t.name }, e); }));
      if (unsettled[key]) out.tabs.push({ gid: gid, name: t.name, unsettled: true });
      else if (r.digest === have[key]) out.tabs.push({ gid: gid, name: t.name, layout: r.layout, digest: r.digest, same: true });
      else out.tabs.push({ gid: gid, name: t.name, layout: r.layout, digest: r.digest, data: r.data });
    });
    out.errors = out.errors.slice(0, 200);
    if (a.form_check && first.kas) {
      const formId = PropertiesService.getScriptProperties().getProperty('SYNC_FORM_ID');
      if (formId && ctx.env === 'prod') out.form_missing = syncFormCheck_(ctx, formId, first.kas.data.rows);
    }
    return out;
  } finally { lock.releaseLock(); }
}

function syncTabsIndex_(ctx, knownGids) {
  const known = {};
  (knownGids || []).forEach(function (g) { known[Number(g)] = true; });
  const tabs = [], unknown = [], sheets = {};
  syncTabsList_(ctx).forEach(function (t) {
    tabs.push({ name: t.name, gid: t.gid });
    sheets[t.gid] = t.sh;
    if (!known[t.gid]) {
      const md = t.sh.getDeveloperMetadata().filter(function (m) { return m.getKey() === 'ccc_project_id'; })[0];
      unknown.push({ gid: t.gid, ccc_project_id: md ? md.getValue() : null });
    }
  });
  return { tabs: tabs, unknown: unknown, sheets: sheets };
}

/** One Rekap row (B..Z + the B/K links) as the snapshot carries it. */
function syncRekapRowObj_(row, vals, bLink, kLink, tz) {
  const o = { row: row, b_link: bLink || null, drive_folder_url: kLink || null };
  Object.keys(SYNC_REKAP_COLS).forEach(function (c) { o[SYNC_REKAP_COLS[c]] = syncCell_(vals[Number(c) - 1], tz); });
  return o;
}

function syncRekapRead_(ctx, onlyRow) {
  const sh = ctx.ss.getSheetByName(REKAP);
  syncHead_(sh, 8, 1, SYNC_HEAD.rekap, 'Rekap Project');
  if (onlyRow) {
    const v = sh.getRange(onlyRow, 1, 1, 26).getValues()[0];
    return syncRekapRowObj_(onlyRow, v, syncLink_(sh.getRange(onlyRow, 2).getRichTextValue()),
      syncLink_(sh.getRange(onlyRow, 11).getRichTextValue()), ctx.tz);
  }
  const top = sh.getRange(4, 1, 2, 15).getValues();
  const v = sh.getRange(9, 1, 200, 26).getValues();
  const b = sh.getRange(9, 2, 200, 1).getRichTextValues();
  const k = sh.getRange(9, 11, 200, 1).getRichTextValues();
  const rows = [], errors = [];
  for (let i = 0; i < 200; i++) {
    if (String(v[i][1]).trim() === '') continue;
    rows.push(syncRekapRowObj_(9 + i, v[i], syncLink_(b[i][0]), syncLink_(k[i][0]), ctx.tz));
    syncPushErrors_(errors, 'rekap', REKAP, [v[i]], 9 + i, 1, 30);
  }
  syncPushErrors_(errors, 'rekap', REKAP, top.map(function (r) { return r.slice(1); }), 4, 2, 20);
  const counts = {};
  for (let j = 5; j <= 9; j++) { const label = String(top[0][j]).trim(); if (label) counts[label] = syncCell_(top[1][j], ctx.tz); }
  const data = {
    summary: {
      count: syncCell_(top[1][1], ctx.tz), next_invoice: syncCell_(top[1][2], ctx.tz), deal_value: syncCell_(top[1][3], ctx.tz),
      status_counts: counts, tempo_days: syncCell_(top[1][11], ctx.tz), receivable: syncCell_(top[1][12], ctx.tz),
      profit_deal: syncCell_(top[1][13], ctx.tz), seq_seed: syncCell_(top[1][14], ctx.tz),
    },
    rows: rows,
  };
  return { data: data, digest: syncDigest_(data), errors: errors };
}

function syncKasRowObj_(row, vals, tz) {
  const o = { row: row };
  SYNC_KAS_KEYS.forEach(function (key, i) { o[key] = syncCell_(vals[i], tz); });
  return o;
}

/** Kas A:K rows 9..last (+ B5:G5), or one row. */
function syncKasRead_(ctx, onlyRow) {
  const k = ctx.ss.getSheetByName('Kas');
  syncHead_(k, 8, 1, SYNC_HEAD.kas, 'Kas');
  if (onlyRow) return syncKasRowObj_(onlyRow, k.getRange(onlyRow, 1, 1, 11).getValues()[0], ctx.tz);
  const top = k.getRange(5, 2, 1, 6).getValues()[0];
  const last = k.getLastRow();
  const v = last >= 9 ? k.getRange(9, 1, last - 8, 11).getValues() : [];
  const rows = [], errors = [];
  v.forEach(function (r, i) {
    if (r.every(function (x) { return x === ''; })) return;
    rows.push(syncKasRowObj_(9 + i, r, ctx.tz));
  });
  syncPushErrors_(errors, 'kas', 'Kas', v, 9, 1, 30);
  syncPushErrors_(errors, 'kas', 'Kas', [top], 5, 2, 10);
  const data = {
    summary: {
      start_date: syncCell_(top[0], ctx.tz), opening: syncCell_(top[1], ctx.tz), in: syncCell_(top[2], ctx.tz),
      out: syncCell_(top[3], ctx.tz), cash: syncCell_(top[4], ctx.tz), owed: syncCell_(top[5], ctx.tz),
    },
    rows: rows,
  };
  return { data: data, digest: syncDigest_(data), errors: errors };
}

/** Client / Crew A4:H200: display values for text and phone, raw values for numbers. */
function syncTableRead_(ctx, name, onlyRow) {
  const sh = ctx.ss.getSheetByName(name === 'client' ? CLIENT : 'Crew');
  syncHead_(sh, 3, 1, SYNC_HEAD[name], name === 'client' ? 'Client' : 'Crew');
  const cols = name === 'client' ? SYNC_CLIENT_COLS : SYNC_CREW_COLS;
  const raw = name === 'crew' ? { rate: true, unpaid: true, paid_this_year: true } : {};
  const first = onlyRow || 4, n = onlyRow ? 1 : 197;
  const rg = sh.getRange(first, 1, n, 8);
  const v = rg.getValues(), d = rg.getDisplayValues();
  const keyCols = name === 'client' ? 8 : 6;                       // Crew G:H are formulas (spill), not content
  const rows = [], errors = [];
  for (let i = 0; i < n; i++) {
    if (!onlyRow && d[i].slice(0, keyCols).every(function (x) { return String(x).trim() === ''; })) continue;
    const o = { row: first + i };
    Object.keys(cols).forEach(function (key) {
      const c = cols[key] - 1;
      o[key] = raw[key] ? syncCell_(v[i][c], ctx.tz) : (SYNC_ERR_RE.test(String(v[i][c])) ? { err: String(v[i][c]) } : (d[i][c] === '' ? null : d[i][c]));
    });
    rows.push(o);
    syncPushErrors_(errors, name, sh.getName(), [v[i]], first + i, 1, 30);
  }
  if (onlyRow) return rows[0];
  const data = { rows: rows };
  return { data: data, digest: syncDigest_(data), errors: errors };
}

/** Keuangan (read-only): B5, C5:L5, months A8:K19 + total row 20, unpaid B25:I60, per-year M25:T60.
 *  Anchors checked against the live Sheet on 2026-11-04: B4 TAHUN, C4 "OMSET (Rp)", B7 Bulan, B23, M23. */
function syncKeuanganRead_(ctx) {
  const sh = ctx.ss.getSheetByName('Keuangan');
  const v = sh.getRange(1, 1, 60, 20).getValues();
  const d = sh.getRange(1, 1, 60, 20).getDisplayValues();
  const lab = function (r, c) { return String(d[r - 1][c - 1]).trim().toUpperCase(); };
  const want = [[4, 2, 'TAHUN'], [4, 3, 'OMSET'], [7, 2, 'BULAN'], [23, 2, 'TAGIHAN BELUM LUNAS'], [23, 13, 'RINGKASAN PER TAHUN']];
  want.forEach(function (w) {
    if (lab(w[0], w[1]).indexOf(w[2]) !== 0) {                       // C4 reads "OMSET (Rp)"
      throw syncErr_('layout', 'Keuangan layout changed at ' + syncColName_(w[1]) + w[0] + ': expected "' + w[2] + '". Sync paused for Keuangan.');
    }
  });
  const c = function (r, col) { return syncCell_(v[r - 1][col - 1], ctx.tz); };
  const line = function (r) {
    return { projects: c(r, 3), omset: c(r, 4), cost: c(r, 5), profit: c(r, 6), margin: c(r, 7), money_in: c(r, 8),
      receivable: c(r, 9), operational: c(r, 10), net_profit: c(r, 11) };
  };
  const errors = [];
  const isErrStr = function (x) { return typeof x === 'string' && SYNC_ERR_RE.test(x); };
  // an empty FILTER shows #N/A in its first cell: that means "no rows", not a broken formula
  const emptyFilter = function (r, c1, c2) {
    return isErrStr(v[r - 1][c1 - 1]) && v[r - 1].slice(c1, c2).every(function (x) { return x === ''; })
      && (r >= 60 || v[r].slice(c1 - 1, c2).every(function (x) { return x === ''; }));
  };
  const unpaidEmpty = emptyFilter(25, 2, 9), yearsEmpty = emptyFilter(25, 13, 20);
  syncPushErrors_(errors, 'keuangan', 'Keuangan', v.slice(3, 20).map(function (r) { return r.slice(0, 12); }), 4, 1, 30);
  if (!unpaidEmpty) syncPushErrors_(errors, 'keuangan', 'Keuangan', v.slice(24, 60).map(function (r) { return r.slice(1, 9); }), 25, 2, 20);
  if (!yearsEmpty) syncPushErrors_(errors, 'keuangan', 'Keuangan', v.slice(24, 60).map(function (r) { return r.slice(12, 20); }), 25, 13, 20);
  const months = [];
  for (let r = 8; r <= 19; r++) months.push(Object.assign({ month: Number(v[r - 1][0]) || (r - 7), label: c(r, 2) }, line(r)));
  const unpaid = [], years = [];
  for (let r = 25; r <= 60; r++) {
    // a message row ("Tidak ada tagihan terbuka" in B, C:I empty) is not a bill
    if (!unpaidEmpty && v[r - 1].slice(2, 9).some(function (x) { return x !== ''; })) {
      unpaid.push({ invoice_no: c(r, 2), client: c(r, 3), project: c(r, 4), grand_total: c(r, 5), paid: c(r, 6),
        outstanding: c(r, 7), due: c(r, 8), pay_status: c(r, 9) });
    }
    if (!yearsEmpty && v[r - 1][12] !== '') {
      years.push({ year: c(r, 13), projects: c(r, 14), omset: c(r, 15), cost: c(r, 16), profit: c(r, 17), margin: c(r, 18),
        money_in: c(r, 19), net_profit: c(r, 20) });
    }
  }
  const data = {
    year: c(5, 2), omset: c(5, 3), cost: c(5, 4), profit: c(5, 5), margin: c(5, 6), money_in: c(5, 7), receivable_all: c(5, 8),
    operational: c(5, 9), net_profit: c(5, 10), cash: c(5, 11), owed: c(5, 12),
    months: months, total: line(20), unpaid: unpaid, years: years,
  };
  return { data: data, digest: syncDigest_(data), errors: errors };
}

/**
 * Parse one RAB tab. v2 (I13 = NO. URUT INVOICE) in full, v1 (old 8-9 column tabs) minimally.
 * Returns {layout, digest, data, errors} or {error: message} when an anchor is missing.
 */
function syncRabRead_(sh, tz) {
  const last = Math.max(sh.getLastRow(), 1);
  const ncol = Math.min(sh.getMaxColumns(), 14);
  const raw = sh.getRange(1, 1, last, ncol).getValues();
  const at = function (r, c) { return r >= 1 && r <= last && c <= ncol ? raw[r - 1][c - 1] : ''; };
  const S = function (x) { return String(x === null || x === undefined ? '' : x).trim(); };
  const U = function (r, c) { return S(at(r, c)).toUpperCase(); };
  const cell = function (r, c) { return r ? syncCell_(at(r, c), tz) : null; };
  const find = function (c, label, from, to, prefix) {
    for (let r = from; r <= Math.min(to, last); r++) {
      const u = U(r, c);
      if (u === label || (prefix && u.indexOf(label) === 0)) return r;
    }
    return 0;
  };
  const digest = syncDigest_(raw.map(function (row) { return row.map(function (x) { return syncCell_(x, tz); }); }));
  const errors = [];
  syncPushErrors_(errors, null, null, raw, 1, 1, 50);
  errors.forEach(function (e) { delete e.section; delete e.sheet; });
  const invRow = find(4, 'NO. INVOICE', 1, 40);

  if (U(13, 9) !== 'NO. URUT INVOICE') {
    const gt = find(6, 'GRAND TOTAL', 1, last);
    if (ncol <= 9 && invRow && gt) {
      return { layout: 'v1', digest: digest, errors: errors,
        data: { layout: 'v1', meta: { title: cell(8, 8), client_label: cell(11, 6), invoice_no: cell(invRow, 6) }, grand_total: cell(gt, 8) } };
    }
    return { error: 'Unknown RAB layout (no "NO. URUT INVOICE" in I13 and no v1 anchors). Sync paused for this tab.' };
  }

  const sub = find(6, 'SUB TOTAL', 20, 45), disc = find(6, 'DISKON', 20, 45, true), ppn = find(6, 'PPN', 20, 45, true);
  const gt = find(6, 'GRAND TOTAL', 20, 45), dp = find(6, 'DP', 20, 45), fin = find(6, 'PELUNASAN', 20, 45);
  const iRow = function (label, prefix) { return find(9, label, 20, 60, prefix); };
  const other = iRow('BIAYA LAIN', true), cost = iRow('TOTAL BIAYA KELUAR'), omset = iRow('OMSET'), profit = iRow('PROFIT');
  const margin = iRow('MARGIN'), pph = iRow('PPH 23', true), net = iRow('DANA MASUK BERSIH'), unl = iRow('ALAT BELUM DIKUNCI');
  const dateRow = find(7, 'DATE:', 40, last);
  const missing = [];
  [[invRow, 'D "NO. INVOICE"'], [sub, 'F "SUB TOTAL"'], [gt, 'F "GRAND TOTAL"'], [dp, 'F "DP"'], [fin, 'F "PELUNASAN"'],
    [cost, 'I "TOTAL BIAYA KELUAR"'], [omset, 'I "OMSET"'], [unl, 'I "ALAT BELUM DIKUNCI"'], [dateRow, 'G "Date:"']]
    .forEach(function (x) { if (!x[0]) missing.push(x[1]); });
  if (sub && sub < 31) missing.push('10 summary rows above SUB TOTAL');
  if (missing.length) return { error: 'RAB anchors missing: ' + missing.join(', ') + '. Sync paused for this tab.' };

  const categories = [];
  for (let i = 0; i < 10; i++) {
    const r = sub - 10 + i;
    categories.push({ no: Number(at(r, 1)) || i + 1, label: cell(r, 2), total: cell(r, 8), estimate: cell(r, 12), actual: cell(r, 13) });
  }

  // breakdown sections: title in A → header row (A = NO) → items → E contains TOTAL (TOTAL CREW / SUB TOTAL)
  const sections = [];
  let crewLines = [];
  for (let r = dateRow + 1; r <= last; r++) {
    const title = U(r, 1).replace(/^[0-9.\s]+/, '');
    const def = SYNC_SECTIONS.filter(function (s) { return title === s[0]; })[0];
    if (!def) continue;
    let h = 0;
    for (let x = r + 1; x <= Math.min(r + 3, last); x++) if (U(x, 1) === 'NO') { h = x; break; }
    if (!h) return { error: 'Section ' + def[0] + ' has no NO | DESCRIPTION header. Sync paused for this tab.' };
    let end = 0, subRow = 0, crewRow = 0;
    for (let x = h + 1; x <= last; x++) {
      const e = U(x, 5);
      if (e.indexOf('TOTAL') >= 0) {
        if (!end) end = x;
        if (e.indexOf('TOTAL CREW') >= 0) crewRow = x;
        if (e.indexOf('SUB TOTAL') >= 0) { subRow = x; break; }
      }
    }
    if (!subRow) return { error: 'Section ' + def[0] + ' has no SUB TOTAL. Sync paused for this tab.' };
    const lines = [];
    for (let x = h + 1; x < end; x++) {
      if (S(at(x, 2)) === '' && S(at(x, 3)) === '' && S(at(x, 4)) === '') continue;
      lines.push({ row: x, no: cell(x, 1), desc: cell(x, 2), person: cell(x, 3), cost: cell(x, 4), qty: cell(x, 5),
        unit: cell(x, 6), days: cell(x, 7), total: cell(x, 8) });
    }
    const sec = { key: def[1], title: def[0], row: r, end_row: subRow, subtotal: cell(subRow, 8), lines: lines };
    if (crewRow) sec.total_crew = cell(crewRow, 8);
    sections.push(sec);
    if (def[1] === 'crew') {
      crewLines = lines.map(function (l) {
        return { row: l.row, person: l.person, desc: l.desc, cost: l.cost, qty: l.qty, days: l.days, total: l.total };
      });
    }
    r = subRow;
  }

  // equipment: I = PILIH ALAT / KETIK MANUAL header → groups (A) → E = SUB TOTAL, then PPN BSM, TOTAL
  let equipment = null, unlocked = 0;
  const eh = find(9, 'PILIH ALAT / KETIK MANUAL', 1, last);
  if (eh) {
    let es = 0;
    for (let x = eh + 1; x <= last; x++) if (U(x, 5) === 'SUB TOTAL') { es = x; break; }
    if (!es) return { error: 'Equipment has no SUB TOTAL. Sync paused for this tab.' };
    const groups = [];
    let g = null;
    for (let x = eh + 1; x < es; x++) {
      const a = U(x, 1);
      if (SYNC_EQ_GROUPS.indexOf(a) >= 0) { g = { name: a, row: x, lines: [] }; groups.push(g); continue; }
      if (S(at(x, 9)) === '') continue;
      const ln = { row: x, item: cell(x, 9), qty: cell(x, 10), days: cell(x, 11), manual_price: cell(x, 12), desc: cell(x, 2),
        cost: cell(x, 4), unit: cell(x, 6), total: cell(x, 8), vendor: cell(x, 13), price_date: cell(x, 14) };
      if (S(at(x, 12)) === '') unlocked++;
      if (!g) { g = { name: 'LAINNYA', row: x, lines: [] }; groups.push(g); }
      g.lines.push(ln);
    }
    const near = function (re) {
      for (let x = es + 1; x <= Math.min(es + 4, last); x++) {
        if ([5, 6, 7].some(function (c) { return re.test(U(x, c)); })) return x;
      }
      return 0;
    };
    const ppnRow = near(/PPN/), totRow = near(/^TOTAL$/);
    equipment = { row: eh, end_row: es, subtotal: cell(es, 8), ppn_bsm: cell(ppnRow, 8), total: cell(totRow, 8), groups: groups };
  }

  // ALOKASI DANA block, only in tabs that have it (syncAlokasiSetup)
  let alloc = null;
  const aTop = iRow('ALOKASI DANA');
  if (aTop) {
    alloc = {};
    SYNC_ALOKASI.forEach(function (d) {
      const r = find(9, d[1].toUpperCase(), aTop + 1, aTop + SYNC_ALOKASI.length);
      alloc[d[0]] = cell(r, 12);
      if (d[2] !== null) alloc[d[0] + '_pct'] = cell(r, 10);
    });
  }

  let placeholders = false;
  for (let r = 1; r <= Math.min(20, last) && !placeholders; r++) {
    for (let c = 1; c <= Math.min(8, ncol); c++) if (/^\[.*\]$/.test(S(at(r, c)))) { placeholders = true; break; }
  }
  const data = {
    layout: 'v2',
    meta: {
      doc_type: cell(5, 1), title: cell(8, 8), client_label: cell(11, 6), product: cell(12, 6), photographer: cell(13, 3),
      invoice_no: cell(invRow, 6), seq: cell(13, 10), client_code: cell(14, 10), quote_date: cell(14, 6),
      locations: cell(16, 3), shooting_days: cell(17, 3), usage: cell(17, 6), location: cell(18, 3), language: cell(18, 6),
    },
    summary: {
      categories: categories, subtotal: cell(sub, 8), discount_pct: cell(disc, 7), discount: cell(disc, 8),
      ppn_pct: cell(ppn, 7), ppn: cell(ppn, 8), grand_total: cell(gt, 8), dp_pct: cell(dp, 7), dp: cell(dp, 8),
      final_amount: cell(fin, 8),
    },
    internal: {
      other_estimate: cell(other, 12), other_actual: cell(other, 13), cost_estimate: cell(cost, 12), cost_actual: cell(cost, 13),
      omset: cell(omset, 12), profit_estimate: cell(profit, 12), profit_actual: cell(profit, 13),
      margin_estimate: cell(margin, 12), margin_actual: cell(margin, 13), pph23_pct: cell(pph, 10), pph23: cell(pph, 12),
      net_in: cell(net, 12), unlocked_gear: cell(unl, 12), alloc: alloc,
    },
    sections: sections, equipment: equipment, crew_lines: crewLines, unlocked: unlocked, placeholders: placeholders,
  };
  return { layout: 'v2', digest: digest, data: data, errors: errors };
}

/** A tab in the shape of a snapshot `tabs` entry (always with data). */
function syncTabSection_(ctx, sh) {
  const r = syncRabRead_(sh, ctx.tz);
  if (r.error) return { gid: sh.getSheetId(), name: sh.getName(), error: 'layout', message: r.error };
  return { gid: sh.getSheetId(), name: sh.getName(), layout: r.layout, digest: r.digest, data: r.data };
}

function api_rab(ctx, a) {
  return { tab: syncTabSection_(ctx, syncSheetByGid_(ctx, a.gid)) };
}

/** PDFs under INVOICE_FOLDER/<client>/ named "<JENIS> NNN-KODE-DDMMYY - ….pdf". */
function api_scan_docs(ctx) {
  const root = syncDriveRoot_();
  if (!root) return { files: [] };
  const inv = root.getFoldersByName(INVOICE_FOLDER);
  if (!inv.hasNext()) return { files: [] };
  const out = [];
  const folders = inv.next().getFolders();
  while (folders.hasNext() && out.length < 500) {
    const files = folders.next().getFiles();
    while (files.hasNext() && out.length < 500) {
      const f = files.next();
      const m = /^(PENAWARAN|INVOICE|KWITANSI) (\d{3})-([A-Z]{2,5})-(\d{6}) - .*\.pdf$/i.exec(f.getName());
      if (!m) continue;
      out.push({ id: f.getId(), name: f.getName(), url: f.getUrl(), created: f.getDateCreated().toISOString(),
        invoice_no: m[2] + '/' + m[3].toUpperCase() + '/' + m[4], kind: m[1].toLowerCase() });
    }
  }
  return { files: out };
}

/** Kas Form backstop (§3.9): responses 2-15 min old without an identical Kas row. */
function syncFormCheck_(ctx, formId, kasRows) {
  const now = Date.now();
  const responses = FormApp.openById(formId).getResponses(new Date(now - 15 * 60000));
  const missing = [];
  responses.forEach(function (resp) {
    if (now - resp.getTimestamp().getTime() < 2 * 60000) return;
    const row = syncFormRow_(resp, ctx.tz);
    const vals = SYNC_KAS_KEYS.map(function (k) { return row[k]; });
    const found = kasRows.some(function (r) { return syncKasEq_(SYNC_KAS_KEYS.map(function (k) { return r[k]; }), vals, ctx.tz); });
    if (!found) missing.push({ response_id: resp.getId(), submitted_at: resp.getTimestamp().toISOString(), row: row });
  });
  return missing;
}

/** mirror of kasDariForm in Code.gs (mapping only): one Form response → the 11 Kas values. */
function syncFormRow_(resp, tz) {
  const a = {};
  resp.getItemResponses().forEach(function (r) { a[r.getItem().getTitle()] = r.getResponse(); });
  const ts = resp.getTimestamp();
  let tgl = new Date(ts.getFullYear(), ts.getMonth(), ts.getDate());
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(a[FK.tanggal] || '');
  if (m) tgl = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const nominal = Number(String(a[FK.nominal] || '').split(',')[0].replace(/\D/g, '')) || 0;
  const project = a[FK.project] === FK_OPERASIONAL ? '' : (a[FK.project] || '');
  const status = a[FK.status] === FK_BELUM ? 'Belum' : 'Sudah';
  const row = [tgl, a[FK.jenis] || 'Keluar', a[FK.kategori] || '', project, a[FK.ket] || '', a[FK.ke] || '', nominal, status, a[FK.metode] || '', a[FK.bukti] || '', 'via Form'];
  const o = {};
  SYNC_KAS_KEYS.forEach(function (k, i) { o[k] = syncCell_(row[i], tz); });
  return o;
}

/** mirror of formKasProjects_ in Code.gs, using SYNC_FORM_ID and ctx.ss (prod only). */
function syncFormProjects_(ctx) {
  const id = PropertiesService.getScriptProperties().getProperty('SYNC_FORM_ID');
  if (!id || ctx.env !== 'prod') return;
  const form = FormApp.openById(id);
  const item = form.getItems(FormApp.ItemType.LIST).filter(function (i) { return i.getTitle() === FK.project; })[0];
  if (!item) return;
  const tabs = ctx.ss.getSheetByName(REKAP).getRange('B9:B208').getDisplayValues()
    .map(function (r) { return r[0].trim(); }).filter(String).reverse();
  item.asListItem().setChoiceValues([FK_OPERASIONAL].concat(tabs));
}

function api_selftest(ctx) {
  const ss = ctx.ss;
  const check = function (fn) { try { fn(); return 'ok'; } catch (err) { return String(err.message || err); } };
  const r = { version: SYNC_VERSION, env: ctx.env, sheet: ctx.id, tz: ctx.tz };
  r.headers = {
    rekap: check(function () { syncHead_(ss.getSheetByName(REKAP), 8, 1, SYNC_HEAD.rekap, 'Rekap Project'); }),
    status_labels: check(function () { syncHead_(ss.getSheetByName(REKAP), 4, 6, SYNC_HEAD.status, 'Rekap Project status labels'); }),
    kas: check(function () { syncHead_(ss.getSheetByName('Kas'), 8, 1, SYNC_HEAD.kas, 'Kas'); }),
    client: check(function () { syncHead_(ss.getSheetByName(CLIENT), 3, 1, SYNC_HEAD.client, 'Client'); }),
    crew: check(function () { syncHead_(ss.getSheetByName('Crew'), 3, 1, SYNC_HEAD.crew, 'Crew'); }),
    keuangan: check(function () { syncKeuanganRead_(ctx); }),
  };
  const tpl = ss.getSheetByName(TEMPLATE);
  const tr = tpl ? syncRabRead_(tpl, ctx.tz) : { error: 'Template RAB missing' };
  r.template = tr.error || (tr.layout === 'v2' ? 'ok' : 'not v2');
  r.tabs = syncTabsList_(ctx).map(function (t) {
    const x = syncRabRead_(t.sh, ctx.tz);
    return { name: t.name, gid: t.gid, layout: x.layout || null, ok: !x.error, error: x.error || null,
      sections: x.data && x.data.sections ? x.data.sections.map(function (s) { return s.key; }) : null,
      equipment: x.data && x.data.layout === 'v2' ? !!x.data.equipment : null };
  });
  const sym = {};
  [['nextInvoiceNo_', typeof nextInvoiceNo_], ['pad3_', typeof pad3_], ['todayText_', typeof todayText_],
    ['projectFolder_', typeof projectFolder_], ['getOrCreate_', typeof getOrCreate_], ['cccFolder_', typeof cccFolder_],
    ['PROJECT_SUBFOLDERS', typeof PROJECT_SUBFOLDERS],
    ['equipmentRows_', typeof equipmentRows_], ['rapikanAlat_', typeof rapikanAlat_], ['clean_', typeof clean_],
    ['REKAP', typeof REKAP], ['CLIENT', typeof CLIENT], ['TEMPLATE', typeof TEMPLATE], ['NON_RAB', typeof NON_RAB],
    ['INVOICE_FOLDER', typeof INVOICE_FOLDER], ['PROJECT_FOLDER', typeof PROJECT_FOLDER], ['DRIVE_ROOT', typeof DRIVE_ROOT],
    ['FK', typeof FK], ['FK_OPERASIONAL', typeof FK_OPERASIONAL], ['FK_BELUM', typeof FK_BELUM], ['KAS_KATEGORI', typeof KAS_KATEGORI]]
    .forEach(function (x) { sym[x[0]] = x[1] !== 'undefined'; });
  r.code_gs = sym;
  r.mirrors = {
    rekap_name: REKAP === 'Rekap Project', client_name: CLIENT === 'Client', template_name: TEMPLATE === 'Template RAB',
    invoice_folder: INVOICE_FOLDER === '01_INVOICE & PENAWARAN', project_folder: PROJECT_FOLDER === '02_PROJECTS',
    form_titles: FK.project === 'Project' && FK.tanggal === 'Tanggal' && FK.nominal === 'Berapa? (Rp)',
  };
  r.triggers = ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction(); });
  r.triggers_ok = {
    onChangeRab: r.triggers.indexOf('onChangeRab') >= 0, syncTick: r.triggers.indexOf('syncTick') >= 0,
    kasDariForm: ctx.env === 'dev' || r.triggers.indexOf('kasDariForm') >= 0,
  };
  const p = PropertiesService.getScriptProperties();
  r.properties = {
    SYNC_SECRET: /^[0-9a-f]{64}$/i.test(p.getProperty('SYNC_SECRET') || ''), SYNC_BRIDGE_URL: check(function () { syncBridgeUrl_(ctx.env); }),
    SYNC_SHEET_ID: p.getProperty('SYNC_SHEET_ID') === ctx.id, SYNC_WRITES: p.getProperty('SYNC_WRITES') || 'unset',
    SYNC_FORM_ID: !!p.getProperty('SYNC_FORM_ID'), SYNC_SEQ: Number(p.getProperty('SYNC_SEQ') || 0),
    SYNC_LAST_ERROR: p.getProperty('SYNC_LAST_ERROR') || null,
  };
  r.drive_safe = ctx.env === 'prod' || !syncLiveDriveRoot_();
  r.ok = Object.keys(r.headers).every(function (k) { return r.headers[k] === 'ok'; }) && r.template === 'ok'
    && Object.keys(sym).every(function (k) { return sym[k]; }) && Object.keys(r.mirrors).every(function (k) { return r.mirrors[k]; })
    && r.drive_safe;
  return r;
}

function api_formula_fingerprint(ctx, a) {
  const names = Array.isArray(a.sheets) && a.sheets.length ? a.sheets : ctx.ss.getSheets().map(function (s) { return s.getName(); });
  const out = {};
  names.slice(0, 60).forEach(function (n) { const sh = ctx.ss.getSheetByName(n); if (sh) out[n] = syncFormulaHash_(sh); });
  return { fingerprints: out };
}

// =====================================================================================================
// Writers (inside syncRun_: script lock held, seq taken)
// =====================================================================================================

/** The Rekap row of a tab: B = the tab's current name, exactly once. */
function syncRekapRowOf_(ctx, name) {
  const rekap = ctx.ss.getSheetByName(REKAP);
  const b = rekap.getRange(9, 2, 200, 1).getDisplayValues();
  const rows = [];
  b.forEach(function (r, i) { if (String(r[0]).trim() === name.trim()) rows.push(9 + i); });
  if (!rows.length) throw syncErr_('not_found', 'Rekap Project has no row for "' + name + '"');
  if (rows.length > 1) throw syncErr_('invalid', '"' + name + '" appears more than once in Rekap Project');
  return rows[0];
}

function syncProjectReply_(ctx, sh, row) {
  if (!row) {
    try { row = syncRekapRowOf_(ctx, sh.getName()); } catch (err) { return undefined; }
  }
  const p = syncRekapRead_(ctx, row);
  p.gid = sh.getSheetId();
  return p;
}

function syncCheckRow_(ctx, row, name, before) {
  const now = String(ctx.ss.getSheetByName(REKAP).getRange(row, 2).getDisplayValue()).trim();
  if (now !== name.trim()) {
    throw syncErr_('write_landed_on_moved_row', 'Rekap rows moved while saving (row ' + row + ' now shows "' + now + '").',
      { row: row, expected: name, found: now, before: before || null });
  }
}

function api_project_set(ctx, a) {
  const sh = syncSheetByGid_(ctx, a.tab_gid);
  const rekap = ctx.ss.getSheetByName(REKAP);
  syncHead_(rekap, 8, 1, SYNC_HEAD.rekap, 'Rekap Project');
  const row = syncRekapRowOf_(ctx, sh.getName());
  const labels = rekap.getRange(4, 6, 1, 5).getDisplayValues()[0].map(function (x) { return String(x).trim(); }).filter(String);
  const set = a.set || {}, expect = a.expect || {};
  const writes = Object.keys(set).map(function (f) {
    const def = SYNC_REKAP_SET[f];
    if (!def) throw syncErr_('invalid', f + " can't be changed from the admin");
    return { sh: rekap, r: row, c: def[0], v: set[f], type: def[1], field: f, list: f === 'status' ? labels : null,
      expect: Object.prototype.hasOwnProperty.call(expect, f) ? expect[f] : undefined };
  });
  if (!writes.length) throw syncErr_('invalid', 'Nothing to change');
  const before = rekap.getRange(row, 1, 1, 26).getValues()[0].map(function (x) { return syncCell_(x, ctx.tz); });
  const res = syncWrite_(ctx, writes, { force: a.force === true });
  syncCheckRow_(ctx, row, sh.getName(), before);
  return { project: syncProjectReply_(ctx, sh, row), tab: { name: sh.getName(), gid: sh.getSheetId() }, written: res.written, noop: res.noop };
}

/** The value cell of a % row: label in `col` (F or I) within rows 20-60. */
function syncPctCell_(sh, def) {
  const col = def[0] === 'F' ? 6 : 9, vcol = def[2] === 'G' ? 7 : 10;
  const v = sh.getRange(20, col, 41, 1).getDisplayValues();
  for (let i = 0; i < v.length; i++) {
    const u = String(v[i][0]).trim().toUpperCase();
    if (u === def[1] || (def[1] !== 'DP' && u.indexOf(def[1]) === 0)) return [20 + i, vcol];
  }
  throw syncErr_('layout', 'Label "' + def[1] + '" not found in column ' + def[0] + ' rows 20-60');
}

function syncV2_(sh) {
  if (String(sh.getRange('I13').getDisplayValue()).trim().toUpperCase() !== 'NO. URUT INVOICE') {
    throw syncErr_('invalid', 'This is an old (v1) RAB tab. Edit it in the Sheet.');
  }
}

function api_rab_meta(ctx, a) {
  const sh = syncSheetByGid_(ctx, a.tab_gid);
  syncV2_(sh);
  const set = a.set || {}, expect = a.expect || {};
  const writes = Object.keys(set).map(function (f) {
    const has = Object.prototype.hasOwnProperty.call(expect, f);
    if (SYNC_TAB_FIELDS[f]) {
      const d = SYNC_TAB_FIELDS[f];
      if (d[1]) {
        const label = String(sh.getRange(d[1]).getDisplayValue()).trim().toUpperCase();
        if (label.indexOf(d[2]) !== 0) throw syncErr_('layout', d[1] + ' should read "' + d[2] + '" but reads "' + label + '"');
      }
      const rg = sh.getRange(d[0]);
      return { sh: sh, r: rg.getRow(), c: rg.getColumn(), v: set[f], type: d[3], field: f,
        list: f === 'doc_type' ? SYNC_DOC_TYPES : null, expect: has ? expect[f] : undefined };
    }
    if (SYNC_PCT[f]) {
      const rc = syncPctCell_(sh, SYNC_PCT[f]);
      return { sh: sh, r: rc[0], c: rc[1], v: set[f], type: 'pct', field: f, expect: has ? expect[f] : undefined };
    }
    throw syncErr_('invalid', f + " can't be changed from the admin");
  });
  if (!writes.length) throw syncErr_('invalid', 'Nothing to change');
  const res = syncWrite_(ctx, writes, { force: a.force === true });
  return { rab: syncTabSection_(ctx, sh), project: syncProjectReply_(ctx, sh), tab: { name: sh.getName(), gid: sh.getSheetId() },
    written: res.written, noop: res.noop };
}

/** The kunciHarga loop on a given sheet: L = D where I is set, L is empty and D is a number. */
function syncLockWrites_(sh) {
  const rows = equipmentRows_(sh);
  if (!rows) return [];
  const n = rows.end - rows.start + 1;
  const cost = sh.getRange(rows.start, 4, n, 1).getValues();
  const iToL = sh.getRange(rows.start, 9, n, 4).getValues();
  const writes = [];
  iToL.forEach(function (r, k) {
    if (r[0] !== '' && r[3] === '' && typeof cost[k][0] === 'number') {
      writes.push({ sh: sh, r: rows.start + k, c: 12, v: Math.round(cost[k][0]), type: 'money', field: 'L' + (rows.start + k) });
    }
  });
  return writes;
}

function api_lock_prices(ctx, a) {
  const sh = syncSheetByGid_(ctx, a.tab_gid);
  syncV2_(sh);
  rapikanAlat_(sh);                                  // before the formula hash is taken (new equipment rows get formulas)
  SpreadsheetApp.flush();
  const writes = syncLockWrites_(sh);
  const res = writes.length ? syncWrite_(ctx, writes, {}) : { written: [], noop: [] };
  return { locked: res.written.length, rab: syncTabSection_(ctx, sh), project: syncProjectReply_(ctx, sh),
    tab: { name: sh.getName(), gid: sh.getSheetId() } };
}

/** Under the lock: checks + optional doc type / lock; the export itself runs in `after` (syncExportAfter_). */
function api_export_pdf(ctx, a) {
  if (ctx.env === 'dev' && syncLiveDriveRoot_()) throw syncErr_('invalid', 'This copy still uses the live Drive root');
  const sh = syncSheetByGid_(ctx, a.tab_gid);
  rapikanAlat_(sh);
  SpreadsheetApp.flush();
  const v2 = String(sh.getRange('I13').getDisplayValue()).trim().toUpperCase() === 'NO. URUT INVOICE';
  if (a.doc_type) {
    if (!v2) throw syncErr_('invalid', 'This is an old (v1) RAB tab. Change the document type in the Sheet.');
    syncWrite_(ctx, [{ sh: sh, r: 5, c: 1, v: a.doc_type, type: 'list', list: SYNC_DOC_TYPES, field: 'doc_type' }], {});
  }
  const last = sh.getLastRow();
  const vals = sh.getRange(1, 1, last, 8).getDisplayValues();
  const invRow = vals.filter(function (r) { return r[3] === 'NO. INVOICE'; })[0];
  const inv = invRow ? invRow[5] : '';
  if (!inv || inv.charAt(0) === '[') throw syncErr_('no_invoice_no', 'The invoice number is not complete yet (F14 date, J13 number, J14 client code).');
  const ph = [];
  vals.slice(0, 20).forEach(function (r, i) { r.forEach(function (c, j) { if (/^\[.*\]$/.test(c)) ph.push(syncColName_(j + 1) + (i + 1)); }); });
  if (ph.length && !a.accept_placeholders) {
    throw syncErr_('needs_confirm', 'There is still [placeholder] text at the top of the document.', { placeholders: ph });
  }
  let locked = 0;
  const lockWrites = syncLockWrites_(sh);
  if (lockWrites.length) {
    if (!a.lock) throw syncErr_('needs_confirm', lockWrites.length + ' equipment prices are not locked yet.', { unlocked: lockWrites.length });
    locked = syncWrite_(ctx, lockWrites, {}).written.length;
  }
  let lastUsed = last;
  while (lastUsed > 1 && vals[lastUsed - 1].every(function (c) { return c === ''; })) lastUsed--;
  const jenis = (String(sh.getRange('A5').getDisplayValue()) || 'INVOICE').trim() || 'INVOICE';
  const client = clean_(sh.getRange('F11').getDisplayValue()) || 'Tanpa Client';
  const project = clean_(sh.getRange('H8').getDisplayValue());
  return {
    doc_type: jenis, invoice_no: inv, locked: locked, tab: { name: sh.getName(), gid: sh.getSheetId() },
    project: syncProjectReply_(ctx, sh), rab: v2 ? syncTabSection_(ctx, sh) : undefined,
    pdf: { gid: sh.getSheetId(), last: lastUsed, client: client,
      name: jenis + ' ' + inv.replace(/\//g, '-') + ' - ' + client + (project ? ' - ' + project : '') + '.pdf' },
  };
}

/** mirror of the export part of exportPdf in Code.gs (same URL options), outside the lock. Same name < 15 min → reused. */
function syncExportAfter_(ctx, a, data) {
  const p = data.pdf;
  delete data.pdf;
  const folder = getOrCreate_(cccFolder_(INVOICE_FOLDER), p.client);
  const same = folder.getFilesByName(p.name);
  while (same.hasNext()) {
    const f = same.next();
    if (Date.now() - f.getDateCreated().getTime() < 15 * 60000) {
      data.file = { id: f.getId(), url: f.getUrl(), name: f.getName(), created: f.getDateCreated().toISOString(), reused: true };
      return;
    }
  }
  const url = 'https://docs.google.com/spreadsheets/d/' + ctx.ss.getId() + '/export'
    + '?format=pdf&gid=' + p.gid + '&range=' + encodeURIComponent('A1:H' + p.last) + SYNC_PDF_OPTS;
  const res = UrlFetchApp.fetch(url, { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw new Error('PDF export failed (' + res.getResponseCode() + ')');
  const file = folder.createFile(res.getBlob().setName(p.name));
  data.file = { id: file.getId(), url: file.getUrl(), name: file.getName(), created: file.getDateCreated().toISOString() };
}

function api_create_rab(ctx, a) {
  if (!SYNC_UUID_RE.test(String(a.project_id))) throw syncErr_('invalid', 'project_id');
  const code = String(a.code || '').trim().toUpperCase();
  if (!/^[A-Z]{2,5}$/.test(code)) throw syncErr_('invalid', 'The client code must be 2 to 5 capital letters');
  const docType = a.doc_type || 'PENAWARAN';
  if (SYNC_DOC_TYPES.indexOf(docType) < 0) throw syncErr_('invalid', 'Pick PENAWARAN, INVOICE or KWITANSI');
  const ss = ctx.ss;

  // idempotent: the tab made for this project already exists
  const found = ss.createDeveloperMetadataFinder().withKey('ccc_project_id').withValue(String(a.project_id)).find();
  for (let i = 0; i < found.length; i++) {
    const loc = found[i].getLocation();
    const sh = loc.getLocationType() === SpreadsheetApp.DeveloperMetadataLocationType.SHEET ? loc.getSheet() : null;
    if (!sh) continue;
    return { replayed: true, tab: { name: sh.getName(), gid: sh.getSheetId() }, rab: syncTabSection_(ctx, sh),
      project: syncProjectReply_(ctx, sh), client: null };
  }

  const rekap = ss.getSheetByName(REKAP), clientSh = ss.getSheetByName(CLIENT), tpl = ss.getSheetByName(TEMPLATE);
  syncHead_(rekap, 8, 1, SYNC_HEAD.rekap, 'Rekap Project');
  syncHead_(clientSh, 3, 1, SYNC_HEAD.client, 'Client');
  if (!tpl) throw syncErr_('layout', 'Template RAB is missing');
  const project = String(a.project || '').trim();
  if (!project) throw syncErr_('invalid', 'Give the project a short name');

  const cv = clientSh.getRange(4, 1, 197, 8).getDisplayValues();
  const ci = cv.findIndex(function (r) { return String(r[1]).trim().toUpperCase() === code; });
  let name = ci >= 0 ? String(cv[ci][0]).trim() : '';
  let clientRow = ci >= 0 ? 4 + ci : 0, newClient = false;
  const bVals = rekap.getRange(9, 2, 200, 1).getValues();
  const idx = bVals.findIndex(function (r) { return r[0] === ''; });
  if (idx < 0) throw syncErr_('invalid', 'Rekap Project is full (200 rows)');
  const row = 9 + idx;

  const check = syncWatch_([rekap]);
  let sh = null, tabName = '', wroteRekap = false;
  const undoAll = function () {                    // one undo scope: client row, tab, Rekap row
    if (sh) { try { ss.deleteSheet(sh); } catch (err) { /* already gone */ } }
    if (wroteRekap) { rekap.getRange(row, 2).clearContent(); rekap.getRange(row, 10).clearContent(); }
    if (newClient) clientSh.getRange(clientRow, 1, 1, 5).clearContent();
    SpreadsheetApp.flush();
  };
  try {
    if (!name) {
      const c = a.client || {};
      name = String(c.name || '').trim();
      if (!name) throw syncErr_('invalid', 'Client code ' + code + ' is new: give the client a name');
      const free = cv.findIndex(function (r) { return r.every(function (x) { return String(x).trim() === ''; }); });
      if (free < 0) throw syncErr_('invalid', 'The Client tab is full');
      clientRow = 4 + free;
      newClient = true;
      syncWrite_(ctx, [
        { sh: clientSh, r: clientRow, c: 1, v: name, field: 'client.name' },
        { sh: clientSh, r: clientRow, c: 2, v: code, field: 'client.code' },
        { sh: clientSh, r: clientRow, c: 3, v: c.pic || null, field: 'client.pic' },
        { sh: clientSh, r: clientRow, c: 4, v: c.phone || null, type: 'phone', field: 'client.phone' },
        { sh: clientSh, r: clientRow, c: 5, v: c.email || null, field: 'client.email' },
      ], {});
    }

    const no = nextInvoiceNo_(ss, rekap);
    tabName = syncName_(pad3_(no) + ' ' + name + ' - ' + project, 100);
    if (ss.getSheetByName(tabName)) throw syncErr_('invalid', 'A tab named "' + tabName + '" already exists');

    // mirror of buatRabBaru in Code.gs (no UI): duplicateActiveSheet keeps protections and grouping
    try {
      ss.setActiveSheet(tpl);
      sh = ss.duplicateActiveSheet();
    } catch (err) {
      sh = tpl.copyTo(ss);
      tpl.getProtections(SpreadsheetApp.ProtectionType.RANGE).forEach(function (p) {
        const np = sh.getRange(p.getRange().getA1Notation()).protect().setDescription(p.getDescription());
        if (p.isWarningOnly()) np.setWarningOnly(true);
      });
    }
    sh.setName(tabName);
    ss.setActiveSheet(sh);
    ss.moveActiveSheet(ss.getNumSheets());
    sh.setTabColor('#c9daf8');
    syncWrite_(ctx, [
      { sh: sh, r: 5, c: 1, v: docType, type: 'list', list: SYNC_DOC_TYPES, field: 'doc_type' },
      { sh: sh, r: 8, c: 8, v: project, field: 'title' },
      { sh: sh, r: 11, c: 6, v: name, field: 'client_label' },
      { sh: sh, r: 14, c: 6, v: todayText_(ss), field: 'quote_date' },
      { sh: sh, r: 13, c: 10, v: no, type: 'int', field: 'seq' },
      { sh: sh, r: 14, c: 10, v: code, field: 'client_code' },
    ], {});
    sh.addDeveloperMetadata('ccc_project_id', String(a.project_id));
    const bCell = rekap.getRange(row, 2);
    if (bCell.getFormula() || bCell.getValue() !== '') throw syncErr_('busy', 'Rekap row ' + row + ' was just taken. Try again.');
    wroteRekap = true;
    bCell.setRichTextValue(SpreadsheetApp.newRichTextValue().setText(tabName).setLinkUrl('#gid=' + sh.getSheetId()).build());
    rekap.getRange(row, 10).setValue('Draft');
    SpreadsheetApp.flush();
    const inv = String(rekap.getRange(row, 3).getDisplayValue()).trim();
    const broken = check();
    if (broken || !/^\d{3}\/[A-Z]{2,5}\/\d{6}$/.test(inv)) {
      if (broken) console.warn('Formula guard: ' + broken);
      throw syncErr_('formula_guard', 'The new RAB did not register cleanly in Rekap Project (invoice "' + inv + '"), so it was removed.',
        broken ? { broken: broken } : undefined);
    }
  } catch (err) {
    undoAll();
    throw err;
  }
  return {
    tab: { name: tabName, gid: sh.getSheetId() }, project: syncProjectReply_(ctx, sh, row), rab: syncTabSection_(ctx, sh),
    client: syncTableRead_(ctx, 'client', clientRow), invoice_no: String(rekap.getRange(row, 3).getDisplayValue()).trim(),
  };
}

/** After the lock: Drive folder in this env's root, then the Rekap K link under the lock, then the Kas Form list.
 *  mirror of projectFolder_ in Code.gs, split so the slow Drive calls don't hold the script lock. */
function syncCreateAfter_(ctx, a, data) {
  if (data.replayed || !data.tab) return;
  if (ctx.env === 'dev' && syncLiveDriveRoot_()) return;
  const year = Utilities.formatDate(new Date(), ctx.tz, 'yyyy');
  const pf = getOrCreate_(getOrCreate_(cccFolder_(PROJECT_FOLDER), year), data.tab.name);
  PROJECT_SUBFOLDERS.forEach(function (n) { getOrCreate_(pf, n); });
  data.folder_url = pf.getUrl();
  const lock = LockService.getScriptLock();
  if (lock.tryLock(10000)) {
    try {
      const row = syncRekapRowOf_(ctx, data.tab.name);
      const k = ctx.ss.getSheetByName(REKAP).getRange(row, 11);
      if (k.getValue() === '' && !k.getFormula()) {
        k.setRichTextValue(SpreadsheetApp.newRichTextValue().setText('Folder project').setLinkUrl(pf.getUrl()).build());
        SpreadsheetApp.flush();
        if (data.project) { data.project.note_text = 'Folder project'; data.project.drive_folder_url = pf.getUrl(); }
      }
    } catch (err) {
      data.after_error = 'folder link: ' + String(err.message).slice(0, 150);
    } finally { lock.releaseLock(); }
  }
  try { syncFormProjects_(ctx); } catch (err) { /* the Form list catches up on the next RAB */ }
}

// ---------- Kas ----------

/** The 11 Kas values to write, validated. K defaults to "via Admin". */
function syncKasValues_(ctx, row) {
  if (!row || typeof row !== 'object') throw syncErr_('invalid', 'row is missing');
  const rekapNames = ctx.ss.getSheetByName(REKAP).getRange('B9:B208').getDisplayValues()
    .map(function (r) { return String(r[0]).trim(); }).filter(String);
  const lists = { kind: ['Keluar', 'Masuk'], paid: ['Sudah', 'Belum'], method: ['Transfer', 'Cash', 'QRIS'], project_tab: rekapNames };
  const r = Object.assign({}, row);
  if (r.note === undefined || r.note === null || r.note === '') r.note = 'via Admin';
  ['entry_date', 'kind', 'category', 'description', 'amount', 'paid'].forEach(function (k) {
    if (r[k] === undefined || r[k] === null || r[k] === '') throw syncErr_('invalid', k + ' is required');
  });
  return SYNC_KAS_KEYS.map(function (k, i) {
    if (k === 'project_tab' && (r[k] === null || r[k] === undefined || r[k] === '')) return '';
    return syncValue_(k, r[k], ctx.tz, lists[k], SYNC_KAS_TYPES[i]);
  });
}

function syncKasEq_(a, b, tz) {
  tz = tz || Session.getScriptTimeZone();
  for (let i = 0; i < 11; i++) if (!syncSame_(a[i], b[i], tz)) return false;
  return true;
}

function syncKasList_(r) {
  return SYNC_KAS_KEYS.map(function (k) { return r[k] === undefined ? null : r[k]; });
}

/** Locate a Kas row by content: the hint row first, else the nearest identical row (identical rows are
 *  interchangeable for the mirror; the nearest one is the one the admin saw). `rows` = a syncKasRead_ list. */
function syncKasLocate_(ctx, hint, want, rows) {
  rows = rows || syncKasRead_(ctx).data.rows;
  const h = rows.filter(function (x) { return x.row === hint; })[0];
  if (h && syncKasEq_(syncKasList_(h), want, ctx.tz)) return h;
  const same = rows.filter(function (x) { return syncKasEq_(syncKasList_(x), want, ctx.tz); });
  if (!same.length) return null;
  same.sort(function (p, q) { return Math.abs(p.row - hint) - Math.abs(q.row - hint); });
  return same[0];
}

function syncKasAt_(rows, hint, want, tz) {
  const h = rows.filter(function (x) { return x.row === hint; })[0];
  return h && syncKasEq_(syncKasList_(h), want, tz) ? h : null;
}

function api_kas_add(ctx, a, run) {
  const k = ctx.ss.getSheetByName('Kas');
  syncHead_(k, 8, 1, SYNC_HEAD.kas, 'Kas');
  const row = syncKasValues_(ctx, a.row);                       // validated A..K; K defaults to 'via Admin'
  const same = syncKasRead_(ctx).data.rows.filter(x => syncKasEq_(syncKasList_(x), row, ctx.tz));
  if (same.length && !a.allow_duplicate) {
    if (run.attempt > 1) return { kas: same[0], replayed: true };       // an earlier attempt landed
    throw syncErr_('duplicate', 'The same entry is already in Kas (row ' + same[0].row + ')', same[0]);
  }
  const check = syncWatch_([ctx.ss.getSheetByName(REKAP), ctx.ss.getSheetByName('Crew')]);
  for (let i = 0; i < 3; i++) {
    const col = k.getRange(9, 1, k.getMaxRows() - 8, 1).getValues();    // first empty A from row 9, as kasDariForm does
    const idx = col.findIndex(x => x[0] === '');
    const r = idx >= 0 ? 9 + idx : k.getMaxRows() + 1;
    if (idx < 0) k.insertRowAfter(k.getMaxRows());
    const target = k.getRange(r, 1, 1, 11);
    if (target.getValues()[0].some(x => x !== '')) continue;            // taken a moment ago
    syncNoFormula_(target);
    target.setValues([row]);
    SpreadsheetApp.flush();
    Utilities.sleep(2000);                                               // let a Form write that read the same row land
    if (syncKasEq_(k.getRange(r, 1, 1, 11).getValues()[0], row, ctx.tz)) {
      const broken = check();
      if (broken) {
        target.clearContent();
        SpreadsheetApp.flush();
        syncGuardTrip_();
        throw syncGuardErr_(broken);
      }
      return { kas: syncKasRead_(ctx, r) };
    }
  }                                                                      // a Form row took the slot: keep it, try the next row
  throw syncErr_('busy', 'Kas kept changing while saving. Try again.');
}

function api_kas_update(ctx, a) {
  const k = ctx.ss.getSheetByName('Kas');
  syncHead_(k, 8, 1, SYNC_HEAD.kas, 'Kas');
  const match = syncKasList_(a.match || {});
  const set = a.set || {};
  const fields = Object.keys(set);
  if (!fields.length) throw syncErr_('invalid', 'Nothing to change');
  fields.forEach(function (f) { if (SYNC_KAS_KEYS.indexOf(f) < 0) throw syncErr_('invalid', f + " can't be changed"); });
  const merged = Object.assign({}, a.match || {}, set);
  const hintRow = Number(a.hint_row), rows = syncKasRead_(ctx).data.rows;
  // order matters with identical rows: the hint row (as seen, then as already edited) before any other row,
  // so a retry whose first attempt landed never edits the twin of the row it already changed
  let cur = syncKasAt_(rows, hintRow, match, ctx.tz);
  let done = cur ? null : syncKasAt_(rows, hintRow, syncKasList_(merged), ctx.tz);
  if (!cur && !done) cur = syncKasLocate_(ctx, hintRow, match, rows);
  if (!cur && !done) done = syncKasLocate_(ctx, hintRow, syncKasList_(merged), rows);
  if (done) return { kas: done, before: Object.assign({ row: done.row }, a.match), noop: fields };
  if (!cur) {
    const hint = hintRow >= 9 ? syncKasRead_(ctx, hintRow) : null;
    throw syncErr_('conflict', 'This cash entry changed in the Sheet.', { field: null, sheet_value: hint, you_saw: a.match });
  }
  const writes = fields.map(function (f) {
    const i = SYNC_KAS_KEYS.indexOf(f);
    return { sh: k, r: cur.row, c: i + 1, v: set[f], type: SYNC_KAS_TYPES[i], field: f, expect: match[i],
      list: { kind: ['Keluar', 'Masuk'], paid: ['Sudah', 'Belum'], method: ['Transfer', 'Cash', 'QRIS'] }[f] || null };
  });
  if (set.project_tab) {
    const names = ctx.ss.getSheetByName(REKAP).getRange('B9:B208').getDisplayValues().map(function (r) { return String(r[0]).trim(); });
    if (names.indexOf(String(set.project_tab).trim()) < 0) throw syncErr_('invalid', 'project_tab must be a project in Rekap Project');
  }
  const res = syncWrite_(ctx, writes, { force: a.force === true, watch: [ctx.ss.getSheetByName('Crew')] });
  const after = syncKasRead_(ctx, cur.row);
  if (!syncKasEq_(syncKasList_(after), syncKasList_(merged), ctx.tz)) {
    throw syncErr_('write_landed_on_moved_row', 'Kas rows moved while saving (row ' + cur.row + ').', { row: cur.row, before: cur, after: after });
  }
  return { kas: after, before: cur, written: res.written, noop: res.noop };
}

function api_kas_delete(ctx, a, run) {
  const k = ctx.ss.getSheetByName('Kas');
  syncHead_(k, 8, 1, SYNC_HEAD.kas, 'Kas');
  const match = syncKasList_(a.match || {});
  const hintRow = Number(a.hint_row), rows = syncKasRead_(ctx).data.rows;
  let cur = syncKasAt_(rows, hintRow, match, ctx.tz);
  if (!cur) {
    // a retry whose first attempt cleared the hint row must not clear an identical twin
    const hintEmpty = hintRow >= 9 && !rows.some(function (x) { return x.row === hintRow; });
    if (hintEmpty && run && run.attempt > 1) return { removed: null, noop: true };
    cur = syncKasLocate_(ctx, hintRow, match, rows);
  }
  if (!cur) return { removed: null, noop: true };                       // already gone
  const target = k.getRange(cur.row, 1, 1, 11);
  syncNoFormula_(target);
  const check = syncWatch_([ctx.ss.getSheetByName(REKAP), ctx.ss.getSheetByName('Crew')]);
  const undo = target.getValues();
  target.clearContent();                                                 // keeps validation and format; the gap is reused
  SpreadsheetApp.flush();
  const broken = check();
  if (broken) {
    target.setValues(undo);
    SpreadsheetApp.flush();
    syncGuardTrip_();
    throw syncGuardErr_(broken);
  }
  return { removed: cur };
}

// ---------- Client / Crew ----------

function syncUpsert_(ctx, kind, key, a) {
  const isClient = kind === 'client';
  const sh = ctx.ss.getSheetByName(isClient ? CLIENT : 'Crew');
  syncHead_(sh, 3, 1, SYNC_HEAD[kind], isClient ? 'Client' : 'Crew');
  const cols = isClient ? SYNC_CLIENT_COLS : SYNC_CREW_COLS;
  const editable = isClient ? ['name', 'pic', 'phone', 'email', 'npwp', 'address', 'note'] : ['role', 'rate', 'rate_unit', 'phone', 'note'];
  const keyCol = 2;                                                  // Client B = Kode, Crew B = Nama
  const d = sh.getRange(4, 1, 197, 8).getDisplayValues();
  const norm = function (s) { return isClient ? String(s).trim().toUpperCase() : String(s).trim().toLowerCase(); };
  const hits = [];
  d.forEach(function (r, i) { if (norm(r[keyCol - 1]) === norm(key)) hits.push(4 + i); });
  if (hits.length > 1) throw syncErr_('invalid', '"' + key + '" appears more than once in the ' + (isClient ? 'Client' : 'Crew') + ' tab');
  const set = a.set || {}, expect = a.expect || {};
  Object.keys(set).forEach(function (f) { if (editable.indexOf(f) < 0) throw syncErr_('invalid', f + " can't be changed from the admin"); });
  let row = hits[0] || 0, creating = false;
  if (!row) {
    if (!a.create) throw syncErr_('not_found', '"' + key + '" is not in the ' + (isClient ? 'Client' : 'Crew') + ' tab anymore');
    const width = isClient ? 8 : 6;                                    // Crew G:H are formulas
    const free = d.findIndex(function (r) { return r.slice(0, width).every(function (x) { return String(x).trim() === ''; }); });
    if (free < 0) throw syncErr_('invalid', 'The ' + (isClient ? 'Client' : 'Crew') + ' tab is full');
    row = 4 + free;
    creating = true;
  }
  const typeOf = function (f) { return f === 'rate' ? 'money' : (f === 'phone' ? 'phone' : 'text'); };
  const writes = Object.keys(set).map(function (f) {
    // creating over an existing record (a retry, or someone added it meanwhile): only empty or equal cells are fine
    const ex = a.create && !creating ? null : (Object.prototype.hasOwnProperty.call(expect, f) ? expect[f] : undefined);
    return { sh: sh, r: row, c: cols[f], v: set[f], type: typeOf(f), field: f, expect: creating ? undefined : ex };
  });
  if (creating) writes.unshift({ sh: sh, r: row, c: keyCol, v: key, type: 'text', field: isClient ? 'code' : 'name' });
  const res = writes.length ? syncWrite_(ctx, writes, { force: a.force === true }) : { written: [], noop: [] };
  const now = String(sh.getRange(row, keyCol).getDisplayValue());
  if (norm(now) !== norm(key)) throw syncErr_('write_landed_on_moved_row', 'Rows moved while saving (row ' + row + ').', { row: row, expected: key, found: now });
  const out = { written: res.written, noop: res.noop, created: creating };
  out[kind] = syncTableRead_(ctx, kind, row);
  return out;
}

function api_client_upsert(ctx, a) {
  const code = String(a.code || '').trim().toUpperCase();
  if (!/^[A-Z]{2,5}$/.test(code)) throw syncErr_('invalid', 'The client code must be 2 to 5 capital letters');
  return syncUpsert_(ctx, 'client', code, a);
}

function api_crew_upsert(ctx, a) {
  const name = String(a.name || '').trim();
  if (!name || name.length > 120) throw syncErr_('invalid', 'A crew member needs a name');
  return syncUpsert_(ctx, 'crew', name, a);
}

// =====================================================================================================
// RAB lines (M6): breakdown lines, equipment lines and the internal actual costs (DESIGN.md §3.6, §3.8.5)
// =====================================================================================================

/** The "Date:" row (G, from row 40). Above it: the header, the summary, GRAND TOTAL and the internal block. */
function syncDateRow_(sh) {
  const g = sh.getRange(1, 7, Math.max(sh.getLastRow(), 1), 1).getDisplayValues();
  for (let r = 40; r <= g.length; r++) if (String(g[r - 1][0]).trim().toUpperCase() === 'DATE:') return r;
  throw syncErr_('layout', 'RAB anchor missing: G "Date:"');
}

/** A breakdown section as syncRabRead_ reads it, found again inside the lock: its title in A below the "Date:" row,
 *  the NO header within 3 rows, item rows down to the first E holding TOTAL (TOTAL CREW or SUB TOTAL). */
function syncSectionAt_(sh, key) {
  const def = SYNC_SECTIONS.filter(function (s) { return s[1] === key; })[0];
  if (!def) throw syncErr_('invalid', 'Pick a section');
  const date = syncDateRow_(sh), last = sh.getLastRow();
  const v = sh.getRange(1, 1, last, 5).getDisplayValues();
  const U = function (r, c) { return String(v[r - 1][c - 1]).trim().toUpperCase(); };
  for (let r = date + 1; r <= last; r++) {
    if (U(r, 1).replace(/^[0-9.\s]+/, '') !== def[0]) continue;
    let head = 0;
    for (let x = r + 1; x <= Math.min(r + 3, last) && !head; x++) if (U(x, 1) === 'NO') head = x;
    if (!head) throw syncErr_('layout', def[0] + ' has no NO | DESCRIPTION header');
    let end = 0, sub = 0;
    for (let x = head + 1; x <= last && !sub; x++) {
      const e = U(x, 5);
      if (e.indexOf('TOTAL') < 0) continue;
      if (!end) end = x;
      if (e.indexOf('SUB TOTAL') >= 0) sub = x;
    }
    if (!sub) throw syncErr_('layout', def[0] + ' has no SUB TOTAL');
    if (end < head + 2) throw syncErr_('needs_sheet', def[0] + ' has no item rows. Add one in the Sheet.');
    return { key: key, title: def[0], cols: def[2], date: date, row: r, head: head, first: head + 1, last: end - 1, end: end, sub: sub };
  }
  throw syncErr_('layout', def[0] + ' is not in this RAB');
}

/** The equipment block as equipmentRows_ (Code.gs) finds it, by group (A = CAMERA, LENS, ...). Item rows are the rows
 *  with the Sheet's equipment dropdown in I: the rows rapikanAlat_ gives formulas. */
function syncEquipmentAt_(sh) {
  const eq = equipmentRows_(sh);
  if (!eq) throw syncErr_('layout', 'This RAB has no equipment block');
  const n = eq.end - eq.start + 1;
  const a = sh.getRange(eq.start, 1, n, 1).getDisplayValues();
  const dv = sh.getRange(eq.start, 9, n, 1).getDataValidations();
  const groups = [];
  let g = null;
  for (let i = 0; i < n; i++) {
    const name = String(a[i][0]).trim().toUpperCase();
    if (SYNC_EQ_GROUPS.indexOf(name) >= 0) { g = { name: name, row: eq.start + i, rows: [] }; groups.push(g); continue; }
    if (g && dv[i][0]) g.rows.push(eq.start + i);
  }
  return { head: eq.start - 1, start: eq.start, end: eq.end, sub: eq.end + 1, groups: groups };
}

/** What a line op may touch: the section's fields (or the equipment's), its item rows, the field that names a line,
 *  its header row and its SUB TOTAL row. */
function syncLineTarget_(sh, section) {
  const rows = [];
  if (section === 'equipment') {
    const eq = syncEquipmentAt_(sh);
    eq.groups.forEach(function (g) { g.rows.forEach(function (r) { rows.push(r); }); });
    return { title: 'Equipment', equipment: true, eq: eq, fields: SYNC_EQ_FIELDS, idKey: 'item', spill: null, rows: rows,
      isItem: function (r) { return rows.indexOf(r) >= 0; }, head: eq.head, sub: eq.sub };
  }
  const sec = syncSectionAt_(sh, section);
  for (let r = sec.first; r <= sec.last; r++) rows.push(r);
  const fields = {};
  Object.keys(SYNC_LINE_FIELDS).forEach(function (f) { if (sec.cols.indexOf(SYNC_LINE_FIELDS[f][0]) >= 0) fields[f] = SYNC_LINE_FIELDS[f]; });
  return { title: sec.title, equipment: false, sec: sec, fields: fields, idKey: 'desc', spill: { first: sec.first }, rows: rows,
    isItem: function (r) { return r >= sec.first && r <= sec.last; }, head: sec.head, sub: sec.sub };
}

/** A check for syncWrite_: the block's SUB TOTAL (H) equals the sum of the numbers in H between its header row and
 *  it, which is what the template's SUB TOTAL adds up (=SUM(H65:INDEX(H:H;ROW()-1))). It fails when a tab's formula
 *  covers fewer rows, like a fixed range that a new row falls outside of. */
function syncSumCheck_(sh, t) {
  const head = t.head, sub = t.sub;
  return function () {
    if (String(sh.getRange(sub, 5).getDisplayValue()).trim().toUpperCase() !== 'SUB TOTAL') return sh.getName() + ': SUB TOTAL is not on row ' + sub;
    if (sub - head < 2) return '';
    let sum = 0;
    sh.getRange(head + 1, 8, sub - head - 1, 1).getValues().forEach(function (r) { if (typeof r[0] === 'number') sum += r[0]; });
    const st = sh.getRange(sub, 8).getValue();
    return typeof st === 'number' && Math.abs(st - sum) < 0.5 ? '' : sh.getName() + ': SUB TOTAL H' + sub + ' shows ' + st + ' but its lines add up to ' + sum;
  };
}

/** Refuses a change to a line that isn't the one the admin showed (DESIGN.md §3.6, line_moved): each field in
 *  `expect` must still read the same, except the fields being changed (syncWrite_ checks those one by one, a
 *  conflict). The description (equipment: the item) names the line, so it is checked even when it is being changed.
 *  A field that already holds its new value (a retry after a lost answer) passes. */
function syncLineSame_(ctx, sh, row, t, expect, set) {
  const moved = [];
  Object.keys(expect || {}).forEach(function (f) {
    const d = t.fields[f];
    if (!d) throw syncErr_('invalid', f + ' is not a field of ' + t.title);
    const has = Object.prototype.hasOwnProperty.call(set, f);
    const cur = sh.getRange(row, d[0]).getValue();
    if (has && syncSame_(cur, syncValue_(f, set[f], ctx.tz, null, d[1]), ctx.tz)) return;
    if (has && f !== t.idKey) return;
    if (!syncSame_(cur, expect[f], ctx.tz)) moved.push(f);
  });
  if (moved.length) {
    throw syncErr_('line_moved', 'Row ' + row + ' of ' + t.title + ' changed or moved in the Sheet (' + moved.join(', ') + ').',
      { row: row, fields: moved });
  }
}

function syncLineReply_(ctx, sh, res, extra) {
  return Object.assign({ rab: syncTabSection_(ctx, sh), project: syncProjectReply_(ctx, sh), tab: { name: sh.getName(), gid: sh.getSheetId() },
    written: res.written, noop: res.noop }, extra || {});
}

/** Op rab_line_set {tab_gid, section, lines: [{row, set, expect}], force}: changes lines of one section (section
 *  'equipment' for the gear) in one guarded write. Row numbers come from the admin's copy and are checked here. */
function api_rab_line_set(ctx, a) {
  const sh = syncSheetByGid_(ctx, a.tab_gid);
  syncV2_(sh);
  const lines = Array.isArray(a.lines) ? a.lines : [];
  if (!lines.length || lines.length > 40) throw syncErr_('invalid', 'Send 1 to 40 lines');
  if (a.section === 'equipment') { rapikanAlat_(sh); SpreadsheetApp.flush(); }   // before any hash: gear typed in the Sheet gets its formulas
  const t = syncLineTarget_(sh, a.section);
  const seen = {}, writes = [];
  lines.forEach(function (l) {
    const row = Number(l.row), set = l.set || {}, expect = l.expect || {};
    if (!t.isItem(row)) throw syncErr_('line_moved', 'Row ' + row + ' is not a line of ' + t.title + ' anymore.', { row: row });
    if (seen[row]) throw syncErr_('invalid', 'Row ' + row + ' is sent twice');
    seen[row] = true;
    if (!Object.keys(set).length) throw syncErr_('invalid', 'Nothing to change');
    if (Object.prototype.hasOwnProperty.call(set, t.idKey) && (set[t.idKey] === null || String(set[t.idKey]).trim() === '')) {
      throw syncErr_('invalid', 'Use Remove line to take a line out');
    }
    syncLineSame_(ctx, sh, row, t, expect, set);
    Object.keys(set).forEach(function (f) {
      const d = t.fields[f];
      if (!d) throw syncErr_('invalid', f + " can't be changed in " + t.title);
      writes.push({ sh: sh, r: row, c: d[0], v: set[f], type: d[1], field: f + '@' + row, spillCheck: t.spill,
        expect: Object.prototype.hasOwnProperty.call(expect, f) ? expect[f] : undefined });
    });
  });
  const res = syncWrite_(ctx, writes, { force: a.force === true, check: syncSumCheck_(sh, t) });
  return syncLineReply_(ctx, sh, res);
}

/** Op rab_line_add {tab_gid, section, group (equipment), set}: a new line in the section's (gear: the group's) first
 *  empty item row, or in a row inserted after its last item row (syncInsertLine_). Every field of the line is
 *  written, the ones not sent as empty. The op id stays on the row as developer metadata (ccc_op), so a retry whose
 *  first answer was lost finds the line instead of adding it twice. */
function api_rab_line_add(ctx, a, run) {
  const sh = syncSheetByGid_(ctx, a.tab_gid);
  syncV2_(sh);
  const key = String((run && run.key) || '');
  const set = a.set || {};
  if (a.section === 'equipment') { rapikanAlat_(sh); SpreadsheetApp.flush(); }
  const t = syncLineTarget_(sh, a.section);
  Object.keys(set).forEach(function (f) {                                 // every value is checked before a row goes in
    if (!t.fields[f]) throw syncErr_('invalid', f + " can't be set in " + t.title);
    syncValue_(f, set[f], ctx.tz, null, t.fields[f][1]);
  });
  if (set[t.idKey] === undefined || set[t.idKey] === null || String(set[t.idKey]).trim() === '') {
    throw syncErr_('invalid', t.equipment ? 'Pick or type the equipment' : 'A line needs a description');
  }
  const again = syncOpRow_(sh, key);
  if (again) return syncLineReply_(ctx, sh, { written: [], noop: Object.keys(set) }, { row: again, replayed: true });
  let rows = [];
  if (t.equipment) {
    const g = t.eq.groups.filter(function (x) { return x.name === a.group; })[0];
    if (!g) throw syncErr_('invalid', 'Pick an equipment group');
    if (!g.rows.length) throw syncErr_('needs_sheet', g.name + ' has no item rows. Add one in the Sheet.');
    rows = g.rows;
  } else {
    for (let r = t.sec.first; r <= t.sec.last; r++) rows.push(r);
  }
  // a free row: gear with I empty and its formulas in place; a breakdown row with B, C and D empty (syncRabRead_'s rule)
  const vals = sh.getRange(rows[0], 1, rows[rows.length - 1] - rows[0] + 1, 12).getValues();
  let row = 0;
  rows.some(function (r) {
    const v = vals[r - rows[0]];
    if (t.equipment ? v[8] === '' && !!sh.getRange(r, 2).getFormula() : v[1] === '' && v[2] === '' && v[3] === '') row = r;
    return !!row;
  });
  const inserted = row ? 0 : syncInsertLine_(ctx, sh, t, rows[rows.length - 1]);
  if (inserted) row = inserted;
  // fields left out stay empty: what an earlier line left in them is cleared, but a spill column's output is not input
  const cur = sh.getRange(row, 1, 1, 12).getValues()[0];
  const writes = [];
  Object.keys(t.fields).forEach(function (f) {
    const c = t.fields[f][0], sent = Object.prototype.hasOwnProperty.call(set, f);
    if (!sent && (cur[c - 1] === '' || (t.spill && syncSpillColumn_(sh, t.spill, c)))) return;
    writes.push({ sh: sh, r: row, c: c, v: sent ? set[f] : null, type: t.fields[f][1], field: f + '@' + row, spillCheck: t.spill });
  });
  let res;
  try {
    res = syncWrite_(ctx, writes, { check: syncSumCheck_(sh, inserted ? syncLineTarget_(sh, a.section) : t) });
  } catch (err) {
    if (inserted) { sh.deleteRow(inserted); SpreadsheetApp.flush(); }
    throw err;
  }
  if (key) sh.getRange(row + ':' + row).addDeveloperMetadata('ccc_op', key + '@' + Date.now());
  return syncLineReply_(ctx, sh, res, { row: row, inserted: !!inserted });
}

/** The row an earlier attempt of this add wrote its line to (row metadata ccc_op "<op id>@<ms>"), or 0. Tags older
 *  than a day are removed on the way (by then the op is settled or failed for good). */
function syncOpRow_(sh, key) {
  if (!key) return 0;
  let row = 0;
  const now = Date.now();
  sh.createDeveloperMetadataFinder().withKey('ccc_op').find().forEach(function (m) {
    const v = String(m.getValue() || '').split('@');
    if (v[0] === key) row = m.getLocation().getRow().getRow();
    else if (!(now - Number(v[1] || 0) < 86400000)) m.remove();
  });
  return row;
}

/** The guarded row insert (DESIGN.md §3.8.5): one row after `after`, the block's last item row, with that row's
 *  format and dropdowns, and for gear its formulas (rapikanAlat_). Then: everything from the top of the tab down to the
 *  "Date:" row (header, summary, GRAND TOTAL, internal block) reads as before, Rekap's formulas are unchanged, no new
 *  error appeared, the new row is an empty item row of the block and SUB TOTAL still adds up. Otherwise the row goes. */
function syncInsertLine_(ctx, sh, t, after) {
  const rekap = ctx.ss.getSheetByName(REKAP);
  const date = syncDateRow_(sh);
  const top = function () {
    return syncDigest_(sh.getRange(1, 1, date, 14).getValues().map(function (r) { return r.map(function (x) { return syncCell_(x, ctx.tz); }); }));
  };
  const before = { top: top(), rekap: syncFormulaHash_(rekap), errs: syncErrorCells_(sh).length, rekapErrs: syncErrorCells_(rekap) };
  sh.insertRowAfter(after);
  const row = after + 1, width = sh.getMaxColumns();
  const src = sh.getRange(after, 1, 1, width), dst = sh.getRange(row, 1, 1, width);
  src.copyTo(dst, SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
  src.copyTo(dst, SpreadsheetApp.CopyPasteType.PASTE_DATA_VALIDATION, false);
  if (t.equipment) rapikanAlat_(sh, row);
  SpreadsheetApp.flush();
  const what = [];
  try {
    if (top() !== before.top) what.push('the values above the breakdown changed');
    if (syncFormulaHash_(rekap) !== before.rekap) what.push('Rekap Project formulas changed');
    if (syncErrorCells_(sh).length !== before.errs) what.push('new errors in the tab');
    const re = syncNewErrors_(before.rekapErrs, syncErrorCells_(rekap));
    if (re.length) what.push('new errors in Rekap Project ' + re.slice(0, 5).join(' '));
    const t2 = syncLineTarget_(sh, t.equipment ? 'equipment' : t.sec.key);
    if (!t2.isItem(row)) what.push('row ' + row + ' is not a line of ' + t.title);
    if (t2.sub !== t.sub + 1) what.push('SUB TOTAL did not move down one row');
    if (t.equipment) {
      if (!sh.getRange(row, 2).getFormula() || !sh.getRange(row, 8).getFormula()) what.push('the new gear row has no formulas');
    } else if (!sh.getRange(t.sec.first, 8).getFormula()) {
      what.push('the line total formula on row ' + t.sec.first + ' is gone');
    }
    const v = sh.getRange(row, 1, 1, 12).getValues()[0];
    if (Object.keys(t.fields).some(function (f) { return v[t.fields[f][0] - 1] !== ''; })) what.push('the new row is not empty');
    const sum = syncSumCheck_(sh, t2)();
    if (sum) what.push(sum);
  } catch (err) {
    what.push(String(err.message || err));
  }
  if (what.length) {
    sh.deleteRow(row);
    SpreadsheetApp.flush();
    syncGuardTrip_();
    throw syncGuardErr_(sh.getName() + ', new row after ' + after + ': ' + what.join('; '));
  }
  return row;
}

/** Op rab_line_clear {tab_gid, section, row, expect}: empties a line's input cells. The row stays as an empty spare
 *  row, like the template's. Already empty (a retry) → nothing to do. */
function api_rab_line_clear(ctx, a) {
  const sh = syncSheetByGid_(ctx, a.tab_gid);
  syncV2_(sh);
  if (a.section === 'equipment') { rapikanAlat_(sh); SpreadsheetApp.flush(); }
  const t = syncLineTarget_(sh, a.section);
  const row = Number(a.row);
  if (!t.isItem(row)) throw syncErr_('line_moved', 'Row ' + row + ' is not a line of ' + t.title + ' anymore.', { row: row });
  const cur = sh.getRange(row, 1, 1, 12).getValues()[0];
  // the input cells that hold something (a spill column's output is not input)
  const fields = Object.keys(t.fields).filter(function (f) {
    const c = t.fields[f][0];
    return cur[c - 1] !== '' && !(t.spill && syncSpillColumn_(sh, t.spill, c));
  });
  if (!fields.length) return syncLineReply_(ctx, sh, { written: [], noop: [] });
  const expect = a.expect || {};
  if (!Object.keys(expect).length) throw syncErr_('invalid', 'expect is missing');
  syncLineSame_(ctx, sh, row, t, expect, {});
  const writes = fields.map(function (f) {
    return { sh: sh, r: row, c: t.fields[f][0], v: null, type: t.fields[f][1], field: f + '@' + row, spillCheck: t.spill,
      expect: Object.prototype.hasOwnProperty.call(expect, f) ? expect[f] : undefined };
  });
  const res = syncWrite_(ctx, writes, { check: syncSumCheck_(sh, t) });
  return syncLineReply_(ctx, sh, res);
}

/** Op rab_internal {tab_gid, set, expect, force}: the internal costs beside the summary. actual_1 .. actual_10 are M
 *  of the ten category rows (empty: the Sheet uses the estimate in L); other_estimate and other_actual are L and M of
 *  "Biaya lain di luar RAB", which the template puts on the SUB TOTAL row, above TOTAL BIAYA KELUAR. */
function api_rab_internal(ctx, a) {
  const sh = syncSheetByGid_(ctx, a.tab_gid);
  syncV2_(sh);
  const v = sh.getRange(20, 6, 41, 4).getDisplayValues();                   // F..I, rows 20 to 60
  const at = function (c, label, prefix) {
    for (let i = 0; i < v.length; i++) {
      const u = String(v[i][c]).trim().toUpperCase();
      if (u === label || (prefix && u.indexOf(label) === 0)) return 20 + i;
    }
    return 0;
  };
  const sub = at(0, 'SUB TOTAL'), other = at(3, 'BIAYA LAIN', true), cost = at(3, 'TOTAL BIAYA KELUAR');
  if (!sub || sub < 31 || other !== sub || cost !== sub + 1) {
    throw syncErr_('needs_sheet', 'The internal cost rows are not where the template has them. Edit them in the Sheet.');
  }
  const set = a.set || {}, expect = a.expect || {};
  const writes = Object.keys(set).map(function (f) {
    const m = /^actual_(\d{1,2})$/.exec(f);
    let r = 0, c = 13;
    if (m && Number(m[1]) >= 1 && Number(m[1]) <= 10) r = sub - 11 + Number(m[1]);
    else if (f === 'other_estimate') { r = other; c = 12; }
    else if (f === 'other_actual') r = other;
    else throw syncErr_('invalid', f + " can't be changed from the admin");
    return { sh: sh, r: r, c: c, v: set[f], type: 'money', field: f, expect: Object.prototype.hasOwnProperty.call(expect, f) ? expect[f] : undefined };
  });
  if (!writes.length) throw syncErr_('invalid', 'Nothing to change');
  const res = syncWrite_(ctx, writes, { force: a.force === true });
  return syncLineReply_(ctx, sh, res);
}

/** Op catalog (read only): Katalog Alat from row 5 for the admin's gear picker, each as [key, category, price per day,
 *  unit]. The key is N, the "Name (Vendor)" text the RAB's dropdown in I offers; an empty price means "by call". */
function api_catalog(ctx) {
  const sh = ctx.ss.getSheetByName('Katalog Alat');
  if (!sh) throw syncErr_('layout', 'Katalog Alat is missing');
  syncHead_(sh, 4, 1, ['Kategori RAB', 'Nama Alat', 'Vendor'], 'Katalog Alat');
  const n = sh.getLastRow() - 4;
  if (n < 1) return { items: [] };
  const items = [];
  sh.getRange(5, 1, Math.min(n, 5000), 14).getValues().forEach(function (r) {
    const key = String(r[13] || '').trim();
    if (!key || !String(r[1] || '').trim()) return;
    items.push([key, String(r[0] || '').trim().toUpperCase(), typeof r[3] === 'number' ? r[3] : null, String(r[4] || '').trim()]);
  });
  return { items: items };
}

/** DEV copy only, run from the editor: the M6 checks (DESIGN.md §10, T20 to T22) on a copy of the template, which it
 *  deletes afterwards. Logs a report; a line starting with FAIL is a failed check. SYNC_WRITES and the guard counter
 *  are put back as they were. */
function syncDevLineTest() {
  const ss = SpreadsheetApp.getActive();
  const props = PropertiesService.getScriptProperties();
  if (ss.getId() === SYNC_PROD_SHEET || ss.getId() !== props.getProperty('SYNC_SHEET_ID')) throw new Error('Run this in the DEV copy only.');
  const ctx = syncCtx_(ss.getId());
  if (ctx.env !== 'dev') throw new Error('Run this in the DEV copy only.');
  const keep = { writes: props.getProperty('SYNC_WRITES'), trips: props.getProperty('SYNC_GUARD_TRIPS') };
  const hashes = ss.getSheets().map(function (s) { return [s.getName(), syncFormulaHash_(s)]; });
  const sh = ss.getSheetByName(TEMPLATE).copyTo(ss).setName('998 M6 TEST');
  const gid = sh.getSheetId(), report = [];
  let fails = 0;
  const ok = function (cond, what) { if (!cond) fails++; report.push((cond ? 'ok   ' : 'FAIL ') + what); };
  const run = function (op, args, key) {
    try { return syncRun_(ctx, key || Utilities.getUuid(), 1, syncOps_()[op], Object.assign({ tab_gid: gid }, args)); }
    catch (err) { return { error: err.code || 'error', message: String(err.message || err), current: err.current || null }; }
  };
  const sec = function (r, key) { return r.rab.data.sections.filter(function (x) { return x.key === key; })[0]; };
  const lineOf = function (r, key, desc) { return sec(r, key).lines.filter(function (l) { return l.desc === desc; })[0]; };
  const view = function (l, keys) { const o = {}; keys.forEach(function (k) { o[k] = l[k]; }); return o; };
  props.setProperty('SYNC_WRITES', 'on');
  try {
    // T20: every section takes 3 lines; its 2 template rows fill first, the third gets an inserted row
    let last = null;
    SYNC_SECTIONS.forEach(function (d) {
      const key = d[1];
      for (let i = 1; i <= 3; i++) {
        const set = { no: i, desc: 'M6 ' + key + ' ' + i, cost: 1000 * i, qty: 1, days: 2 };
        if (d[2].indexOf(3) >= 0) set.person = 'Test Person ' + i;
        if (d[2].indexOf(6) >= 0) set.unit = 'pcs';
        const r = run('rab_line_add', { section: key, set: set });
        if (r.error) { ok(false, key + ' add ' + i + ': ' + r.error + ' ' + r.message); return; }
        if (i === 3) {
          ok(r.inserted === true, key + ': the third line went into an inserted row ' + r.row);
          ok(sec(r, key).lines.length === 3, key + ': 3 lines');
          ok(sec(r, key).subtotal === 12000, key + ': SUB TOTAL 12000 (' + sec(r, key).subtotal + ')');
        }
        last = r;
      }
    });
    const cats = last.rab.data.summary.categories, sumCats = cats.reduce(function (t, c) { return t + (Number(c.total) || 0); }, 0);
    ok(last.rab.data.summary.subtotal === sumCats, 'summary SUB TOTAL = the categories (' + sumCats + ')');
    // T20 equipment: 4 lines into CAMERA and into LAINNYA (3 template rows each)
    ['CAMERA', 'LAINNYA'].forEach(function (g) {
      for (let i = 1; i <= 4; i++) {
        const r = run('rab_line_add', { section: 'equipment', group: g, set: { item: 'M6 gear ' + g + ' ' + i, manual_price: 10000 * i, qty: 1, days: 1 } });
        if (r.error) { ok(false, g + ' add ' + i + ': ' + r.error + ' ' + r.message); return; }
        if (i === 4) {
          const grp = r.rab.data.equipment.groups.filter(function (x) { return x.name === g; })[0];
          ok(r.inserted === true && grp.lines.length === 4, g + ': 4 lines, the fourth in an inserted row ' + r.row);
          last = r;
        }
      }
    });
    ok(last.rab.data.equipment.subtotal === 200000, 'equipment SUB TOTAL 200000 (' + last.rab.data.equipment.subtotal + ')');
    // set: days of pre 1 from 2 to 3
    const p1 = lineOf(last, 'pre', 'M6 pre 1');
    let r = run('rab_line_set', { section: 'pre', lines: [{ row: p1.row, set: { days: 3 }, expect: view(p1, ['no', 'desc', 'cost', 'qty', 'unit', 'days']) }] });
    ok(!r.error && sec(r, 'pre').subtotal === 13000, 'set pre 1 days 3: SUB TOTAL 13000 (' + (r.error ? r.message : sec(r, 'pre').subtotal) + ')');
    // conflict on a changed field, then forced
    const p3 = lineOf(r, 'pre', 'M6 pre 3');
    r = run('rab_line_set', { section: 'pre', lines: [{ row: p3.row, set: { cost: 5000 }, expect: { desc: 'M6 pre 3', cost: 999 } }] });
    ok(r.error === 'conflict', 'stale cost: conflict (' + (r.error || 'saved') + ')');
    r = run('rab_line_set', { section: 'pre', force: true, lines: [{ row: p3.row, set: { cost: 5000 }, expect: { desc: 'M6 pre 3', cost: 999 } }] });
    ok(!r.error && sec(r, 'pre').subtotal === 17000, 'forced: SUB TOTAL 17000 (' + (r.error ? r.message : sec(r, 'pre').subtotal) + ')');
    // T21: a row inserted above the section in the Sheet → the admin's row numbers are off by one → line_moved
    const p2 = lineOf(r, 'pre', 'M6 pre 2'), title = syncSectionAt_(sh, 'pre').row;
    sh.insertRowBefore(title);
    SpreadsheetApp.flush();
    r = run('rab_line_set', { section: 'pre', lines: [{ row: p2.row, set: { cost: 2500 }, expect: view(p2, ['no', 'desc', 'cost', 'qty', 'unit', 'days']) }] });
    ok(r.error === 'line_moved', 'row inserted above: line_moved (' + (r.error || 'saved') + ')');
    sh.deleteRow(title);
    SpreadsheetApp.flush();
    // clear, clear again (nothing to do), then an add fills the emptied row instead of inserting
    r = run('rab_line_clear', { section: 'pre', row: p2.row, expect: view(p2, ['no', 'desc', 'cost', 'qty', 'unit', 'days']) });
    ok(!r.error && sec(r, 'pre').lines.length === 2, 'clear pre 2: 2 lines left');
    r = run('rab_line_clear', { section: 'pre', row: p2.row, expect: view(p2, ['no', 'desc', 'cost', 'qty', 'unit', 'days']) });
    ok(!r.error && r.written.length === 0, 'clear again: nothing written');
    r = run('rab_line_add', { section: 'pre', set: { no: 2, desc: 'M6 pre 2b', cost: 2000, qty: 1, days: 2 } });
    ok(!r.error && r.inserted === false && r.row === p2.row, 'add after clear: reuses row ' + p2.row);
    // a lost answer: the same op id again with its cached answer gone → found through ccc_op, not added twice
    const key = Utilities.getUuid(), set = { no: 4, desc: 'M6 replay', cost: 100, qty: 1, days: 1 };
    const a1 = run('rab_line_add', { section: 'others', set: set }, key);
    CacheService.getScriptCache().remove('op:' + key);
    const a2 = run('rab_line_add', { section: 'others', set: set }, key);
    ok(!a1.error && a2.replayed === true && a2.row === a1.row && sec(a2, 'others').lines.length === 4, 'replayed add: same row, 4 lines');
    // internal actual costs
    r = run('rab_internal', { set: { actual_1: 50000, other_estimate: 7000, other_actual: 8000 }, expect: { actual_1: null, other_estimate: null, other_actual: null } });
    ok(!r.error && r.rab.data.summary.categories[0].actual === 50000 && r.rab.data.internal.other_actual === 8000, 'internal: actual 1 and Biaya lain saved'
      + (r.error ? ' (' + r.message + ')' : ''));
    // T20 forced failure: a SUB TOTAL with a fixed range (like an old tab) leaves the inserted row out → undone, row gone
    const post = syncSectionAt_(sh, 'post');
    sh.getRange(post.sub, 8).setFormula('=SUM(H' + post.head + ':H' + post.last + ')');
    SpreadsheetApp.flush();
    const rows = sh.getLastRow();
    r = run('rab_line_add', { section: 'post', set: { no: 4, desc: 'M6 post 4', cost: 4000, qty: 1, days: 1 } });
    ok(r.error === 'formula_guard' && sh.getLastRow() === rows && syncSectionAt_(sh, 'post').last === post.last,
      'fixed SUB TOTAL: refused and the row removed (' + (r.error || 'saved') + ')');
    // T22: no other sheet's formulas changed
    const changed = hashes.filter(function (h) { const s = ss.getSheetByName(h[0]); return !s || syncFormulaHash_(s) !== h[1]; }).map(function (h) { return h[0]; });
    ok(!changed.length, 'other sheets unchanged' + (changed.length ? ': ' + changed.join(', ') : ''));
  } catch (err) {
    ok(false, 'stopped: ' + (err.stack || err.message || err));
  } finally {
    ss.deleteSheet(sh);
    if (keep.writes) props.setProperty('SYNC_WRITES', keep.writes); else props.deleteProperty('SYNC_WRITES');
    if (keep.trips) props.setProperty('SYNC_GUARD_TRIPS', keep.trips); else props.deleteProperty('SYNC_GUARD_TRIPS');
  }
  report.unshift('Sync ' + SYNC_VERSION + ' M6 test: ' + (fails ? fails + ' failed' : 'all passed'));
  Logger.log(report.join('\n'));
  return report;
}
