# Privacy and security

## What leaves the computer

When classification is enabled, selected rendered email text and configured priorities are sent through the local service to TypeSafe’s hosted Jev API. Category descriptions are submitted as classification criteria. The current Gmail folder and visible sender/recipient details can be included. No Google credentials, Gmail cookies, or attachments are collected by this application.

Only rendered content is available: unopened mail uses previews; opened conversations add visible bodies and expanded replies. The application never automatically opens messages, expands replies, or changes the mailbox. Hiding a badge is a display setting and does not stop classification or transmission. Pausing prevents new submissions but cannot recall a request already sent.

Provider retention and data use are governed by [TypeSafe’s policies](https://docs.typesafe.ai/legal). This project does not promise provider-side zero retention or deletion.

## Local persistence

The service stores preferences, sender rules, hashed conversation identities, fingerprints, decisions, and reliable corrections in `.local/state.sqlite3`. Bodies and subjects are not persisted or logged by the service. Card previews remain temporarily in tab memory. Unreliable identities use service-memory storage. Model activity summaries remain in service memory.

The API key belongs in `.env`, which is excluded from Git and release archives. The pairing token is stored under `.local/` and in trusted extension storage. Local service data files are owner-readable/writable; SQLite is not application-level encrypted. Use normal device account protections and disk encryption as appropriate.

## Delete data

- **Clear cached results:** removes cached decisions while keeping preferences and manual corrections.
- **Delete all local service data:** stop the service, remove `.local/`, and restart. This resets preferences, corrections, cached decisions, and the pairing token.
- **Delete extension data:** remove the extension from Chrome. A new installation starts without the old pairing configuration.
- **Provider-held data:** deleting local data does not delete data retained by TypeSafe. Consult the provider’s process separately.

Never publish `.env`, `.local/`, browser profiles, private evaluation datasets, or screenshots of real messages. Tests and packaged examples use synthetic content.

## Distribution status

This repository is a local-use prototype. A public hosted product still needs a production privacy policy, prominent in-product data disclosure and consent, retention/deletion controls, provider review, and Chrome Web Store review. Repository availability is not Chrome Web Store approval.
