# k-shui Agent

**k-shui Agent** is the primary workflow for open-source, agent-driven Kafka
management: ask a question, investigate evidence, review a requested operation,
and check its outcome. The **k-shui engine** connects to the ecosystem, enforces
permissions, and records activity. The visual workspace provides resource detail,
message browsing, dashboards, and lineage alongside each investigation.

The agent is disabled by default and requires an authenticated k-shui user.
The server's `auth.type: none` mode does not grant agent access.

## Start with a question

1. Sign in and open **Ask K-Shui**, or **Investigate** from a supported resource.
2. Confirm the cluster and resource, then use **Inspect** to ask, for example,
   “Why is this consumer group falling behind?” or “Explain this connector failure.”
3. Review linked evidence, timestamps, possible explanations, and missing data.
4. When you want a supported change, use **Operate** and name the exact action
   and target. Review the preview, execute it, and inspect the outcome and audit
   record. Asking a diagnostic question does not authorize a change.

![k-shui Agent gathers evidence and prepares reviewed operations through the k-shui engine](images/k-shui-agent-architecture.png)

## A first investigation (worked example)

This is an **illustrative example, not a captured session**: the numbers are
invented, but every label, field and limitation below is what the panel and the
inspection tools actually produce.

1. **Open the resource.** On a consumer group page, choose **Investigate**. The
   panel opens with the question box pre-filled with “Why is this consumer group
   falling behind?”, and the **Investigation context** row shows the cluster, the
   `consumer_group` resource, `User:` you, the provider/model, the `Inspect`
   badge, and `Current bounded snapshot`.
2. **Ask in Inspect mode.** Inspect gathers metadata, metrics and redacted
   configuration only; message payloads are excluded.
3. **Read the evidence.** Each card under **Source evidence** is headed
   **Observed evidence** and carries a `Recent snapshot` or `Historical snapshot`
   badge (historical once the observation is older than two minutes), a
   `Retrieval:` status, a link to the resource, the cluster and the tool that
   produced it (here `get_group_lag` and `get_topic_metadata`), the retrieval
   timestamp, an **Inspect source data** disclosure for the raw JSON, and a
   **Missing data / limitations** list.
4. **Read the answer.** The **K-Shui analysis** reply closes with a short
   Finding, Observed evidence, Alternative explanations / missing data, and Next
   steps, and cites each supported claim as an `[Evidence · timestamp]` button
   that jumps to the exact card. In this example it separates:
   - **Observation** — net backlog grew across the sampled window on two
     partitions of the group (`trend.direction: growing`), cited to the lag card.
   - **Hypothesis** — membership lists fewer members than assigned partitions,
     consistent with a departed member or an in-progress rebalance; offered as an
     alternative explanation, not a conclusion.
   - **Missing information** — the lag card’s own limitations: last 15 minutes
     only, up to 60 complete samples with an unchanged partition set, and net
     backlog change establishes neither cause, nor production/consumption rates,
     nor successful processing; offset resets and retention also move lag.
   - **Next steps** — open the group’s **Members** and **Lag chart** tabs, check
     the owning application or connector logs, and consider an offset reset only
     after stopping the consumers — an Operate-mode change that still requires a
     preview, a successful dry run, exact per-partition offsets and a typed group
     name.
5. **Refresh rather than re-ask.** **Refresh evidence** re-runs the same tool on
   the same resource under current authority and appends a new observation,
   leaving earlier findings, timestamps and scope intact.

Treat first use as successful when you have relevant, timestamped evidence and
an understood next action. Executing an operation is not part of that bar, and
Inspect mode cannot execute one.

## Current capability boundaries

| Agent workflow       | Supported scope                                                                                                                                                                                              |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Inspect              | Cluster health, topic metadata, consumer-group lag and membership, connector task states, job/checkpoint summaries, registered schema summaries, lineage neighbors, alert evidence, and recent audit headers |
| Operate              | The selected topic, connector/task, and consumer-offset operations listed below, after review and applicable confirmation                                                                                    |
| Supporting workspace | Full message browser, SQL editors, dashboards and resource controls; their availability does not make them agent tools                                                                                       |

The agent has no message-payload reader, arbitrary query executor, shell tool,
or unattended remediation loop. It reports missing evidence and uncertain
outcomes rather than inventing a diagnosis or success.

## Deployment

Start with the [complete authentication and agent setup example](getting-started.md#4-enable-k-shui-agent). The fragment below adds agent settings to an already authenticated deployment. Connection tests require an administrator with access to a permitted cluster.

Configure connections in the deployment's `k-shui.yaml`, supply provider keys through the server's secrets/environment mechanism, then restart K-Shui. An administrator can open AI connections in Settings, which shows the effective configuration and offers a connection test. Keys are never entered into browser storage.

```yaml
agent:
  enabled: true
  allowMutations: false
  allowedClusters: [prod]
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
      allowedClusters: [prod]
      inputUsdPerMillion: ${KSHUI_AGENT_INPUT_PRICE}
      outputUsdPerMillion: ${KSHUI_AGENT_OUTPUT_PRICE}
```

Set the model and its contracted USD prices per million tokens explicitly. Missing prices prevent paid investigation runs; configured prices determine the local budget estimate and must be maintained by the deployment administrator. The estimate is not the provider invoice. For Anthropic, use `provider: anthropic` with a separate model, key environment variable, and rates. Connections use the providers' official API endpoints; custom base URLs and subscription login tokens are not supported.

Every entry in `agent.allowedClusters` and `agent.connections[].allowedClusters` must equal a configured `clusters[].id` (`prod` in the getting-started example, `compose` for the [Compose demo](deployment/docker-compose.md#enable-k-shui-agent)); an identifier that matches no cluster hides the connection and blocks its connection test and investigations. `allowedClusters` and `allowedTools` may additionally narrow deployment and connection scope. A connection's inference credential confers no Kafka permissions. Enable `allowMutations` only when operations should be available; K-Shui roles and server/cluster read-only settings still apply.

Run the agent in a single application worker/process. Run admission and interrupted-run recovery currently assume a single process; sharing the same investigation database across independently starting workers is not supported. Mutation execution uses a durable database claim to prevent redispatch of the same operation identifier.

**Data leaves your deployment:** questions, conversation context, cluster metadata, metrics, redacted configuration and bounded error summaries are transmitted to the configured OpenAI or Anthropic API and are subject to that provider’s retention policies and terms. Excluding payloads, credentials and raw traces does not make operational metadata nonsensitive. Administrators must review their organization’s data-sharing policy and applicable provider terms before enabling the agent. Users should not paste secrets or sensitive payloads into questions.

Connection tests are informational observations, not an admission gate: configured credentials and pricing permit an explicit run even before a test or after a failed test. Test results do not guarantee current provider availability.

## Investigations

Use **Ask K-Shui** in the top bar or **Investigate** on a consumer group, unhealthy partition, connector, or alert. Review the selected cluster, resource, time window, provider/model, acting user, and Inspect/Operate mode. Removing resource context starts a broader investigation within the selected cluster. Changing clusters starts a new investigation; existing evidence retains its original scope.

The panel can expand into a dedicated investigation page. Saved investigations belong to their initiating user and persist in the configured k-shui database. Treat that database as operational data: transcripts and resource metadata may be sensitive even after credential redaction. Context collection excludes message payloads, bounds records and text, and treats retrieved resource content as untrusted data.

Evidence cards retain original retrieval timestamps and status separately from age: observations older than two minutes are labelled historical snapshots. **Refresh evidence** retrieves the same tool and resource under current authority, appending a new observation without rewriting earlier findings, timestamps or scope. Refresh is unavailable during an active run; at the 32-observation limit, start a new investigation. Validated answer citations open the precise observation, including citations in follow-ups; unknown or no-longer-retained sources are shown as unavailable.

Consumer lag inspection includes up to 60 complete, comparable samples from the last 15 minutes. It reports net backlog growth/drain only; it does not infer processing success, cause, production rates or consumption rates. Sampling gaps, changed partition sets and stale history are explicit limitations. Resource starters reflect Inspect/Operate mode and the connection’s allowed inspection tools. Schema inspection summarizes registered metadata and directs candidate compatibility checks to the subject page.

Evidence cards link to resources and carry retrieval timestamps. Missing telemetry and provider errors must remain visible. Findings distinguish observations, hypotheses, missing information, and next steps; a selected historical time window does not turn a current-state API into historical evidence.

## Operations

All supported changes deliberately require a preview and human execution review, even where deployment policy would permit direct execution. Inspect mode cannot execute mutations. In Operate mode, a supported request prepares an exact target and parameter preview. Review the effect and complete any required typed confirmation before execution. The backend binds the preview to the initiating user, scoped investigation, parameters, resource state, and expiry, and checks authority again before dispatch.

Operation outcomes include verification and audit evidence. Cancellation stops subsequent work but cannot undo an upstream operation already accepted. An uncertain mutation must not be automatically retried: inspect current resource state first. Kafka deletion, purging records, and offset changes do not imply a rollback guarantee.

| Supported operation                              | Review requirement / boundary                                                        |
| ------------------------------------------------ | ------------------------------------------------------------------------------------ |
| Create topic                                     | Exact partitions, replication factor and supported configuration preview             |
| Update topic configuration                       | Before/after values for allowlisted non-secret keys                                  |
| Pause, resume or restart connector; restart task | Exact Connect instance, connector, task and restart options                          |
| Delete or purge topic                            | `delete <topic>` or `purge <topic>`; internal topics excluded                        |
| Increase partitions                              | Typed resource name and irreversible partition-count change                          |
| Reset consumer offsets                           | Consumers stopped, successful dry run, exact per-partition offsets, typed group name |

**Cancel prepared change** withdraws a pending proposal even after the investigation completes and stays cancelled when reopened. Previews expire after five minutes; the card updates while idle. **Prepare new preview** cancels the expired proposal and retrieves a new exact effect under current permissions, requiring a new review and typed confirmation. It never executes automatically. Changed target state requires a new preview. Internal-topic mutations, arbitrary topic configuration keys, shell commands, and administrative operations outside this table are excluded. Current schema inspection summarizes registered fields and compatibility policy; it has no candidate-schema compatibility tool; use the [Schema Registry workspace](features/schemas.md) to test a candidate.

## Scope

This implementation follows the Agent MVP stage of [the product plan](product-improvement-plan.md). Optional Codex runtime integration, external Claude Code workflows, MCP access, enterprise provider adapters, arbitrary endpoints, payload sampling, and expanded administrative operations remain separate future work. Operator research and production provider/Kafka validation remain release activities; automated tests use controlled fakes.

## Verification

Agent tests cover both provider wire formats, capability/error handling, cost preflight, timeouts, cancellation, persistent history ownership, model tool allowlists, cluster restrictions, permission revocation, credential/trace exclusion, exact previews, typed confirmation, state changes, audit failures, replay/concurrent execution, and interrupted-run recovery. Frontend tests cover scoped context, user-cache isolation, preview/expiry behavior, panel keyboard resizing and focus restoration.

The Agent branch was validated after integrating the merged P1 product/UX implementation and addressing the product/engineering review with 556 backend tests, 283 frontend tests, and 50 hermetic Chromium end-to-end tests. The browser suite includes contextual consumer investigation, linked evidence and expansion with saved scope, typed operation confirmation and the verified result, persistent proposal cancellation, expired-preview replacement, historical evidence refresh and precise follow-up citations, keyboard resizing and focus restoration, and desktop (1440px) and narrow (390px) panel layouts. Both viewport screenshots were visually inspected. Backend/frontend lint, formatting, the frontend production build, version consistency and release-tooling tests passed.

Browser tests use mocked APIs and automated backend tests use controlled Kafka/provider doubles. Live paid-provider/Kafka validation and a manual visual walkthrough are not claimed. Validate the configured model and an isolated Kafka environment before enabling production operations.

## Preview release gates

Keep the feature disabled by default and begin with an administrator-enabled Inspect pilot. Before enabling production operations, validate every supported operation against an isolated real Kafka cluster and configured providers, including delayed verification, uncertain outcomes, permission changes and cancellation. Successful dispatch and resolution of the original incident are separate outcomes.

Run the product plan’s 5–8-operator study before claiming improved diagnosis: compare time to relevant evidence and task accuracy with existing pages, and record setup completion (reaching a tested AI connection from a fresh install), time to first useful investigation (relevant evidence plus an understood next action), usefulness ratings and unsuccessful-investigation reasons. Collect all of these through research sessions or opt-in content-free measurement; no new telemetry implementation is required. A 30% improvement remains a hypothesis, not a measured result.

Deferred follow-ups: disabled-state discoverability, a non-modal desktop panel, compact investigation actions in dense tables, URL synchronization on the expanded page, history rename/delete and cumulative spend, a scoped reason when Operate is unavailable, and progress-delivery efficiency. These should not expand the preview’s supported operation classes.
