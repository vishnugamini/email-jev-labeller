# Jev Email Labels

A Chrome extension that classifies visible Gmail conversations using Jev, with a local Python service for API requests, preferences, and caching.

- **Inbox badges:** Important, Routine, Spam, and up to 12 custom labels.
- **Personalization:** editable descriptions, priorities, sender rules, and conversation corrections.
- **Visibility:** hide individual categories without changing the model’s choices.
- **Actions panel:** To do, Has a deadline, and Waiting, with Open, Done, and Undo.
- **Details:** per-category probabilities, confidence, model version, latency, and token usage.

**Email text is sent to TypeSafe’s hosted Jev API.** “Local” refers to the service and storage. This application reads rendered Gmail content; it does not use the Gmail API or modify Gmail labels, messages, or read status.

[Architecture](docs/architecture.md) · [Privacy and security](docs/privacy.md) · [Evaluation](docs/evaluation.md)

## Quick start

Requires desktop Chrome, Node.js 24, Python 3.12+, [uv](https://docs.astral.sh/uv/), and a [TypeSafe API key](https://console.typesafe.ai/).

```sh
git clone https://github.com/vishnugamini/email-jev-labeller.git
cd email-jev-labeller
npm ci
npm run build
uv sync --locked
cp .env.example .env
chmod 600 .env
```

1. Set `TYPESAFE_API_KEY` in `.env`. Never commit that file.
2. Open `chrome://extensions`, enable **Developer mode**, and select **Load unpacked** → `extension/dist`.
3. Copy the extension ID shown by Chrome and start the service:

```sh
uv run --env-file .env python -m service --extension-id YOUR_EXTENSION_ID
```

4. Open the extension popup, paste the printed **pairing token**, and select **Pair**.
5. Enable **Classify visible emails** and open Gmail.

Keep the terminal running. The service binds to `127.0.0.1:8765`; the extension expects that port. No Google OAuth configuration is needed.

## Labels and preferences

The three default labels are Important, Routine, and Spam. Jev selects **one** label per conversation, which is displayed directly without a confidence threshold. Click a badge for probabilities, confidence, corrections, and action scores.

To create another category, select **Add label**, enter a unique name and a description, and select **Save changes**. The name can contain up to 32 characters; descriptions can contain up to 2,000. Descriptions are sent as Jev Choice criteria. Keep definitions distinct so competing categories have clear boundaries.

Each label has a visibility switch. Switching it off immediately hides that category’s badges on this browser; classification still considers the category. Removing a custom label takes effect on save and clears associated sender rules and corrections.

Priority order: **conversation correction → exact sender-address rule → exact domain rule → Jev**. Domain rules do not cover subdomains. Corrections apply to the current conversation revision only and do not train the model or become examples for later decisions. Newly rendered replies or changed body content invalidate them.

## Actions panel

Open **Actions** at the bottom right of Gmail:

| View | Meaning |
| --- | --- |
| To do | You owe an action or personal reply. |
| Has a deadline | An outstanding action has an explicit deadline. |
| Waiting | Someone owes you a reply or promised deliverable. |

These are independent signals, so a conversation can appear in several views. The panel shows original email previews and Open / Done controls. Done hides a card in the current tab; Undo restores the latest completion. Neither changes Gmail.

Only conversations scanned in the current tab are included, up to 200. Waiting requires an opened conversation with reliable account and thread identity. The panel does not extract dates, schedule reminders, monitor your whole mailbox, or persist completion state across reloads. Reloading, pausing, or switching accounts clears the panel.

## Updates and troubleshooting

After a code update:

```sh
npm ci
npm run build
uv sync --locked
```

Stop the old service with **Ctrl+C**, run the start command again, reload the extension at `chrome://extensions`, and refresh Gmail. The popup offers **Reload Gmail** when it detects an outdated content script.

| Problem | Action |
| --- | --- |
| Port 8765 already in use | Stop the existing service in its terminal with Ctrl+C. Ctrl+Z suspends it and leaves the port occupied. Use `lsof -nP -iTCP:8765 -sTCP:LISTEN` to identify the listener. |
| Local service unavailable | Start the service and keep its terminal open. |
| Pairing failed | Match the extension ID and use the token printed by that service. |
| Missing or rejected API key | Update `.env` and restart the service. |
| Old badges or switches seem ineffective | Reload the extension, then refresh Gmail. |
| Retry badge | Click for details; check the service and key, then retry. |

**Clear cached results** retains preferences and corrections. To remove local service data, stop the service and delete `.local/`; this also rotates the pairing token on next start. Extension storage is separate. See [privacy and deletion](docs/privacy.md).

## Development and validation

```sh
uv sync --locked --group dev
uv run python -m pytest service/tests -q
npm test
npm run build
```

The browser test uses a temporary profile, synthetic Gmail markup, and a mock Jev provider:

```sh
PLAYWRIGHT_BROWSERS_PATH=.cache/browsers npx playwright-core install chromium
npm run test:browser
```

It covers pairing, badges, custom labels, visibility, correction/reset, stale-tab recovery, layout bounds, actions, and pause. Tests do not access your real inbox. Optional hosted-model checks require explicit `--allow-send`; see [evaluation](docs/evaluation.md).

## Packaging

After building, generate a source ZIP and a load-unpacked extension ZIP:

```sh
python scripts/package_release.py
```

Outputs are written to `release/`, with SHA-256 checksums. The source ZIP contains Git-tracked source files; the extension ZIP contains the compiled extension. Neither includes `.env`, local databases, pairing tokens, dependencies, or private evaluation data. Extract the extension ZIP before using **Load unpacked**. The local Python service is still required.

## Project layout

```text
extension/src/      Gmail extraction, badges, popup, Actions panel, service worker
extension/public/   Manifest and badge styles
extension/tests/    Synthetic DOM and interface tests
service/            FastAPI transport, Jev adapter, validation, SQLite cache
service/tests/      Service, security, cache, custom label, and action tests
scripts/            Packaging, browser smoke test, optional Jev evaluations
docs/               Architecture, privacy, and evaluation details
```

## Current limits

This is a local-use prototype, not a Chrome Web Store release. Gmail desktop DOM selectors need maintenance, and unopened mail is limited to rendered previews. Full inbox accuracy has not been established on a held-out real-email dataset. Synthetic checks demonstrate behavior, not a measured production accuracy guarantee.

Public delivery would require an authenticated HTTPS backend, per-user isolation and quotas, privacy disclosures, deletion controls, operational monitoring, and store review. Google login, hosted multi-user storage, billing, and a Gmail API adapter are not implemented.
