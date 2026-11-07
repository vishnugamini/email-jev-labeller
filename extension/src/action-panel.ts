import type {ActionGroup, Observation, Result} from './types';
import styles from './action-panel.css?inline';
import {signature} from './extract';
const groups: Record<ActionGroup, string> = {todo: 'To do', deadline: 'Has a deadline', waiting: 'Waiting'};
interface Item {
  key: string; revision: string; bodyVersion: string; sender: string; subject: string; preview: string;
  result?: Result; open?: () => void; done: boolean;
}
const element = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', value?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag); node.className = className;
  if (value !== undefined) node.textContent = value;
  return node;
};
const button = (name: string, action: () => void, className = '') => {
  const node = element('button', className, name); node.type = 'button'; node.onclick = action; return node;
};
export class ActionPanel {
  readonly host = element('div');
  private shadow = this.host.attachShadow({mode: 'open'});
  private panel = element('section', 'panel');
  private launcher = button('Actions', () => this.toggle(true), 'launcher');
  private list = element('div', 'list');
  private status = element('p', 'scope');
  private undoRow = element('div', 'undo-row');
  private tabs = new Map<ActionGroup, HTMLButtonElement>();
  private items = new Map<string, Item>();
  private active: ActionGroup = 'todo';
  private opened = false;
  private lastDone: string | null = null;
  private notice = '';
  constructor() {
    this.host.id = 'jev-action-root'; this.host.hidden = true;
    const style = element('style'); style.textContent = styles; this.shadow.append(style);
    this.panel.hidden = true; this.panel.setAttribute('role', 'complementary'); this.panel.setAttribute('aria-label', 'Email actions');
    const header = element('header'); header.append(element('h2', '', 'Actions'));
    const close = button('×', () => this.toggle(false), 'close'); close.setAttribute('aria-label', 'Close actions'); header.append(close);
    const scopeNote = element('p', 'scope-note', 'From conversations scanned in this tab. Open a thread for fuller context.');
    const tabs = element('div', 'tabs'); tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', 'Action groups');
    for (const [key, title] of Object.entries(groups) as [ActionGroup, string][]) {
      const tab = button(title, () => {this.active = key; this.render();}, 'tab');
      tab.id = `jev-tab-${key}`; tab.setAttribute('role', 'tab'); tab.setAttribute('aria-controls', 'jev-action-list');
      tab.addEventListener('keydown', event => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault(); const keys = Object.keys(groups) as ActionGroup[];
        const index = (keys.indexOf(this.active) + (event.key === 'ArrowRight' ? 1 : -1) + keys.length) % keys.length;
        this.active = keys[index]; this.render(); this.tabs.get(this.active)!.focus();
      });
      this.tabs.set(key, tab); tabs.append(tab);
    }
    this.list.id = 'jev-action-list'; this.list.setAttribute('role', 'tabpanel');
    this.status.setAttribute('role', 'status');
    this.panel.append(header, scopeNote, tabs, this.status, this.undoRow, this.list);
    this.panel.addEventListener('keydown', event => {if (event.key === 'Escape') this.toggle(false);});
    this.shadow.append(this.launcher, this.panel); document.body.append(this.host);
  }
  private toggle(opened: boolean) {
    this.opened = opened; this.panel.hidden = !opened; this.launcher.hidden = opened;
    if (opened) {this.render(); this.tabs.get(this.active)!.focus();} else this.launcher.focus();
  }
  setEnabled(enabled: boolean) {
    this.host.hidden = !enabled;
    if (!enabled) {this.reset(); this.opened = false; this.panel.hidden = true; this.launcher.hidden = false;}
  }
  reset() {this.items.clear(); this.lastDone = null; this.notice = ''; this.render();}
  observe(email: Observation) {
    const key = email.conversation;
    const previous = this.items.get(key);
    const latest = email.messages.at(-1);
    // Retain only a bounded content marker, not full message bodies, for change detection.
    const bodyVersion = email.evidence === 'body' && latest ? signature(email.messages) : '';
    if (previous && previous.revision === email.revision && (!bodyVersion || !previous.bodyVersion || previous.bodyVersion === bodyVersion)) return;
    this.items.delete(key);
    this.items.set(key, {key, revision: email.revision, bodyVersion, sender: (email.sender_name || email.sender || 'Unknown sender').slice(0, 200),
      subject: email.subject.slice(0, 500) || '(No subject)', preview: email.preview.slice(0, 240), done: false});
    while (this.items.size > 200) this.items.delete(this.items.keys().next().value!);
    this.render();
  }
  update(email: Observation, result: Result, open?: () => void) {
    this.observe(email);
    const item = this.items.get(email.conversation)!;
    if (item.revision !== email.revision) return;
    item.result = result; item.open = open;
    if (email.evidence === 'body') {
      const latest = email.messages.at(-1);
      item.bodyVersion = latest ? signature(email.messages) : '';
    }
    if (!item.preview) item.preview = (email.messages.at(-1)?.text || '').slice(0, 240);
    this.notice = result.error || result.action_error ? 'Some messages could not be analyzed. Retry their badges.'
      : !result.actions ? 'Restart the local service to enable action analysis.' : '';
    this.render();
  }
  private matches(item: Item, group: ActionGroup) {return !item.done && !item.result?.error && item.result?.actions?.[group]?.state === 'positive';}
  private render() {
    const values = [...this.items.values()];
    const count = values.filter(item => Object.keys(groups).some(key => this.matches(item, key as ActionGroup))).length;
    this.launcher.textContent = count ? `Actions · ${count}` : 'Actions';
    for (const [key, tab] of this.tabs) {
      const count = values.filter(item => this.matches(item, key)).length;
      tab.textContent = `${groups[key]} ${count}`;
      tab.setAttribute('aria-selected', String(key === this.active)); tab.tabIndex = key === this.active ? 0 : -1;
    }
    const analyzed = values.filter(item => item.result && !item.result.error).length;
    const uncertain = values.filter(item => item.result?.actions?.[this.active]?.state === 'uncertain').length;
    const unavailable = values.filter(item => item.result?.actions?.[this.active]?.state === 'unavailable').length;
    this.status.textContent = this.notice || `${analyzed} scanned${uncertain ? ` · ${uncertain} uncertain` : ''}${unavailable ? ` · ${unavailable} unavailable` : ''}`;
    this.list.setAttribute('aria-labelledby', `jev-tab-${this.active}`);
    this.undoRow.replaceChildren();
    if (this.lastDone && this.items.get(this.lastDone)?.done) {
      this.undoRow.append(element('span', '', 'Marked done in this tab'), button('Undo', () => {
        const item = this.items.get(this.lastDone!); if (item) item.done = false;
        this.lastDone = null; this.render();
      }, 'text-button'));
    }
    this.list.replaceChildren();
    const matching = values.filter(item => this.matches(item, this.active)).reverse();
    if (!matching.length) {
      this.list.append(element('p', 'empty', this.active === 'waiting' && !values.some(item => item.result?.evidence === 'body')
        ? 'Open conversations to check whether someone owes you a response.' : 'No matching conversations in the messages scanned so far.'));
      return;
    }
    for (const item of matching) {
      const card = element('article', 'card');
      card.append(element('p', 'sender', item.sender), element('h3', '', item.subject));
      if (item.preview) card.append(element('p', 'preview', item.preview));
      const footer = element('div', 'card-footer');
      footer.append(element('span', 'evidence', item.result?.evidence === 'body' ? 'Opened thread' : 'Preview only'));
      const actions = element('div', 'card-actions');
      const open = button('Open', () => item.open?.()); open.disabled = !item.open;
      actions.append(open, button('Done', () => {item.done = true; this.lastDone = item.key; this.render();}, 'text-button'));
      footer.append(actions); card.append(footer); this.list.append(card);
    }
  }
}
