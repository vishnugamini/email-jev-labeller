import pytest
from scripts.evaluate import metrics, benchmark
from service.tests.test_service import email, Provider
from service.models import Preferences

def test_metrics_counts_review_as_missed_important():
    result = metrics(['important', 'important', 'spam', 'routine'], ['important', 'review', 'spam', 'spam'])
    assert result['important_recall'] == .5
    assert result['spam_precision'] == .5
    assert result['review_rate'] == .25

@pytest.mark.asyncio
async def test_benchmark_reports_per_request_tokens_without_double_counting():
    result = await benchmark([email()] * 8, Preferences(), 4, .042, Provider())
    assert result['requests'] == 2
    assert result['input_tokens'] == 200
    assert result['first_badge_ms'] <= result['last_badge_ms']
