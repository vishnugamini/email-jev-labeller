import {accountOf, extractRow, extractOpened, signature} from './extract';
import type { Observation, Result, Category } from './types';
import {ActionPanel} from './action-panel';
const session = crypto.randomUUID();
let account: string | null = null;
let accountScope = '';
const actionPanel = new ActionPanel();
let enabled = false;
let hiddenCategories: Category[] = [];
let epoch = 0;
let scanning = false;
let rescan = false;
const known = new Map<string, Observation>();
const selectedRoutes = new Map<string, Observation>();
let clickedRow: {email: Observation; from: string} | null = null;
const rendered = new WeakMap<Element, string>();
const pending = new Set<string>();
let timer: ReturnType<typeof setTimeout>;
let names: Record<string, string> = {important: 'Important', routine: 'Routine', spam: 'Spam'};
const errors: Record<string, string> = {missing_key: 'Set TYPESAFE_API_KEY and restart the local service.', invalid_key: 'Jev rejected the API key. Update it and restart the service.', timeout: 'Classification timed out. Click Retry.', classification_failed: 'Classification failed. Check service configuration, then retry.'};
async function api(path: string, method: string, body?: unknown) {
  const response = await chrome.runtime.sendMessage({type: 'api', path, method, body});
  if (response?.error) throw new Error(response.error);
  return response.data;
}
function removeUI() {
  document.querySelectorAll('.jev-badge, .jev-detail').forEach(n => n.remove());
  document.querySelectorAll('.jev-sender-name').forEach(n => n.replaceWith(...n.childNodes));
  document.querySelectorAll('.jev-sender-layout').forEach(n => n.replaceWith(...n.childNodes));
  document.querySelectorAll('.jev-sender-cell').forEach(n => n.classList.remove('jev-sender-cell'));
}
function detail(email: Observation, result: Result, badge: HTMLElement, anchor: Element) {
  document.querySelectorAll('.jev-detail').forEach(n => n.remove());
  const panel = document.createElement('div'); panel.className = 'jev-detail';
  panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Email classification');
  const add = (value: string) => { const p = document.createElement('p'); p.textContent = value; panel.append(p); };
  const button = (name: string, action: () => void) => {
    const b = document.createElement('button'); b.textContent = name; b.onclick = action; panel.append(b); return b;
  };
  if (result.error) add(errors[result.error] || result.error);
  else {
    add(`${names[result.label!]} · ${result.evidence === 'body' ? 'Opened message text' : 'Inbox preview'}${result.truncated ? ' · Text truncated' : ''}`);
    if (result.probabilities) add(Object.entries(result.probabilities).map(([key, value]) => `${names[key]} ${Math.round(value * 100)}%`).join(' · '));
    if (result.confidence != null) add(`Confidence: ${Math.round(result.confidence * 100)}%`);
    if (result.actions) {
      for (const [key, title] of [['todo', 'To do'], ['deadline', 'Has a deadline'], ['waiting', 'Waiting']] as const) {
        const signal = result.actions[key];
        add(`${title}: ${signal.probability == null ? signal.state === 'needs_context' ? 'open the conversation for context' : 'unavailable' : `${Math.round(signal.probability * 100)}% · ${signal.state}`}`);
      }
    }
    if (result.source === 'override') add('Your correction');
    if (result.source === 'rule') add('Sender rule');
    if (!email.reliable) add('Corrections last for this tab session.');
    for (const category of Object.keys(names) as Category[]) {
      button(names[category], () => {
        void api('/overrides', 'PUT', {email, category}).then(() => {
          panel.remove(); rendered.delete(anchor); epoch++; schedule();
        }).catch(error => add(error.message));
      });
    }
    button('Reset correction', () => {
      void api('/overrides', 'DELETE', {email}).then(() => {
        panel.remove(); rendered.delete(anchor); epoch++; schedule();
      }).catch(error => add(error.message));
    });
  }
  button('Retry', () => { panel.remove(); rendered.delete(anchor); epoch++; schedule(); });
  button('Close', () => {panel.remove(); badge.focus();});
  panel.addEventListener('keydown', event => {if (event.key === 'Escape') {panel.remove(); badge.focus();}});
  document.body.append(panel);
  const rect = badge.getBoundingClientRect();
  panel.style.top = `${Math.min(rect.bottom + 5, window.innerHeight - 280)}px`;
  panel.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 370))}px`;
  panel.querySelector('button')?.focus();
}
function show(anchor: Element, email: Observation, result: Result) {
  const conversation = email.conversation;
  const row = anchor.closest('tr.zA, [data-jev-row]');
  const openedRoute = !row ? location.hash : '';
  const open = row || openedRoute || (email.reliable && /^[a-f0-9]+$/i.test(conversation)) ? () => {
    if (row?.isConnected) {
      const current = extractRow(row, accountOf(document), session);
      if (current.conversation === conversation) {
        (row.querySelector('.bog, [data-jev-subject]') || row).dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true, view: window}));
        return;
      }
    }
    if (openedRoute) location.hash = openedRoute;
    else if (/^[a-f0-9]+$/i.test(conversation)) location.hash = `#all/${conversation}`;
  } : undefined;
  actionPanel.update(email, result, open);
  const sender = anchor.matches('.yW, [data-jev-sender]');
  const parent = sender ? anchor : anchor.parentElement!;
  parent.querySelector('.jev-badge')?.remove();
  if (result.label && hiddenCategories.includes(result.label)) {
    if (sender) {
      anchor.querySelectorAll('.jev-sender-name, .jev-sender-layout').forEach(n => n.replaceWith(...n.childNodes));
      anchor.classList.remove('jev-sender-cell');
    }
    return;
  }
  const badge = document.createElement('button');
  badge.className = `jev-badge jev-${result.error ? 'error' : ['important', 'routine', 'spam'].includes(result.label!) ? result.label : 'custom'}`;
  badge.textContent = result.error ? 'Retry' : names[result.label!];
  badge.setAttribute('aria-label', `Email classification: ${badge.textContent}. Show details or correct.`);
  badge.onclick = event => {event.preventDefault(); event.stopPropagation(); detail(email, result, badge, anchor);};
  if (sender) {
    anchor.classList.add('jev-sender-cell');
    let layout = anchor.querySelector(':scope > .jev-sender-layout');
    if (!layout) {
      layout = document.createElement('span'); layout.className = 'jev-sender-layout';
      const name = document.createElement('span'); name.className = 'jev-sender-name';
      name.append(...anchor.childNodes); layout.append(name); anchor.append(layout);
    }
    layout.append(badge);
  }
  else anchor.insertAdjacentElement('afterend', badge);
}
function visible(element: Element): boolean {
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < innerHeight;
}
function schedule() { clearTimeout(timer); timer = setTimeout(() => void scan(), 200); }
async function scan() {
  if (scanning) {rescan = true; return;}
  scanning = true;
  try {
    const state = await chrome.runtime.sendMessage({type: 'state'});
    enabled = Boolean(state?.enabled);
    hiddenCategories = state?.hidden_categories || [];
    names = Object.fromEntries([['important', 'Important'], ['routine', 'Routine'], ['spam', 'Spam'], ...(state?.custom_labels || []).map((label: {id: string; name: string}) => [label.id, label.name])]);
    if (!enabled) {removeUI(); actionPanel.setEnabled(false); return;}
    actionPanel.setEnabled(true);
    const nextAccount = accountOf(document);
    const scope = nextAccount || `unknown:${location.pathname}`;
    if (scope !== accountScope) {account = nextAccount; accountScope = scope; known.clear(); selectedRoutes.clear(); clickedRow = null; actionPanel.reset(); removeUI(); epoch++;}
    const runEpoch = epoch;
    type Work = {anchor: Element; email: Observation; stamp: string; current: () => Observation | null};
    const work: Work[] = [];
    for (const row of document.querySelectorAll('tr.zA, [data-jev-row]')) {
      if (!visible(row)) continue;
      const anchor = row.querySelector('.yW, [data-jev-sender]') || row.querySelector('.bog, [data-jev-subject]');
      if (!anchor) continue;
      const email = extractRow(row, account, session);
      known.set(email.conversation, email);
      actionPanel.observe(email);
      const stamp = signature([email.conversation, email.revision, email.account, email.mailbox, epoch]);
      if (rendered.get(anchor) === stamp) continue;
      work.push({anchor, email, stamp, current: () => row.isConnected ? extractRow(row, accountOf(document), session) : null});
    }
    const opened = extractOpened(document, account, session, known, selectedRoutes.get(location.hash));
    if (opened) {
      actionPanel.observe(opened.email);
      // Observation IDs are request IDs, not content: exclude them from the stamp.
      const stableStamp = signature({...opened.email, id: '', epoch});
      if (rendered.get(opened.anchor) !== stableStamp) work.unshift({
        ...opened, stamp: stableStamp, current: () => extractOpened(document, accountOf(document), session, known, selectedRoutes.get(location.hash))?.email || null,
      });
    }
    const groupSize = state.batch_size === 8 ? 8 : 4;
    for (let offset = 0; offset < work.length; offset += groupSize) {
      if (!enabled || runEpoch !== epoch) break;
      const group = work.slice(offset, offset + groupSize).filter(item => !pending.has(item.stamp));
      if (!group.length) continue;
      group.forEach(item => pending.add(item.stamp));
      let results: Result[];
      try { results = (await api('/classify', 'POST', {emails: group.map(item => item.email)})).results; }
      catch (error) { results = group.map(item => ({id: item.email.id, error: (error as Error).message})); }
      for (const item of group) {
        pending.delete(item.stamp);
        const current = item.current();
        if (!enabled || runEpoch !== epoch || !item.anchor.isConnected || !current || current.account !== item.email.account || current.conversation !== item.email.conversation || current.revision !== item.email.revision || current.mailbox !== item.email.mailbox || signature(current.messages) !== signature(item.email.messages)) continue;
        const result = results.find(result => result.id === item.email.id);
        if (result) {show(item.anchor, item.email, result); rendered.set(item.anchor, item.stamp);}
      }
    }
  } catch { /* Extension was reloaded or its worker is unavailable. */ } finally {scanning = false; if (rescan) {rescan = false; schedule();}}
}
chrome.runtime.onMessage.addListener((message, _sender, respond) => {
  if (message.type === 'version' || message.type === 'refresh') respond({ui_version: 3});
  if (message.type === 'refresh') {enabled = false; epoch++; removeUI(); actionPanel.setEnabled(false); schedule();}
});
const observer = new MutationObserver(records => {
  const relevant = records.some(record => {
    const target = record.target instanceof Element ? record.target : record.target.parentElement;
    if (target?.closest('.jev-badge, .jev-detail, #jev-action-root')) return false;
    if (record.type === 'childList' && [...record.addedNodes, ...record.removedNodes].every(n => n instanceof Element && n.matches('.jev-badge, .jev-detail, #jev-action-root'))) return false;
    return true;
  });
  if (relevant) schedule();
});
observer.observe(document.body, {childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['data-thread-id', 'data-legacy-thread-id', 'email', 'aria-label']});
addEventListener('pagehide', () => {observer.disconnect(); clearTimeout(timer); enabled = false; epoch++; actionPanel.setEnabled(false);}, {once: true});
addEventListener('scroll', schedule, true);
addEventListener('click', event => {
  if (!(event.target instanceof Element) || event.ctrlKey || event.metaKey || event.button !== 0) return;
  if (event.target.closest('button, input, a, [role="checkbox"], #jev-action-root')) return;
  const row = event.target.closest('tr.zA, [data-jev-row]');
  if (row) clickedRow = {email: extractRow(row, accountOf(document), session), from: location.hash};
}, true);
addEventListener('hashchange', () => {
  if (clickedRow && location.hash !== clickedRow.from) {
    selectedRoutes.set(location.hash, clickedRow.email); clickedRow = null;
    while (selectedRoutes.size > 100) selectedRoutes.delete(selectedRoutes.keys().next().value!);
  }
  epoch++; document.querySelectorAll('.jev-detail').forEach(e => e.remove()); schedule();});
schedule();
