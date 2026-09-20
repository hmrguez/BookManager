const api = WovenleafLibby.api;
const $ = id => document.getElementById(id);
let snapshot = null;
const safari = api.runtime.getManifest().permissions.includes('nativeMessaging');
function show(value) {
  snapshot = value;
  $('delivery').hidden = !snapshot;
  $('titles').replaceChildren();
  for (const item of snapshot?.observations ?? []) {
    const row = document.createElement('li'); row.textContent = `${item.title} · ${item.percent}%`; $('titles').append(row);
  }
  $('send').textContent = safari ? 'Send to Wovenleaf again' : 'Send to Wovenleaf';
}
async function refresh() {
  const result = await api.runtime.sendMessage({ type: 'status' });
  $('enabled').checked = !!result.enabled;
  $('capture').disabled = !result.enabled;
  show(result.snapshot);
  $('status').textContent = snapshot ? `Captured ${new Date(snapshot.capturedAt).toLocaleString()}` : 'No capture yet. Keep your shelf visible, then capture.';
}
$('enabled').addEventListener('change', async () => {
  await api.runtime.sendMessage({ type: 'enable', enabled: $('enabled').checked }); await refresh();
});
$('capture').addEventListener('click', async () => {
  try {
    const [tab] = await api.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error();
    const result = await api.tabs.sendMessage(tab.id, { type: 'capture-now' });
    await refresh();
    $('status').textContent = result?.message ?? (result?.transport === 'native' ? 'Saved for Wovenleaf. Open the app to apply or review.' : result?.ok ? 'Ready to send to Wovenleaf.' : 'Open your Libby Shelf first.');
  } catch { $('status').textContent = 'Open Libby Shelf in this browser, refresh it, then try again.'; }
});
$('send').addEventListener('click', async () => {
  if (!snapshot) return;
  try {
    if (safari) {
      const result = await api.runtime.sendMessage({ type: 'retry' });
      $('status').textContent = result.message ?? 'Saved for Wovenleaf. Open the app to apply or review.';
    } else {
      // Prepare synchronously so Web Share retains this button's user activation.
      const file = new File([JSON.stringify(snapshot)], 'wovenleaf-libby.json', { type: 'application/json' });
      if (!navigator.share) { $('status').textContent = 'Sharing is unavailable here. Save the file and import it in Wovenleaf → Settings → Libby.'; return; }
      const data = navigator.canShare?.({ files: [file] }) ? { files: [file], title: 'Wovenleaf Libby progress' }
        : { text: 'Wovenleaf Libby progress\n' + JSON.stringify(snapshot), title: 'Wovenleaf Libby progress' };
      // Some mobile extension popups expose Web Share but never open its sheet
      // or settle its promise. Keep the working local-file path visible.
      $('status').textContent = 'Opening the share sheet. If nothing opens, choose Save progress file, then import it in Wovenleaf → Settings → Libby.';
      await navigator.share(data);
      $('status').textContent = 'Share sheet closed. Check Wovenleaf for your update.';
    }
  } catch (error) { if (error.name !== 'AbortError') $('status').textContent = 'Sharing is unavailable here. Save the progress file instead.'; }
});
$('save').addEventListener('click', () => {
  if (!snapshot) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(snapshot)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = 'wovenleaf-libby.json'; link.click();
  $('status').textContent = 'Finish the download, then import wovenleaf-libby.json in Wovenleaf → Settings → Libby. You can also open it from Quetta Downloads and share it with Wovenleaf.';
  setTimeout(() => URL.revokeObjectURL(url), 30000);
});
refresh().catch(() => { $('status').textContent = 'Reopen the companion to try again.'; });
