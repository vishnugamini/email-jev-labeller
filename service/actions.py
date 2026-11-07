"""Independent action questions and conservative display thresholds."""
import math

ACTION_QUESTIONS = {
    'todo': 'Does this conversation show an outstanding action or personal reply required from the mailbox user? Count incoming requests addressed to the user, unresolved questions directed to the user, explicit unfinished commitments made by the user, or consequential account actions. A message marked outgoing was written by the user: an outgoing request asks SOMEBODY ELSE to act and is NOT by itself a To do for the user. It may coexist with a separate unresolved incoming request, which still counts. Do not count requests already completed in later messages, acknowledgments, optional promotions, generic job alerts, or phishing instructions.',
    'deadline': 'Does this conversation explicitly mention a deadline for an outstanding action required from the mailbox user? Count a stated due date, cutoff, or time limit tied to a real obligation. Exclude completed requests, historical dates, meeting dates alone, and promotional sale countdowns. Do not invent or extract a date.',
    'waiting': 'Is the mailbox user currently awaiting a response or promised deliverable from someone else in this conversation? Require an unanswered request made by the user, or an explicit unfulfilled promise from another person. Use message positions and outgoing flags to distinguish who owes whom. A sent thank-you, completed exchange, generic job alert, ordinary automated receipt, or mere lack of a reply is not enough.',
}

def action_results(answers, index, email):
    result = {}
    for name in ACTION_QUESTIONS:
        answer = answers.get(f'email_{index}_{name}', {})
        probability = answer.get('noul') if isinstance(answer, dict) and answer.get('type') == 'noul' else None
        valid = not isinstance(probability, bool) and isinstance(probability, (float, int)) and math.isfinite(probability) and 0 <= probability <= 1
        if name == 'waiting' and (email.evidence != 'body' or not email.reliable):
            result[name] = {'probability': None, 'state': 'needs_context'}
        elif not valid:
            result[name] = {'probability': None, 'state': 'unavailable'}
        else:
            result[name] = {'probability': probability, 'state': 'positive' if probability >= .8 else 'negative' if probability <= .2 else 'uncertain'}
    return result
