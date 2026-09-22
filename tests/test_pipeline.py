from app.core import pipeline


def _item(n: int) -> dict:
    return {"payload": f"event-{n}", "source": None}


def test_enqueue_accepts_when_space():
    pipeline.configure_queue(10)
    try:
        assert pipeline.enqueue(_item(1)) is True
        assert pipeline.queue_depth() >= 1
    finally:
        pipeline.configure_queue(10000)


def test_full_queue_sheds_load_and_counts():
    pipeline.configure_queue(2)
    try:
        assert pipeline.enqueue(_item(1)) is True
        assert pipeline.enqueue(_item(2)) is True
        assert pipeline.enqueue(_item(3)) is False
        assert pipeline.enqueue(_item(4)) is False
        assert pipeline.queue_dropped_total() == 2
        assert pipeline.queue_depth() == 2
    finally:
        pipeline.configure_queue(10000)
    assert pipeline.queue_dropped_total() == 0


def test_queue_metrics_endpoint(client):
    body = client.get("/api/v1/metrics").text
    assert "simplifyr_queue_depth" in body
    assert "simplifyr_queue_dropped_total" in body
