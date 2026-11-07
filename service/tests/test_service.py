import asyncio
import json
import pytest
from fastapi.testclient import TestClient
from service.app import create_app
from service.engine import Engine, Jev, normalize, validate_answer
from service.models import Observation, Message, Preferences, SenderRule


def email(**kwargs):
    return Observation(id='one', account='me@example.com', conversation='thread1', revision='r1', reliable=True,
                       session='tab1', sender='sender@example.com', subject='Private subject', preview='Private preview', **kwargs)

class Provider:
    def __init__(self):
        self.calls = []
        self.active = 0
        self.peak = 0
    async def decide(self, emails, prefs):
        self.calls.append((emails, prefs))
        self.active += 1
        self.peak = max(self.active, self.peak)
        await asyncio.sleep(.005)
        self.active -= 1
        answers = {}
        for i, email_state in enumerate(emails):
            answers[f'email_{i}'] = {'type': 'choice', 'choice': 'routine', 'confidence': .9,
                'probabilities': {'important': .05, 'routine': .9, 'spam': .05} | {label.id: 0. for label in prefs.custom_labels}}
            for name in ['todo', 'deadline', 'waiting']:
                positive = 'Meeting' in email_state['subject'] and not any('All complete' in m['text'] for m in email_state['messages']) and (name != 'waiting' or any(m['outgoing'] for m in email_state['messages']))
                answers[f'email_{i}_{name}'] = {'type': 'noul', 'noul': .95 if positive else .05}
        return {'model': 'jev-1.14.0', 'answers': answers, 'usage': {'input_tokens': 100, 'output_tokens': 10}}


@pytest.mark.asyncio
async def test_cache_body_upgrade_override_reset_new_reply(tmp_path):
    provider = Provider(); engine = Engine(tmp_path / 'db', provider)
    first = email()
    await engine.classify([first])
    assert (await engine.classify([first]))[0]['cached']
    body = first.model_copy(update={'messages': [Message(text='Full body')], 'evidence': 'body'})
    await engine.classify([body])
    result = (await engine.classify([first]))[0]
    assert result['evidence'] == 'body' and len(provider.calls) == 2
    engine.override(body, 'important')
    assert (await engine.classify([first]))[0]['source'] == 'override'
    engine.override(body)
    assert (await engine.classify([body]))[0]['source'] == 'jev'
    engine.override(body, 'spam')
    changed = first.model_copy(update={'revision': 'r2', 'preview': 'New reply'})
    assert (await engine.classify([changed]))[0]['source'] == 'jev'
    assert 'Private subject' not in (tmp_path / 'db').read_bytes().decode(errors='ignore')

@pytest.mark.asyncio
async def test_rules_precedence_preferences_and_accounts(tmp_path):
    p = Provider(); engine = Engine(tmp_path / 'db', p)
    engine.save_preferences(Preferences(rules=[SenderRule(kind='domain', value='example.com', category='spam'),
        SenderRule(kind='address', value='sender@example.com', category='important')]))
    assert (await engine.classify([email()]))[0]['label'] == 'important'
    engine.override(email(), 'routine')
    assert (await engine.classify([email()]))[0]['label'] == 'routine'
    other = email().model_copy(update={'account': 'other@example.com'})
    assert (await engine.classify([other]))[0]['label'] == 'important'
    engine.save_preferences(Preferences(priorities='Urgent deadlines'))
    assert (await engine.classify([other]))[0]['source'] == 'jev'
    engine.save_preferences(Preferences(priorities='Personal messages'))
    await engine.classify([other])
    assert len(p.calls) == 4

@pytest.mark.asyncio
async def test_session_records_never_persist_and_restart(tmp_path):
    p = Provider(); engine = Engine(tmp_path / 'db', p)
    ephemeral = email().model_copy(update={'reliable': False})
    await engine.classify([ephemeral]); engine.override(ephemeral, 'spam')
    assert engine.db.execute('SELECT count(*) FROM records').fetchone()[0] == 0
    assert (await engine.classify([ephemeral]))[0]['source'] == 'override'
    assert (await engine.classify([ephemeral.model_copy(update={'session': 'tab2'})]))[0]['source'] == 'jev'
    await engine.classify([email()]); engine.override(email(), 'important')
    restarted = Engine(tmp_path / 'db', p)
    assert (await restarted.classify([email()]))[0]['source'] == 'override'
    restarted.clear_cache()
    assert (await restarted.classify([email()]))[0]['source'] == 'override'

@pytest.mark.asyncio
async def test_concurrency_dedup_and_batch_limits(tmp_path):
    p = Provider(); engine = Engine(tmp_path / 'db', p)
    rows = [email().model_copy(update={'id': str(i), 'conversation': str(i)}) for i in range(9)]
    await engine.classify(rows)
    assert p.peak == 4
    p.calls.clear()
    await engine.classify(rows, bypass=True, batch_size=4)
    assert [len(call[0]) for call in p.calls] == [4, 4, 1]
    p.calls.clear()
    await engine.classify([rows[0], rows[0].model_copy(update={'id': 'duplicate'})], bypass=True)
    assert len(p.calls) == 1
    p.calls.clear()
    bodies = [r.model_copy(update={'messages': [Message(text='x' * 16000)], 'evidence': 'body'}) for r in rows[:4]]
    await engine.classify(bodies, bypass=True, batch_size=4)
    assert len(p.calls) == 4

@pytest.mark.asyncio
async def test_partial_errors_are_sanitized(tmp_path):
    class Broken(Provider):
        async def decide(self, emails, prefs):
            if emails[0]['subject'] == 'fail':
                raise ValueError('SECRET API KEY AND BODY')
            return await super().decide(emails, prefs)
    engine = Engine(tmp_path / 'db', Broken())
    rows = [email(), email().model_copy(update={'id': 'bad', 'conversation': 'bad', 'subject': 'fail'})]
    results = await engine.classify(rows)
    assert results[0]['label'] == 'routine'
    assert results[1]['error'] == 'classification_failed'
    assert 'SECRET' not in json.dumps(results)

@pytest.mark.parametrize('choice,probability,confidence,label', [('routine', .69, .9, 'routine'), ('spam', .89, .9, 'spam'), ('spam', .95, .9, 'spam'), ('important', .8, .49, 'important')])
def test_selected_choice_is_displayed(choice, probability, confidence, label):
    probs = {k: (1-probability)/2 for k in ['important', 'routine', 'spam']}; probs[choice] = probability
    assert validate_answer({'choice': choice, 'probabilities': probs, 'confidence': confidence})['label'] == label

@pytest.mark.parametrize('answer', [{}, {'choice': 'routine', 'confidence': float('nan'), 'probabilities': {'important': 0, 'routine': 1, 'spam': 0}}, {'choice': 'spam', 'confidence': .9, 'probabilities': {'important': 0, 'routine': 1, 'spam': 0}}])
def test_malformed(answer):
    with pytest.raises(ValueError): validate_answer(answer)

def test_normalization_budget_and_order():
    e = email().model_copy(update={'evidence': 'body', 'messages': [Message(text='old'), Message(text='new'*10000), Message(text='outgoing', outgoing=True)]})
    state = normalize(e)
    assert state['messages'][1]['text'].startswith('new')
    assert [m['position'] for m in state['messages']] == [0, 1, 2]
    def strings(value):
        if isinstance(value, str): return len(value)
        if isinstance(value, dict): return sum(strings(v) for k,v in value.items() if k not in ('evidence', 'mailbox'))
        if isinstance(value, list): return sum(map(strings, value))
        return 0
    assert strings(state) <= 16000 and state['truncated']


def test_http_pairing_and_validation(tmp_path):
    origin = 'chrome-extension://' + 'a'*32
    app = create_app(tmp_path, token='test-token', origin=origin, provider=Provider())
    with TestClient(app) as client:
        assert client.get('/health').status_code == 403
        assert client.get('/health', headers={'Origin': origin}).status_code == 401
        headers = {'Origin': origin, 'Authorization': 'Bearer test-token'}
        assert client.get('/health', headers=headers).status_code == 200
        extension_headers = {'X-Jev-Extension-Origin': origin, 'Authorization': 'Bearer test-token'}
        assert client.get('/health', headers=extension_headers).status_code == 200
        assert client.get('/health', headers=extension_headers | {'Origin': 'https://evil.example'}).status_code == 403
        assert client.options('/classify', headers={'Origin': origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type'}).status_code == 200
        assert client.post('/classify', headers=headers, json={'emails': [email().model_dump()]}).json()['results'][0]['label'] == 'routine'
        assert client.put('/overrides', headers=headers, json={'email': email().model_dump(), 'category': 'important'}).status_code == 200
        assert client.put('/preferences', headers=headers, json={'rules': [{'kind': 'address', 'value': 'bad', 'category': 'spam'}]}).status_code == 400
        assert client.post('/classify', headers=headers, content='x'*1_000_001).status_code == 413

@pytest.mark.asyncio
async def test_real_sdk_contract(monkeypatch):
    import typesafe_sdk
    import httpx2
    captured = []
    async def handler(request):
        body = json.loads(request.content); captured.append(body)
        return httpx2.Response(200, json={'model': 'jev-1.14.0', 'usage': {'input_tokens': 40, 'output_tokens': 4},
            'answers': {key: {'type': 'choice', 'choice': 'routine', 'confidence': .9,
                'probabilities': {'important': .05, 'routine': .9, 'spam': .05}} if question['type'] == 'choice' else {'type': 'noul', 'noul': .9} for key, question in body['questions'].items()}})
    original = typesafe_sdk.AsyncTypeSafeClient
    monkeypatch.setattr(typesafe_sdk, 'AsyncTypeSafeClient', lambda **kw: original(**kw, api_key='test', transport=httpx2.MockTransport(handler), compression=False))
    result = await Jev().decide([normalize(email()), normalize(email())], Preferences())
    assert result['answers']['email_1']['choice'] == 'routine'
    assert 'state.emails["1"]' in captured[0]['questions']['email_1']['instructions']
    assert captured[0]['model'] == 'jev-1.14.0'
    assert len(captured[0]['questions']) == 8
    assert captured[0]['questions']['email_1_waiting']['type'] == 'noul'
    assert 'state.emails["1"]' in captured[0]['questions']['email_1_waiting']['instructions']
    assert 'Use the category descriptions in criteria' in captured[0]['questions']['email_0']['instructions']
    assert 'folder placement alone are not enough' in captured[0]['questions']['email_0']['criteria']['spam']

@pytest.mark.asyncio
async def test_new_opened_body_invalidates_correction(tmp_path):
    engine = Engine(tmp_path / 'db', Provider())
    body = email().model_copy(update={'evidence': 'body', 'messages': [Message(text='Old message')]})
    await engine.classify([body]); engine.override(body, 'important')
    changed = body.model_copy(update={'messages': [Message(text='Old message'), Message(text='New incoming reply')]})
    assert (await engine.classify([changed]))[0]['source'] == 'jev'

@pytest.mark.asyncio
async def test_sdk_retries_rate_limit_without_logging_bodies(monkeypatch, caplog):
    import typesafe_sdk
    import httpx2
    calls = 0
    async def handler(request):
        nonlocal calls
        calls += 1
        if calls == 1:
            return httpx2.Response(429, headers={'retry-after': '0'}, json={'detail': 'Slow down'})
        return httpx2.Response(200, json={'model': 'jev-1.14.0', 'usage': {'input_tokens': 40, 'output_tokens': 4},
            'answers': {'email_0': {'type': 'choice', 'choice': 'routine', 'confidence': .9,
                'probabilities': {'important': .05, 'routine': .9, 'spam': .05}}}})
    original = typesafe_sdk.AsyncTypeSafeClient
    monkeypatch.setattr(typesafe_sdk, 'AsyncTypeSafeClient', lambda **kw: original(**kw, api_key='test', transport=httpx2.MockTransport(handler), compression=False))
    with caplog.at_level('DEBUG'):
        await Jev().decide([normalize(email())], Preferences())
    assert calls == 2
    assert 'Private subject' not in caplog.text and 'Private preview' not in caplog.text


@pytest.mark.asyncio
async def test_mailbox_context_and_policy_invalidate_old_cached_decisions(tmp_path):
    p = Provider(); engine = Engine(tmp_path / 'db', p)
    body = email().model_copy(update={'evidence': 'body', 'mailbox': 'inbox', 'messages': [Message(text='Expected notification')]})
    await engine.classify([body])
    spam_view = email().model_copy(update={'mailbox': 'spam'})
    await engine.classify([spam_view])
    assert len(p.calls) == 2
    assert p.calls[-1][0][0]['mailbox'] == 'spam'
    # The same folder continues to use its cache.
    assert (await engine.classify([spam_view]))[0]['cached']
    # Changing the policy invalidates existing model decisions.
    import service.engine as module
    previous = module.POLICY_VERSION
    try:
        module.POLICY_VERSION = 'next-policy'
        await engine.classify([spam_view])
        assert len(p.calls) == 3
    finally:
        module.POLICY_VERSION = previous

@pytest.mark.asyncio
async def test_custom_descriptions_persist_and_invalidate_cache(tmp_path):
    p = Provider(); engine = Engine(tmp_path / 'db', p)
    await engine.classify([email()])
    prefs = engine.preferences.model_copy(deep=True)
    prefs.category_descriptions.important = 'All direct messages from my university require attention.'
    engine.save_preferences(prefs)
    await engine.classify([email()])
    assert len(p.calls) == 2
    assert p.calls[-1][1].category_descriptions.important == prefs.category_descriptions.important
    restarted = Engine(tmp_path / 'db', p)
    assert restarted.preferences.category_descriptions.important == prefs.category_descriptions.important
    assert (await restarted.classify([email()]))[0]['cached']


def test_legacy_preferences_receive_default_descriptions(tmp_path):
    engine = Engine(tmp_path / 'db', Provider())
    engine.db.execute('INSERT OR REPLACE INTO settings VALUES (?,?)', ('preferences', '{"priorities":"University deadlines","rules":[],"batch_size":4}'))
    engine.db.commit()
    restarted = Engine(tmp_path / 'db', Provider())
    assert restarted.preferences.priorities == 'University deadlines'
    assert restarted.preferences.batch_size == 4
    assert set(restarted.preferences.category_descriptions.model_dump()) == {'important', 'routine', 'spam'}


@pytest.mark.parametrize('descriptions', [{'spam': '   '}, {'important': 'x'*2001}, {'new_choice': 'Other'}])
def test_invalid_category_descriptions_rejected(descriptions):
    from pydantic import ValidationError
    with pytest.raises(ValidationError):
        Preferences(category_descriptions=descriptions)

@pytest.mark.asyncio
async def test_edited_descriptions_reach_official_sdk(monkeypatch):
    import typesafe_sdk
    import httpx2
    captured = []
    async def handler(request):
        body = json.loads(request.content); captured.append(body)
        return httpx2.Response(200, json={'model': 'jev-1.14.0', 'usage': {'input_tokens': 40, 'output_tokens': 4},
            'answers': {'email_0': {'type': 'choice', 'choice': 'important', 'confidence': 1.,
                'probabilities': {'important': 1., 'routine': 0., 'spam': 0.}}}})
    original = typesafe_sdk.AsyncTypeSafeClient
    monkeypatch.setattr(typesafe_sdk, 'AsyncTypeSafeClient', lambda **kw: original(**kw, api_key='test', transport=httpx2.MockTransport(handler), compression=False))
    prefs = Preferences(category_descriptions={'important': 'Job alerts for ML roles need immediate attention.'}, custom_labels=[{'id': 'custom_finance', 'name': 'Finance', 'description': 'Invoices and statements.'}])
    await Jev().decide([normalize(email())], prefs)
    assert captured[0]['questions']['email_0']['criteria'] == prefs.criteria()
    assert captured[0]['questions']['email_0']['criteria']['custom_finance'] == 'Finance: Invoices and statements.'
    assert 'Job alerts for ML roles' not in str(captured[0]['state'])

@pytest.mark.asyncio
async def test_custom_label_roundtrip_selection_rules_and_removal(tmp_path):
    class CustomProvider(Provider):
        async def decide(self, emails, prefs):
            response = await super().decide(emails, prefs)
            for i in range(len(emails)):
                choice = prefs.custom_labels[0].id if prefs.custom_labels else 'routine'
                response['answers'][f'email_{i}'] = {'choice': choice, 'confidence': .4,
                    'probabilities': {key: float(key == choice) for key in prefs.criteria()}}
            return response
    provider = CustomProvider(); path = tmp_path / 'db'; engine = Engine(path, provider)
    custom = {'id': 'custom_finance', 'name': 'Finance', 'description': 'Invoices and bank statements.'}
    prefs = Preferences(custom_labels=[custom])
    engine.save_preferences(prefs)
    result = (await engine.classify([email()]))[0]
    assert result['label'] == 'custom_finance'
    assert Engine(path).preferences.custom_labels[0].name == 'Finance'
    engine.override(email(), 'custom_finance')
    prefs.rules = [SenderRule(kind='address', value='sender@example.com', category='custom_finance')]
    engine.save_preferences(prefs)
    assert engine.rule(email(), prefs) == 'custom_finance'
    engine.save_preferences(Preferences())
    assert (await engine.classify([email()]))[0]['label'] == 'routine'
    with pytest.raises(ValueError, match='no longer exists'):
        engine.override(email(), 'custom_finance')

@pytest.mark.parametrize('labels', [
    [{'id': 'custom_a', 'name': 'Routine', 'description': 'x'}],
    [{'id': 'custom_a', 'name': 'A', 'description': 'x'}, {'id': 'custom_a', 'name': 'B', 'description': 'y'}],
    [{'id': 'custom_a', 'name': 'A', 'description': 'x'}, {'id': 'custom_b', 'name': 'a', 'description': 'y'}],
    [{'id': 'unsafe selector', 'name': 'A', 'description': 'x'}],
    [{'id': 'custom_a', 'name': ' ', 'description': 'x'}],
])
def test_invalid_custom_labels(labels):
    with pytest.raises(ValueError): Preferences(custom_labels=labels)
