# Evaluation

## Local tests

```sh
uv sync --locked --group dev
uv run python -m pytest service/tests -q
npm test
npm run build
```

Tests cover extraction, row association, rules, corrections, cache invalidation, custom labels, pairing, response validation, actions, and batching. The browser test uses a temporary profile, synthetic Gmail, and a mock Jev provider:

```sh
PLAYWRIGHT_BROWSERS_PATH=.cache/browsers npx playwright-core install chromium
npm run test:browser
```

## Jev checks

These send synthetic examples to Jev and use API credits:

```sh
uv run --env-file .env python scripts/check_examples.py --allow-send
uv run --env-file .env python scripts/check_actions.py --allow-send
```

They check six category examples and eight action scenarios. They do not measure real-inbox accuracy.

## Labeled dataset

Keep private data under `.local/`. The evaluation script requires at least 100 distinct manually labeled conversations. Tuning conversations must be separate from evaluation conversations.

Each JSONL line contains a split, expected category, and observation:

```json
{"split":"evaluation","expected":"important","email":{"id":"sample-1","account":"me@example.com","conversation":"thread-1","revision":"r1","reliable":true,"session":"evaluation","sender":"person@example.com","subject":"Deadline","preview":"Please reply today","messages":[{"sender":"person@example.com","text":"Please reply today.","outgoing":false}],"evidence":"body"}}
```

Validate without sending data:

```sh
uv run python scripts/evaluate.py .local/evaluation.jsonl --preferences .local/preferences.json
```

Run the evaluation against Jev:

```sh
uv run --env-file .env python scripts/evaluate.py .local/evaluation.jsonl --preferences .local/preferences.json --allow-send > .local/report.json
```

The script compares preview/body context, priorities, and individual/4/8 request grouping. Reports include precision, recall, errors, confusion matrices, latency, token usage, and estimated cost. Set `--input-price-per-million` to your applicable rate.

The dataset harness supports the three default categories. Custom-label behavior and sender rules are tested separately. No private email dataset is included.
