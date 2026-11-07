"""Opt-in live action classification check using synthetic conversations only."""
import argparse
import asyncio
import json
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from service.engine import Jev, normalize
from service.actions import action_results
from service.models import Message, Observation, Preferences

async def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--allow-send', action='store_true')
    args = parser.parse_args()
    if not args.allow_send:
        parser.error('Add --allow-send to send these synthetic examples to Jev.')
    examples = [
        ('request_and_deadline', [(False, 'Please review the contract and send your approval by Friday at 5 PM.')], ['todo', 'deadline']),
        ('completed_request', [(False, 'Please approve by Friday.'), (True, 'I reviewed and approved it.'), (False, 'Thanks, all set. No further action needed.')], []),
        ('awaiting_quote', [(True, 'Could you send me the revised quote?')], ['waiting']),
        ('sent_thank_you', [(False, 'Your issue is resolved.'), (True, 'Thanks, this resolves everything.')], []),
        ('promised_deliverable', [(False, 'I will send you the signed contract tomorrow. You do not need to do anything.')], ['waiting']),
        ('promotional_countdown', [(False, 'Flash sale ends tonight! Shop now for 20% off. Manage email preferences.')], []),
        ('independent_obligations', [(False, 'Please approve the project brief by Friday. I will send you the budget figures tomorrow.')], ['todo', 'deadline', 'waiting']),
        ('received_deliverable', [(True, 'Can you send the revised quote?'), (False, 'Here is the revised quote you requested. This is for your records; no action is required.')], []),
    ]
    semaphore = asyncio.Semaphore(4)
    async def check(index, case):
        name, messages, expected = case
        observation = Observation(id=str(index), account='owner@example.com', conversation=name, revision='1', reliable=True, session='synthetic',
            subject='Project conversation' if name != 'promotional_countdown' else 'Sale', evidence='body',
            messages=[Message(sender='owner@example.com' if outgoing else 'colleague@example.com', text=text, outgoing=outgoing) for outgoing, text in messages])
        async with semaphore:
            try:
                response = await asyncio.wait_for(Jev().decide([normalize(observation)], Preferences()), 24)
                actions = action_results(response['answers'], 0, observation)
                actual = [name for name, value in actions.items() if value['state'] == 'positive']
                return {'example': name, 'expected_groups': expected, 'actual_groups': actual, 'matches': set(expected) == set(actual), 'probabilities': {name: value['probability'] for name, value in actions.items()}}
            except Exception as exc:
                return {'example': name, 'error': type(exc).__name__}
    print(json.dumps(await asyncio.gather(*(check(i, case) for i, case in enumerate(examples))), indent=2))

if __name__ == '__main__':
    asyncio.run(main())
