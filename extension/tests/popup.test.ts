// @vitest-environment jsdom
import {beforeEach, expect, it, vi} from 'vitest';
import popupHTML from '../popup.html?raw';
import type {Preferences} from '../src/types';
let prefs: Preferences;
let sent: any[];
function mount() {
  document.body.innerHTML = new DOMParser().parseFromString(popupHTML, 'text/html').body.innerHTML;
}
beforeEach(() => {
  vi.resetModules(); mount(); sent = [];
  prefs = {priorities: '', rules: [], batch_size: 1, category_descriptions: {important: 'Messages needing attention.', routine: 'Ordinary informational messages.', spam: 'Clear scams or unwanted messages.'}};
  vi.stubGlobal('chrome', {
    runtime: {id: 'a'.repeat(32), sendMessage: vi.fn(async (message: any) => {
      sent.push(message);
      if (message.path === '/health') return {data: {key_configured: true}};
      if (message.path === '/preferences' && message.method === 'PUT') {prefs = structuredClone(message.body); return {data: prefs};}
      if (message.path === '/preferences') return {data: prefs};
      return {data: []};
    })},
    storage: {local: {get: vi.fn(async () => ({enabled: true, token: 'test'})), set: vi.fn(async () => {})}},
    tabs: {query: vi.fn(async () => []), sendMessage: vi.fn()},
  });
});
it('loads all choices, saves edited descriptions, and restores them on reopen', async () => {
  await import('../src/popup');
  await vi.waitFor(() => expect((document.getElementById('save') as HTMLButtonElement).disabled).toBe(false));
  const description = document.getElementById('description-important') as HTMLTextAreaElement;
  expect(description.value).toBe(prefs.category_descriptions.important);
  expect(document.querySelectorAll('.choice')).toHaveLength(3);
  description.value = 'All university deadlines need attention.';
  description.dispatchEvent(new Event('input', {bubbles: true}));
  expect(document.getElementById('save-state')!.textContent).toBe('Unsaved changes');
  document.getElementById('save')!.click();
  await vi.waitFor(() => expect(document.getElementById('save-state')!.textContent).toBe('Changes saved'));
  const save = sent.find(m => m.path === '/preferences' && m.method === 'PUT');
  expect(save.body.category_descriptions.important).toBe(description.value);
  expect(Object.keys(save.body.category_descriptions)).toEqual(['important', 'routine', 'spam']);
  mount(); vi.resetModules(); await import('../src/popup');
  await vi.waitFor(() => expect((document.getElementById('description-important') as HTMLTextAreaElement).value).toBe(prefs.category_descriptions.important));
});
it('rejects blank descriptions without sending a preference update', async () => {
  await import('../src/popup');
  await vi.waitFor(() => expect((document.getElementById('save') as HTMLButtonElement).disabled).toBe(false));
  (document.getElementById('description-spam') as HTMLTextAreaElement).value = '  ';
  document.getElementById('save')!.click();
  await vi.waitFor(() => expect(document.getElementById('save-state')!.textContent).toContain('Enter a description for Spam'));
  expect(sent.some(m => m.method === 'PUT')).toBe(false);
});
it('explains when the local service needs updating', async () => {
  delete (prefs as Partial<Preferences>).category_descriptions;
  await import('../src/popup');
  await vi.waitFor(() => expect(document.getElementById('status')!.textContent).toContain('Restart the local service'));
  expect((document.getElementById('save') as HTMLButtonElement).disabled).toBe(true);
});
