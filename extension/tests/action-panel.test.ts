// @vitest-environment jsdom
import {beforeEach, expect, it} from 'vitest';
import {ActionPanel} from '../src/action-panel';
import type {Observation, Result} from '../src/types';
let panel: ActionPanel;
let root: ShadowRoot;
const observation = (update: Partial<Observation> = {}): Observation => ({id:'1', account:'me@example.com', conversation:'thread', revision:'1', reliable:true, session:'tab', sender:'other@example.com', sender_name:'Other person', subject:'Please approve by Friday', preview:'Please review the contract.', metadata:[], messages:[], evidence:'preview', mailbox:'inbox', ...update});
const result = (): Result => ({id:'1', label:'routine', evidence:'preview', actions:{todo:{probability:.95,state:'positive'},deadline:{probability:.92,state:'positive'},waiting:{probability:null,state:'needs_context'}}});
const click = (selector: string) => (root.querySelector(selector) as HTMLButtonElement).click();
beforeEach(() => {document.body.replaceChildren(); panel = new ActionPanel(); root = panel.host.shadowRoot!; panel.setEnabled(true);});
it('shows a conversation in multiple groups with original text and an open control', () => {
  let opened = 0;
  panel.update(observation(), result(), () => {opened++;}); click('.launcher');
  expect(root.querySelector('#jev-tab-todo')!.textContent).toBe('To do 1');
  expect(root.querySelector('#jev-tab-deadline')!.textContent).toBe('Has a deadline 1');
  expect(root.querySelector('.card h3')!.textContent).toBe('Please approve by Friday');
  click('.card-actions button'); expect(opened).toBe(1);
  click('#jev-tab-deadline'); expect(root.querySelectorAll('.card')).toHaveLength(1);
  click('#jev-tab-waiting'); expect(root.querySelectorAll('.card')).toHaveLength(0);
  expect(root.querySelector('.empty')!.textContent).toContain('Open conversations');
});
it('supports Done and Undo without changing Gmail, and resets completion for a new message', () => {
  panel.update(observation(), result()); click('.launcher'); click('.card-actions .text-button');
  expect(root.querySelectorAll('.card')).toHaveLength(0);
  expect(root.querySelector('#jev-tab-deadline')!.textContent).toBe('Has a deadline 0');
  click('.undo-row button'); expect(root.querySelectorAll('.card')).toHaveLength(1);
  click('.card-actions .text-button');
  panel.observe(observation({revision:'2', preview:'A new request'}));
  expect(root.querySelectorAll('.card')).toHaveLength(0);
  panel.update(observation({revision:'2', preview:'A new request'}), result());
  expect(root.querySelectorAll('.card')).toHaveLength(1);
});
it('replaces resolved results, clears on account reset and pause, and never renders email HTML', () => {
  panel.update(observation({subject:'<img src=x onerror=alert(1)>'}), result()); click('.launcher');
  expect(root.querySelector('.card img')).toBeNull();
  panel.update(observation(), {...result(), actions:{...result().actions!,todo:{probability:.05,state:'negative'}}});
  expect(root.querySelectorAll('.card')).toHaveLength(0);
  panel.reset(); expect(root.querySelector('#jev-tab-deadline')!.textContent).toBe('Has a deadline 0');
  panel.setEnabled(false); expect(panel.host.hidden).toBe(true);
});
it('upgrades preview context to an opened conversation and shows Waiting independently', () => {
  panel.update(observation(), result()); click('.launcher');
  const body = observation({evidence:'body',messages:[{sender:'me@example.com',recipients:'other@example.com',text:'Can you send the quote?',outgoing:true}]});
  panel.update(body, {...result(),evidence:'body',actions:{...result().actions!,waiting:{probability:.98,state:'positive'}}});
  click('#jev-tab-waiting'); expect(root.querySelectorAll('.card')).toHaveLength(1);
  expect(root.querySelector('.evidence')!.textContent).toBe('Opened thread');
});
it('reopens a completed item when new rendered reply content arrives', () => {
  const old = observation({evidence:'body',messages:[{sender:'other@example.com',recipients:'me@example.com',text:'Please approve the quote.',outgoing:false}]});
  panel.update(old, {...result(),evidence:'body'}); click('.launcher'); click('.card-actions .text-button');
  const updated = {...old,messages:[...old.messages,{sender:'other@example.com',recipients:'me@example.com',text:'Also approve the contract.',outgoing:false}]};
  panel.observe(updated); panel.update(updated, {...result(),evidence:'body'});
  expect(root.querySelectorAll('.card')).toHaveLength(1);
});
