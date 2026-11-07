import type {Preferences, Category, CustomLabel} from './types';
import './popup.css';
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const categories: Category[] = ['important', 'routine', 'spam'];
let loaded = false;
const status = (text: string, error = false) => {
  $('status').textContent = text; $('status').dataset.error = String(error);
};
function fitDescription(input: HTMLTextAreaElement) {
  input.style.height = 'auto'; input.style.height = `${Math.min(144, Math.max(54, input.scrollHeight))}px`;
}
const dirty = () => {if (loaded) $('save-state').textContent = 'Unsaved changes';};
async function api(path: string, method = 'GET', body?: unknown) {
  const response = await chrome.runtime.sendMessage({type: 'api', path, method, body});
  if (response?.error) throw new Error(response.error);
  return response.data;
}
let staleTabs: number[] = [];
async function refreshTabs(checkOnly = false) {
  const stale: number[] = [];
  for (const tab of await chrome.tabs.query({url: 'https://mail.google.com/*'})) {
    if (!tab.id) continue;
    try {
      const reply = await chrome.tabs.sendMessage(tab.id, {type: checkOnly ? 'version' : 'refresh'});
      if (reply?.ui_version !== 3) stale.push(tab.id);
    } catch {stale.push(tab.id);}
  }
  staleTabs = stale;
  $('reload-notice').hidden = stale.length === 0;
}
function action(id: string, fn: () => Promise<void>) {
  const button = $<HTMLButtonElement>(id);
  button.addEventListener('click', () => {
    button.disabled = true;
    void fn().catch(error => {
      status(error.message, true);
      if (id === 'save') $('save-state').textContent = error.message;
    }).finally(() => {button.disabled = id === 'save' && !loaded;});
  });
}
function customLabels(): CustomLabel[] {
  return [...document.querySelectorAll<HTMLElement>('.custom-choice')].map(row => ({id: row.dataset.id!, name: row.querySelector<HTMLInputElement>('.label-name')!.value.trim(), description: row.querySelector<HTMLTextAreaElement>('textarea')!.value.trim()}));
}
function labelOptions(): [string, string][] {
  return [...categories.map(id => [id, id[0].toUpperCase() + id.slice(1)] as [string, string]), ...customLabels().map(label => [label.id, label.name || 'New label'] as [string, string])];
}
function updateRuleOptions() {
  document.querySelectorAll('.rule').forEach(row => {
    const select = row.querySelectorAll('select')[1]; const selected = select.value;
    select.replaceChildren(...labelOptions().map(([id, name]) => new Option(name, id)));
    select.value = selected;
  });
}
function addLabel(label?: CustomLabel, hidden: string[] = []) {
  if (customLabels().length >= 12) throw new Error('You can add up to 12 custom labels.');
  const id = label?.id || `custom_${crypto.randomUUID().replaceAll('-', '')}`;
  const row = document.createElement('div'); row.className = 'choice custom-choice'; row.dataset.id = id;
  const heading = document.createElement('div'); heading.className = 'choice-heading';
  const name = document.createElement('input'); name.className = 'label-name'; name.placeholder = 'Label name'; name.maxLength = 32; name.required = true; name.value = label?.name || ''; name.setAttribute('aria-label', 'Label name');
  const toggle = document.createElement('label'); toggle.className = 'switch';
  const input = document.createElement('input'); input.type = 'checkbox'; input.id = `visible-${id}`; input.checked = !hidden.includes(id); input.setAttribute('role', 'switch'); input.setAttribute('aria-label', `Show ${label?.name || 'custom label'} badges`);
  const track = document.createElement('span'); track.className = 'switch-track'; track.setAttribute('aria-hidden', 'true'); toggle.append(input, track); heading.append(name, toggle);
  const description = document.createElement('textarea'); description.required = true; description.maxLength = 2000; description.rows = 3; description.placeholder = 'Which emails belong in this label?'; description.setAttribute('aria-label', 'Label description'); description.value = label?.description || '';
  const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'text-button'; remove.textContent = 'Remove label'; remove.onclick = () => {row.remove(); document.querySelectorAll('.rule').forEach(rule => {if (rule.querySelectorAll('select')[1].value === id) rule.remove();}); updateRuleOptions(); dirty();};
  name.addEventListener('input', () => {input.setAttribute('aria-label', `Show ${name.value || 'custom label'} badges`); updateRuleOptions();});
  row.append(heading, description, remove); $('custom-labels').append(row); fitDescription(description);
}
function addRule(rule?: Preferences['rules'][number]) {
  const row = document.createElement('div'); row.className = 'rule';
  const kind = document.createElement('select'); kind.setAttribute('aria-label', 'Match sender by');
  for (const [value, name] of [['address', 'Address'], ['domain', 'Domain']]) kind.add(new Option(name, value));
  const value = document.createElement('input'); value.setAttribute('aria-label', 'Sender address or domain');
  const category = document.createElement('select'); category.setAttribute('aria-label', 'Sender category');
  for (const [id, name] of labelOptions()) category.add(new Option(name, id));
  const remove = document.createElement('button'); remove.textContent = 'Remove'; remove.onclick = () => {row.remove(); dirty();};
  if (rule) {kind.value = rule.kind; value.value = rule.value; category.value = rule.category;}
  row.append(kind, value, category, remove); $('rules').append(row);
}
async function load() {
  const health = await api('/health');
  const prefs: Preferences = await api('/preferences');
  if (!prefs.category_descriptions) throw new Error('Restart the local service to edit choice descriptions.');
  for (const category of categories) {
    const input = $<HTMLTextAreaElement>(`description-${category}`);
    input.value = prefs.category_descriptions[category]; fitDescription(input);
  }
  $<HTMLTextAreaElement>('priorities').value = prefs.priorities;
  $<HTMLSelectElement>('batch').value = String(prefs.batch_size);
  await chrome.storage.local.set({batch_size: prefs.batch_size});
  const visibility = await chrome.storage.local.get({hidden_categories: [] as string[]});
  $('custom-labels').replaceChildren(); (prefs.custom_labels || []).forEach(label => addLabel(label, visibility.hidden_categories || []));
  await chrome.storage.local.set({custom_labels: prefs.custom_labels || []});
  $('rules').replaceChildren(); prefs.rules.forEach(addRule);
  loaded = true;
  $<HTMLFieldSetElement>('choices-editor').disabled = false;
  $<HTMLButtonElement>('save').disabled = false;
  status(health.key_configured ? 'Connected' : 'Set TYPESAFE_API_KEY and restart the service.', !health.key_configured);
}
async function init() {
  const config = await chrome.storage.local.get({enabled: false, token: '', hidden_categories: [] as Category[]});
  $<HTMLInputElement>('enabled').checked = config.enabled;
  for (const category of categories) $<HTMLInputElement>(`visible-${category}`).checked = !(config.hidden_categories || []).includes(category);
  $<HTMLInputElement>('extension-id').value = chrome.runtime.id;
  $<HTMLInputElement>('token').value = config.token;
  if (!config.token) {$<HTMLDetailsElement>('pairing').open = true; status('Pair with your local service to load choices.');}
  else await load();
  await refreshTabs(true);
}
async function saveVisibility() {
  const hidden_categories = [...document.querySelectorAll<HTMLInputElement>('[id^="visible-"]')].filter(input => !input.checked).map(input => input.id.slice(8));
  await chrome.storage.local.set({hidden_categories}); await refreshTabs();
}
$('choices-editor').addEventListener('change', event => {
  if (event.target instanceof HTMLInputElement && event.target.id.startsWith('visible-')) void saveVisibility().catch(error => status(error.message, true));
});
$('enabled').addEventListener('change', () => {
  void chrome.storage.local.set({enabled: $<HTMLInputElement>('enabled').checked}).then(() => refreshTabs()).catch(error => status(error.message, true));
});
$('choices-editor').addEventListener('input', event => {
  if (event.target instanceof HTMLTextAreaElement) fitDescription(event.target);
  dirty();
});
$('priorities').addEventListener('input', dirty);
$('rules').addEventListener('input', dirty);
$('batch').addEventListener('change', dirty);
action('reload-gmail', async () => {
  await Promise.all(staleTabs.map(id => chrome.tabs.reload(id)));
  $('reload-notice').hidden = true;
});
action('pair', async () => {
  const token = $<HTMLInputElement>('token').value.trim();
  if (!token) throw new Error('Enter the token printed by the local service.');
  await chrome.storage.local.set({token}); await load();
  $<HTMLDetailsElement>('pairing').open = false;
});
action('add-label', async () => {addLabel(); dirty(); document.querySelector<HTMLInputElement>('.custom-choice:last-child .label-name')?.focus();});
action('add-rule', async () => {addRule(); dirty();});
action('save', async () => {
  const category_descriptions = {} as Record<Category, string>;
  for (const category of categories) {
    const input = $<HTMLTextAreaElement>(`description-${category}`);
    if (!input.value.trim() || !input.checkValidity()) {
      input.focus(); throw new Error(`Enter a description for ${category[0].toUpperCase() + category.slice(1)} (1–2,000 characters).`);
    }
    category_descriptions[category] = input.value.trim();
  }
  const custom_labels = customLabels();
  const names = ['important', 'routine', 'spam', ...custom_labels.map(label => label.name.toLowerCase())];
  if (custom_labels.some(label => !label.name || !label.description)) throw new Error('Enter a name and description for each custom label.');
  if (new Set(names).size !== names.length) throw new Error('Choose a unique name for each label.');
  const rules = [...document.querySelectorAll('.rule')].map(row => {
    const selects = row.querySelectorAll('select');
    return {kind: selects[0].value as 'address' | 'domain', value: row.querySelector('input')!.value.trim(), category: selects[1].value as Category};
  });
  const prefs: Preferences = await api('/preferences', 'PUT', {category_descriptions, custom_labels, priorities: $<HTMLTextAreaElement>('priorities').value, rules, batch_size: Number($<HTMLSelectElement>('batch').value)});
  await chrome.storage.local.set({batch_size: prefs.batch_size, custom_labels: prefs.custom_labels || []});
  await saveVisibility(); $('save-state').textContent = 'Changes saved';
});
action('refresh', async () => {
  const events = await api('/activity');
  $('activity').replaceChildren();
  if (!events.length) {const p = document.createElement('p'); p.className = 'muted'; p.textContent = 'No requests yet.'; $('activity').append(p); return;}
  for (const event of events.slice(0, 10)) {
    const row = document.createElement('div'); row.className = 'activity-row';
    const title = document.createElement('strong');
    title.textContent = event.error ? `Request failed: ${event.error}` : `${event.model} · ${event.emails} email${event.emails === 1 ? '' : 's'}`;
    const meta = document.createElement('span');
    meta.textContent = [new Date(event.time * 1000).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'}),
      event.latency_ms == null ? '' : `${event.latency_ms} ms`, event.usage?.input_tokens == null ? '' : `${event.usage.input_tokens} input tokens`].filter(Boolean).join(' · ');
    row.append(title, meta); $('activity').append(row);
  }
});
action('clear', async () => {await api('/cache', 'DELETE'); await refreshTabs(); status('Cache cleared. Corrections retained.');});
void init().catch(error => {status(error.message, true); $<HTMLDetailsElement>('pairing').open = true;});
