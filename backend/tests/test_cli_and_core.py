"""CLI commands, pagination/time-range dependencies and the sampler ring buffer."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
from typer.testing import CliRunner

from k_shui import __version__
from k_shui.cli import app as cli_app
from k_shui.core.deps import Pagination, _parse_duration, series, time_range
from k_shui.core.errors import BadRequest

runner = CliRunner()


# ------------------------------------------------------------------ CLI
def test_version_command() -> None:
    result = runner.invoke(cli_app, ["version"])
    assert result.exit_code == 0
    assert __version__ in result.stdout


def test_version_flag() -> None:
    result = runner.invoke(cli_app, ["--version"])
    assert result.exit_code == 0
    assert __version__ in result.stdout


def test_init_writes_a_loadable_config(tmp_path: Path) -> None:
    target = tmp_path / "k-shui.yaml"
    result = runner.invoke(cli_app, ["init", "--output", str(target)])
    assert result.exit_code == 0
    assert target.exists()

    from k_shui.config import load_settings

    settings = load_settings(target)
    assert settings.server.port == 8090
    assert settings.auth.type == "none"
    assert [c.id for c in settings.clusters] == ["local"]
    assert "KSHUI__" in target.read_text()  # annotated


def test_init_refuses_to_overwrite(tmp_path: Path) -> None:
    target = tmp_path / "k-shui.yaml"
    target.write_text("existing: true")
    assert runner.invoke(cli_app, ["init", "--output", str(target)]).exit_code == 1
    assert target.read_text() == "existing: true"
    assert runner.invoke(cli_app, ["init", "--output", str(target), "--force"]).exit_code == 0
    assert "server:" in target.read_text()


def test_check_reports_unreachable_clusters(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    config = tmp_path / "k-shui.yaml"
    config.write_text("clusters:\n  - id: dead\n    bootstrapServers: nowhere.invalid:9092\n")
    monkeypatch.delenv("KSHUI_CONFIG", raising=False)
    result = runner.invoke(cli_app, ["check", "--config", str(config), "--timeout", "1"])
    assert result.exit_code == 1  # unreachable -> non-zero
    assert "dead" in result.stdout
    assert "kafka" in result.stdout


def test_check_succeeds_with_a_reachable_fake(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    from tests.fakes import FakeKafkaAdmin

    class Reachable(FakeKafkaAdmin):
        pass

    import k_shui.kafka.admin as admin_module

    monkeypatch.setattr(admin_module, "KafkaAdmin", Reachable)
    config = tmp_path / "k-shui.yaml"
    config.write_text("clusters:\n  - id: alive\n    bootstrapServers: fake:9092\n")
    result = runner.invoke(cli_app, ["check", "--config", str(config), "--timeout", "1"])
    assert result.exit_code == 0
    assert "alive" in result.stdout


def test_serve_help_lists_every_option() -> None:
    out = runner.invoke(cli_app, ["serve", "--help"]).stdout
    for flag in ("--config", "--host", "--port", "--bootstrap-servers", "--reload"):
        assert flag in out


# ------------------------------------------------------------------ deps
def test_pagination_slicing_and_envelope() -> None:
    page = Pagination(page=2, per_page=3)
    assert page.offset == 3
    items = list(range(10))
    assert page.slice(items) == [3, 4, 5]
    env = page.envelope(items)
    assert env == {"items": [3, 4, 5], "page": 2, "perPage": 3, "total": 10}


@pytest.mark.parametrize(("label", "expected"), [("1h", 3600), ("6h", 21600), ("24h", 86400), ("7d", 604800)])
def test_time_range_labels(label: str, expected: int) -> None:
    tr = time_range(range=label, start=None, end=None, step=None)
    assert round(tr.duration) == expected
    assert tr.label == label
    assert tr.step > 0
    assert len(tr.buckets()) > 1


def test_time_range_explicit_start_end_and_step() -> None:
    tr = time_range(range=None, start="1700000000", end="1700003600", step="60s")
    assert tr.start == 1700000000
    assert tr.end == 1700003600
    assert tr.step == 60
    assert tr.start_ms == 1700000000000
    assert len(tr.buckets()) == 61


def test_time_range_accepts_millis_and_iso() -> None:
    tr = time_range(range=None, start="1700000000000", end="2023-11-14T23:13:20+00:00", step=None)
    assert tr.start == 1700000000
    assert tr.end > tr.start


def test_time_range_rejects_bad_input() -> None:
    with pytest.raises(BadRequest):
        time_range(range=None, start="not-a-time", end=None, step=None)
    with pytest.raises(BadRequest):
        time_range(range=None, start="1700003600", end="1700000000", step=None)
    with pytest.raises(BadRequest):
        _parse_duration("banana")


def test_series_helper_shape() -> None:
    assert series("bytesIn", [[1, 2.0]], {"topic": "t"}) == {
        "name": "bytesIn",
        "labels": {"topic": "t"},
        "points": [[1, 2.0]],
    }


# ------------------------------------------------------------------ sampler
async def test_sampler_builds_ring_buffer_series(settings: Any) -> None:
    from k_shui.core.registry import ClusterRegistry
    from k_shui.core.sampler import ClusterSampler

    ctx = ClusterRegistry(settings).get("test")
    sampler = ClusterSampler(ctx)

    first = await sampler.sample_once()
    assert first.error is None
    assert first.topics == 3
    assert first.partitions == 5
    assert first.under_replicated == 0
    assert first.in_sync_pct == 100.0
    assert first.per_topic["orders"] == 300
    assert first.per_group["app-consumers"] == 10

    second = await sampler.sample_once()
    second.ts = first.ts + 10  # simulate a 10s gap
    second.messages = first.messages + 100

    start, end = first.ts - 60, second.ts + 60
    overview = {s["name"]: s for s in sampler.overview_series(start, end)}
    assert overview["messagesIn"]["points"][-1][1] == pytest.approx(10.0)
    assert overview["underReplicated"]["points"][-1][1] == 0

    topic_series = {s["name"]: s for s in sampler.topic_series("orders", start, end)}
    assert topic_series["size"]["points"][-1][1] == 300 * 1024

    lag = sampler.group_lag_series("app-consumers", start, end)
    assert lag[0]["labels"] == {"group": "app-consumers"}
    assert lag[0]["points"][-1][1] == 10
    assert any(s["labels"].get("topic") == "orders" for s in lag)


async def test_sampler_records_errors_without_raising(settings: Any) -> None:
    from k_shui.core.registry import ClusterRegistry
    from k_shui.core.sampler import ClusterSampler
    from k_shui.kafka.admin import KafkaAdmin

    ctx = ClusterRegistry(settings).get("test")
    admin = KafkaAdmin.get(ctx)
    admin.reachable = False  # type: ignore[attr-defined]

    sampler = ClusterSampler(ctx)
    sample = await sampler.sample_once()
    assert sample.error
    assert sampler.window(sample.ts - 10, sample.ts + 10) == []  # errored samples are skipped
    assert sampler.overview_series(sample.ts - 10, sample.ts + 10)


async def test_sampler_manager_start_stop(settings: Any) -> None:
    from k_shui.core.registry import ClusterRegistry
    from k_shui.core.sampler import SamplerManager

    manager = SamplerManager(ClusterRegistry(settings))
    manager.start()
    assert manager.get("test") is not None
    assert manager.get("missing") is None
    await manager.stop()


# ------------------------------------------------------------- SPA base path


def test_render_index_is_untouched_at_root(tmp_path):
    from k_shui.main import _render_index

    index = tmp_path / "index.html"
    index.write_text('<head><script src="/assets/app.js"></script></head>', encoding="utf-8")
    assert _render_index(index, "") == index.read_text(encoding="utf-8")


def test_render_index_prefixes_assets_and_injects_base(tmp_path):
    """Behind an ingress sub-path the bundle's root-absolute URLs must be rewritten,
    and the prefix published for the frontend's basePath() helper."""
    from k_shui.main import _render_index

    index = tmp_path / "index.html"
    index.write_text(
        '<head><link rel="icon" href="/favicon.svg">'
        '<script type="module" src="/assets/index.js"></script></head><body></body>',
        encoding="utf-8",
    )
    html = _render_index(index, "/kshui")

    assert 'src="/kshui/assets/index.js"' in html
    assert 'href="/kshui/favicon.svg"' in html
    assert 'window.__KSHUI_BASE__="/kshui"' in html
    # protocol-relative and absolute URLs must not be touched
    assert "/kshui//" not in html


def test_render_index_leaves_external_urls_alone(tmp_path):
    from k_shui.main import _render_index

    index = tmp_path / "index.html"
    index.write_text('<head><link href="https://cdn.test/x.css"><img src="//cdn/y.png"></head>')
    html = _render_index(index, "/kshui")
    assert 'href="https://cdn.test/x.css"' in html
    assert 'src="//cdn/y.png"' in html


def test_render_css_prefixes_font_urls(tmp_path):
    """Fonts are fetched by the CSS engine, not resolved from index.html, so the
    stylesheet's own url(...) targets need the same prefix."""
    from k_shui.main import _render_css

    (tmp_path / "app.css").write_text(
        "@font-face{src:url(/assets/inter.woff2)}.x{background:url(/assets/bg.png)}",
        encoding="utf-8",
    )
    (tmp_path / "plain.css").write_text(".y{color:red}", encoding="utf-8")

    assert _render_css(tmp_path, "") == {}

    out = _render_css(tmp_path, "/kshui")
    assert "plain.css" not in out  # nothing to rewrite
    assert "url(/kshui/assets/inter.woff2)" in out["app.css"]
    assert "url(/kshui/assets/bg.png)" in out["app.css"]
