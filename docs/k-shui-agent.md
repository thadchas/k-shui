# K-Shui Agent

The agent adds scoped investigations and reviewed operations to the existing K-Shui application. It is disabled by default and requires an authenticated K-Shui user. The server's `auth.type: none` mode does not grant agent access.

## Deployment

Configure connections in the deployment's `k-shui.yaml`, supply provider keys through the server's secrets/environment mechanism, then restart K-Shui. AI connections in Settings shows the effective configuration and offers a connection test. Keys are never entered into browser storage.

```yaml
agent:
  enabled: true
  allowMutations: false
  allowedClusters: [production]
  maxToolCalls: 8
  maxRunSeconds: 60
  maxInputChars: 24000
  maxOutputTokens: 2048
  maxRunCostUsd: 0.25
  maxConcurrentRuns: 4
  connections:
    - id: operations-openai
      name: Operations OpenAI
      provider: openai
      model: ${KSHUI_AGENT_OPENAI_MODEL}
      apiKeyEnv: KSHUI_AGENT_OPENAI_KEY
      allowedClusters: [production]
      inputUsdPerMillion: ${KSHUI_AGENT_INPUT_PRICE}
      outputUsdPerMillion: ${KSHUI_AGENT_OUTPUT_PRICE}
```

Set the model and its contracted USD prices per million tokens explicitly. Missing prices prevent paid investigation runs; configured prices determine the local budget estimate and must be maintained by the deployment administrator. The estimate is not the provider invoice. For Anthropic, use `provider: anthropic` with a separate model, key environment variable, and rates. Connections use the providers' official API endpoints; custom base URLs and subscription login tokens are not supported.

`allowedClusters` and `allowedTools` may additionally narrow deployment and connection scope. A connection's inference credential confers no Kafka permissions. Enable `allowMutations` only when operations should be available; K-Shui roles and server/cluster read-only settings still apply.

Run the agent in a single application worker/process. Run admission and interrupted-run recovery currently assume a single process; sharing the same investigation database across independently starting workers is not supported. Mutation execution uses a durable database claim to prevent redispatch of the same operation identifier.

## Investigations

Use **Ask K-Shui** in the top bar or **Investigate** on a consumer group, unhealthy partition, connector, or alert. Review the selected cluster, resource, time window, provider/model, acting user, and Inspect/Operate mode. Removing resource context starts a broader investigation within the selected cluster. Changing clusters starts a new investigation; existing evidence retains its original scope.

The panel can expand into a dedicated investigation page. Saved investigations belong to their initiating user and persist in the configured K-Shui database. Treat that database as operational data: transcripts and resource metadata may be sensitive even after credential redaction. Context collection excludes message payloads, bounds records and text, and treats retrieved resource content as untrusted data.

Evidence cards link to resources and carry retrieval timestamps. Missing telemetry and provider errors must remain visible. Findings distinguish observations, hypotheses, missing information, and next steps; a selected historical time window does not turn a current-state API into historical evidence.

## Operations

Inspect mode cannot execute mutations. In Operate mode, a supported request prepares an exact target and parameter preview. Review the effect and complete any required typed confirmation before execution. The backend binds the preview to the initiating user, scoped investigation, parameters, resource state, and expiry, and checks authority again before dispatch.

Operation outcomes include verification and audit evidence. Cancellation stops subsequent work but cannot undo an upstream operation already accepted. An uncertain mutation must not be automatically retried: inspect current resource state first. Kafka deletion, purging records, and offset changes do not imply a rollback guarantee.

| Supported operation                              | Review requirement / boundary                                                        |
| ------------------------------------------------ | ------------------------------------------------------------------------------------ |
| Create topic                                     | Exact partitions, replication factor and supported configuration preview             |
| Update topic configuration                       | Before/after values for allowlisted non-secret keys                                  |
| Pause, resume or restart connector; restart task | Exact Connect instance, connector, task and restart options                          |
| Delete or purge topic                            | Exact impact and typed resource name; internal topics excluded                       |
| Increase partitions                              | Typed resource name and irreversible partition-count change                          |
| Reset consumer offsets                           | Consumers stopped, successful dry run, exact per-partition offsets, typed group name |

Previews expire after five minutes. Changed target state requires a new preview. Internal-topic mutations, arbitrary topic configuration keys, shell commands, and administrative operations outside this table are excluded. Current schema inspection summarizes registered fields and compatibility policy; it does not run a candidate schema compatibility check without a supplied candidate.

## Scope

This implementation follows the Agent MVP stage of [the product plan](product-improvement-plan.md). Optional Codex runtime integration, external Claude Code workflows, MCP access, enterprise provider adapters, arbitrary endpoints, payload sampling, and expanded administrative operations remain separate future work. Operator research and production provider/Kafka validation remain release activities; automated tests use controlled fakes.

## Verification

Agent tests cover both provider wire formats, capability/error handling, cost preflight, timeouts, cancellation, persistent history ownership, model tool allowlists, cluster restrictions, permission revocation, credential/trace exclusion, exact previews, typed confirmation, state changes, audit failures, replay/concurrent execution, and interrupted-run recovery. Frontend tests cover scoped context, user-cache isolation, preview/expiry behavior, panel keyboard resizing and focus restoration.

The Agent branch was validated on top of the P1 product/UX implementation with 528 backend tests, 277 frontend tests, and 45 hermetic Chromium end-to-end tests. The browser suite includes contextual consumer investigation, linked evidence and expansion with saved scope, plus typed operation confirmation and the verified result. Backend/frontend lint, formatting, the frontend production build, version consistency and release-tooling tests passed.

Browser tests use mocked APIs and automated backend tests use controlled Kafka/provider doubles. Live paid-provider/Kafka validation and a manual visual walkthrough are not claimed. Validate the configured model and an isolated Kafka environment before enabling production operations.
