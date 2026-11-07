# Privacy

## Email processing

With classification enabled, the extension sends rendered email text through the local service to TypeSafe’s hosted Jev API. Requests include available sender/recipient details, subject, preview or opened body, visible metadata, priorities, and category descriptions.

The extension does not collect Gmail credentials, cookies, or attachments. It does not open messages, expand replies, or change the mailbox. Hiding a category only hides its badge; pausing stops new submissions. Requests already sent cannot be recalled.

Provider retention is covered by [TypeSafe’s policies](https://docs.typesafe.ai/legal).

## Local storage

The service stores preferences, rules, hashed conversation identities, fingerprints, decisions, and corrections in `.local/state.sqlite3`. It does not persist or log email bodies or subjects. Card previews remain in tab memory.

The API key is read from `.env`. The pairing token is stored under `.local/` and in trusted extension storage. Local service files have owner-only permissions; the database is not encrypted by the application. `.env`, `.local/`, browser profiles, and private datasets are excluded from source packages.

## Deletion

- **Clear cached results** removes model results while retaining preferences and corrections.
- To reset the service, stop it and delete `.local/`. The next start creates a new pairing token.
- Remove the Chrome extension to delete its settings and saved token.
- Local deletion does not remove data retained by TypeSafe.
