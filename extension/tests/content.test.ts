// @vitest-environment jsdom
import {expect, it, vi} from 'vitest';
it('discards a delayed result when Gmail recycles a row and never duplicates badges', async () => {
  vi.useFakeTimers();
  document.body.innerHTML = '<header><a aria-label="Google Account: me@example.com"></a></header><table><tbody><tr class="zA" data-legacy-thread-id="abcdef0123456789"><td class="yW"><span email="person@example.com">Person</span></td><td><span class="bog">First</span><span class="y2">preview</span></td></tr></tbody></table>';
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({width: 300, height: 30, top: 1, bottom: 31} as DOMRect);
  let resolve!: (value: unknown) => void;
  let request: any;
  let calls = 0;
  vi.stubGlobal('chrome', {runtime: {onMessage: {addListener: vi.fn()}, sendMessage: vi.fn(async (msg: any) => {
    if (msg.type === 'state') return {enabled: true};
    calls++; request = msg;
    if (calls === 1) return new Promise(r => {resolve = r;});
    return {data: {results: msg.body.emails.map((e: any) => ({id: e.id, label: 'routine', evidence: 'preview'}))}};
  })}});
  await import('../src/content');
  await vi.advanceTimersByTimeAsync(210);
  const row = document.querySelector('tr')!;
  row.setAttribute('data-legacy-thread-id', 'abcdef0123456790');
  row.querySelector('.bog')!.textContent = 'Second';
  resolve({data: {results: [{id: request.body.emails[0].id, label: 'spam'}]}});
  await vi.advanceTimersByTimeAsync(10);
  expect(document.querySelector('.jev-spam')).toBeNull();
  await vi.advanceTimersByTimeAsync(500);
  expect(document.querySelectorAll('.jev-badge')).toHaveLength(1);
  row.append(document.createElement('span'));
  await vi.advanceTimersByTimeAsync(500);
  expect(document.querySelectorAll('.jev-badge')).toHaveLength(1);
  expect(document.querySelector('.jev-badge')?.textContent).toBe('Routine');
  expect(document.querySelector('.yW .jev-badge')).not.toBeNull();
  expect(calls).toBe(2);
  dispatchEvent(new Event('pagehide'));
  vi.useRealTimers();
});
