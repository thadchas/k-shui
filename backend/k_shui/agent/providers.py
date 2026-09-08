"""Official API adapters; no custom endpoints, browser credentials, or paid fallbacks.

References: https://developers.openai.com/api/docs/guides/function-calling
https://platform.claude.com/docs/en/api/http/messages/create
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from typing import Any

import httpx

from k_shui.config import AgentConnectionConfig

RECOVERY = {
    "invalid_credential": "Ask an administrator to update the server credential, then test again.",
    "model_unavailable": "Check the configured model ID and the API account's model permissions.",
    "rate_limited": "Wait for the provider limit to reset or adjust the API account quota; retry explicitly.",
    "unreachable": "Check server outbound HTTPS connectivity to the provider, then retry.",
    "timeout": "The provider request timed out. Retry explicitly or narrow the investigation.",
    "unsupported": "Choose a model supporting function tools and test the connection again.",
    "pricing_required": "Set inputUsdPerMillion and outputUsdPerMillion to deployment contract rates.",
    "budget_exceeded": "Narrow the request or ask an administrator to review the run budget.",
    "invalid_response": "The provider returned an invalid response. Test the connection before retrying.",
}


class ProviderError(Exception):
    def __init__(self, state: str):
        self.state = state
        self.recovery = RECOVERY.get(state, "Test the connection and retry explicitly.")
        super().__init__(self.recovery)

    def to_dict(self) -> dict[str, str]:
        return {
            "state": self.state,
            "message": self.state.replace("_", " ").capitalize(),
            "recovery": self.recovery,
        }


@dataclass
class ProviderReply:
    text: str = ""
    calls: list[dict[str, Any]] = field(default_factory=list)
    content: list[dict[str, Any]] = field(default_factory=list)
    input_tokens: int = 0
    output_tokens: int = 0


def connection_state(connection: AgentConnectionConfig) -> str:
    if not os.environ.get(connection.apiKeyEnv):
        return "invalid_credential"
    if connection.inputUsdPerMillion is None or connection.outputUsdPerMillion is None:
        return "pricing_required"
    return "untested"


def estimate_cost(connection: AgentConnectionConfig, input_tokens: int, output_tokens: int) -> float:
    if connection.inputUsdPerMillion is None or connection.outputUsdPerMillion is None:
        raise ProviderError("pricing_required")
    return (
        input_tokens * connection.inputUsdPerMillion + output_tokens * connection.outputUsdPerMillion
    ) / 1_000_000


class Provider:
    def __init__(self, connection: AgentConnectionConfig, timeout: float = 45):
        self.connection = connection
        self.timeout = timeout

    async def complete(
        self,
        system: str,
        history: list[dict[str, Any]],
        tools: list[dict[str, Any]],
        max_tokens: int,
        *,
        force_tool: str | None = None,
    ) -> ProviderReply:
        connection = self.connection
        key = os.environ.get(connection.apiKeyEnv)
        if not key:
            raise ProviderError("invalid_credential")
        if connection.provider == "openai":
            inputs = []
            for entry in history:
                if "providerContent" in entry:
                    inputs.extend(entry["providerContent"])
                elif entry["role"] == "tool":
                    inputs.append(
                        {
                            "type": "function_call_output",
                            "call_id": entry["callId"],
                            "output": entry["content"],
                        }
                    )
                else:
                    inputs.append({"role": entry["role"], "content": entry["content"]})
            payload: dict[str, Any] = {
                "model": connection.model,
                "instructions": system,
                "input": inputs,
                "max_output_tokens": max_tokens,
                "store": False,
                "include": ["reasoning.encrypted_content"],
            }
            if tools:
                payload["tools"] = tools
                payload["parallel_tool_calls"] = False
            if force_tool:
                payload["tool_choice"] = {"type": "function", "name": force_tool}
            url = "https://api.openai.com/v1/responses"
            headers = {"Authorization": f"Bearer {key}"}
        else:
            messages = []
            for entry in history:
                if "providerContent" in entry:
                    messages.append({"role": "assistant", "content": entry["providerContent"]})
                elif entry["role"] == "tool":
                    messages.append(
                        {
                            "role": "user",
                            "content": [
                                {
                                    "type": "tool_result",
                                    "tool_use_id": entry["callId"],
                                    "content": entry["content"],
                                }
                            ],
                        }
                    )
                else:
                    messages.append({"role": entry["role"], "content": entry["content"]})
            payload = {
                "model": connection.model,
                "system": system,
                "messages": messages,
                "max_tokens": max_tokens,
            }
            if tools:
                payload["tools"] = [
                    {
                        "name": t["name"],
                        "description": t.get("description", ""),
                        "input_schema": t["parameters"],
                    }
                    for t in tools
                ]
            if force_tool:
                payload["tool_choice"] = {"type": "tool", "name": force_tool}
            url = "https://api.anthropic.com/v1/messages"
            headers = {"x-api-key": key, "anthropic-version": "2023-06-01"}
        try:
            async with httpx.AsyncClient(
                timeout=self.timeout, follow_redirects=False, trust_env=False
            ) as client:
                response = await client.post(url, headers=headers, json=payload)
        except httpx.TimeoutException as exc:
            raise ProviderError("timeout") from exc
        except httpx.RequestError as exc:
            raise ProviderError("unreachable") from exc
        # Never expose the provider response body: upstream errors may echo credentials or prompts.
        if response.status_code in (401, 403):
            raise ProviderError("invalid_credential")
        if response.status_code == 404:
            raise ProviderError("model_unavailable")
        if response.status_code == 429:
            raise ProviderError("rate_limited")
        if response.status_code in (400, 422):
            raise ProviderError("unsupported")
        if response.is_error or response.is_redirect:
            raise ProviderError("unreachable")
        if len(response.content) > 2_000_000:
            raise ProviderError("invalid_response")
        try:
            body = response.json()
            reply = ProviderReply()
            usage = body.get("usage") or {}
            reply.input_tokens = int(usage.get("input_tokens", 0))
            reply.output_tokens = int(usage.get("output_tokens", 0))
            if connection.provider == "openai":
                if body.get("error"):
                    raise ProviderError("invalid_response")
                reply.content = body.get("output", [])
                for item in reply.content:
                    if item.get("type") == "message":
                        reply.text += "".join(
                            c.get("text", "")
                            for c in item.get("content", [])
                            if c.get("type") == "output_text"
                        )
                    elif item.get("type") == "function_call":
                        reply.calls.append(
                            {
                                "id": item["call_id"],
                                "name": item["name"],
                                "arguments": json.loads(item["arguments"]),
                            }
                        )
            else:
                reply.content = body.get("content", [])
                for item in reply.content:
                    if item.get("type") == "text":
                        reply.text += item.get("text", "")
                    elif item.get("type") == "tool_use":
                        reply.calls.append(
                            {"id": item["id"], "name": item["name"], "arguments": item["input"]}
                        )
            if not reply.text and not reply.calls:
                raise ProviderError("invalid_response")
            if any(not isinstance(c["arguments"], dict) for c in reply.calls):
                raise ProviderError("invalid_response")
            return reply
        except (ValueError, TypeError, KeyError, AttributeError) as exc:
            raise ProviderError("invalid_response") from exc


CAPABILITY_TOOL = {
    "type": "function",
    "name": "connection_check",
    "description": "Confirm tool calling capability; has no side effects.",
    "parameters": {
        "type": "object",
        "properties": {"ok": {"type": "boolean"}},
        "required": ["ok"],
        "additionalProperties": False,
    },
    "strict": True,
}


async def test_connection(connection: AgentConnectionConfig, max_cost: float) -> dict[str, Any]:
    state = connection_state(connection)
    if state != "untested":
        raise ProviderError(state)
    if estimate_cost(connection, 2048, 128) > max_cost:
        raise ProviderError("budget_exceeded")
    reply = await Provider(connection, timeout=15).complete(
        "Call connection_check with ok=true. This test has no access to resource data.",
        [{"role": "user", "content": "Test tool capability."}],
        [CAPABILITY_TOOL],
        128,
        force_tool="connection_check",
    )
    if not any(c["name"] == "connection_check" and c["arguments"].get("ok") is True for c in reply.calls):
        raise ProviderError("unsupported")
    return {
        "state": "connected",
        "toolCapable": True,
        "usage": {
            "inputTokens": reply.input_tokens,
            "outputTokens": reply.output_tokens,
            "estimatedCostUsd": estimate_cost(connection, reply.input_tokens, reply.output_tokens),
        },
    }
