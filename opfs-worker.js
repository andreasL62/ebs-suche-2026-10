// Schreibt große Dateien in den privaten Gerätespeicher der App (Origin Private File System).
// Synchrone Zugriffshandles gibt es nur in Workern – sie funktionieren in Safari (iOS), Chrome und Edge.
let handle = null;

async function dir() {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle('ebs2', { create: true });
}

onmessage = async (e) => {
  const { id, cmd } = e.data;
  try {
    if (cmd === 'open') {
      if (handle) { await handle.close(); handle = null; }
      const fh = await (await dir()).getFileHandle(e.data.name, { create: true });
      handle = await fh.createSyncAccessHandle();
      if (e.data.truncate) await handle.truncate(0);
      postMessage({ id, size: await handle.getSize() });
    } else if (cmd === 'write') {
      const n = await handle.write(new Uint8Array(e.data.data), { at: e.data.at });
      postMessage({ id, n });
    } else if (cmd === 'close') {
      if (handle) { await handle.flush(); await handle.close(); handle = null; }
      postMessage({ id });
    } else if (cmd === 'remove') {
      if (handle) { await handle.close(); handle = null; }
      try { await (await dir()).removeEntry(e.data.name); } catch (_) { /* gab es nicht */ }
      postMessage({ id });
    }
  } catch (err) {
    postMessage({ id, error: String((err && err.message) || err) });
  }
};
