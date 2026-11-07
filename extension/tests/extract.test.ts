// @vitest-environment jsdom
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {accountOf, extractOpened, extractRow, mailboxOf, threadId} from '../src/extract';
const fixture = () => {document.body.innerHTML = `
<header><a aria-label="Google Account: Me (me@example.com)"></a></header>
<table><tbody><tr class="zA" data-legacy-thread-id="abcdef0123456789"><td class="yW"><span email="sender@example.com">Sender</span></td><td><span class="bog">Deadline</span><span class="y2"> - Reply today</span></td><td class="xW"><span title="Tuesday">Tue</span></td></tr></tbody></table>`;};
beforeEach(() => {fixture(); vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList);});
afterEach(() => {location.hash = '';});
describe('Gmail extraction', () => {
  it('extracts identity, sender, subject and revision; missing addresses stay unknown', () => {
    expect(accountOf(document)).toBe('me@example.com');
    const row = document.querySelector('tr')!;
    const first = extractRow(row, accountOf(document), 'session');
    expect(first).toMatchObject({sender: 'sender@example.com', subject: 'Deadline', preview: 'Reply today', reliable: true});
    row.querySelector('.y2')!.textContent = 'new reply';
    expect(extractRow(row, accountOf(document), 'session').revision).not.toBe(first.revision);
    row.querySelector('[email]')!.removeAttribute('email');
    expect(extractRow(row, null, 'session')).toMatchObject({sender: '', reliable: false});
  });
  it('normalizes numeric Gmail thread ids', () => {
    const row = document.querySelector('tr')!; row.removeAttribute('data-legacy-thread-id'); row.setAttribute('data-thread-id', '#thread-f:12345');
    expect(threadId(row)).toBe('3039');
  });
  it('uses only expanded visible bodies, removes hidden tracking text, and distinguishes outgoing replies', () => {
    document.body.insertAdjacentHTML('beforeend', `<section data-legacy-thread-id="abcdef0123456789"><h2 class="hP">Deadline</h2><div class="adn"><span email="sender@example.com">Sender</span><div class="a3s">Respond today<div hidden>Hidden secret</div><script>bad()</script><p>Details</p></div></div><div class="adn"><span email="me@example.com">Me</span><div class="a3s">Thanks</div></div></section>`);
    const row = extractRow(document.querySelector('tr')!, 'me@example.com', 's');
    const opened = extractOpened(document, 'me@example.com', 's', new Map([[row.conversation, row]]))!;
    expect(opened.email.revision).toBe(row.revision);
    expect(opened.email.messages[0].text).not.toContain('Hidden secret');
    expect(opened.email.messages[0].text).not.toContain('bad()');
    expect(opened.email.messages[1].outgoing).toBe(true);
    expect(opened.email.evidence).toBe('body');
  });
  it('does not mistake a sender address in the message for the signed-in account', () => {
    document.querySelector('header')!.remove(); expect(accountOf(document)).toBeNull();
  });
});

it('passes Spam-folder context without confusing inbox and search views', () => {
  location.hash = '#spam';
  expect(mailboxOf()).toBe('spam');
  expect(extractRow(document.querySelector('tr')!, 'me@example.com', 's').mailbox).toBe('spam');
  location.hash = '#spam/abcdef0123456789'; expect(mailboxOf()).toBe('spam');
  location.hash = '#inbox'; expect(mailboxOf()).toBe('inbox');
  location.hash = '#search/in%3Aspam+offer'; expect(mailboxOf()).toBe('unknown');
  location.hash = '#search/in%3Aspam%20offer'; expect(mailboxOf()).toBe('spam');
});
it('adding a sender badge never changes the email revision or sender name', () => {
  const row = document.querySelector('tr')!;
  const before = extractRow(row, 'me@example.com', 's');
  row.querySelector('.yW')!.insertAdjacentHTML('beforeend', '<button class="jev-badge">Routine</button>');
  const after = extractRow(row, 'me@example.com', 's');
  expect(after.revision).toBe(before.revision);
  expect(after.sender_name).toBe(before.sender_name);
});
it('uses the clicked row identity for an opened opaque Gmail route', () => {
  const selected = extractRow(document.querySelector('tr')!, 'me@example.com', 's');
  document.body.insertAdjacentHTML('beforeend', '<h2 class="hP">Deadline</h2><div class="adn"><span email="me@example.com">Me</span><div class="a3s">Please send the document.</div></div>');
  location.hash = '#inbox/FMfcgxOpaqueThread';
  const opened = extractOpened(document, 'me@example.com', 's', new Map(), selected)!;
  expect(opened.email.conversation).toBe(selected.conversation);
  expect(opened.email.reliable).toBe(true);
  expect(extractOpened(document, 'other@example.com', 's', new Map(), selected)!.email.reliable).toBe(false);
});
