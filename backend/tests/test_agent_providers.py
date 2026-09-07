"""Provider wire contracts and safe recovery, without live paid calls."""

import json

import httpx
import pytest
import respx

from k_shui.agent.providers import CAPABILITY_TOOL, Provider, ProviderError, estimate_cost
from k_shui.config import AgentConnectionConfig


def connection(provider="openai"):
    return AgentConnectionConfig(
        id="test",
        name="Test",
        provider=provider,
        model="test-model",
        apiKeyEnv="TEST_PROVIDER_KEY",
        inputUsdPerMillion=1,
        outputUsdPerMillion=3,
    )


@respx.mock
async def test_openai_responses_wire_contract(monkeypatch):
    monkeypatch.setenv("TEST_PROVIDER_KEY", "server-secret")
    route = respx.post("https://api.openai.com/v1/responses").mock(
        return_value=httpx.Response(
            200,
            json={
                "output": [
                    {
                        "type": "function_call",
                        "name": "connection_check",
                        "call_id": "tool1",
                        "arguments": '{"ok":true}',
                    }
                ],
                "usage": {"input_tokens": 12, "output_tokens": 8},
            },
        )
    )
    reply = await Provider(connection()).complete(
        "system",
        [{"role": "user", "content": "hello"}],
        [CAPABILITY_TOOL],
        128,
        force_tool="connection_check",
    )
    request = route.calls[0].request
    body = json.loads(request.content)
    assert request.headers["authorization"] == "Bearer server-secret"
    assert body["store"] is False
    assert body["max_output_tokens"] == 128
    assert body["tool_choice"] == {"type": "function", "name": "connection_check"}
    assert reply.calls == [{"id": "tool1", "name": "connection_check", "arguments": {"ok": True}}]
    assert reply.input_tokens == 12
    assert "server-secret" not in json.dumps(body)


@respx.mock
async def test_anthropic_tool_roundtrip(monkeypatch):
    monkeypatch.setenv("TEST_PROVIDER_KEY", "server-secret")
    route = respx.post("https://api.anthropic.com/v1/messages").mock(
        return_value=httpx.Response(
            200,
            json={
                "content": [{"type": "text", "text": "Finding"}],
                "usage": {"input_tokens": 15, "output_tokens": 9},
            },
        )
    )
    history = [
        {"role": "user", "content": "inspect"},
        {
            "role": "assistant",
            "providerContent": [
                {"type": "tool_use", "id": "tool1", "name": "connection_check", "input": {"ok": True}}
            ],
        },
        {"role": "tool", "callId": "tool1", "content": '{"state":"ok"}'},
    ]
    reply = await Provider(connection("anthropic")).complete("system", history, [CAPABILITY_TOOL], 128)
    request = route.calls[0].request
    body = json.loads(request.content)
    assert body["messages"][-1]["content"][0]["type"] == "tool_result"
    assert body["messages"][-1]["content"][0]["tool_use_id"] == "tool1"
    assert "input_schema" in body["tools"][0]
    assert body["system"] == "system"
    assert request.headers["x-api-key"] == "server-secret"
    assert reply.text == "Finding"


@pytest.mark.parametrize(
    "status,state",
    [
        (401, "invalid_credential"),
        (404, "model_unavailable"),
        (429, "rate_limited"),
        (500, "unreachable"),
        (302, "unreachable"),
        (400, "unsupported"),
    ],
)
@respx.mock
async def test_provider_failures_never_expose_upstream_text(monkeypatch, status, state):
    monkeypatch.setenv("TEST_PROVIDER_KEY", "server-secret")
    route = respx.post("https://api.openai.com/v1/responses").mock(
        return_value=httpx.Response(
            status, text="secret prompt and server-secret", headers={"Location": "http://localhost/private"}
        )
    )
    with pytest.raises(ProviderError) as caught:
        await Provider(connection()).complete("test", [{"role": "user", "content": "hello"}], [], 128)
    assert caught.value.state == state
    assert "server-secret" not in json.dumps(caught.value.to_dict())
    assert route.call_count == 1


@respx.mock
async def test_malformed_tool_arguments_rejected(monkeypatch):
    monkeypatch.setenv("TEST_PROVIDER_KEY", "server-secret")
    respx.post("https://api.openai.com/v1/responses").mock(
        return_value=httpx.Response(
            200,
            json={
                "output": [{"type": "function_call", "call_id": "bad", "name": "inspect", "arguments": "[]"}]
            },
        )
    )
    with pytest.raises(ProviderError):
        await Provider(connection()).complete("test", [{"role": "user", "content": "hello"}], [], 128)


def test_missing_prices_fail_closed():
    config = connection()
    config.inputUsdPerMillion = None
    with pytest.raises(ProviderError) as caught:
        estimate_cost(config, 1, 1)
    assert caught.value.state == "pricing_required"
