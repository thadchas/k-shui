"""PromQL label injection.

Every query issued through k-shui gets the cluster's configured label selectors
(``prometheus.labels`` in the config) added to each *vector selector*, so a shared
Prometheus serving several Kafka clusters returns only the relevant series.

The implementation is a deliberately small regex scanner rather than a full PromQL
parser. It walks the expression and skips the constructs where an identifier is *not* a
metric name: string literals, ``[5m]`` range/subquery blocks, ``{...}`` matcher blocks,
``by (a, b)`` style label lists, ``offset``/``@`` modifiers and function names.
"""

from __future__ import annotations

import re

__all__ = ["inject_labels", "matcher_string"]

#: Aggregators, binary-op modifiers and keywords that are never metric names.
RESERVED = {
    "and",
    "or",
    "unless",
    "by",
    "without",
    "on",
    "ignoring",
    "group_left",
    "group_right",
    "offset",
    "bool",
    "start",
    "end",
    "inf",
    "nan",
    "sum",
    "min",
    "max",
    "avg",
    "group",
    "stddev",
    "stdvar",
    "count",
    "count_values",
    "bottomk",
    "topk",
    "quantile",
    "limitk",
    "limit_ratio",
}
#: Keywords followed by a parenthesised *label list* rather than an expression.
LABEL_LIST_KEYWORDS = {"by", "without", "on", "ignoring", "group_left", "group_right"}

_IDENT = re.compile(r"[a-zA-Z_:][a-zA-Z0-9_:]*")
_DURATION = re.compile(r"\s*-?[0-9]+(\.[0-9]+)?(ms|s|m|h|d|w|y)?")


def matcher_string(labels: dict[str, str]) -> str:
    return ",".join(f'{k}="{v}"' for k, v in sorted(labels.items()))


def _skip_string(expr: str, i: int) -> int:
    quote = expr[i]
    i += 1
    while i < len(expr):
        if expr[i] == "\\":
            i += 2
            continue
        if expr[i] == quote:
            return i + 1
        i += 1
    return i


def _skip_balanced(expr: str, i: int, open_char: str, close_char: str) -> int:
    depth = 0
    while i < len(expr):
        if expr[i] in "\"'`":
            i = _skip_string(expr, i)
            continue
        if expr[i] == open_char:
            depth += 1
        elif expr[i] == close_char:
            depth -= 1
            if depth == 0:
                return i + 1
        i += 1
    return i


def _merge(inner: str, extra: str) -> str:
    inner = inner.strip()
    return "{" + (f"{inner},{extra}" if inner else extra) + "}"


def inject_labels(expr: str, labels: dict[str, str]) -> str:
    """Return ``expr`` with ``labels`` added to every vector selector."""
    if not labels or not expr:
        return expr
    extra = matcher_string(labels)
    out: list[str] = []
    i, n = 0, len(expr)
    while i < n:
        char = expr[i]
        if char in "\"'`":
            end = _skip_string(expr, i)
            out.append(expr[i:end])
            i = end
            continue
        if char == "[":  # range / subquery selector — never contains a metric name
            end = _skip_balanced(expr, i, "[", "]")
            out.append(expr[i:end])
            i = end
            continue
        if char == "{":  # bare `{__name__="x"}` selector
            end = _skip_balanced(expr, i, "{", "}")
            out.append(_merge(expr[i + 1 : end - 1], extra))
            i = end
            continue
        match = _IDENT.match(expr, i)
        if not match:
            out.append(char)
            i += 1
            continue
        name, end = match.group(0), match.end()
        rest = expr[end:]
        stripped = rest.lstrip()
        pad = len(rest) - len(stripped)
        if name in LABEL_LIST_KEYWORDS:
            out.append(name + rest[:pad])
            i = end + pad
            if i < n and expr[i] == "(":
                close = _skip_balanced(expr, i, "(", ")")
                out.append(expr[i:close])
                i = close
            continue
        if name == "offset":
            duration = _DURATION.match(expr, end)
            out.append(name + (duration.group(0) if duration else ""))
            i = duration.end() if duration else end
            continue
        if name in RESERVED or stripped.startswith("("):
            out.append(name)
            i = end
            continue
        if stripped.startswith("{"):
            close = _skip_balanced(expr, end + pad, "{", "}")
            out.append(name + rest[:pad] + _merge(expr[end + pad + 1 : close - 1], extra))
            i = close
            continue
        out.append(name + "{" + extra + "}")
        i = end
    return "".join(out)
