const BASE = 'http://127.0.0.1:8765';
const ROUTES: Record<string, string[]> = {
  '/health': ['GET'], '/classify': ['POST'], '/preferences': ['GET', 'PUT'],
  '/overrides': ['PUT', 'DELETE'], '/cache': ['DELETE'], '/activity': ['GET'],
};
chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  const ownPage = sender.id === chrome.runtime.id && sender.url?.startsWith(chrome.runtime.getURL(''));
  const gmail = sender.id === chrome.runtime.id && sender.url?.startsWith('https://mail.google.com/');
  if (!ownPage && !gmail) return;
  if (message.type === 'state') {
    chrome.storage.local.get({enabled: false, batch_size: 1, hidden_categories: [], custom_labels: []}).then(data => respond({enabled: data.enabled, batch_size: data.batch_size, hidden_categories: data.hidden_categories, custom_labels: data.custom_labels}));
    return true;
  }
  if (message.type !== 'api') return;
  const {path, method = 'GET', body} = message;
  if (!ROUTES[path]?.includes(method) || (!ownPage && !['/classify', '/overrides'].includes(path))) {
    respond({error: 'Request not allowed.'}); return;
  }
  (async () => {
    const config = await chrome.storage.local.get({token: '', enabled: false});
    if (gmail && !config.enabled) throw new Error('Classification is paused.');
    if (!config.token) throw new Error('Pair the extension with the local service.');
    const response = await fetch(BASE + path, {
      method,
      headers: {'Authorization': `Bearer ${config.token}`, 'Content-Type': 'application/json', 'X-Jev-Extension-Origin': `chrome-extension://${chrome.runtime.id}`},
      ...(body === undefined ? {} : {body: JSON.stringify(body)}),
      signal: AbortSignal.timeout(path === '/classify' ? 120000 : 10000),
    });
    const data = await response.json();
    if (!response.ok) {
      // Never reflect a validation response that could include the submitted email.
      const detail = typeof data.detail === 'string' ? data.detail : `Request rejected (${response.status}).`;
      throw new Error(detail);
    }
    respond({data});
  })().catch(error => respond({error: error instanceof TypeError ? 'Local service unavailable. Start it on port 8765.' : String(error.message || 'Request failed.')}));
  return true;
});
