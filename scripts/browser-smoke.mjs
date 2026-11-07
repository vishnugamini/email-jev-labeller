import {mkdtemp, rm, cp, readFile, writeFile} from 'node:fs/promises';
import {createServer} from 'node:net';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';

process.env.PLAYWRIGHT_BROWSERS_PATH ||= resolve('.cache/browsers');
const {chromium} = await import('playwright-core');
const profile = await mkdtemp(join(tmpdir(), 'jev-browser-'));
const data = await mkdtemp(join(tmpdir(), 'jev-service-'));
const extension = join(profile, 'extension');
await cp(resolve('extension/dist'), extension, {recursive: true});
const port = await new Promise((resolvePort, reject) => {
  const socket = createServer(); socket.on('error', reject);
  socket.listen(0, '127.0.0.1', () => {const port = socket.address().port; socket.close(() => resolvePort(port));});
});
const background = join(extension, 'background.js');
await writeFile(background, (await readFile(background, 'utf8')).replaceAll('http://127.0.0.1:8765', `http://127.0.0.1:${port}`));
const executablePath = process.env.CHROMIUM_PATH;
let context, server;
try {
  context = await chromium.launchPersistentContext(profile, {executablePath, channel: 'chromium', headless: true, ignoreDefaultArgs: ['--disable-extensions'],
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]});
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const id = new URL(worker.url()).host;
  server = spawn(resolve('.venv/bin/python'), ['-c', `import sys,uvicorn; from service.app import create_app; from service.tests.test_service import Provider; app=create_app(sys.argv[1],token='smoke-token',origin=sys.argv[2],provider=Provider()); uvicorn.run(app,host='127.0.0.1',port=int(sys.argv[3]),access_log=False,log_level='error')`, data, `chrome-extension://${id}`, String(port)], {stdio: ['ignore', 'pipe', 'pipe'], env: {...process.env, TYPESAFE_API_KEY: 'synthetic-test-provider-only'}});
  let stderr = ''; server.stderr.on('data', b => {stderr += b;});
  await new Promise((resolveReady, reject) => {
    let count = 0;
    const tick = async () => {
      if (server.exitCode !== null) return reject(new Error(stderr || 'Test service failed to start.'));
      try {await fetch(`http://127.0.0.1:${port}/health`); resolveReady();}
      catch {if (++count > 40) reject(new Error('Test service not ready')); else setTimeout(tick, 100);}
    }; tick();
  });
  const popup = await context.newPage();
  popup.on('pageerror', error => console.log('Popup error:', error.message));
  popup.on('console', message => console.log('Popup console:', message.text()));
  await popup.setViewportSize({width: 420, height: 600});
  await popup.goto(`chrome-extension://${id}/popup.html`);
  await popup.locator('#token').fill('smoke-token');
  await popup.locator('#pair').click();
  await popup.waitForFunction(() => !document.querySelector('#choices-editor').disabled, null, {timeout: 10000});
  // This verifies the real extension worker's Origin header and loopback pairing, not a mocked fetch.
  assert.equal(await popup.locator('#status').textContent(), 'Connected');
  assert.ok((await popup.locator('#description-important').inputValue()).length > 0);
  const customDescription = 'Needs action or directly matches my university and ML job priorities.';
  await popup.locator('#description-important').fill(customDescription);
  await popup.locator('#save').click();
  await popup.waitForFunction(() => document.querySelector('#save-state').textContent === 'Changes saved');
  await popup.reload();
  await popup.waitForFunction(() => !document.querySelector('#save').disabled);
  assert.equal(await popup.locator('#description-important').inputValue(), customDescription);
  await popup.locator('main').evaluate(element => {element.scrollTop = 0;});
  const headerBounds = await popup.locator('.popup-header').boundingBox();
  const saveBounds = await popup.locator('#save').boundingBox();
  assert.ok(headerBounds.y >= 0 && saveBounds.y + saveBounds.height <= 600);
  await popup.screenshot({path: resolve('.cache/popup-preview.png')});
  await popup.locator('#enabled').check();
  const gmail = await context.newPage();
  await gmail.route('https://mail.google.com/**', route => route.fulfill({contentType: 'text/html', body: `<!doctype html><html><head><title>Gmail fixture</title><style>table{table-layout:fixed;width:900px}td{padding:8px}.sender-column{width:216px}.yW{width:100%;overflow:hidden;white-space:nowrap}</style></head><body><header><a aria-label="Google Account: Me (me@example.com)">Account</a></header><table><tbody><tr class="zA" data-legacy-thread-id="abcdef0123456789"><td class="sender-column"><div class="yW"><span email="person@example.com">Project coordination team with a very long sender name</span></div></td><td><span class="bog">Meeting brief approval</span><span class="y2"> - Please approve the brief by Friday.</span></td></tr></tbody></table></body></html>`}));
  await gmail.goto('https://mail.google.com/mail/u/0/#inbox');
  await gmail.locator('.jev-badge').filter({hasText: 'Routine'}).waitFor();
  assert.equal(await gmail.locator('.yW .jev-badge').count(), 1);
  await popup.locator('#visible-routine').uncheck();
  await gmail.waitForFunction(() => !document.querySelector('.jev-badge'));
  assert.equal(await gmail.locator('.jev-sender-layout').count(), 0);
  await popup.reload();
  await popup.waitForFunction(() => !document.querySelector('#save').disabled);
  assert.equal(await popup.locator('#visible-routine').isChecked(), false);
  await popup.locator('#visible-routine').check();
  await gmail.locator('.jev-badge').filter({hasText: 'Routine'}).waitFor();
  assert.equal(await gmail.locator('.jev-badge').count(), 1);
  // Simulate a Gmail tab whose old content script cannot acknowledge the update.
  await popup.evaluate(() => {
    globalThis.originalSendMessage = chrome.tabs.sendMessage;
    chrome.tabs.sendMessage = async () => undefined;
  });
  await popup.locator('#visible-routine').uncheck();
  await popup.locator('#reload-notice').waitFor({state: 'visible'});
  await popup.evaluate(() => {chrome.tabs.sendMessage = globalThis.originalSendMessage;});
  await popup.locator('#reload-gmail').click();
  await gmail.waitForLoadState('domcontentloaded');
  await gmail.waitForFunction(() => document.querySelector('#jev-action-root') && !document.querySelector('.jev-badge'));
  await popup.locator('#visible-routine').check();
  await gmail.locator('.jev-badge').filter({hasText: 'Routine'}).waitFor();
  const assertBounds = async () => {
    const fits = await gmail.evaluate(() => {
      const badge = document.querySelector('.jev-badge').getBoundingClientRect();
      const sender = document.querySelector('.sender-column').getBoundingClientRect();
      const subject = document.querySelector('.bog').getBoundingClientRect();
      const name = document.querySelector('.jev-sender-name');
      return badge.right <= sender.right && badge.right <= subject.left && name.scrollWidth > name.clientWidth;
    });
    assert.ok(fits, 'Badge must stay inside sender column, with long sender text truncated.');
  };
  await assertBounds();
  // Check the widest label at several narrow sender-column widths.
  await gmail.locator('.jev-badge').click();
  await gmail.getByRole('button', {name: 'Spam', exact: true}).click();
  await gmail.locator('.jev-spam').waitFor();
  for (const width of [176, 216, 280]) {
    await gmail.locator('.sender-column').evaluate((element, width) => {element.style.width = `${width}px`;}, width);
    await assertBounds();
  }
  await gmail.screenshot({path: resolve('.cache/layout-preview.png')});
  await gmail.locator('.jev-badge').click();
  await gmail.getByRole('button', {name: 'Important', exact: true}).click();
  await gmail.locator('.jev-badge').filter({hasText: 'Important'}).waitFor();
  await gmail.locator('.jev-badge').click();
  await gmail.getByRole('button', {name: 'Reset correction', exact: true}).click();
  await gmail.locator('.jev-badge').filter({hasText: 'Routine'}).waitFor();
  assert.equal(await gmail.locator('.jev-badge').count(), 1);
  await popup.locator('#add-label').click();
  await popup.getByRole('textbox', {name: 'Label name', exact: true}).fill('Finance');
  await popup.getByRole('textbox', {name: 'Label description', exact: true}).fill('Invoices and bank statements.');
  await popup.locator('#save').click();
  await popup.waitForFunction(() => document.querySelector('#save-state').textContent === 'Changes saved');
  await popup.reload();
  await popup.getByRole('textbox', {name: 'Label name', exact: true}).waitFor();
  assert.equal(await popup.getByRole('textbox', {name: 'Label name', exact: true}).inputValue(), 'Finance');
  await gmail.locator('.jev-badge').filter({hasText: 'Routine'}).waitFor();
  await gmail.locator('.jev-badge').click();
  await gmail.getByRole('button', {name: 'Finance', exact: true}).click();
  await gmail.locator('.jev-custom').filter({hasText: 'Finance'}).waitFor();
  await assertBounds();
  await popup.getByRole('switch', {name: 'Show Finance badges', exact: true}).uncheck();
  await gmail.waitForFunction(() => !document.querySelector('.jev-badge'));
  await popup.getByRole('switch', {name: 'Show Finance badges', exact: true}).check();
  await gmail.locator('.jev-custom').waitFor();
  await popup.getByRole('button', {name: 'Remove label', exact: true}).click();
  await popup.locator('#save').click();
  await popup.waitForFunction(() => document.querySelector('#save-state').textContent === 'Changes saved');
  await gmail.locator('.jev-badge').filter({hasText: 'Routine'}).waitFor();
  const actionRoot = gmail.locator('#jev-action-root');
  await actionRoot.getByRole('button', {name: 'Actions · 1', exact: true}).click();
  assert.equal(await actionRoot.locator('.card').count(), 1);
  await actionRoot.getByRole('tab', {name: 'Has a deadline 1', exact: true}).click();
  assert.equal(await actionRoot.locator('.card').count(), 1);
  await actionRoot.getByRole('button', {name: 'Done', exact: true}).click();
  assert.equal(await actionRoot.locator('.card').count(), 0);
  await actionRoot.getByRole('button', {name: 'Undo', exact: true}).click();
  assert.equal(await actionRoot.locator('.card').count(), 1);
  await gmail.evaluate(() => {
    const row = document.querySelector('tr.zA');
    row.addEventListener('click', () => {
      document.querySelector('table').hidden = true;
      const thread = document.createElement('section'); thread.id = 'opened-thread';
      thread.innerHTML = '<h2 class="hP">Meeting brief approval</h2><div class="adn"><span email="person@example.com">Project coordinator</span><div class="a3s">Please approve the brief by Friday. I will send you the budget figures.</div></div><div class="adn"><span email="me@example.com">Me</span><div class="a3s">Can you send the budget figures?</div></div>';
      document.body.append(thread); location.hash = '#inbox/FMfcOpaqueThread';
    }, {once: true});
  });
  await actionRoot.getByRole('button', {name: 'Open', exact: true}).click();
  await actionRoot.getByRole('tab', {name: 'Waiting 1', exact: true}).waitFor();
  await actionRoot.getByRole('tab', {name: 'Waiting 1', exact: true}).click();
  assert.equal(await actionRoot.locator('.evidence').textContent(), 'Opened thread');
  await actionRoot.locator('.panel').screenshot({path: resolve('.cache/actions-preview.png')});
  await gmail.evaluate(() => {
    const reply = document.createElement('div'); reply.className = 'adn';
    reply.innerHTML = '<span email="person@example.com">Project coordinator</span><div class="a3s">All complete. Your approval is recorded and the budget is delivered.</div>';
    document.querySelector('#opened-thread').append(reply);
  });
  await actionRoot.getByRole('tab', {name: 'Waiting 0', exact: true}).waitFor();
  await actionRoot.getByRole('tab', {name: 'To do 0', exact: true}).waitFor();
  await actionRoot.getByRole('tab', {name: 'Has a deadline 0', exact: true}).waitFor();
  await popup.locator('#enabled').uncheck();
  await gmail.waitForFunction(() => !document.querySelector('.jev-badge'));
  assert.equal(await actionRoot.isVisible(), false);
  assert.equal(await gmail.locator('.jev-sender-layout, .jev-sender-name').count(), 0);
  assert.equal(await gmail.locator('.yW [email]').textContent(), 'Project coordination team with a very long sender name');
  console.log('Browser smoke passed: real extension loading, loopback pairing, classification, corrections, action groups, Done/Undo, opened-thread Waiting, resolved replies, and pause.');
} finally {
  await context?.close();
  if (server) {server.kill(); await new Promise(r => server.exitCode !== null ? r() : server.once('exit', r));}
  await rm(profile, {recursive: true, force: true});
  await rm(data, {recursive: true, force: true});
}
