"""Explicitly initiated Jev evaluation. No email text is written to reports."""
import argparse
import asyncio
import json
import math
import sys
import time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from service.engine import Jev, normalize, validate_answer
from service.models import Observation, Preferences


def metrics(expected, predicted):
    labels = ['important', 'routine', 'spam']
    matrix = {label: {guess: 0 for guess in labels + ['review', 'error']} for label in labels}
    for truth, guess in zip(expected, predicted):
        matrix[truth][guess] += 1
    per_category = {}
    for label in labels:
        tp = matrix[label][label]
        actual = sum(matrix[label].values())
        selected = sum(matrix[other][label] for other in labels)
        per_category[label] = {'precision': tp / selected if selected else None, 'recall': tp / actual if actual else None, 'support': actual}
    n = len(expected)
    return {'confusion_matrix': matrix, 'per_category': per_category,
        'important_recall': per_category['important']['recall'], 'spam_precision': per_category['spam']['precision'],
        'accuracy': sum(t == g for t,g in zip(expected, predicted))/n,
        'review_rate': predicted.count('review')/n, 'error_rate': predicted.count('error')/n}


def load_dataset(path):
    rows = [json.loads(line) for line in path.read_text().splitlines() if line.strip()]
    if any(row.get('split') not in ('tuning', 'evaluation') or row.get('expected') not in ('important', 'routine', 'spam') for row in rows):
        raise ValueError('Each row needs split=tuning|evaluation and expected=important|routine|spam.')
    selected = [row for row in rows if row['split'] == 'evaluation']
    if len(selected) < 100:
        raise ValueError('Provide at least 100 manually labeled held-out evaluation messages. Tuning messages are excluded.')
    emails = [Observation.model_validate(row['email']) for row in selected]
    if any(not email.messages for email in emails):
        raise ValueError('Every held-out example needs preview text and opened-body messages for paired comparisons.')
    identities = [(e.account, e.conversation) for e in emails]
    if len(identities) != len(set(identities)):
        raise ValueError('Use distinct conversations in the evaluation split.')
    tuning_ids = {(r['email']['account'], r['email']['conversation']) for r in rows if r['split'] == 'tuning'}
    if tuning_ids & set(identities):
        raise ValueError('A conversation cannot occur in both tuning and evaluation splits.')
    return selected, emails


async def benchmark(emails, prefs, size, price, provider=None):
    provider = provider or Jev()
    states = [normalize(e) for e in emails]
    groups = []
    for offset in range(0, len(states), size):
        group = list(enumerate(states))[offset:offset+size]
        if len(json.dumps([x[1] for x in group], ensure_ascii=False).encode()) > 24000:
            groups.extend([[item] for item in group])
        else:
            groups.append(group)
    semaphore = asyncio.Semaphore(4)
    started = time.perf_counter()
    finished = []
    predicted = ['error'] * len(states)
    choices = ['error'] * len(states)
    input_tokens = 0
    async def run(group):
        nonlocal input_tokens
        async with semaphore:
            try:
                data = await asyncio.wait_for(provider.decide([item[1] for item in group], prefs), 24)
                input_tokens += data.get('usage', {}).get('input_tokens', 0)
                for index, (position, _) in enumerate(group):
                    result = validate_answer(data['answers'][f'email_{index}'])
                    predicted[position] = result['label']; choices[position] = result['choice']
            except Exception:
                pass  # Report failure counts; never print email-bearing upstream exceptions.
            finished.append(time.perf_counter() - started)
    await asyncio.gather(*(run(group) for group in groups))
    ordered = sorted(finished)
    return {'predicted': predicted, 'choices': choices, 'requests': len(groups), 'input_tokens': input_tokens,
        'estimated_cost_usd': input_tokens / 1_000_000 * price,
        'first_badge_ms': round(min(finished) * 1000), 'last_badge_ms': round(max(finished) * 1000),
        'p95_request_completion_ms': round(ordered[max(0, math.ceil(.95 * len(ordered))-1)] * 1000)}


async def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('dataset', type=Path)
    parser.add_argument('--preferences', type=Path, required=True)
    parser.add_argument('--allow-send', action='store_true', help='Explicitly send this dataset to hosted Jev for 12 comparisons')
    parser.add_argument('--input-price-per-million', type=float, default=.042)
    args = parser.parse_args()
    rows, emails = load_dataset(args.dataset)
    prefs = Preferences.model_validate_json(args.preferences.read_text())
    if not args.allow_send:
        print(json.dumps({'valid': True, 'held_out_messages': len(rows), 'network_calls': 0, 'next_step': 'Add --allow-send to run the 12 comparisons against hosted Jev.'}, indent=2))
        return
    expected = [row['expected'] for row in rows]
    report = {'messages': len(rows), 'input_price_per_million_usd': args.input_price_per_million, 'runs': {}}
    for evidence in ('preview', 'body'):
        variants = [e.model_copy(update={'messages': [] if evidence == 'preview' else e.messages, 'evidence': evidence}) for e in emails]
        for personalized in (False, True):
            current = prefs if personalized else Preferences()
            baseline = None
            for size in (1,4,8):
                result = await benchmark(variants, current, size, args.input_price_per_million)
                choices = result.pop('choices')
                predicted = result.pop('predicted')
                if baseline is None: baseline = choices
                result.update(metrics(expected, predicted))
                result['choice_disagreement_with_individual'] = sum(a != b for a,b in zip(choices, baseline))/len(rows)
                report['runs'][f'{evidence}:personalized={personalized}:batch={size}'] = result
    print(json.dumps(report, indent=2))

if __name__ == '__main__':
    asyncio.run(main())
