/* Modul „OL-Regulierung“ für die EBS-Suche.
   Baustellen kommen als Import-Datei (*.olreg, vom PC erzeugt), Messwerte bleiben auf dem Gerät (IndexedDB),
   Zeichnungen öffnen im Viewer der App, Fertigmeldung als Excel (.xlsx) ohne Internet. */
(() => {
'use strict';
const REG = document.getElementById('reg');
const q = s => REG.querySelector(s);
const qa = s => [...REG.querySelectorAll(s)];
const num = v => { if (v === '' || v == null) return null; const n = parseFloat(String(v).replace(',', '.').replace('−', '-')); return isNaN(n) ? null : n; };
const f2 = (v, d = 2) => v == null ? '–' : v.toFixed(d).replace('.', ',');
const h = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* ---------- Speicher (IndexedDB) ---------- */
const DB = (() => {
  let p = null;
  const open = () => p || (p = new Promise((res, rej) => {
    const r = indexedDB.open('ebs2-olreg', 1);
    r.onupgradeneeded = () => { r.result.createObjectStore('baustellen'); r.result.createObjectStore('mess'); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  }));
  const tx = async (st, mode, fn) => { const db = await open(); return new Promise((res, rej) => {
    const t = db.transaction(st, mode), o = t.objectStore(st), r = fn(o);
    t.oncomplete = () => res(r && r.result); t.onerror = () => rej(t.error); }); };
  return {
    get: (st, k) => tx(st, 'readonly', o => o.get(k)),
    put: (st, k, v) => tx(st, 'readwrite', o => o.put(v, k)),
    del: (st, k) => tx(st, 'readwrite', o => o.delete(k)),
    keys: st => tx(st, 'readonly', o => o.getAllKeys()),
  };
})();
try { navigator.storage?.persist?.(); } catch {}

/* ---------- Zustand ---------- */
let B = null;        // Baustelle (Stammdaten)
let S = null;        // Messwerte/Einstellungen dieser Baustelle
let list = [];       // [{id,name}]
const DEF = { fh: 5500, sh: 1800, sl: 400, tolFH: 20, tolSL: 30, tolSH: 50, tolAus: 50, tolRS: 50, alpha: 17, tm: 20, rsMitte: 2600, rsUe: 3 };
const LAST = 'ebs2.olreg.last';
let saveT = 0;
function save() { if (!B) return; clearTimeout(saveT); const id = B.meta.id, s = S;
  saveT = setTimeout(() => DB.put('mess', id, s).catch(e => alert('Speichern fehlgeschlagen: ' + e)), 250); }
/* Abgleich: je Feld Stempel [Zeit ISO, Name] in S.st['m|Mast#i|feld' | 'be|Mast' | 'ar|Mast' | 'kw|nr|feld' | 'km|Mast'] */
const nowIso = () => new Date().toISOString();
function stamp(p) { (S.st ||= {})[p] = [nowIso(), S.g.Name || '']; syQueue(p); }
const stOf = p => S.st?.[p];
const dtT = t => new Date(t).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const whoT = s => s ? `${s[1] || '?'} ${dtT(s[0])}` : '';
function lastOf(pre) { let b = null; for (const p in S.st || {}) if (p.startsWith(pre) && (!b || S.st[p][0] > b[0])) b = S.st[p]; return b; }
const cfg = () => S.cfg;
const T = () => num(S.g.T);
const mast = id => B.maste.find(m => m.id === id);
const kwBy = nr => B.kettenwerke.find(k => String(k.nr) === String(nr));
const mastKm = id => { const o = S.km[id]; if (o != null && o !== '') return num(o); const m = mast(id); return m ? m.km : (B.kmExtern?.[id] ?? null); };
const stpList = () => { const o = []; B.maste.forEach(m => m.stp.forEach((s, i) => o.push({ m, s, i, key: m.id + '#' + i }))); return o; };
const kwOf = key => { const [id, i] = key.split('#'); const v = mast(id)?.stp[+i]?.kw; return v == null ? '' : String(v); };
const kwSel = () => S.g.kwSel || '';
const kwObj = () => kwSel() ? kwBy(kwSel()) : null;

/* ---------- Fachlogik ---------- */
const slSign = b => 'aceg'.includes((b || 'a')[0]) ? -1 : 1;     // von Gleismitte: Pfeil zum Mast = −
/* Einheiten: intern mm; FH/SH in m (2 Stellen), b-Maß in cm (ganzzahlig, immer mit Vorzeichen), Auslegerstellung in mm */
const U = { fh: { k: 1000, d: 2, u: 'm' }, sh: { k: 1000, d: 2, u: 'm' }, sl: { k: 10, d: 0, u: 'cm', sg: 1 }, aus: { k: 10, d: 0, u: 'cm', sg: 1 } };
const uKey = f => ({ sFH: 'fh', sSH: 'sh', sSL: 'sl' }[f] || f);
const sgn = v => v > 0 ? '+' : v < 0 ? '-' : '';
function fmtU(f, mm, opt = {}) { if (mm == null || mm === '' || isNaN(mm)) return ''; const u = U[uKey(f)]; const v = Number(mm) / u.k;
  const a = u.d ? Math.abs(v).toFixed(u.d).replace('.', ',') : String(Math.round(Math.abs(v)));
  const s = (u.sg || opt.sign) ? (Math.round(v * 10 ** u.d) === 0 ? '' : v > 0 ? '+' : (opt.minus || '-')) : (v < 0 ? '-' : '');
  return s + a + (opt.unit ? ' ' + u.u : ''); }
const slTxt = v => fmtU('sl', v, { unit: 1, minus: '−' });
const stpLbl = (s, i) => `Stp ${i + 1} ${/30\.05\.01/.test(s.ausleger) && !/\+ 30\.05\.01/.test(s.ausleger) ? 'hoch' : 'bef'}`;
function lpUni(id, k) { const a = B.fhLageplan?.[id]; if (!a) return null; const v = a.map(x => x[k]); return v.every(x => x === v[0]) ? Math.round(v[0] * 1000) : null; }
/* Soll lt. Stammdaten (Baustellen-Datei) */
function base(m, s) { const c = cfg(), q2 = s.fhsh, L = s.sl;
  return { fh: (q2 && q2[0] != null ? Math.round(q2[0] * 1000) : null) ?? lpUni(m.id, 0) ?? c.fh,
           sh: (q2 && q2[1] != null ? Math.round(q2[1] * 1000) : null) ?? lpUni(m.id, 1) ?? c.sh,
           sl: !L ? slSign(s.bauart) * c.sl : (Math.abs(L[0]) === 400 ? Math.sign(L[0]) * c.sl : L[0]) }; }
/* Soll mit Korrektur aus der App (Felder sFH/sSH/sSL) */
function soll(key, m, s) { const r = S.m[key] || {}, b = base(m, s);
  return { fh: num(r.sFH) ?? b.fh, sh: num(r.sSH) ?? b.sh, sl: num(r.sSL) ?? b.sl }; }
const KF = [['sFH', 'fh', 'FH'], ['sSH', 'sh', 'SH'], ['sSL', 'sl', 'b-Maß']];
/* alle Soll-Korrekturen dieser Baustelle, die von den Stammdaten abweichen */
function korrekturen() { const o = []; stpList().forEach(({ m, s, i, key }) => { const r = S.m[key]; if (!r) return; const b = base(m, s);
  KF.forEach(([sf, f, name]) => { const v = num(r[sf]); if (v != null && v !== b[f]) o.push({ key, m, s, i, sf, f, name, alt: b[f], neu: v, ts: r.ts || '' }); }); }); return o; }
const auslSoll = L => { const t = T(); if (L == null || t == null) return null; return cfg().alpha * 1e-6 * L * (t - cfg().tm) * 1000; };
const rsSoll = L => { const t = T(); if (L == null || t == null) return null; const d = cfg().rsUe * cfg().alpha * 1e-6 * L * (t - cfg().tm) * 1000; return { a: cfg().rsMitte + d, kl: 1.75 + d / 1600, gr: 1.75 - d / 1600 }; };
const chk = (ist, sol, tol) => { if (ist == null || sol == null) return null; const d = ist - sol; return { d, ok: Math.abs(d) <= tol }; };
const ck = (r, f, sol, tol) => r['ok_' + f] ? { d: 0, ok: true, hk: true } : chk(num(r[f]), sol, tol);
function kwFP(k) { const r = S.kw[k.nr] || {}; let fp = r.fp || k.fp;
  if (!fp) { if (k.vonFD === 'f' && k.bisFD !== 'f') fp = k.von; else if (k.bisFD === 'f' && k.vonFD !== 'f') fp = k.bis; } return fp || null; }
function Lauto(id, nr) { if (!nr) return null; const k = kwBy(nr); if (!k) return null; const fp = kwFP(k); if (!fp) return null;
  const a = mastKm(id), b = mastKm(fp); return a == null || b == null ? null : Math.abs(a - b) * 1000; }
const Lof = (key, r) => num(r.L) ?? Lauto(key.split('#')[0], kwOf(key));
function stpStatus(key, m, s) { const r = S.m[key] || {}, so = soll(key, m, s), c = cfg();
  const p = [ck(r, 'fh', so.fh, c.tolFH), ck(r, 'sl', so.sl, c.tolSL), ck(r, 'sh', so.sh, c.tolSH), ck(r, 'aus', auslSoll(Lof(key, r)), c.tolAus)].filter(Boolean);
  return !p.length ? 'open' : p.every(x => x.ok) ? 'ok' : 'nok'; }
/* Auslegerstellung mit Pfeil statt Vorzeichen: ↓ = zum Mast, der in der Liste darunter steht, ↑ = darüber.
   Intern: + = vom Festpunkt weg, − = zum Festpunkt hin. */
function ausNb(key) { const id = key.split('#')[0], nr = kwOf(key), k = kwBy(nr), fp = k && kwFP(k), a = mastKm(id), f = fp && mastKm(fp), idx = B.maste.findIndex(m => m.id === id);
  if (a == null || f == null || a === f) return null;
  const pick = upKm => B.maste.filter(m => m.km != null && m.id !== id && m.stp.some((s, i) => kwOf(m.id + '#' + i) === nr) && (upKm ? m.km > a : m.km < a)).sort((x, y) => upKm ? x.km - y.km : y.km - x.km)[0];
  const side = upKm => { const nb = pick(upKm); return { id: nb ? nb.id : '', ar: nb ? (B.maste.indexOf(nb) > idx ? '↓' : '↑') : (upKm ? '↓' : '↑') }; };
  const posUp = f < a;                                   // vom FP weg = km steigend, wenn der FP bei kleinerem km liegt
  return { pos: side(posUp), neg: side(!posUp) }; }
function ausFmt(mm, key, opt = {}) { if (mm == null || isNaN(mm)) return ''; const cm = Math.round(Math.abs(mm) / 10); if (cm === 0) return '0 cm';
  const n = ausNb(key), sd = n ? (mm > 0 ? n.pos : n.neg) : null; return `${cm} cm ${sd ? sd.ar : (mm > 0 ? '+' : '-')}${opt.mast && sd && sd.id ? ' ' + sd.id : ''}`; }
const ausAr = (key, pos) => { const n = ausNb(key); return n ? (pos ? n.pos.ar : n.neg.ar) : (pos ? '+' : '−'); };
/* Soll-Feld Auslegerstellung: Betrag + Pfeil, Rest dahinter (Nachbarmast, Toleranz) */
const asSgn = (as) => as != null && Math.round(as / 10) !== 0 && as < 0 ? -1 : 1;
const asVal = (as, key) => as == null ? '' : Math.round(as / 10) === 0 ? '0' : Math.round(Math.abs(as) / 10) + ' ' + ausAr(key, as > 0);
const asRest = (as, key) => { const tol = '±' + fmtU('aus', cfg().tolAus).replace(/^[+-]/, '') + ' cm'; if (as == null) return 'T und L eingeben';
  if (Math.round(as / 10) === 0) return 'Mitte ' + tol; const n = ausNb(key), sd = n ? (as > 0 ? n.pos : n.neg) : null; return (sd && sd.id ? sd.id + ' ' : '') + tol; };
const asTxt = (as, key) => 'Soll: ' + (as == null ? 'T und L eingeben' : Math.round(as / 10) === 0 ? 'Mittelstellung (0 cm)' : ausFmt(as, key, { mast: 1 })) + ' · ±' + fmtU('aus', cfg().tolAus).replace(/^[+-]/, '') + ' cm';
function rsEnd(k, e) { const r = S.kw[k.nr] || {}, mid = e === 'a' ? k.von : k.bis, fp = kwFP(k); let auto = null;
  if (fp) { if ((k.vonFD === 'f') !== (k.bisFD === 'f')) auto = k.laenge; else { const a = mastKm(mid), b = mastKm(fp); if (a != null && b != null) auto = Math.abs(a - b) * 1000; } }
  const L = num(r['L' + e]) ?? auto, so = rsSoll(L), ist = num(r['a' + e]); return { L, auto, so, ist, c: chk(ist, so && so.a, cfg().tolRS), r }; }
const mA = v => v == null ? '' : (Math.round(v / 10) / 100).toFixed(2).replace('.', ',');
function kwEnd(id) { const k = kwObj(); if (!k) return ''; const art = (a, b) => a === 'f' && b === 'f' ? 'FA' : 'Rsp';
  if (id === k.von) return `Anfang KW ${k.nr} – ${art(k.vonFD, k.vonTS)}`; if (id === k.bis) return `Ende KW ${k.nr} – ${art(k.bisFD, k.bisTS)}`; return ''; }
function kwEndInfo(id) { const k = kwObj(); if (!k) return ''; const e = id === k.von ? 'a' : id === k.bis ? 'b' : null; if (!e) return '';
  const fd = e === 'a' ? k.vonFD : k.bisFD, ts = e === 'a' ? k.vonTS : k.bisTS;
  if (fd === 'f' && ts === 'f') return `<div class="rnote">${kwEnd(id)}: kein Radspanner</div>`;
  const x = rsEnd(k, e);
  return `<div class="rnote">${kwEnd(id)}: L zum FP ${x.L != null ? Math.round(x.L) + ' m' : '?'} · Soll a unter Spannseil <b>${x.so ? mA(x.so.a) + ' m' : 'T eingeben'}</b>${x.r['ok' + e] ? ' · <b>✓ i.O.</b>' : ' · offen'} (Abhaken unter „Kettenwerke“)</div>`; }

/* ---------- Zeichnungen im Viewer der App ---------- */
function ebsTag(nr, txt) { return nr ? `<button type="button" class="rtag rebs" data-ebs="${nr}" title="Zeichnung Ebs ${nr} öffnen">${txt}</button>` : `<span class="rtag">${txt}</span>`; }
function openEbs(nr) {
  if (typeof findSheet !== 'function' || !window.EBS_READY?.()) { alert('Die Zeichnungen sind auf diesem Gerät noch nicht geladen (Daten → laden).'); return; }
  const t = findSheet(nr);
  if (!t) { alert(`Ebs ${nr} ist im Zeichnungsverzeichnis nicht enthalten.`); return; }
  window.EBS_OPEN(t.n);
}

/* ---------- Oberfläche ---------- */
function shell() {
  REG.innerHTML = `
  <div class="rhead">
    <div class="rrow1"><button type="button" class="iconbtn" id="rClose" title="Zurück zur Suche">←</button><b class="rtitle">OL-Regulierung</b><span id="rSyD" class="rsyd" hidden></span>
      <select id="rBs" aria-label="Baustelle"></select>
      <button type="button" class="iconbtn" id="rMoreB" title="Datum, Prüfer, Import" aria-expanded="false">⋯</button></div>
    <div class="rmore" id="rMore" hidden>
      <div class="rsub" id="rSub"></div>
      <div class="rbar">
        <label>Datum<input id="rDate" type="date"></label>
        <label>Prüfer / Trupp<input id="rName"></label>
        <label class="iconbtn rfile" title="Baustelle importieren (.olreg)">Import<input type="file" id="rImp" hidden></label>
        <a id="rFolder" class="iconbtn rfile" target="_blank" rel="noopener" title="OneDrive-Ordner mit den Baustellen-Dateien öffnen" hidden>Ordner</a>
      </div>
    </div>
    <select id="rKw" class="rkwsel" aria-label="Kettenwerk / Abschnitt"></select>
    <div class="rbar2">
      <span class="rtin"><input id="rT" type="number" step="0.5" inputmode="decimal" placeholder="T" aria-label="Temperatur °C">°C</span>
      <input id="rQ" type="search" placeholder="Mast suchen" aria-label="Suche">
      <select id="rFlt" aria-label="Filter"><option value="">alle</option><option value="open">offen</option><option value="nok">außer Tol.</option><option value="ok">i.O.</option></select>
    </div>
    <nav class="rtabs" id="rTabs"><button data-t="stp" class="on"><span class="rlg">Stützpunkte</span><span class="rsm">Stp</span></button><button data-t="kw"><span class="rlg">Kettenwerke</span><span class="rsm">KW</span></button><button data-t="ar"><span class="rlg">Ausrichtung</span><span class="rsm">Ausr.</span></button><button data-t="be"><span class="rlg">Bestücken</span><span class="rsm">Best.</span></button><button data-t="aus"><span class="rlg">Fertigmeldung</span><span class="rsm">Meldung</span></button><button data-t="cfg" title="Einstellungen">⚙</button></nav>
  </div>
  <div class="rmain"><section id="r-stp"></section><section id="r-kw" hidden></section><section id="r-ar" hidden></section><section id="r-be" hidden></section><section id="r-aus" hidden></section><section id="r-cfg" hidden></section></div>`;
  q('#rClose').onclick = close;
  q('#rMoreB').onclick = () => { const lk = window.EBS_LINK?.() || '', fo = q('#rFolder'); fo.hidden = !lk; if (lk) fo.href = lk; const p = q('#rMore'); p.hidden = !p.hidden; q('#rMoreB').setAttribute('aria-expanded', !p.hidden); };
  q('#rImp').onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) importFile(f); };
  q('#rBs').onchange = e => e.target.value === '' ? null : loadBs(e.target.value);
  q('#rTabs').onclick = e => { const b = e.target.closest('button'); if (!b) return; qa('#rTabs button').forEach(x => x.classList.toggle('on', x === b)); render(); };
  q('#rKw').onchange = e => { S.g.kwSel = e.target.value; save(); render(); };
  q('#rQ').oninput = () => { if (tab() === 'stp') renderStp(); else if (tab() === 'ar') renderAr(); else if (tab() === 'be') renderBe(); };
  q('#rFlt').onchange = renderStp;
}
const tab = () => q('#rTabs button.on').dataset.t;
function render() { if (!B) return renderEmpty(); ['stp', 'kw', 'ar', 'be', 'aus', 'cfg'].forEach(t => q('#r-' + t).hidden = t !== tab());
  ({ stp: renderStp, kw: renderKw, ar: renderAr, be: renderBe, aus: renderAus, cfg: renderCfg })[tab()](); }
function renderEmpty() { ['kw', 'ar', 'be', 'aus', 'cfg'].forEach(t => q('#r-' + t).hidden = true); q('#r-stp').hidden = false;
  q('#rSub').textContent = ''; q('#r-stp').innerHTML = `<div class="rnote">Noch keine Baustelle auf diesem Gerät. Die Baustellen-Datei (<b>*.olreg</b>) wird am PC erzeugt und hier über <b>Import</b> geladen.</div>`; }
function head() {
  const sel = q('#rBs'); sel.innerHTML = list.map(b => `<option value="${h(b.id)}">${h(b.name)}</option>`).join('') + (list.length ? '' : '<option value="">– keine Baustelle –</option>');
  if (!B) return; sel.value = B.meta.id;
  q('#rSub').textContent = [B.meta.strecke, B.meta.bereich, B.meta.bauart].filter(Boolean).join(' · ');
  q('#rKw').innerHTML = '<option value="">alle Kettenwerke</option>' + B.kettenwerke.map(k => `<option value="${k.nr}">KW ${k.nr} – ${h(k.name)} (${k.von}–${k.bis})</option>`).join('');
  q('#rKw').value = kwSel(); q('#rT').value = S.g.T || ''; q('#rDate').value = S.g.Date || new Date().toISOString().slice(0, 10); S.g.Date = q('#rDate').value; q('#rName').value = S.g.Name || '';
}

/* Soll-b-Maß je Stützpunkt (mit Korrekturen aus der App) für die zugeklappte Zeile */
function bsumTxt(m) { const ks = kwSel(); const v = m.stp.map((s, i) => { const key = m.id + '#' + i; return ks && kwOf(key) !== ks ? null : slTxt(soll(key, m, s).sl); }).filter(x => x != null); return v.length ? 'b ' + v.join(' / ') : ''; }
/* Soll-Auslegerstellung je Stützpunkt für die zugeklappte Zeile */
function asumTxt(m) { const ks = kwSel(); const v = m.stp.map((s, i) => { const key = m.id + '#' + i; if (ks && kwOf(key) !== ks) return null;
  const as = auslSoll(Lof(key, S.m[key] || {})); return as == null ? '?' : Math.round(as / 10) === 0 ? '0 cm' : ausFmt(as, key); }).filter(x => x != null);
  return v.length ? 'Ausl. ' + (T() == null ? 'T eingeben' : v.join(' / ')) : ''; }
/* Mastausrichtung (Neigung unbelasteter Maste, Ebs 02.03.13/14): Eckstiel-Abstand mm/m an der 1-m-Waage */
function renderAr() {
  const A = B.ausrichtung, qq = (q('#rQ').value || '').toLowerCase(), ks = kwSel();
  if (!A) { q('#r-ar').innerHTML = '<div class="rnote">Diese Baustellen-Datei enthält noch keine Ausrichtwerte. Neue .olreg vom PC importieren.</div>'; return; }
  let o = '';
  B.maste.forEach(m => { const a = A[m.id]; if (!a) return;
    if (qq && !(m.id + ' ' + (m.bem || '')).toLowerCase().includes(qq)) return;
    if (ks && !kwEnd(m.id) && !m.stp.some((s, i) => kwOf(m.id + '#' + i) === ks)) return;
    const w = a.w ? a.w.map(v => `<td>${v}</td>`).join('') : '<td colspan="4" class="rhint">offen</td>', ok = !!S.ar[m.id];
    o += `<tr class="${ok ? 'rardone' : ''}"><td class="rarm"><b>${h(m.id)}</b>${a.gl ? `<span>${h(a.gl)}</span>` : ''}${a.hw ? `<span class="rkortxt">${h(a.hw)}</span>` : ''}</td><td>${a.t}</td>${w}<td><input type="checkbox" data-arok="${h(m.id)}" ${ok ? 'checked' : ''} aria-label="ausgerichtet">${whoSp('ar|' + m.id, ok)}</td></tr>`; });
  q('#r-ar').innerHTML = `<p class="rhint rpad">Eckstiel-Abstand zur Lotrechten in mm/m (Waage 1,0 m), Blick vom Gleis zum Mast. FM = Flachmast, WM = Winkelmast.<br>Prüfen: ${ebsTag('02.03.13', 'Ebs 02.03.13 Bl. 1')} ${ebsTag('02.03.14', 'Ebs 02.03.14 Bl. 1')}</p>
    <table class="rart"><thead><tr><th>Mast</th><th></th><th>vorne</th><th>hinten</th><th>links</th><th>rechts</th><th>✓</th></tr></thead><tbody>${o || '<tr><td colspan="7" class="rhint">keine Maste</td></tr>'}</tbody></table>`;
}
const whoSp = (p, ok) => `<span class="rwho">${ok ? h(whoT(stOf(p))) : ''}</span>`;
function okCell(t, p) { t.closest('tr').classList.toggle('rardone', t.checked); const w = t.parentElement.querySelector('.rwho'); if (w) w.textContent = t.checked ? whoT(stOf(p)) : ''; }
/* Bestücken: Montagehöhen je Mast (m) – Ausleger, Radspanner, feste Abfangung, Mehrgleisausleger */
const mtF = v => v == null ? '' : v.toFixed(2).replace('.', ',');
function mastVis(m, qq, ks) { return !(qq && !(m.id + ' ' + (m.bem || '')).toLowerCase().includes(qq)) && !(ks && !kwEnd(m.id) && !m.stp.some((s, i) => kwOf(m.id + '#' + i) === ks)); }
function renderBe() {
  const A = B.bestueckung, qq = (q('#rQ').value || '').toLowerCase(), ks = kwSel();
  if (!A) { q('#r-be').innerHTML = '<div class="rnote">Diese Baustellen-Datei enthält noch keine Montagehöhen. Neue .olreg vom PC importieren.</div>'; return; }
  const two = (a, b) => [a, b].filter(v => v != null).map(mtF).join('<br>');
  let o = '';
  B.maste.forEach(m => { const a = A[m.id]; if (!a || !mastVis(m, qq, ks)) return; const ok = !!S.be[m.id];
    const lp = B.lageplan?.[m.id];
    o += `<tr class="${ok ? 'rardone' : ''}"><td class="rarm">${lp ? `<button type="button" class="rlpb" data-lp="${h(m.id)}" title="Lageplan-Ausschnitt">${h(m.id)}</button>` : `<b>${h(m.id)}</b>`}</td><td>${two(a.ab[0], a.ab[1])}</td><td>${two(a.ab[2], a.ab[3])}</td>
      <td>${a.rsp.map(mtF).join('<br>')}${a.gfw != null ? `<span class="rgfw">GFW ${mtF(a.gfw)}</span>` : ''}</td><td>${a.fa.map(mtF).join('<br>')}</td><td>${mtF(a.mga)}</td>
      <td><input type="checkbox" data-beok="${h(m.id)}" ${ok ? 'checked' : ''} aria-label="bestückt">${whoSp('be|' + m.id, ok)}</td></tr>`; });
  q('#r-be').innerHTML = `<p class="rhint rpad">Montagehöhen in m. MF = von Mastfuß, SO = von Schienenoberkante. Ausleger: oben / unten. GFW = Radspanner v. MF-GFW.${B.lageplan ? ' Unterstrichene Mastnummer antippen = Lageplan-Ausschnitt.' : ''}</p>
    <table class="rart rbet"><thead><tr><th>Mast</th><th>Ausl.<br>MF</th><th>Ausl.<br>SO</th><th>Rsp<br>MF</th><th>FA<br>MF</th><th>MGA<br>MF</th><th>✓</th></tr></thead><tbody>${o || '<tr><td colspan="7" class="rhint">keine Maste</td></tr>'}</tbody></table>`;
}
/* Stützpunkte */
function renderStp() {
  const qq = (q('#rQ').value || '').toLowerCase(), fl = q('#rFlt').value, ks = kwSel(); let o = '';
  const fp = B.festpunktMaste || {};
  B.maste.forEach(m => {
    if (qq && !(m.id + ' ' + m.bem).toLowerCase().includes(qq)) return;
    const endT = kwEnd(m.id);
    if (ks && !endT && !m.stp.some((s, i) => kwOf(m.id + '#' + i) === ks)) return;
    const sts = m.stp.map((s, i) => (!ks || kwOf(m.id + '#' + i) === ks) ? stpStatus(m.id + '#' + i, m, s) : null).filter(Boolean);
    const st = sts.includes('nok') ? 'nok' : sts.length && sts.every(x => x === 'ok') ? 'ok' : 'open';
    if (fl && fl !== st) return;
    o += `<details class="rcard" data-m="${m.id}"><summary><span class="rmid">${m.id}</span>${endT ? `<span class="rtag nok">${endT}</span>` : ''}
      ${m.stp.map(s => ebsTag(s.sys.startsWith('30.') ? s.sys : '', s.bauart)).join('')}
      ${fp[m.id] ? `<span class="rtag nok">× ${h(fp[m.id])}</span>` : ''}<span class="rtag open" data-bsum="${m.id}">${bsumTxt(m)}</span>
      <span class="rtag" data-asum="${m.id}">${asumTxt(m)}</span><span class="rtag ${st}">${st === 'ok' ? 'i.O.' : st === 'nok' ? 'außer Tol.' : 'offen'}</span></summary><div class="rbody"></div></details>`;
  });
  const k = kwObj();
  if (k && !qq) { const ext = id => !mast(id), fm = id => `<div class="rnote">${kwEnd(id)}: Mast ${id}${mastKm(id) != null ? ' (km ' + mastKm(id).toFixed(4).replace('.', ',') + ')' : ''} – außerhalb dieser Unterlagen</div>`;
    if (ext(k.von)) o = fm(k.von) + o; if (ext(k.bis)) o += fm(k.bis); }
  q('#r-stp').innerHTML = o || '<p class="rhint">Keine Treffer.</p>';
  qa('#r-stp details').forEach(d => d.addEventListener('toggle', () => { if (d.open) fillBody(d); }));
}
function fld(f, lab, r, sol, sf, tol, bv) { const kor = num(r[sf]) != null && num(r[sf]) !== bv, u = U[f], im = u.sg ? '' : ' inputmode="decimal"', w = 'rv' + (u.sg ? ' rvs' : '');
  return `<label class="rf">${lab}<span class="rrow"><span class="rpre">Ist</span><input type="text"${im} data-f="${f}" value="${h(fmtU(f, num(r[f])))}" class="${w}"><label class="rok"><input type="checkbox" data-f="ok_${f}" ${r['ok_' + f] ? 'checked' : ''}>i.O.</label></span>
  <span class="rrow rhint"><span class="rpre">Soll</span><input type="text"${im} data-f="${sf}" value="${h(fmtU(f, sol))}" class="${w}${kor ? ' rkor' : ''}"> ±${fmtU(f, tol).replace(/^[+-]/, '')} ${u.u}</span>${kor ? `<span class="rhint rkortxt">korrigiert – Stammdaten ${fmtU(f, bv, { unit: 1 })}</span>` : ''}<span class="rd" data-d="${f}"></span></label>`; }
function fillBody(d) {
  const m = mast(d.dataset.m), id = m.id, c = cfg(); let x = `<div class="rstamm">
    <div><b>km</b><input data-km="${id}" value="${h(S.km[id] ?? (m.km ?? ''))}"></div><div><b>Mast Ebs 04.</b>${h(m.ebs04)}</div><div><b>Profil</b>${h(m.profil)}</div>
    <div><b>Mastlänge</b>${f2(m.ml)} m</div><div><b>SO über FOK (e)</b>${m.e.map(v => f2(v)).join(' / ')} m</div><div><b>MVK</b>${m.mvk.map(v => f2(v)).join(' / ')} m</div></div>
    ${kwEndInfo(id)}<div class="rhint">${h(m.bem) || ''}</div>`;
  const ks = kwSel(), hid = m.stp.map((s, i) => i).filter(i => ks && kwOf(id + '#' + i) !== ks);
  if (hid.length) x += `<div class="rhint">Ausgeblendet (anderes Kettenwerk): ${hid.map(i => stpLbl(m.stp[i], i) + ' = KW ' + (kwOf(id + '#' + i) || '–')).join(', ')}</div>`;
  m.stp.forEach((s, i) => { if (hid.includes(i)) return;
    const key = id + '#' + i, r = S.m[key] || {}, so = soll(key, m, s), bs = base(m, s), L = Lof(key, r), k = kwBy(kwOf(key)), aus = (s.ausleger.match(/30\.0[125]\.0\d/) || [''])[0];
    x += `<div class="rstp" data-key="${key}"><h4>${stpLbl(s, i)} ${ebsTag(s.sys.startsWith('30.') ? s.sys : '', 'Ebs ' + h(s.sys) + ' · Bauart ' + h(s.bauart))}${ebsTag(aus, 'Ausleger ' + h(s.ausleger))}${/\+ 30\.05\.01/.test(s.ausleger) ? ebsTag('30.05.01', '30.05.01') : ''}<span class="rtag">MVK ${f2(m.mvk[Math.min(i, m.mvk.length - 1)])} m</span></h4>
      ${s.sl ? `<div class="rhint">b-Maß lt. Lageplan: <b>${slTxt(s.sl[0])}</b>${s.sl[3] ? ' ' + h(s.sl[3]) : ''}</div>` : '<div class="rhint">b-Maß: Vorbelegung aus Bauart</div>'}
      <div class="rgrid">
        <div class="rf">Kettenwerk<b>${k ? 'KW ' + k.nr + ' – ' + h(k.name) : '–'}</b><span class="rhint">lt. KW-Tabelle + Lageplan${(B.kwPruefen || []).includes(id) ? ' – ⚠ prüfen' : ''}</span></div>
        ${fld('fh', 'FH [m]', r, so.fh, 'sFH', c.tolFH, bs.fh)}
        ${fld('sl', 'b-Maß [cm]', r, so.sl, 'sSL', c.tolSL, bs.sl)}
        ${fld('sh', 'SH [m]', r, so.sh, 'sSH', c.tolSH, bs.sh)}
        <label class="rf">L zum Festpunkt [m]<span class="rrow"><span class="rpre"></span><input type="number" class="rv rvs" data-f="L" value="${h(r.L ?? '')}" placeholder="${L != null ? Math.round(L) : 'm'}"></span><span class="rhint">${num(r.L) == null && L != null ? 'auto aus km: ' + Math.round(L) + ' m' : ''}</span></label>
        <label class="rf">Auslegerstellung [cm]<span class="rrow rhint"><span class="rpre">Soll</span><input type="text" class="rv" readonly tabindex="-1" data-asv value="${asVal(auslSoll(L), key)}"> <span data-as>${asRest(auslSoll(L), key)}</span></span><span class="rrow"><span class="rpre"></span><label class="rok"><input type="checkbox" data-f="ok_aus" ${r.ok_aus ? 'checked' : ''}>eingestellt</label></span></label>
        <label class="rf">Erledigt<span class="rrow"><label class="rok"><input type="checkbox" data-f="done" ${r.done ? 'checked' : ''}>reguliert</label></span></label>
      </div><label class="rf">Bemerkung / Maßnahme<textarea rows="2" data-f="note">${h(r.note || '')}</textarea></label><div class="rhint rwhol" data-who></div></div>`; });
  d.querySelector('.rbody').innerHTML = x;
  d.querySelectorAll('.rstp').forEach(upd);
}
function upd(el) { const key0 = el.dataset.key, m0 = mast(key0.split('#')[0]), sumB = el.closest('details')?.querySelector('[data-bsum]'), sumA = el.closest('details')?.querySelector('[data-asum]');
  if (sumB) sumB.textContent = bsumTxt(m0); if (sumA) sumA.textContent = asumTxt(m0);
  const key = el.dataset.key, [id, i] = key.split('#'), m = mast(id), s = m.stp[+i], r = S.m[key] || {}, so = soll(key, m, s), c = cfg();
  const set = (f, res) => { const d = el.querySelector(`[data-d="${f}"]`); if (!d) return; if (!res) { d.textContent = ''; d.className = 'rd'; return; }
    d.textContent = res.hk ? '✓ i.O. (abgehakt)' : fmtU(f, res.d, { sign: 1, unit: 1 }) + ' ' + (res.ok ? '✓ i.O.' : '✗ korrigieren'); d.className = 'rd ' + (res.ok ? 'ok' : 'nok'); };
  set('fh', ck(r, 'fh', so.fh, c.tolFH)); set('sl', ck(r, 'sl', so.sl, c.tolSL)); set('sh', ck(r, 'sh', so.sh, c.tolSH));
  const L = Lof(key, r), xa = ck(r, 'aus', auslSoll(L), c.tolAus), da = el.querySelector('[data-d="aus"]');
  if (da) { if (!xa) { da.textContent = ''; da.className = 'rd'; } else { da.className = 'rd ' + (xa.ok ? 'ok' : 'nok');
    da.textContent = xa.hk ? '✓ i.O. (abgehakt)' : xa.ok ? '✓ i.O.' : '✗ ' + ausFmt(-xa.d, key) + ' verschieben'; } } const a = el.querySelector('[data-as]'); if (a) a.textContent = asRest(auslSoll(L), key); const wl = el.querySelector('[data-who]'); if (wl) { const ls = lastOf('m|' + key + '|'); wl.textContent = ls ? 'zuletzt: ' + whoT(ls) : ''; } const av = el.querySelector('[data-asv]'); if (av) av.value = asVal(auslSoll(L), key); }

/* Kettenwerke & Radspanner */
function renderKw() {
  let o = `<div class="rnote">Radspanner nach Ebs 08.02.21/31, übereinander nach Ebs 08.02.22 (Berechnung identisch): Mittelstellung der Gewichte bei +${cfg().tm} °C = ${mA(cfg().rsMitte)} m unter Spannseil, Übersetzung 1:${cfg().rsUe}. ${ebsTag('08.02.21', 'Ebs 08.02.21')} ${ebsTag('08.02.31', 'Ebs 08.02.31')} ${ebsTag('08.02.22', 'Ebs 08.02.22 RSP übereinander')} ${ebsTag('02.05.33', 'Ebs 02.05.33 Auslegerstellung')}</div>`;
  B.kettenwerke.filter(k => !kwSel() || String(k.nr) === kwSel()).forEach(k => { o += `<div class="rcard rpad" data-kwr="${k.nr}"></div>`; });
  q('#r-kw').innerHTML = o; qa('[data-kwr]').forEach(kwRow);
}
function kwRow(el) { const k = kwBy(el.dataset.kwr), r = S.kw[k.nr] || {}, fp = kwFP(k);
  const ms = B.maste.map(m => `<option ${r.fp === m.id ? 'selected' : ''}>${m.id}</option>`).join('');
  let rows = ''; [['a', k.von, k.vonFD, k.vonTS], ['b', k.bis, k.bisFD, k.bisTS]].forEach(([e, mid, fd, ts]) => {
    if (fd !== 'b' && ts !== 'b') { rows += `<tr><td>${mid}</td><td>FA</td><td colspan="4" class="rhint">kein Radspanner</td></tr>`; return; }
    const x = rsEnd(k, e);
    rows += `<tr><td>${mid}</td><td>Rsp</td><td><input type="number" class="rL" max="750" data-k="L${e}" value="${h(r['L' + e] ?? '')}" placeholder="${x.auto != null ? Math.round(x.auto) : 'm'}"></td>
      <td>${x.so ? mA(x.so.a) + ' m' : '–'}</td>
      <td><label class="rok"><input type="checkbox" data-k="ok${e}" ${r['ok' + e] ? 'checked' : ''}>i.O.</label></td>
      <td><input data-k="n${e}" value="${h(r['n' + e] ?? '')}" placeholder="Notiz"></td></tr>`; });
  el.innerHTML = `<div class="rrow"><b>KW ${k.nr}</b> ${h(k.name)} <span class="rtag">${h(k.bauart)}</span><span class="rtag">${f2(k.laenge, 1)} m</span>
    <label class="rhint">FP <select data-k="fp"><option value="">${fp && !r.fp ? fp + (k.fp ? ' (lt. Lageplan)' : ' (FA)') : '– wählen –'}</option>${ms}</select></label>${k.fpText ? `<span class="rhint">${h(k.fpText)}</span>` : ''}</div>
    <div class="rtw"><table><tr><th>Abfangung</th><th>Art</th><th>L zum FP [m]</th><th>Soll a [m]</th><th>Ist</th><th></th></tr>${rows}</table></div>`;
  el.querySelector('[data-k="fp"]').onchange = e => { (S.kw[k.nr] ||= {}).fp = e.target.value; stamp('kw|' + k.nr + '|fp'); save(); kwRow(el); }; }

/* Auswertung */
function rowsFor() { return stpList().filter(x => !kwSel() || kwOf(x.key) === kwSel()); }
function renderAus() {
  const all = rowsFor(); let ok = 0, nok = 0, op = 0, done = 0, c = cfg();
  const tr = all.map(({ m, s, i, key }) => { const r = S.m[key] || {}, so = soll(key, m, s), st = stpStatus(key, m, s), as = auslSoll(Lof(key, r));
    if (st === 'ok') ok++; else if (st === 'nok') nok++; else op++; if (r.done) done++;
    const cell = (f, sol, tol) => { const x = ck(r, f, sol, tol); return x?.hk ? '<td class="rd ok">✓ i.O.</td>' : x ? `<td class="rd ${x.ok ? 'ok' : 'nok'}">${fmtU(f, num(r[f]))} (${fmtU(f, x.d, { sign: 1 })})</td>` : '<td class="rhint">–</td>'; };
    return `<tr data-st="${st}"><td>${m.id} ${stpLbl(s, i)}</td><td>${s.bauart}</td><td>${kwOf(key) ? 'KW ' + kwOf(key) : ''}</td>${cell('fh', so.fh, c.tolFH)}${cell('sl', so.sl, c.tolSL)}${cell('sh', so.sh, c.tolSH)}${(() => { const x = ck(r, 'aus', as, c.tolAus); return x?.hk ? '<td class="rd ok">✓ i.O.</td>' : x ? `<td class="rd ${x.ok ? 'ok' : 'nok'}">${ausFmt(num(r.aus), key)} (Soll ${ausFmt(as, key)})</td>` : '<td class="rhint">–</td>'; })()}<td>${r.done ? '✓' : ''}</td><td>${h(r.note || '')}</td></tr>`; });
  q('#r-aus').innerHTML = `<div class="rstats"><div><b>${all.length}</b>Stützpunkte</div><div><b class="ok">${ok}</b>i.O.</div><div><b class="nok">${nok}</b>außer Toleranz</div><div><b>${op}</b>offen</div><div><b>${done}</b>reguliert</div></div>
    <p class="rrow"><button type="button" class="primarybtn" id="rXlsx">Fertigmeldung als Excel</button></p>
    <div class="rcard rpad rsync"><h3>Abgleich mit Kollegen</h3>${syncInfo()}
    <p class="rrow"><button type="button" class="primarybtn" id="rBak">Stand teilen</button><label class="secbtn rfile">Stand einlesen<input type="file" id="rBakIn" multiple hidden></label></p>
    <p class="rhint">„Stand teilen“ schickt deine Einträge als Datei (Teams, WhatsApp, Mail, OneDrive). Die Kollegen tippen „Stand einlesen“ und wählen die Datei, auch mehrere auf einmal. Pro Feld gilt der neueste Eintrag, nichts wird doppelt. Die Datei ist zugleich die Sicherung.</p></div>
    <p class="rhint">${kwSel() ? 'Fertigmeldung für KW ' + kwSel() + ' – ' + h(kwObj().name) : 'Fertigmeldung für alle Kettenwerke'} (Auswahl oben „Kettenwerk / Abschnitt“). <label><input type="checkbox" id="rOnlyNok"> nur außer Toleranz anzeigen</label></p>
    <div class="rtw"><table id="rAt"><tr><th>Mast / Stp</th><th>Bauart</th><th>KW</th><th>FH [m] (Abw.)</th><th>b [cm] (Abw.)</th><th>SH [m] (Abw.)</th><th>Ausl. [cm] (Abw.)</th><th>Reg.</th><th>Bemerkung</th></tr>${tr.join('')}</table></div>`;
  q('#rOnlyNok').onchange = e => qa('#rAt tr[data-st]').forEach(t => t.hidden = e.target.checked && t.dataset.st !== 'nok');
  q('#rXlsx').onclick = exportXlsx;
  q('#rBak').onclick = shareStand;
  q('#rBakIn').onchange = e => { const fs = [...e.target.files]; e.target.value = ''; if (fs.length) readStand(fs); };
}
/* ---------- Abgleich ohne Server: Stand-Datei teilen / einlesen ---------- */
function syncInfo() { const mine = Object.values(S.st || {}).filter(s => s[1] === (S.g.Name || '') && s[0] > (S.sent || '')).length;
  const oth = Object.entries(S.sy || {}).sort((a, b) => b[1].localeCompare(a[1])).map(([n, t]) => `${h(n || '?')} (${dtT(t)})`);
  return `${S.g.Name ? '' : '<p class="rnote">Bitte oben unter ⋯ „Prüfer / Trupp“ eintragen, damit die Kollegen sehen, wer was abgehakt hat.</p>'}
    <p class="rhint">${mine ? `<b>${mine}</b> eigene Einträge noch nicht geteilt.` : 'Alle eigenen Einträge geteilt.'}${S.sent ? ' Zuletzt geteilt: ' + dtT(S.sent) + '.' : ''}<br>${oth.length ? 'Eingelesen von: ' + oth.join(', ') : 'Noch nichts von Kollegen eingelesen.'}</p>`; }
async function shareStand() {
  if (!S.g.Name) { const n = (prompt('Dein Name (Prüfer / Trupp) – erscheint bei den Kollegen an deinen Haken:') || '').trim(); if (!n) return;
    S.g.Name = n; q('#rName').value = n; Object.values(S.st || {}).forEach(s => { if (!s[1]) s[1] = n; }); }
  const t = nowIso(), nm = S.g.Name.replace(/[^\wäöüÄÖÜß-]+/g, '_');
  const o = { format: 'olreg-stand', baustelle: B.meta.id, von: S.g.Name, erstellt: t, ...S };
  await share(`OL-Stand_${B.meta.id}_${nm}_${t.slice(0, 16).replace(/[-:T]/g, '')}.json`, new Blob([JSON.stringify(o)], { type: 'application/json' }));
  S.sent = t; save(); if (tab() === 'aus') renderAus(); }
function setVal(p, v, t) { const [a, b, c] = p.split('|'), dst = S[a]; if (!dst || !b) return false;
  if (c === undefined) { if (v != null) dst[b] = v; else delete dst[b]; }
  else { const tg = dst[b] ||= {}; if (v == null) delete tg[c]; else tg[c] = v; if (a === 'm' && (!tg.ts || tg.ts < t)) tg.ts = t; } return true; }
const valOf = p => { const [a, b, c] = p.split('|'), x = S[a]?.[b]; return (c === undefined ? x : x?.[c]) ?? null; };
/* Zusammenführen: je Feld gewinnt der neuere Stempel; ein Stempel ohne Wert = Haken entfernt */
function mergeStand(o) { let n = 0; const st = o.st || {};
  for (const [p, s] of Object.entries(st)) { const l = S.st[p]; if (l && l[0] >= s[0]) continue;
    const [a, b, c] = p.split('|'), src = o[a] || {}; if (!setVal(p, c === undefined ? src[b] : src[b]?.[c], s[0])) continue;
    S.st[p] = s; syQueue(p); n++; }
  Object.values(st).forEach(s => { const k = s[1] || '?'; if (k !== (S.g.Name || '') && (!S.sy[k] || S.sy[k] < s[0])) S.sy[k] = s[0]; });
  return n; }
async function readStand(fs) { let n = 0, f0 = 0; const von = [];
  for (const f of fs) { let o; try { o = JSON.parse(await f.text()); } catch { f0++; continue; }
    if (!o.m) { f0++; continue; }
    if (o.baustelle && o.baustelle !== B.meta.id && !confirm(`„${f.name}“ gehört zu „${o.baustelle}“, nicht zu „${B.meta.id}“. Trotzdem einlesen?`)) continue;
    if (!o.st) { if (confirm(`„${f.name}“ ist eine ältere Sicherung ohne Zeitstempel. Alle Messwerte dieses Geräts damit ERSETZEN?`)) { S = norm(o); n++; } continue; }
    n += mergeStand(o); von.push(o.von || '?'); }
  save(); head(); render();
  alert(`${n} Einträge übernommen${von.length ? ' von ' + [...new Set(von)].join(', ') : ''}.${f0 ? ` ${f0} Datei(en) ungültig.` : ''}`); }

/* Einstellungen */
function renderCfg() { const c = cfg(), i = (k, l, u) => `<label class="rf">${l}<span class="rrow"><input type="number" data-cfg="${k}" value="${c[k]}"> ${u}</span></label>`;
  q('#r-cfg').innerHTML = `<div class="rcard rpad"><h3>Regelwerte</h3><div class="rgrid">${i('fh', 'Regel-FH', 'mm')}${i('sh', 'Regel-SH', 'mm')}${i('sl', 'Regel-b-Maß ±', 'mm')}</div>
    <p class="rhint">b-Maß von Gleismitte (0): Pfeil zum Mast = −, Pfeil vom Mast weg = +. Pfeil ohne Zahl = Regelmaß. Werte hier in mm, in der Erfassung FH/SH in m, b-Maß in cm.</p></div>
    <div class="rcard rpad"><h3>Toleranzen</h3><div class="rgrid">${i('tolFH', 'FH ±', 'mm')}${i('tolSL', 'b-Maß ±', 'mm')}${i('tolSH', 'SH ±', 'mm')}${i('tolAus', 'Auslegerstellung ±', 'mm')}${i('tolRS', 'Radspanner-Gewicht ±', 'mm')}</div>
    <p class="rhint">Auslegerstellung ±50 mm nach ${ebsTag('02.05.33', 'Ebs 02.05.33')}. Übrige Toleranzen mit den Abnahmewerten abgleichen.</p></div>
    <div class="rcard rpad"><h3>Temperaturdehnung</h3><div class="rgrid">${i('alpha', 'α (×10⁻⁶ /K)', '')}${i('tm', 'Mittelstellung bei', '°C')}${i('rsMitte', 'Radspanner a bei Tm', 'mm')}${i('rsUe', 'Radspanner Übersetzung 1:', '')}</div></div>
    <div class="rcard rpad" id="rSyC"></div>
    <div class="rcard rpad"><h3>Baustelle</h3><p class="rhint">${h(B.meta.name)} · erstellt ${h(B.meta.erstellt || '')}<br>Quellen: ${(B.meta.quellen || []).map(h).join(' · ')}</p>
    <div id="rKorr"></div>
    <p class="rrow"><button type="button" class="secbtn" id="rRst">Toleranzen auf Standard</button><button type="button" class="secbtn danger" id="rClr">Messwerte dieser Baustelle löschen</button><button type="button" class="secbtn danger" id="rDel">Baustelle vom Gerät entfernen</button></p></div>`;
  renderKorr(); renderSync();
  q('#rRst').onclick = () => { S.cfg = { ...DEF, ...(B.cfg || {}) }; save(); renderCfg(); };
  q('#rClr').onclick = () => { if (confirm('Alle Messwerte dieser Baustelle auf diesem Gerät löschen? Vorher „Sicherung speichern“!')) { S.m = {}; S.kw = {}; S.km = {}; save(); render(); } };
  q('#rDel').onclick = async () => { if (!confirm(`Baustelle „${B.meta.name}“ samt Messwerten von diesem Gerät entfernen?`)) return;
    await DB.del('baustellen', B.meta.id); await DB.del('mess', B.meta.id); B = null; await refreshList(); if (list[0]) await loadBs(list[0].id); else { head(); render(); } };
}

/* ---------- Soll-Korrekturen: anzeigen, in Stammdaten übernehmen, als neue Baustellen-Datei weitergeben ---------- */
function renderKorr() { const el = q('#rKorr'); if (!el) return; const k = korrekturen();
  el.innerHTML = `<h3>Soll-Korrekturen</h3>${k.length ? `<div class="rtw"><table><tr><th>Mast / Stp</th><th>Wert</th><th>Stammdaten</th><th>korrigiert</th></tr>${k.map(x => `<tr><td>${x.m.id} ${stpLbl(x.s, x.i)}</td><td>${x.name}</td><td>${fmtU(x.f, x.alt, { unit: 1 })}</td><td><b>${fmtU(x.f, x.neu, { unit: 1 })}</b></td></tr>`).join('')}</table></div>
    <p class="rhint">Die Korrekturen gelten bisher nur auf diesem Gerät. „Übernehmen und weitergeben“ schreibt sie in die Stammdaten der Baustelle und erzeugt eine neue Baustellen-Datei (*.olreg) für den PC und die anderen Geräte.</p>
    <p class="rrow"><button type="button" class="primarybtn" id="rKorrEx">Übernehmen und weitergeben (.olreg)</button></p>`
    : `<p class="rhint">Keine. Ein geändertes Soll-Feld am Stützpunkt wird hier als Korrektur gesammelt.</p><p class="rrow"><button type="button" class="secbtn" id="rKorrEx">Baustellen-Datei weitergeben (.olreg)</button></p>`}
    ${(B.meta.korrekturen || []).length ? `<p class="rhint">Stand ${h(B.meta.stand || B.meta.erstellt || '')} · ${B.meta.korrekturen.length} übernommene Korrekturen in der Baustellen-Datei</p>` : ''}`;
  q('#rKorrEx').onclick = korrExport; }
async function korrExport() { const k = korrekturen();
  if (k.length && !confirm(`${k.length} Soll-Korrektur(en) in die Stammdaten übernehmen und als neue Baustellen-Datei weitergeben?`)) return;
  const b2 = JSON.parse(JSON.stringify(B)), d = new Date().toISOString().slice(0, 10), log = b2.meta.korrekturen ||= [];
  k.forEach(x => { const st = b2.maste.find(m => m.id === x.m.id).stp[x.i];
    if (x.f === 'sl') { const o = st.sl || [0, null, 0, '']; st.sl = [x.neu, null, 0, ((o[3] || '') + ' · korrigiert ' + d).replace(/^ · /, '')]; }
    else { const o = st.fhsh || [null, null]; st.fhsh = x.f === 'fh' ? [x.neu / 1000, o[1]] : [o[0], x.neu / 1000]; }
    log.push({ datum: d, mast: x.m.id, stp: x.i + 1, feld: x.name, alt: x.alt, neu: x.neu, pruefer: S.g.Name || '' }); });
  b2.meta.stand = d;
  if (k.length) { B = b2; await DB.put('baustellen', B.meta.id, B); k.forEach(x => { delete S.m[x.key][x.sf]; }); save(); }
  await share(`${B.meta.id}_${d}.olreg`, new Blob([JSON.stringify(b2, null, 1)], { type: 'application/json' }));
  renderCfg(); }
/* nach Import neuer Stammdaten: Korrekturen löschen, die jetzt mit den Stammdaten übereinstimmen */
function cleanKorr() { let n = 0; stpList().forEach(({ m, s, key }) => { const r = S.m[key]; if (!r) return; const b = base(m, s);
  KF.forEach(([sf, f]) => { if (r[sf] !== undefined && (r[sf] === '' || num(r[sf]) === b[f])) { delete r[sf]; n++; } }); }); if (n) save(); return n; }

/* ---------- Eingaben ---------- */
REG.addEventListener('input', e => { const t = e.target; if (!B) return;
  if (t.dataset.km) { S.km[t.dataset.km] = t.value; stamp('km|' + t.dataset.km); save(); return; }
  if (t.dataset.beok) { if (t.checked) S.be[t.dataset.beok] = nowIso(); else delete S.be[t.dataset.beok]; stamp('be|' + t.dataset.beok); okCell(t, 'be|' + t.dataset.beok); save(); return; }
  if (t.dataset.arok) { if (t.checked) S.ar[t.dataset.arok] = nowIso(); else delete S.ar[t.dataset.arok]; stamp('ar|' + t.dataset.arok); okCell(t, 'ar|' + t.dataset.arok); save(); return; }
  const st = t.closest('.rstp'); if (st && t.dataset.f === 'aus') { const r = S.m[st.dataset.key] ||= {}, v = num(t.value), sg = asSgn(auslSoll(Lof(st.dataset.key, r)));
    r.aus = v == null ? '' : String(Math.round(v * 10) * sg); r.ts = nowIso(); stamp('m|' + st.dataset.key + '|aus'); save(); upd(st); return; }
  if (st && t.dataset.f) { const r = S.m[st.dataset.key] ||= {}, f = t.dataset.f, u = U[uKey(f)];
    r[f] = t.type === 'checkbox' ? t.checked : (u && f !== 'L' && t.value.trim() !== '' && num(t.value) != null) ? String(Math.round(num(t.value) * u.k)) : t.value; r.ts = nowIso(); stamp('m|' + st.dataset.key + '|' + f); save(); upd(st); return; }
  const kr = t.closest('[data-kwr]'); if (kr && t.dataset.k && /^ok/.test(t.dataset.k)) { (S.kw[kr.dataset.kwr] ||= {})[t.dataset.k] = t.checked; stamp('kw|' + kr.dataset.kwr + '|' + t.dataset.k); save(); return; }
  if (kr && t.dataset.k && t.dataset.k !== 'fp') { const k = t.dataset.k, v = num(t.value); (S.kw[kr.dataset.kwr] ||= {})[k] = /^a/.test(k) && v != null ? String(Math.round(v * 1000)) : t.value; stamp('kw|' + kr.dataset.kwr + '|' + k); save(); return; }
  if (t.id === 'rT' || t.id === 'rDate' || t.id === 'rName') { S.g[t.id.slice(1)] = t.value; save(); if (t.id === 'rT') { qa('.rstp').forEach(upd); qa('[data-asum]').forEach(x => { x.textContent = asumTxt(mast(x.dataset.asum)); }); if (tab() === 'kw') qa('[data-kwr]').forEach(kwRow); } return; }
  if (t.dataset.cfg) { S.cfg[t.dataset.cfg] = num(t.value) ?? DEF[t.dataset.cfg]; save(); }
});
REG.addEventListener('change', e => { const kr = e.target.closest?.('[data-kwr]'); if (kr && e.target.dataset.k && e.target.dataset.k !== 'fp') kwRow(kr); });
/* Lageplan-Ausschnitt (Bild aus der .olreg, Schlüssel lageplan[Mast] = {bl, img base64-JPEG}) */
function showLp(id) {
  const lp = B.lageplan?.[id]; if (!lp) return;
  let w = document.getElementById('rLp');
  if (!w) { w = document.createElement('div'); w.id = 'rLp'; w.setAttribute('role', 'dialog');
    w.innerHTML = `<div class="rlph"><b id="rLpT"></b><span class="rhint" id="rLpS"></span><button type="button" class="iconbtn" id="rLpZ">Ganz</button><button type="button" class="iconbtn" id="rLpX" aria-label="Schließen">✕</button></div><div class="rlpw" id="rLpW"><img id="rLpI" alt="Lageplan-Ausschnitt"></div>`;
    REG.appendChild(w);
    const W = w.querySelector('#rLpW'), I = w.querySelector('#rLpI');
    const mid = () => setTimeout(() => { W.scrollLeft = (W.scrollWidth - W.clientWidth) / 2; W.scrollTop = (W.scrollHeight - W.clientHeight) / 2; }, 30);
    const zoom = () => { const fit = I.classList.toggle('rfit'); w.querySelector('#rLpZ').textContent = fit ? 'Detail' : 'Ganz'; mid(); };
    w.querySelector('#rLpZ').onclick = zoom; I.onclick = zoom; I.onload = mid;
    w.querySelector('#rLpX').onclick = () => { w.hidden = true; }; }
  const I = w.querySelector('#rLpI'); I.classList.remove('rfit'); w.querySelector('#rLpZ').textContent = 'Ganz';
  I.src = 'data:image/jpeg;base64,' + lp.img;
  w.querySelector('#rLpT').textContent = id; w.querySelector('#rLpS').textContent = `Lageplan Bl. ${lp.bl}`;
  w.hidden = false; I.onload?.();
}
REG.addEventListener('click', e => { const lpb = e.target.closest('[data-lp]'); if (lpb) { e.preventDefault(); showLp(lpb.dataset.lp); return; }
  const ar = e.target.closest('[data-ar]');
  if (ar) { e.preventDefault(); const st = ar.closest('.rstp'), key = st.dataset.key, P = ausAr(key, true), N = ausAr(key, false);
    ar.textContent = ar.textContent === P ? N : P; st.querySelector('[data-f="aus"]').dispatchEvent(new Event('input', { bubbles: true })); return; }
  const p = e.target.closest('[data-pm]');
  if (p) { e.preventDefault(); const inp = p.parentElement.querySelector(`[data-f="${p.dataset.pm}"]`); const v = inp.value.trim();
    inp.value = v.startsWith('-') ? '+' + v.slice(1) : v.startsWith('+') ? '-' + v.slice(1) : '-' + v; inp.dispatchEvent(new Event('input', { bubbles: true })); return; }
  const b = e.target.closest('[data-ebs]'); if (b) { e.preventDefault(); e.stopPropagation(); openEbs(b.dataset.ebs); } });

/* ---------- Baustellen laden / importieren ---------- */
const today = () => (S?.g?.Date || new Date().toISOString().slice(0, 10));
function norm(o) { return { v: 6, cfg: { ...DEF, ...(B.cfg || {}), ...(o.cfg || {}) }, m: o.m || {}, kw: o.kw || {}, g: o.g || {}, km: o.km || {}, ar: o.ar || {}, be: o.be || {}, st: o.st || {}, sy: o.sy || {}, sent: o.sent || '', q: o.q || {} }; }
async function refreshList() { const ks = await DB.keys('baustellen'); list = [];
  for (const k of ks) { const b = await DB.get('baustellen', k); list.push({ id: k, name: b?.meta?.name || k }); } }
async function loadBs(id) { B = await DB.get('baustellen', id); if (!B) return; S = norm(await DB.get('mess', id) || {}); syConnect(); try { localStorage.setItem(LAST, id); } catch {} head(); render(); }
async function importFile(f) {
  let o; try { o = JSON.parse(await f.text()); } catch { alert('Die Datei ist keine gültige Baustellen-Datei.'); return; }
  if (o.format !== 'olreg' || !o.meta?.id || !Array.isArray(o.maste)) {
    if (o.m && B) { await readStand([f]); }
    else alert('Die Datei ist keine Baustellen-Datei (*.olreg).'); return; }
  const old = await DB.get('baustellen', o.meta.id);
  if (old && !confirm(`Baustelle „${o.meta.name}“ ist schon vorhanden. Stammdaten ersetzen? Die Messwerte bleiben erhalten.`)) return;
  await DB.put('baustellen', o.meta.id, o); await refreshList(); await loadBs(o.meta.id); cleanKorr(); render();
  alert(`Baustelle „${o.meta.name}“ geladen: ${o.maste.length} Maste, ${o.maste.reduce((a, m) => a + m.stp.length, 0)} Stützpunkte, ${o.kettenwerke.length} Kettenwerke.`);
}

/* ---------- Teilen / Speichern ---------- */
async function share(name, blob) {
  const file = new File([blob], name, { type: blob.type });
  if (navigator.canShare?.({ files: [file] })) { try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e.name === 'AbortError') return; } }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

/* ---------- Excel (.xlsx) ohne Bibliothek ---------- */
const crcT = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = b => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = crcT[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
function zip(files) { const enc = new TextEncoder(), parts = [], cen = []; let off = 0;
  for (const [name, txt] of files) { const nb = enc.encode(name), d = enc.encode(txt), c = crc32(d);
    const lh = new DataView(new ArrayBuffer(30)); lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint32(14, c, true); lh.setUint32(18, d.length, true); lh.setUint32(22, d.length, true); lh.setUint16(26, nb.length, true);
    parts.push(lh, nb, d);
    const ch = new DataView(new ArrayBuffer(46)); ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint32(16, c, true); ch.setUint32(20, d.length, true); ch.setUint32(24, d.length, true); ch.setUint16(28, nb.length, true); ch.setUint32(42, off, true);
    cen.push(ch, nb); off += 30 + nb.length + d.length; }
  const cs = cen.reduce((a, x) => a + x.byteLength, 0), end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, cs, true); end.setUint32(16, off, true);
  return new Blob([...parts, ...cen, end], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }); }
const xe = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
const colL = i => { let s = ''; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = (i - m - 1) / 26; } return s; };
/* Zellen: Wert oder {v, s}; s = Stil: 1 fett, 2 Kopf (fett+grau), 3 grün, 4 rot, 5 Titel, 6 gelb */
function sheetXml(rows, widths, merges = []) {
  const r = rows.map((row, ri) => `<row r="${ri + 1}">${row.map((c, ci) => { if (c == null || c === '') return ''; const o = typeof c === 'object' ? c : { v: c }, ref = colL(ci) + (ri + 1), st = o.s ? ` s="${o.s}"` : '';
    return typeof o.v === 'number' && isFinite(o.v) ? `<c r="${ref}"${st}><v>${o.v}</v></c>` : `<c r="${ref}"${st} t="inlineStr"><is><t xml:space="preserve">${xe(o.v)}</t></is></c>`; }).join('')}</row>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"/></sheetViews><cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols><sheetData>${r}</sheetData>${merges.length ? `<mergeCells count="${merges.length}">${merges.map(m => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>` : ''}<pageSetup orientation="landscape" paperSize="9" fitToWidth="1" fitToHeight="0"/></worksheet>`; }
function xlsx(sheets) {
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="2"><numFmt numFmtId="164" formatCode="+0;-0;0"/><numFmt numFmtId="165" formatCode="+0.00;-0.00;0.00"/></numFmts><fonts count="3"><font><sz val="10"/><name val="Arial"/></font><font><b/><sz val="10"/><name val="Arial"/></font><font><b/><sz val="14"/><name val="Arial"/></font></fonts>
<fills count="6"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFD9D9D9"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFC6EFCE"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFC7CE"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFEB9C"/></patternFill></fill></fills>
<borders count="2"><border/><border><left style="thin"/><right style="thin"/><top style="thin"/><bottom style="thin"/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="14"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment wrapText="1" vertical="center"/></xf><xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0" applyFill="1" applyBorder="1"/><xf numFmtId="0" fontId="0" fillId="4" borderId="1" xfId="0" applyFill="1" applyBorder="1"/><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="0" fillId="5" borderId="1" xfId="0" applyFill="1" applyBorder="1"/><xf numFmtId="2" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1"/><xf numFmtId="165" fontId="0" fillId="4" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1"/><xf numFmtId="164" fontId="0" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1"/><xf numFmtId="164" fontId="0" fillId="4" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1"/></cellXfs><cellStyles count="1"><cellStyle name="Standard" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  const files = [['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((s, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`],
    ['_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${xe(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((s, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
    ['xl/styles.xml', styles], ...sheets.map((s, i) => [`xl/worksheets/sheet${i + 1}.xml`, s.xml])];
  return zip(files); }
const xWho = p => { const s = stOf(p); return s && s[1] ? ' – ' + s[1] : ''; };
function exportXlsx() {
  const c = cfg(), k = kwObj(), all = rowsFor(), H = v => ({ v, s: 2 }), mm = v => v == null || v === '' ? '' : Math.round(num(v));
  const stCell = st => st === 'ok' ? { v: 'i.O.', s: 3 } : st === 'nok' ? { v: 'außer Toleranz', s: 4 } : { v: 'offen', s: 6 };
  const kopf = [[{ v: 'Fertigmeldung Oberleitung – Regulierung', s: 5 }], [],
    [{ v: 'Baustelle', s: 1 }, B.meta.name], [{ v: 'Strecke', s: 1 }, B.meta.strecke || ''], [{ v: 'Bereich', s: 1 }, B.meta.bereich || ''],
    [{ v: 'Abschnitt', s: 1 }, k ? `KW ${k.nr} – ${k.name} (${k.von} bis ${k.bis})` : 'alle Kettenwerke'],
    [{ v: 'Datum', s: 1 }, S.g.Date || ''], [{ v: 'Temperatur', s: 1 }, S.g.T ? num(S.g.T) + ' °C' : ''], [{ v: 'Prüfer / Trupp', s: 1 }, S.g.Name || ''],
    [{ v: 'Toleranzen', s: 1 }, `FH ±${fmtU('fh', c.tolFH)} m · b-Maß ±${fmtU('sl', c.tolSL).replace(/^[+-]/, '')} cm · SH ±${fmtU('sh', c.tolSH)} m · Auslegerstellung ±${fmtU('aus', c.tolAus).replace(/^[+-]/, '')} cm · Radspanner ±${mA(c.tolRS)} m`], []];
  let ok = 0, nok = 0, op = 0, done = 0;
  const hd = ['Mast', 'Stp', 'km', 'System Ebs', 'Bauart', 'Ausleger', 'KW', 'FH Soll [m]', 'FH Ist [m]', 'FH Abw [m]', 'b Soll [cm]', 'b Ist [cm]', 'b Abw [cm]', 'SH Soll [m]', 'SH Ist [m]', 'SH Abw [m]', 'L FP [m]', 'Ausl. Soll', 'Ausl. eingestellt', 'Status', 'reguliert', 'Bemerkung', 'erfasst von'].map(H);
  const body = all.map(({ m, s, i, key }) => { const r = S.m[key] || {}, so = soll(key, m, s), L = Lof(key, r), as = auslSoll(L), st = stpStatus(key, m, s);
    if (st === 'ok') ok++; else if (st === 'nok') nok++; else op++; if (r.done) done++;
    const ab = (f, sol, tol) => { const x = ck(r, f, sol, tol); if (!x) return ''; if (x.hk) return { v: 'i.O.', s: 3 }; const m2 = U[f].d === 2;
      return { v: m2 ? Math.round(x.d) / 1000 : Math.round(x.d / U[f].k), s: (m2 ? 10 : 12) + (x.ok ? 0 : 1) }; };
    const vm = (f, v) => v == null || v === '' || isNaN(num(v)) ? '' : U[f].d === 2 ? { v: Math.round(num(v)) / 1000, s: 7 } : { v: Math.round(num(v) / U[f].k), s: 8 };
    return [m.id, stpLbl(s, i).slice(4), mastKm(m.id) ?? '', s.sys, s.bauart, s.ausleger, kwOf(key) ? Number(kwOf(key)) : '',
      vm('fh', so.fh), vm('fh', r.fh), ab('fh', so.fh, c.tolFH), vm('sl', so.sl), vm('sl', r.sl), ab('sl', so.sl, c.tolSL), vm('sh', so.sh), vm('sh', r.sh), ab('sh', so.sh, c.tolSH),
      L != null ? Math.round(L) : '', as != null ? ausFmt(as, key, { mast: 1 }) : '', r.ok_aus ? { v: 'ja', s: 3 } : '', stCell(st), r.done ? 'ja' : '', r.note || '', whoT(lastOf('m|' + key + '|'))]; });
  const sum = [[{ v: 'Zusammenfassung', s: 5 }], [], [H('Stützpunkte'), all.length], [H('i.O.'), { v: ok, s: 3 }], [H('außer Toleranz'), { v: nok, s: 4 }], [H('offen'), { v: op, s: 6 }], [H('reguliert'), done], [],
    [{ v: 'Bestätigung', s: 1 }], ['Die Oberleitung im angegebenen Abschnitt wurde reguliert. Abweichungen außerhalb der Toleranz sind in der Tabelle gekennzeichnet.'], [], ['Ort, Datum:', '', '', 'Unterschrift:']];
  const rs = [[{ v: 'Radspanner (Ebs 08.02.21/31)', s: 5 }], [`Temperatur ${S.g.T ? num(S.g.T) + ' °C' : '–'} · Mittelstellung ${mA(c.rsMitte)} m bei ${c.tm} °C · Übersetzung 1:${c.rsUe}`], [],
    ['KW', 'Bezeichnung', 'Mast', 'Abfangung', 'L zum FP [m]', 'Soll a [m]', 'Status', 'Notiz'].map(H)];
  B.kettenwerke.filter(x => !k || x.nr === k.nr).forEach(x => [['a', x.von, x.vonFD], ['b', x.bis, x.bisFD]].forEach(([e, mid, fd]) => {
    if (fd !== 'b') { rs.push([x.nr, x.name, mid, 'FA']); return; } const y = rsEnd(x, e);
    rs.push([x.nr, x.name, mid, 'Rsp', y.L != null ? Math.round(y.L) : '', y.so ? { v: Math.round(y.so.a / 10) / 100, s: 7 } : '', y.r['ok' + e] ? { v: 'i.O.', s: 3 } : { v: 'offen', s: 6 }, y.r['n' + e] || '']); }));
  const ars = [[{ v: 'Mastausrichtung (Ebs 02.03.13 Bl. 1 / 02.03.14 Bl. 1)', s: 5 }], ['Eckstiel-Abstand zur Lotrechten in mm/m (Waage 1,0 m), Blick vom Gleis zum Mast'], [],
    ['Mast', 'Typ', 'Blick von', 'vorne', 'hinten', 'links', 'rechts', 'Status', 'Hinweis'].map(H)];
  if (B.ausrichtung) B.maste.forEach(m => { const a = B.ausrichtung[m.id]; if (!a) return;
    if (k && !kwEnd(m.id) && !m.stp.some((s, i) => kwOf(m.id + '#' + i) === String(k.nr))) return;
    ars.push([m.id, a.t, a.gl || '', ...(a.w || ['', '', '', '']), S.ar[m.id] ? { v: 'ausgerichtet' + xWho('ar|' + m.id), s: 3 } : { v: 'offen', s: 6 }, a.hw || '']); });
  const bes = [[{ v: 'Bestücken – Montagehöhen [m]', s: 5 }], ['MF = von Mastfuß, SO = von Schienenoberkante'], [],
    ['Mast', 'Ausl. oben v. MF', 'Ausl. unten v. MF', 'Ausl. oben v. SO', 'Ausl. unten v. SO', 'Rsp v. MF', 'Rsp 2 v. MF', 'GFW v. MF', 'FA v. MF', 'FA 2 v. MF', 'MGA v. MF', 'Status'].map(H)];
  if (B.bestueckung) B.maste.forEach(m => { const a = B.bestueckung[m.id]; if (!a || (k && !mastVis(m, '', String(k.nr)))) return;
    const c2 = v => v == null ? '' : { v, s: 7 };
    bes.push([m.id, ...a.ab.map(c2), c2(a.rsp[0]), c2(a.rsp[1]), c2(a.gfw), c2(a.fa[0]), c2(a.fa[1]), c2(a.mga), S.be[m.id] ? { v: 'bestückt' + xWho('be|' + m.id), s: 3 } : { v: 'offen', s: 6 }]); });
  const blob = xlsx([
    { name: 'Fertigmeldung', xml: sheetXml([...kopf, hd, ...body], [9, 5, 9, 10, 7, 28, 5, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 16, 11, 14, 9, 30, 18]) },
    { name: 'Radspanner', xml: sheetXml(rs, [5, 30, 10, 11, 12, 11, 10, 30]) },
    ...(B.bestueckung ? [{ name: 'Bestücken', xml: sheetXml(bes, [10, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 11]) }] : []),
    ...(B.ausrichtung ? [{ name: 'Ausrichtung', xml: sheetXml(ars, [10, 6, 18, 8, 8, 8, 8, 13, 34]) }] : []),
    { name: 'Zusammenfassung', xml: sheetXml(sum, [18, 12, 12, 30]) },
    ...(() => { const kk = korrekturen().filter(x => !k || kwOf(x.key) === String(k.nr)), lg = (B.meta.korrekturen || []).filter(x => !k || kwOf(x.mast + '#' + (x.stp - 1)) === String(k.nr));
      if (!kk.length && !lg.length) return []; const rows = [[{ v: 'Soll-Korrekturen', s: 5 }], [], ['Mast', 'Stp', 'Wert', 'Soll Plan', 'Soll korrigiert', 'Datum', 'Prüfer', 'Stand'].map(H)];
      const fk = n => ({ 'Fahrdrahthöhe': 'fh', 'FH': 'fh', 'Systemhöhe': 'sh', 'SH': 'sh' }[n] || 'sl');
      lg.forEach(x => rows.push([x.mast, x.stp, x.feld, fmtU(fk(x.feld), x.alt, { unit: 1 }), fmtU(fk(x.feld), x.neu, { unit: 1 }), x.datum, x.pruefer, 'in Stammdaten']));
      kk.forEach(x => rows.push([x.m.id, stpLbl(x.s, x.i).slice(4), x.name, fmtU(x.f, x.alt, { unit: 1 }), { v: fmtU(x.f, x.neu, { unit: 1 }), s: 6 }, (x.ts || '').slice(0, 10), S.g.Name || '', 'nur Gerät']));
      return [{ name: 'Soll-Korrekturen', xml: sheetXml(rows, [9, 5, 15, 14, 18, 11, 16, 14]) }]; })()]);
  share(`Fertigmeldung_${B.meta.id}${k ? '_KW' + k.nr : ''}_${today()}.xlsx`, blob);
}

/* ---------- Öffnen / Schließen ---------- */
async function open() { REG.hidden = false; document.body.classList.add('regopen');
  if (!REG.firstChild) { shell(); await refreshList(); let id = null; try { id = localStorage.getItem(LAST); } catch {}
    if (id && list.some(b => b.id === id)) await loadBs(id); else if (list[0]) await loadBs(list[0].id); else { head(); render(); } } }
function close() { REG.hidden = true; document.body.classList.remove('regopen'); }
/* ---------- Online-Abgleich: Firebase Realtime Database (REST + Stream), Zugang NUR auf dem Gerät (localStorage) ----------
   Pfad /t/<Team-Code>/<Baustelle>/e/<Feld> = { v: Wert, t: Zeit, n: Name }. Regeln: nur /t/$code mit Code ≥ 20 Zeichen lesbar/schreibbar. */
const SYK = 'ebs2.sync';
const syCfg = () => { try { const c = JSON.parse(localStorage.getItem(SYK) || 'null'); return c?.url && c?.code ? c : null; } catch { return null; } };
const enc = p => p.replace(/[_.#$\[\]\/%]/g, c => '_' + c.charCodeAt(0).toString(16));
const dec = k => k.replace(/_([0-9a-f]{2})/g, (m, x) => String.fromCharCode(parseInt(x, 16)));
let ES = null, syT = 0, syRT = 0, syBusy = false, syState = '', syLast = '';
const syPend = new Set();
const syBase = () => { const c = syCfg(); return c && B ? `${c.url.replace(/\/+$/, '')}/t/${encodeURIComponent(c.code)}/${enc(B.meta.id)}/e` : null; };
function syQueue(p) { if (!syCfg() || !S) return; (S.q ||= {})[p] = 1; clearTimeout(syT); syT = setTimeout(syPush, 1200); }
async function syPush() { const u = syBase(); if (!u || syBusy) return syShow(); const ks = Object.keys(S.q || {}); if (!ks.length) return syShow();
  if (!navigator.onLine) { syState = 'offline'; return syShow(); }
  syBusy = true; const body = {}, snap = {}; ks.forEach(p => { const s = S.st[p]; if (s) { body[enc(p)] = { v: valOf(p), t: s[0], n: s[1] || '' }; snap[p] = s[0]; } });
  try { const r = await fetch(u + '.json', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error(r.status === 401 || r.status === 403 ? 'kein Zugriff – Regeln/Team-Code prüfen' : 'HTTP ' + r.status);
    ks.forEach(p => { if (!S.st[p] || S.st[p][0] === snap[p]) delete S.q[p]; }); save(); syState = 'ok'; syLast = nowIso(); }
  catch (e) { syState = navigator.onLine ? 'Fehler: ' + (e.message || e) : 'offline'; }
  finally { syBusy = false; syShow(); } }
function syApply(p, x) { const l = S.st[p]; if (!x?.t || (l && l[0] >= x.t)) return false; if (!setVal(p, x.v, x.t)) return false;
  S.st[p] = [x.t, x.n || '']; const k = x.n || '?'; if (k !== (S.g.Name || '') && (!S.sy[k] || S.sy[k] < x.t)) S.sy[k] = x.t; return true; }
/* Einträge aus der Zeit vor den Stempeln (vor v33) nachträglich stempeln, damit sie hochgeladen werden */
function stampOld() { if (!S) return 0; const st = S.st ||= {}, n0 = S.g.Name || '', now = nowIso(); let n = 0;
  const add = (p, t) => { if (!st[p]) { st[p] = [t || now, n0]; (S.q ||= {})[p] = 1; n++; } };
  Object.entries(S.m || {}).forEach(([k, r]) => Object.keys(r || {}).forEach(f => { if (f !== 'ts' && r[f] !== '' && r[f] != null) add('m|' + k + '|' + f, r.ts); }));
  ['be', 'ar'].forEach(a => Object.entries(S[a] || {}).forEach(([k, v]) => add(a + '|' + k, typeof v === 'string' && v[4] === '-' ? v : null)));
  Object.entries(S.kw || {}).forEach(([k, r]) => Object.keys(r || {}).forEach(f => { if (r[f] !== '' && r[f] != null) add('kw|' + k + '|' + f); }));
  Object.entries(S.km || {}).forEach(([k, v]) => { if (v !== '' && v != null) add('km|' + k); });
  if (n) save(); return n; }
function syConnect() { if (ES) { ES.close(); ES = null; } const u = syBase(); if (!u) { syState = ''; return syShow(); }
  stampOld();
  syState = 'verbinde …'; syShow();
  ES = new EventSource(u + '.json');
  const on = e => { let d; try { d = JSON.parse(e.data); } catch { return; } if (!d) return; const ch = [];
    const take = (k, x) => { const p = dec(k); if (syApply(p, x)) ch.push(p); };
    const parts = (d.path || '/').split('/').filter(Boolean);
    if (!parts.length) Object.entries(d.data || {}).forEach(([k, x]) => take(k, x)); else if (parts.length === 1) take(parts[0], d.data);
    syState = 'ok'; syLast = nowIso(); if (ch.length) { save(); syRefresh(ch); } syShow(); syPush(); };
  ES.addEventListener('put', on); ES.addEventListener('patch', on);
  ES.addEventListener('cancel', () => { syState = 'kein Zugriff – Regeln/Team-Code prüfen'; syShow(); });
  ES.onerror = () => { syState = navigator.onLine ? 'verbinde …' : 'offline'; syShow(); }; }
/* Anzeige nach Änderungen von Kollegen: nicht während der Eingabe, offene Karten + Scrollposition bleiben */
function syRefresh(ps) { ps.forEach(p => syPend.add(p)); clearTimeout(syRT); syRT = setTimeout(syDo, 300); }
function syDo() { if (!B || !syPend.size) return; const a = document.activeElement;
  if (a && REG.contains(a) && (a.tagName === 'TEXTAREA' || (a.tagName === 'INPUT' && a.type !== 'checkbox' && a.type !== 'file'))) { a.addEventListener('blur', () => syRefresh([]), { once: true }); return; }
  syPend.clear(); if (REG.hidden || tab() === 'cfg') return;
  const sc = [document.scrollingElement, REG, q('.rmain')].filter(Boolean).map(e => [e, e.scrollTop]), op = qa('details[open]').map(d => d.dataset.m);
  render(); op.forEach(id => { const d = q(`details[data-m="${CSS.escape(id)}"]`); if (d) { d.open = true; fillBody(d); } }); sc.forEach(([e, t]) => { e.scrollTop = t; }); }
function syShow() { const d = q('#rSyD'); if (!d) return; const c = syCfg(), n = Object.keys(S?.q || {}).length;
  d.hidden = !c; d.className = 'rsyd ' + (syState === 'ok' ? 'on' : /Fehler|Zugriff/.test(syState) ? 'err' : 'off');
  d.textContent = (syState === 'ok' ? '●' : '○') + (n ? ' ' + n : ''); d.title = 'Online-Abgleich: ' + (syState || 'aus') + (n ? `, ${n} warten` : '');
  const s = q('#rSyS'); if (s) s.textContent = (c ? (syState || 'aus') : 'aus') + (n ? ` · ${n} Einträge warten` : '') + (syLast && syState === 'ok' ? ' · ' + dtT(syLast) : ''); }
function syCode() { const a = crypto.getRandomValues(new Uint8Array(24)), z = 'abcdefghijkmnpqrstuvwxyz23456789'; return [...a].map(b => z[b & 31]).join('') + z[a[0] >> 5]; }
function syParse(t) { const m = String(t || '').match(/olsync=([A-Za-z0-9+/=_-]+)/); if (!m) return null; try { const o = JSON.parse(decodeURIComponent(escape(atob(m[1].replace(/-/g, '+').replace(/_/g, '/'))))); return o.url && o.code ? o : null; } catch { return null; } }
function renderSync() { const el = q('#rSyC'); if (!el) return; const c = syCfg() || JSON.parse(localStorage.getItem(SYK + '.e') || '{}');
  el.innerHTML = `<h3>Online-Abgleich</h3><p class="rhint">Status: <b id="rSyS"></b></p>
    <label class="rf">Zugang einfügen (vom Kollegen erhalten)<span class="rrow"><input id="rSyP" placeholder="Text mit olsync=… hier einfügen"><button type="button" class="secbtn" id="rSyPb">Übernehmen</button></span></label>
    <label class="rf">Datenbank-Adresse<input id="rSyU" value="${h(c.url || '')}" placeholder="https://….europe-west1.firebasedatabase.app" autocomplete="off"></label>
    <label class="rf">Team-Code<span class="rrow"><input id="rSyK" value="${h(c.code || '')}" autocomplete="off"><button type="button" class="secbtn" id="rSyN">Neu</button></span></label>
    <p class="rrow"><button type="button" class="primarybtn" id="rSyOn">${syCfg() ? 'Neu verbinden' : 'Verbinden'}</button>${syCfg() ? '<button type="button" class="secbtn" id="rSyL">Zugang an Kollegen</button><button type="button" class="secbtn danger" id="rSyX">Trennen</button>' : ''}</p>
    <p class="rhint">Alle mit gleicher Adresse und gleichem Team-Code sehen sofort, was die anderen eintragen. Ohne Netz wird gesammelt und später gesendet (○ mit Zahl oben = wartende Einträge). Der Zugang wird nur auf diesem Gerät gespeichert, nicht in der App und nicht im Internet veröffentlicht. „Stand teilen“ bleibt als Weg ohne Netz.</p>`;
  q('#rSyN').onclick = () => { if (!q('#rSyK').value || confirm('Neuen Team-Code erzeugen? Alle Kollegen brauchen dann den neuen Zugang.')) q('#rSyK').value = syCode(); };
  q('#rSyPb').onclick = () => { const o = syParse(q('#rSyP').value); if (!o) return alert('Kein gültiger Zugang (olsync=…) gefunden.'); q('#rSyU').value = o.url; q('#rSyK').value = o.code; q('#rSyOn').click(); };
  q('#rSyOn').onclick = () => { const url = q('#rSyU').value.trim().replace(/\/+$/, ''), code = q('#rSyK').value.trim();
    if (!/^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)*\.(firebasedatabase\.app|firebaseio\.com)$/i.test(url)) return alert('Datenbank-Adresse prüfen (https://….firebasedatabase.app).');
    if (code.length < 20) return alert('Team-Code zu kurz (mind. 20 Zeichen) – „Neu“ tippen.');
    if (!S.g.Name) { const n = (prompt('Dein Name (Prüfer / Trupp) – erscheint bei den Kollegen an deinen Haken:') || '').trim(); if (!n) return; S.g.Name = n; q('#rName').value = n; Object.values(S.st || {}).forEach(s => { if (!s[1]) s[1] = n; }); }
    try { localStorage.setItem(SYK, JSON.stringify({ url, code })); } catch { return alert('Speichern auf dem Gerät nicht möglich.'); }
    Object.keys(S.st || {}).forEach(p => { S.q[p] = 1; }); save(); syConnect(); syPush(); renderSync(); };
  if (syCfg()) { q('#rSyL').onclick = async () => { const c2 = syCfg(), tk = btoa(unescape(encodeURIComponent(JSON.stringify(c2)))).replace(/\+/g, '-').replace(/\//g, '_');
      const txt = `Zugang Online-Abgleich OL-Regulierung (nur intern weitergeben):\nEBS-Suche → Regul. → ⚙ → „Zugang einfügen“ → diesen ganzen Text einfügen → Übernehmen\nolsync=${tk}`;
      try { if (navigator.share) { await navigator.share({ text: txt }); return; } } catch (e) { if (e.name === 'AbortError') return; }
      try { await navigator.clipboard.writeText(txt); alert('Zugang kopiert – an die Kollegen schicken (Teams/WhatsApp).'); } catch { prompt('Zugang kopieren:', txt); } };
    q('#rSyX').onclick = () => { if (!confirm('Online-Abgleich auf diesem Gerät trennen? Die Daten auf dem Gerät bleiben.')) return; try { localStorage.setItem(SYK + '.e', localStorage.getItem(SYK)); localStorage.removeItem(SYK); } catch {} syConnect(); renderSync(); }; }
  syShow(); }
window.addEventListener('online', () => { syPush(); if (!ES || ES.readyState === 2) syConnect(); });
setInterval(() => { if (B && syCfg()) syPush(); }, 30000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && B && syCfg()) { if (!ES || ES.readyState === 2) syConnect(); syPush(); } });
document.getElementById('regBtn').onclick = open;
window.OLREG = { open, close };
})();
