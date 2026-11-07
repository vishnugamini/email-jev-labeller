import pytest
from service.actions import action_results
from service.engine import Engine, normalize
from service.models import Message, Preferences, SenderRule
from service.tests.test_service import Provider, email


def answers(todo=.95, deadline=.95, waiting=.95):
    return {f'email_0_{name}': {'type': 'noul', 'noul': value} for name, value in [('todo', todo), ('deadline', deadline), ('waiting', waiting)]}


def test_independent_actions_and_preview_waiting_gate():
    result = action_results(answers(), 0, email())
    assert result['todo']['state'] == result['deadline']['state'] == 'positive'
    assert result['waiting']['state'] == 'needs_context'
    body = email().model_copy(update={'evidence': 'body'})
    assert action_results(answers(), 0, body)['waiting']['state'] == 'positive'
    assert action_results(answers(), 0, body.model_copy(update={'reliable': False}))['waiting']['state'] == 'needs_context'


@pytest.mark.parametrize('value,state', [(0, 'negative'), (.2, 'negative'), (.21, 'uncertain'), (.79, 'uncertain'), (.8, 'positive'), (1, 'positive'), (True, 'unavailable'), (float('nan'), 'unavailable'), (float('inf'), 'unavailable'), (-.1, 'unavailable'), (1.1, 'unavailable')])
def test_action_thresholds_and_invalid_values(value, state):
    assert action_results(answers(todo=value), 0, email())['todo']['state'] == state


def test_missing_action_never_becomes_a_false_negative():
    result = action_results({}, 0, email())
    assert result['todo'] == {'probability': None, 'state': 'unavailable'}


def test_normalize_preserves_order_and_direction_for_resolved_requests():
    observation = email().model_copy(update={'evidence': 'body', 'messages': [
        Message(sender='other@example.com', text='Please approve by Friday.'),
        Message(sender='me@example.com', text='Approved.', outgoing=True),
        Message(sender='other@example.com', text='Thanks, all done.'),
    ]})
    messages = normalize(observation)['messages']
    assert [m['text'] for m in messages] == ['Please approve by Friday.', 'Approved.', 'Thanks, all done.']
    assert [m['outgoing'] for m in messages] == [False, True, False]


@pytest.mark.asyncio
async def test_category_rules_and_corrections_do_not_change_actions(tmp_path):
    provider = Provider(); engine = Engine(tmp_path / 'db', provider)
    engine.save_preferences(Preferences(rules=[SenderRule(kind='address', value='sender@example.com', category='spam')]))
    observation = email().model_copy(update={'subject': 'Meeting tomorrow'})
    first = (await engine.classify([observation]))[0]
    assert first['source'] == 'rule' and first['label'] == 'spam'
    assert first['actions']['todo']['state'] == first['actions']['deadline']['state'] == 'positive'
    engine.override(observation, 'important')
    corrected = (await engine.classify([observation]))[0]
    assert corrected['source'] == 'override' and corrected['actions'] == first['actions']
    engine.override(observation)
    reset = (await engine.classify([observation]))[0]
    assert reset['source'] == 'rule' and len(provider.calls) == 1


@pytest.mark.asyncio
async def test_action_results_update_after_new_reply(tmp_path):
    provider = Provider(); engine = Engine(tmp_path / 'db', provider)
    observation = email().model_copy(update={'subject': 'Meeting tomorrow'})
    assert (await engine.classify([observation]))[0]['actions']['todo']['state'] == 'positive'
    resolved = observation.model_copy(update={'revision': 'r2', 'subject': 'Resolved'})
    assert (await engine.classify([resolved]))[0]['actions']['todo']['state'] == 'negative'


@pytest.mark.asyncio
async def test_missing_noul_response_preserves_category_and_can_retry(tmp_path):
    class Partial(Provider):
        async def decide(self, emails, prefs):
            response = await super().decide(emails, prefs)
            del response['answers']['email_0_todo']
            return response
    provider = Partial(); engine = Engine(tmp_path / 'db', provider)
    first = (await engine.classify([email()]))[0]
    assert first['label'] == 'routine'
    assert first['actions']['todo']['state'] == 'unavailable'
    await engine.classify([email()])
    assert len(provider.calls) == 2


@pytest.mark.asyncio
async def test_rule_label_survives_action_provider_failure(tmp_path):
    class Broken:
        async def decide(self, emails, prefs): raise RuntimeError('private upstream error')
    engine = Engine(tmp_path / 'db', Broken())
    engine.save_preferences(Preferences(rules=[SenderRule(kind='address', value='sender@example.com', category='important')]))
    result = (await engine.classify([email()]))[0]
    assert result['label'] == 'important' and result['source'] == 'rule'
    assert result['action_error'] == 'classification_failed'
    assert result['actions']['todo']['state'] == 'unavailable'
