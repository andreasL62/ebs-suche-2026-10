'use strict';
/* Lokaler Gerätespeicher für PDF und Suchdaten (Origin Private File System) */
const Store = (() => {
  const PDF = 'doc.pdf', DATA = 'ebs-daten.bin', META = 'meta.json';
  let worker = null, seq = 0;
  const pending = new Map();

  const supported = () => !!(navigator.storage && navigator.storage.getDirectory && window.Worker);

  function call(msg, transfer) {
    if (!worker) {
      worker = new Worker('opfs-worker.js');
      worker.onmessage = (e) => {
        const p = pending.get(e.data.id); pending.delete(e.data.id);
        if (p) e.data.error ? p.reject(new Error(e.data.error)) : p.resolve(e.data);
      };
    }
    const id = ++seq;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      worker.postMessage({ ...msg, id }, transfer || []);
    });
  }

  async function dir() {
    const root = await navigator.storage.getDirectory();
    return root.getDirectoryHandle('ebs2', { create: true });
  }
  async function file(name) {
    try { return await (await (await dir()).getFileHandle(name)).getFile(); } catch { return null; }
  }
  async function readMeta() {
    const f = await file(META);
    if (!f) return null;
    try { return JSON.parse(await f.text()); } catch { return null; }
  }
  async function writeMeta(m) {
    const data = new TextEncoder().encode(JSON.stringify(m));
    await call({ cmd: 'open', name: META, truncate: true });
    await call({ cmd: 'write', data: data.buffer, at: 0 }, [data.buffer]);
    await call({ cmd: 'close' });
  }

  /* Zustand: sind beide Dateien vollständig vorhanden? */
  async function status() {
    const meta = await readMeta();
    const pdf = await file(PDF), data = await file(DATA);
    const done = !!(meta && pdf && data && pdf.size === meta.pdfSize && data.size === meta.datenSize);
    return { meta, pdf, data, done, pdfBytes: pdf ? pdf.size : 0, dataBytes: data ? data.size : 0 };
  }

  /* Datenstrom in Datei schreiben (in 4-MB-Blöcken) */
  async function pump(reader, name, startAt, total, onProgress) {
    let pos = startAt, parts = [], len = 0;
    const flush = async () => {
      if (!len) return;
      const buf = new Uint8Array(len); let o = 0;
      for (const p of parts) { buf.set(p, o); o += p.length; }
      parts = []; const n = len; len = 0;
      await call({ cmd: 'write', data: buf.buffer, at: pos }, [buf.buffer]);
      pos += n; onProgress && onProgress(pos, total);
    };
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value); len += value.length;
      if (len >= (4 << 20)) await flush();
    }
    await flush();
    await call({ cmd: 'close' });
    if (total && pos !== total) throw new Error(`Übertragung unvollständig (${pos} von ${total} Bytes)`);
    return pos;
  }

  /* Vom PC laden – setzt einen abgebrochenen Download fort */
  async function download(url, name, total, onProgress) {
    let { size } = await call({ cmd: 'open', name, truncate: false });
    if (size > total) { await call({ cmd: 'open', name, truncate: true }); size = 0; }
    if (size === total) { await call({ cmd: 'close' }); onProgress && onProgress(total, total); return; }
    let res = await fetch(url, { cache: 'no-store', headers: size ? { Range: `bytes=${size}-` } : {} });
    if (size && res.status !== 206) {                    // Fortsetzen nicht möglich → neu beginnen
      await call({ cmd: 'open', name, truncate: true }); size = 0;
      if (res.status !== 200) res = await fetch(url, { cache: 'no-store' });
    }
    if (!res.ok) throw new Error(`Download fehlgeschlagen (HTTP ${res.status})`);
    await pump(res.body.getReader(), name, size, total, onProgress);
  }

  async function importFile(f, name, onProgress) {
    await call({ cmd: 'open', name, truncate: true });
    await pump(f.stream().getReader(), name, 0, f.size, onProgress);
  }

  async function remove() {
    for (const n of [META, DATA, PDF]) await call({ cmd: 'remove', name: n });
  }
  const removeFile = (name) => call({ cmd: 'remove', name });

  /* Datenpaket öffnen: [4 Byte Kopflänge][Kopf-JSON][Wortpositionen] */
  /* Microsoft Intune (App-Schutz der Firma) verschlüsselt Dateien, die eine verwaltete App wie OneDrive
     an eine nicht verwaltete App weitergibt. Solche Dateien beginnen mit "MSMAMARPCRY". */
  async function isProtected(f) {
    try {
      const b = new Uint8Array(await f.slice(0, 16).arrayBuffer());
      return new TextDecoder('latin1').decode(b).includes('MSMAMARPCRY');
    } catch { return false; }
  }
  async function checkProtected(f, what) {
    if (await isProtected(f)) {
      throw new Error(`${what} sind durch den Firmen-App-Schutz (Microsoft Intune) verschlüsselt und können `
        + 'außerhalb der Firmen-Apps nicht gelesen werden. Das ist eine Sicherheitsrichtlinie der Firmen-IT – '
        + 'bitte die Dateien auf einem anderen, erlaubten Weg auf das Gerät bringen oder die IT fragen.');
    }
  }
  async function describe(f, label) {        // für Fehlermeldungen: Größe und erste Bytes
    let hex = '–';
    try { hex = [...new Uint8Array(await f.slice(0, 12).arrayBuffer())].map(b => b.toString(16).padStart(2, '0')).join(' '); } catch {}
    return `${label}: ${f.size.toLocaleString('de-DE')} Bytes, Anfang: ${hex}`;
  }
  async function openBundle() {
    const f = await file(DATA);
    if (!f || f.size < 8) throw new Error('Suchdaten fehlen oder sind leer' + (f ? ` (${f.size} Bytes)` : ''));
    await checkProtected(f, 'Die Suchdaten');
    const hl = new DataView(await f.slice(0, 4).arrayBuffer()).getUint32(0, true);
    if (hl < 2 || hl > f.size - 4) throw new Error('Keine gültige Datendatei. ' + await describe(f, 'Gespeichert'));
    const head = JSON.parse(await f.slice(4, 4 + hl).text());
    const base = 4 + hl;
    return {
      head,
      async words(n) {
        const e = head.words && head.words[n];
        if (!e) return null;
        return JSON.parse(await f.slice(base + e[0], base + e[0] + e[1]).text());
      },
      thumb(n) {                            // fertiges Vorschaubild (JPG) oder null
        const e = head.thumbs && head.thumbs[n];
        return e ? f.slice(base + e[0], base + e[0] + e[1], 'image/jpeg') : null;
      },
    };
  }
  async function peekBundleHead(f) {       // für den Import vom Gerät: Kopf einer gewählten Datei lesen
    const hl = new DataView(await f.slice(0, 4).arrayBuffer()).getUint32(0, true);
    if (hl <= 0 || hl > f.size) throw new Error('Keine gültige Datendatei (ebs-daten.bin)');
    return JSON.parse(await f.slice(4, 4 + hl).text());
  }

  return { supported, status, readMeta, writeMeta, download, importFile, remove, removeFile, openBundle, describe, checkProtected, peekBundleHead, file, PDF, DATA };
})();
