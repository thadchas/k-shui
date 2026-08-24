#!/usr/bin/env bash
# Local pre-commit hook: lint the k-shui chart with both its default values and the
# lakestream example values. Not packaged into the chart (see .helmignore: ci/).
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
chart_dir="${repo_root}/charts/k-shui"

if ! command -v helm >/dev/null 2>&1; then
  echo "helm-lint: 'helm' not found on PATH, skipping (install helm to run this hook locally)" >&2
  exit 0
fi

helm lint "${chart_dir}"
helm lint "${chart_dir}" -f "${chart_dir}/values-lakestream.yaml"
helm template t "${chart_dir}" >/dev/null
helm template t "${chart_dir}" -f "${chart_dir}/values-lakestream.yaml" >/dev/null
