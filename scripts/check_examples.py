"""Optional live Jev regression check using synthetic email content only."""
import argparse
import asyncio
import json
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from service.engine import Jev, normalize, validate_answer
from service.models import Observation, Preferences

async def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--allow-send', action='store_true')
    args = parser.parse_args()
    if not args.allow_send:
        parser.error('Add --allow-send to send these synthetic examples to Jev.')
    examples = [
        ('job_alert', 'jobs@career-alerts.example', 'A 94% match Software Engineer role', 'Your daily job recommendations: Software Engineer, Seattle, $120k. View matching roles or manage alert preferences.', 'inbox', 'routine'),
        ('low_match_job_alert', 'jobs@career-alerts.example', 'A 71% match Automation Technician role', 'Your job recommendation: Automation Technician, $18/hr, Onsite. Manage your job alerts in your account.', 'inbox', 'routine'),
        ('bank_promotion', 'updates@bank.example', 'Explore our new savings account', 'Learn about our savings account rates and manage your email preferences. No action is required.', 'inbox', 'routine'),
        ('receipt_in_spam', 'receipts@rides.example', 'Your ride receipt', 'Your completed ride cost $18.60. Payment was charged to your saved card. This is your receipt; no action is needed.', 'spam', 'routine'),
        ('credential_phishing', 'security@verify-password.example', 'Your Google account will be deleted', 'Visit https://verify-password.example/google now and enter your Google password and your two-factor authentication code to prevent deletion.', 'inbox', 'spam'),
        ('advance_fee_scam', 'claims@random-prize.example', 'You won an unexpected lottery', 'You won $2 million without entering. Pay a $500 release fee using gift card codes to receive the prize. Keep this confidential.', 'spam', 'spam'),
    ]
    client = Jev()
    semaphore = asyncio.Semaphore(4)
    async def check(example):
        name, sender, subject, body, mailbox, expected = example
        email = Observation(id=name, account='test@example.com', conversation=name, revision='test', session='test', sender=sender,
                            subject=subject, preview=body, mailbox=mailbox)
        async with semaphore:
            response = await client.decide([normalize(email)], Preferences())
        result = validate_answer(response['answers']['email_0'])
        return {'example': name, 'expected_choice': expected, 'choice': result['choice'], 'label': result['label'],
                'spam_probability': result['probabilities']['spam'], 'matches': result['choice'] == expected}
    results = await asyncio.gather(*(check(example) for example in examples))
    print(json.dumps(results, indent=2))

if __name__ == '__main__':
    asyncio.run(main())
