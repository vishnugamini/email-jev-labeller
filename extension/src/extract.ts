import type { Observation } from './types';
const emailPattern = /[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
export const text = (element: Element | null): string => {
  if (!element) return '';
  if (element.querySelector('.jev-badge')) {
    const copy = element.cloneNode(true) as Element;
    copy.querySelectorAll('.jev-badge, .jev-detail').forEach(n => n.remove());
    return (copy.textContent || '').trim();
  }
  return (element instanceof HTMLElement && element.innerText !== undefined ? element.innerText : element.textContent || '').trim();
};
export function accountOf(doc: Document): string | null {
  const header = doc.querySelector('header, [role="banner"], .gb_Header');
  if (!header) return null;
  const candidates = header.querySelectorAll('[aria-label], [data-email]');
  for (const node of candidates) {
    const label = node.getAttribute('aria-label') || '';
    if (!/Google Account|Google account|Account:/.test(label) && !node.hasAttribute('data-email')) continue;
    const match = (node.getAttribute('data-email') || label).match(emailPattern);
    if (match) return match[0].toLowerCase();
  }
  return null;
}
export function threadId(element: Element): string | null {
  const holder = element.matches('[data-legacy-thread-id], [data-thread-id]') ? element : element.querySelector('[data-legacy-thread-id], [data-thread-id]');
  const legacy = holder?.getAttribute('data-legacy-thread-id');
  if (legacy && /^[a-f0-9]+$/i.test(legacy)) return legacy.toLowerCase();
  const raw = holder?.getAttribute('data-thread-id');
  const numeric = raw?.match(/^#?thread-[af]:(\d+)$/);
  if (numeric) return BigInt(numeric[1]).toString(16);
  if (raw && /^[a-f0-9]+$/i.test(raw)) return raw.toLowerCase();
  const href = element.querySelector('a[href*="#"]')?.getAttribute('href');
  return href?.match(/\/(?:([a-f0-9]{16,}))$/i)?.[1] || null;
}
export function signature(value: unknown): string {
  // A local revision hint; the backend uses SHA-256 for persistent keys and content fingerprints.
  const input = JSON.stringify(value);
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) hash = Math.imul(hash ^ input.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16) + ':' + input.length;
}
function senderOf(node: Element): {sender: string; sender_name: string} {
  const from = node.querySelector('[email], [data-hovercard-id]');
  const raw = from?.getAttribute('email') || from?.getAttribute('data-hovercard-id') || '';
  return {sender: raw.match(emailPattern)?.[0]?.toLowerCase() || '', sender_name: text(from)};
}
export function mailboxOf(): Observation['mailbox'] {
  const route = location.hash.slice(1).split('/')[0];
  if (route === 'spam' || route === 'inbox' || route === 'trash') return route;
  if (route === 'search') {
    const query = decodeURIComponent(location.hash.slice(8));
    if (/(?:^|\s)in:spam(?:\s|$)/i.test(query)) return 'spam';
  }
  return 'unknown';
}
export function extractRow(row: Element, account: string | null, session: string): Observation {
  const subject = text(row.querySelector('.bog, [data-jev-subject]'));
  const preview = text(row.querySelector('.y2, [data-jev-preview]')).replace(/^\s*[-–]\s*/, '');
  const sender = senderOf(row);
  const metadata = [...row.querySelectorAll('[data-jev-meta], .yW .bqe, .xW [title], [role="checkbox"][aria-label*="Star"]')]
    .map(e => e.getAttribute('title') || e.getAttribute('aria-label') || text(e)).slice(0, 15);
  const revision = signature([subject, preview, sender, text(row.querySelector('.yW')), text(row.querySelector('.xW')), metadata]);
  const conversation = threadId(row);
  return {id: crypto.randomUUID(), account: account || `unknown:${location.pathname}`, conversation: conversation || `row:${revision}`,
    revision, reliable: Boolean(account && conversation), session, ...sender, subject, preview, metadata, mailbox: mailboxOf(), messages: [], evidence: 'preview'};
}
function rendered(node: HTMLElement): string {
  const copy = node.cloneNode(true) as HTMLElement;
  // innerText of the original respects computed visibility. Filter hidden descendants in the clone too.
  const originals = [...node.querySelectorAll<HTMLElement>('*')];
  const clones = [...copy.querySelectorAll<HTMLElement>('*')];
  originals.forEach((element, i) => {
    if (getComputedStyle(element).display === 'none' || getComputedStyle(element).visibility === 'hidden') clones[i]?.remove();
  });
  copy.querySelectorAll('script, style, img, [hidden], [aria-hidden="true"]').forEach(e => e.remove());
  copy.querySelectorAll('br').forEach(e => e.replaceWith('\n'));
  copy.querySelectorAll('div, p').forEach(e => e.append('\n'));
  return copy.textContent?.trim() || '';
}
export function extractOpened(doc: Document, account: string | null, session: string, known: Map<string, Observation>, selected?: Observation): {email: Observation; anchor: Element} | null {
  const anchor = doc.querySelector('h2.hP, [data-jev-open-subject]');
  const bodies = [...doc.querySelectorAll<HTMLElement>('.a3s, [data-jev-body]')].filter(e => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden');
  if (!anchor || !bodies.length) return null;
  const container = anchor.closest('[data-legacy-thread-id], [data-thread-id]') || bodies[0].closest('[data-legacy-thread-id], [data-thread-id]');
  const fromURL = location.hash.match(/\/([a-f0-9]{16,})$/i)?.[1];
  const clicked = selected?.reliable && selected.account === account ? selected : undefined;
  const conversation = (container && threadId(container)) || fromURL || clicked?.conversation || null;
  const previous = conversation ? known.get(conversation) || (clicked?.conversation === conversation ? clicked : undefined) : undefined;
  const messages = bodies.map(body => {
    const message = body.closest('.adn, [data-message-id], [data-jev-message]') || body.parentElement!;
    const sender = senderOf(message).sender;
    return {sender, recipients: [...message.querySelectorAll('[email]')].map(n => n.getAttribute('email')).filter(Boolean).join(', '),
      text: rendered(body), outgoing: Boolean(account && sender === account)};
  });
  const subject = text(anchor);
  const latest = messages.at(-1)!;
  const revision = previous?.revision || signature([subject, latest.sender, latest.text]);
  return {anchor, email: {id: crypto.randomUUID(), account: account || `unknown:${location.pathname}`, session,
    conversation: conversation || `opened:${revision}`, revision, reliable: Boolean(account && conversation),
    sender: [...messages].reverse().find(m => !m.outgoing)?.sender || latest.sender, sender_name: '',
    subject, preview: previous?.preview || '', metadata: previous?.metadata || [], mailbox: mailboxOf(), messages, evidence: 'body'}};
}
