# Evaluation

## Offline checks

```sh
uv sync --locked --group dev
uv run python -m pytest service/tests -q
npm test
npm run build
```

Service tests cover cache invalidation, body upgrades, rules/corrections, restarts, custom labels, pairing, request validation, malformed responses, action scores, batching, and concurrency. Extension tests use synthetic DOM fixtures. The browser smoke test checks the actual bundled extension against synthetic Gmail and a mocked provider.

```sh
PLAYWRIGHT_BROWSERS_PATH=.cache/browsers npx playwright-core install chromium
npm run test:browser
```

The browser test writes synthetic screenshots under ignored `.cache/`. It does not inspect the user’s Gmail or send messages to Jev.

## Optional hosted-model regression checks

These commands send synthetic text to Jev and can incur provider charges. They require explicit opt-in:

```sh
uv run --env-file .env python scripts/check_examples.py --allow-send
uv run --env-file .env python scripts/check_actions.py --allow-send
```

The first checks six category examples; the second checks eight action scenarios. Neither is a held-out real-inbox accuracy estimate.

## Held-out evaluation

Keep private JSONL data under `.local/`. Supply at least 100 distinct manually labeled evaluation conversations. Tuning examples are excluded, and conversations must not overlap splits.

```json
{"split":"evaluation","expected":"important","email":{"id":"sample-1","account":"me@example.com","conversation":"thread-1","revision":"r1","reliable":true,"session":"evaluation","sender":"person@example.com","subject":"Deadline","preview":"Please reply today","messages":[{"sender":"person@example.com","text":"Please reply today.","outgoing":false}],"evidence":"body"}}
```

Validate data without sending it:

```sh
uv run python scripts/evaluate.py .local/evaluation.jsonl --preferences .local/preferences.json
```

Explicitly send the dataset:

```sh
uv run --env-file .env python scripts/evaluate.py .local/evaluation.jsonl --preferences .local/preferences.json --allow-send > .local/report.json
```

The harness compares preview/body, general/personalized priorities, and individual/4/8 request grouping. It reports per-category precision/recall, Important recall, Spam precision, errors, legacy Review counts, confusion matrices, completion timing, tokens, and estimated input-token cost. The supplied price is an estimate parameter, not a current pricing guarantee; pass `--input-price-per-million` with the price applicable to your account.

The current evaluation script is limited to the three default categories. Custom-label definitions and behavior are tested separately; a custom-label accuracy benchmark needs a corresponding dataset and metrics extension. Sender-rule precedence is unit tested separately from personalization comparisons. No real-email dataset is shipped or automatically evaluated.
