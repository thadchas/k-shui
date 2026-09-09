# k-shui agent-driven product and UX direction

Original review: 2026-09-07. Product-language alignment: 2026-09-09.
Status: directional proposals, not a release-completion record. The current
workspace includes an agent MVP; [the agent guide](k-shui-agent.md) defines its
implemented scope. Remaining proposals below are not implied to be shipped.
This editorial revision is tracked in the
[documentation alignment work](agent-driven-documentation-plan.md).

## Product direction

Position **k-shui as open-source, agent-driven Kafka management**. Make
**k-shui Agent** the primary workflow for answering: What needs attention? Why
is it happening? What can I do next under my permissions?

The product's center is the investigation-to-action workflow: ask in context,
gather evidence, explain findings, prepare a requested change, review it, and
execute with outcome verification. The **k-shui engine** supplies connections,
authorization, operations, and audit history. Resource pages, message browsing,
dashboards, and lineage form the supporting **visual workspace** for precise
expert control. Feature breadth should improve this workflow and the evidence
available to the operator.

Prioritize trustworthy investigations and reviewed supported operations. Expand
agent scope only with explicit tool boundaries and validation; broad workspace
coverage does not imply equally broad agent authority.

Assumed primary audience: platform engineers and on-call operators. Secondary audience: developers inspecting events and maintaining pipelines. These are working hypotheses, not interview findings.

## Review scope and evidence

This is an expert review of nine repository screenshots and selected current frontend implementations, not a live application walkthrough or user study. Screenshots may lag implementation: current code already includes partition-health remediation, lag time estimates, richer message filters, and explicit Cluster settings naming. Recommendations account for those existing features.

Visually reviewed: overview, topics, messages, consumer group, Connect, schemas, Flink job, lineage, and alerts in `docs/images/`. Read current routes, shell, app settings, cluster list, command palette, navigation definitions, and selected overview/message/consumer/lineage/alert code. Brokers, security, replication, SQL editors, and metrics need deeper interactive follow-up. Keyboard behavior, screen readers, contrast ratios, responsive layouts, latency, and actual backend outcomes were not verified. No numerical usability score or WCAG compliance claim is justified by this review.

Keep: consistent teal/navy identity, semantic status pills, column controls, command palette and shortcuts, resource tabs, useful schema empty state, masked secrets, RBAC, audit logging, typed destructive confirmations, and dry-run offset resets. These are foundations to extend, not missing features to rebuild.

## Prioritized screen improvements

Priorities: P1 = next release focus; P2 = following release; P3 = later exploration. Effort is relative engineering scope (S/M/L), not a delivery estimate. Confidence describes evidence for the opportunity; impact remains a hypothesis until tested.

| Area and evidence                                                                                                                                                                             | Recommended change                                                                                                                                                                                                                     | Priority / effort | Acceptance outcome                                                                                                                                   |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Overview: screenshot gives eight summary cards similar weight; current code places partition health and lagging groups after other content. High confidence.                                  | Put a compact Needs attention queue above charts; rank offline partitions, failed services, and sustained lag. Move version/controller metadata into cluster details.                                                                  | P1 / M            | An operator can identify the most urgent affected resource and open its evidence from the first viewport; unavailable telemetry never means healthy. |
| Global navigation: many resource destinations; Alerts and Audit are global while most pages are cluster-scoped (`lib/nav.ts`). High confidence.                                               | Retain familiar groups, add pinned/recent resources, and show explicit scope: current cluster or all clusters. Preserve an investigation's cluster and time window when navigating.                                                    | P1 / M            | Every investigation view displays its scope; cross-cluster navigation is explicit and never silently reuses the previous resource context.           |
| Command palette searches topics and consumer groups; failures are caught and converted into empty results (`components/CommandPalette.tsx`). High confidence.                                 | Expand resource search to connectors, jobs, schemas, and alerts. Distinguish unavailable search sources from no matches; add resource type filters.                                                                                    | P1 / M            | Partial results remain usable and identify failed sources with retry; selecting a result reaches the exact resource.                                 |
| Topics: dense technical columns and long names in screenshot. High confidence.                                                                                                                | Add saved views such as Unhealthy, High traffic, and Recently changed; persistent column/width preferences; readable expanded labels for RF/URP; pin name and health columns.                                                          | P1 / M            | Users can restore a named view without recreating filters; long identifiers are available by keyboard and copy action.                               |
| Message browser: crowded query toolbar, truncated JSON, terse P/HDRS labels; current implementation already supports advanced filters and live controls. High confidence.                     | Put common controls first; disclose advanced encoding/partition/filter controls on demand. Add saved searches, selectable JSON field columns, and explicit Live/Paused/Stopped states.                                                 | P1 / M            | A user can find an event by key or field, inspect it, and return to the same query; saved views contain configuration, not message payloads.         |
| Consumer detail: State, Members, Topics, and Lag dominate the screenshot; lag history lives in another tab. High confidence.                                                                  | Bring lag trend, worst partition, and assignment skew into the overview. Explain that Stable describes membership, not processing health. Make Investigate the main diagnostic action and move Delete into an action menu.             | P1 / M            | A stable-but-lagging group is visibly distinguishable from a caught-up group. Existing offset preview and confirmations remain intact.               |
| Connect/Flink: healthy status and resource tables lead; job tables can extend beyond the visible width. Medium confidence from screenshots.                                                   | Add a compact diagnostic summary: failed task, recent exception, checkpoint age, throughput trend, and related topic/group links. Prioritize operational columns before worker/class metadata.                                         | P2 / M            | A failed connector or stalled job exposes relevant evidence and related resources without tab hunting; missing metrics are labeled.                  |
| Lineage: screenshot fits the whole graph at a scale where names become tiny; current code already has focus and depth controls. High confidence.                                              | Open resource-linked lineage focused on that resource; use readable initial zoom, upstream/downstream shortcuts, a dependency list alternative, and highlighted impact paths.                                                          | P1 / M            | Selected resource and neighbors have readable names; operators can inspect dependencies without operating the graph canvas.                          |
| Alerts: repeated instances of the same trigger fill history; acknowledge already exists. High confidence.                                                                                     | Add an Active incidents view grouping related occurrences with first/last seen and occurrence count. Keep raw history available. Add owner, notes, and linked evidence. Rename Actions to Notification destinations where appropriate. | P2 / L            | Repeated events can be triaged as one incident while retaining every occurrence; acknowledgement remains separate from resolution.                   |
| Schemas: clear registration empty state already exists. Medium confidence for next opportunities.                                                                                             | Add example schema starters and a readable compatibility explanation beside the existing check/diff flow, with affected consumers where relationships are known.                                                                       | P2 / M            | A developer understands the incompatible field and consequence before registering a version.                                                         |
| Clusters/settings: original review found deployment-managed YAML onboarding; current workspace adds a connection tester/config generator and AI connection status. High confidence from code. | Validate the existing guided connection tester/config generator and AI connection status flow with users. Retain separate Kafka/integration results, deployment-managed settings and explicit data-access policy.                      | P1 / L            | A first-time user can validate connection details and obtain a usable config; errors distinguish connectivity, credentials, and permissions.         |

## Visual and interaction refinements

Keep the current visual identity. Reduce competition between cards by emphasizing exceptions and the next useful action. Use normal UI typography for explanations and reserve monospace for identifiers, payloads, and numeric alignment. Make dense versus comfortable table spacing a preference.

Standardize data status across views: loading, fresh, refreshing, stale, partially available, and failed. Display last successful update and source where relevant. Preserve data during refresh failures, with a visible stale indication. Clearly distinguish zero, unknown, unsupported, and no matching results.

Audit icon-only controls, chart descriptions, keyboard focus, horizontal scrolling, and zoom at 200%. Use a compact inspection layout on narrow screens and a full-screen agent view when a side panel would squeeze the resource table. These are verification tasks, not confirmed accessibility defects.

## k-shui Agent

### Agent experience and remaining proposals

The current MVP provides **Ask K-Shui** in the top bar and contextual
**Investigate** actions for alerts, consumer groups, unhealthy partitions, and
connectors. Investigations open in a resizable panel and can expand into a
dedicated page. An individual failed-task launcher remains a possible extension;
current Connect context identifies the connector. Use the
[agent guide](k-shui-agent.md) for current behavior and the proposals below for
future experience improvements.

The panel displays the active cluster, selected resource, time window, provider/model, acting user, and effective operating mode: Inspect or Operate. Operate is available only within the authenticated user’s effective permissions; choosing it never grants additional authority. Context chips are inspectable and removable. Switching cluster requires a new scoped investigation or an explicit context change; old evidence retains its original scope.

Use starters within implemented tool scope. Schema-error explanations need a
supplied candidate and dedicated compatibility tooling; query drafting below is
a future workflow, not an arbitrary SQL execution capability. Candidate starters:

- Why is this consumer group falling behind?
- Explain this connector failure.
- Which downstream resources depend on this topic?
- Explain this schema compatibility error.
- Create a topic with specified partitions, replication, and retention.
- Update this topic’s retention to one day.
- Restart the failed connector task.
- Preview and execute an offset reset for this group.
- Draft a query or configuration change for review.

Responses should contain a short finding, linked timestamped evidence, alternative explanations or missing data, and suggested next steps. Distinguish observed facts from hypotheses. Avoid unsupported confidence percentages. Show tool progress, cancellation, timeout, provider-limit recovery, and a persistent investigation history.

Current example journey: open a lagging group → Investigate → agent inspects
membership, assignments, offsets, watermarks and lag → presents findings and
missing evidence with source links → user opens the resource or saves the
investigation. Connector-state evidence needs the connector and Connect-instance
identifiers; topic-rate analysis is not an implemented agent tool. A user can
request a supported operation, review its exact effect, complete typed
confirmation where required, trigger execution, and inspect the recorded outcome.

### Scope and controls

The current MVP uses bounded metadata and status summaries, configuration with
secrets removed, and evidence links. Message payloads are excluded; no payload
sampling tool is implemented. A future opt-in sampling workflow would require
separate data policy, a reviewable bounded sample, and deployment controls.

Keep credentials server-side in a secrets mechanism, never browser storage or transcripts. Apply the user's existing permissions to every tool call. Logs, messages, schema descriptions, and other resource content are untrusted data, never tool instructions. Enforce tool allowlists, query/time/record limits, maximum run cost, and cancellation in the backend. Custom endpoints remain future work and would require deployment-controlled outbound access policy.

For mutations, the agent prepares a change; k-shui validates current resource state, shows the exact diff and effect, checks permissions again, and uses the existing approval/confirmation flow. Associate execution and verification with an audit record. Do not claim rollback for irreversible Kafka operations.

### Operating under the user’s authority

The agent is an operational interface to k-shui. A natural-language instruction can initiate actual Kafka and streaming operations. Authorization is enforced by the backend for the authenticated human user on every action; the model cannot choose or impersonate an acting identity.

Effective authority is the intersection of the user’s k-shui permissions, allowed cluster/resource scope, deployment agent policy, and permissions of the upstream connection. If k-shui uses a shared Kafka service account, its broader privileges must never become the agent user’s privileges. Delegated upstream credentials may narrow access further. API keys for the LLM authenticate inference only and confer no Kafka authority.

| Operation class                    | Examples                                                                               | Interaction                                                                                                                                                                              |
| ---------------------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Inspect                            | Health, configuration, lag, task status                                                | Execute immediately within permitted scope.                                                                                                                                              |
| Supported changes in MVP           | Create topic, update topic configuration, pause/resume/restart connector; restart task | A specific user instruction defines the scope. Prepare the resolved target and parameters; the user reviews the preview and triggers execution. The model cannot dispatch the operation. |
| Consequential operations in MVP    | Offset reset, topic purge/delete, partition increase                                   | Require existing dry-run/typed confirmations and a concrete impact preview. Exclude unsupported operations rather than falling back to shell commands.                                   |
| Expanded administrative operations | Reassignment, preferred-leader election, ACL or quota changes                          | Add only with explicit operation-level authorization and deployment policy; never infer administrative authority from chat intent.                                                       |

Permission and intent are separate: permission determines what a user may do; the instruction determines what the agent should do now. “Why is lag increasing?” authorizes investigation, not an offset reset. “Restart failed task 2 on connector X” is an action request. In the current MVP it prepares a concrete preview for user-triggered execution, rather than giving the model authority to execute directly.

For each operation: resolve cluster/resource → validate parameters and permissions → prepare exact effect → obtain any policy-required confirmation → recheck authority and resource state → execute → verify outcome. Bind confirmations to the user, target, exact parameters, and an expiring operation identifier. Changed parameters or materially changed resource state require a new preview. Permission revocation or an expired session stops pending operations.

Show states such as Preparing, Awaiting confirmation, Running, Verifying, Succeeded, Partially completed, Failed, and Outcome unknown. Record initiating user, agent origin, resource, redacted parameters, confirmation where applicable, before/after evidence, and result in the audit trail. A multi-step request must report per-step outcomes and stop when later steps depend on a failed step. Do not automatically retry an uncertain mutation; reconcile upstream state first. Cancellation stops queued work but cannot undo an already accepted Kafka operation.

MVP acceptance examples:

- A viewer asking to delete a topic gets an explanation of denied access; no mutation is dispatched.
- An authorized user requesting a topic creation sees the exact cluster and configuration, and receives a verified resource link after success.
- Offset reset cannot execute before its required preview and confirmation, even if the model requests the execution tool directly.
- A user permitted on cluster A cannot cause an operation on cluster B through a prompt, copied resource name, or reused confirmation.
- Removing permission between preview and execution blocks the action; an LLM provider switch does not change permissions.

### Provider connections

Treat model API connections and external agent runtimes as distinct connection types.

| Connection                 | Proposed UX                                                                        | Delivery decision                                                                                                                                                    |
| -------------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OpenAI API                 | API key, model, connection test, estimated usage cost                              | First release; usage billed to the API account.                                                                                                                      |
| Anthropic API              | API key, model, connection test                                                    | First release; standard embedded Claude route.                                                                                                                       |
| OpenAI-compatible endpoint | Base URL, optional secret, explicit model and capability test                      | First release if capacity allows; compatibility must be tested rather than assumed. Includes a path toward local/private inference.                                  |
| ChatGPT through Codex      | Connect Codex; provider-managed ChatGPT login; account and available limit display | Follow-up feasibility spike, then optional runtime adapter. Codex App Server documents managed ChatGPT login; this is separate from a generic OpenAI API credential. |
| Claude subscription        | External Claude Code workflow, authenticated by the user through Anthropic         | Separate integration path. Do not implement a generic Claude.ai OAuth login or copy subscription tokens into k-shui.                                                 |
| Enterprise cloud providers | Deployment-managed identities, model/deployment selection                          | Later, based on customer demand and deployment needs.                                                                                                                |

OpenAI documents API-key and managed ChatGPT authentication in [Codex App Server](https://learn.chatgpt.com/docs/app-server), with separate billing behavior described in [Authentication](https://learn.chatgpt.com/docs/auth). Proposed local runtime integration needs validation of deployment isolation, supported tools, lifecycle, and account eligibility before a delivery commitment.

Anthropic distinguishes embedded product API authentication from user sign-in to the unmodified Claude Code binary. Its guidance permits the latter under stated conditions, but prohibits third-party apps from offering their own Claude.ai login or intermediating subscription credentials. Therefore an external Claude Code workflow is a separate product option, not an API-key substitute. See [Claude Code authentication and product-use guidance](https://code.claude.com/docs/en/legal-and-compliance). Recheck provider guidance before implementation.

Connection setup: select connection type → authenticate through the supported mechanism → select model → test connectivity and tool capability → choose allowed clusters/data categories → save. Show Connected, Invalid credential, Model unavailable, Rate limited, or Unreachable with targeted recovery. Clearly label personal connections versus administrator-managed connections. Never silently fall back to a different paid provider or share one person's subscription across users.

An optional k-shui MCP interface can expose narrowly scoped investigation tools to users working inside external agent products. This could reuse the same backend authorization and evidence layer. It needs a separate authentication design and client compatibility check.

### Implementation boundaries

Frontend: shell panel, contextual launch actions, AI settings, investigation state, evidence cards. Backend: provider adapters, typed inspection and operation tools, bounded context collection/redaction, streaming progress, persistent investigations, and usage accounting. Reuse existing resource APIs and permissions; do not give the agent unrestricted shell or cluster-admin credentials.

Suggested inspection tools: get cluster health, get topic metadata, get group lag/assignments, get connector task errors, get job/checkpoint summary, get lineage neighbors, and retrieve relevant audit events. Add payload sampling only after explicit data policy support.

## Delivery sequence

These stages describe the original implementation direction. The agent MVP now
exists in the workspace; this list does not certify its release or live-provider
validation. Treat remaining stage items as proposals and publish any finalized
engineering plan according to [repository policy](../AGENTS.md#publish-finalized-plans).

1. **Foundation:** scope/freshness states, overview priorities, consumer diagnostics, message-browser simplification, and search error visibility. Produce interactive prototypes of the three core investigations and validate with representative users.
2. **Agent MVP:** OpenAI/Anthropic API connections, scoped inspection and operation tools, exact change previews, existing confirmations, audited execution and verification, evidence responses, provider recovery states, and saved investigations. Ship behind an administrator-controlled feature setting.
3. **Connected workflows:** incident grouping, saved resource/message views, guided connection setup, lineage impact navigation, and optional Codex runtime integration after its spike passes.
4. **Expanded operations and ecosystem:** partition reassignment, leader election, policy-controlled administrative tools, MCP access, enterprise providers, and team runbooks. Prioritize based on observed usage.

Avoid committing to calendar dates before estimating backend persistence, authorization, provider runtimes, and deployment support. Do not prioritize autonomous remediation, multi-agent orchestration, or broad provider catalogs ahead of reliable diagnosis.

## Validation and release gates

Recruit 5–8 representative operators/developers. Compare current and proposed flows for locating a failing component, finding a record, explaining lag, and understanding downstream impact. Measure task completion, time to first relevant evidence, navigation reversals, and confidence in the next action. Establish a baseline first; proposed target is a 30% reduction in median time to relevant evidence without lower completion accuracy.

Agent evaluation scenarios must include stable-but-lagging consumers, failed tasks, missing telemetry, stale data, incompatible schemas, misleading logs, provider timeouts, exhausted limits, and cross-cluster access attempts. Release gates: no unauthorized tool execution in the test suite; no secrets or default payload leakage; resource claims linked to retrieved evidence; honest insufficient-evidence responses; cancellation terminates further tool work; no duplicate action execution on retries.

Track user-rated usefulness and repeat investigation use with opt-in telemetry that excludes payloads, prompts, credentials, and sensitive resource identifiers. Collect qualitative reasons for unsuccessful investigations. Proposed targets are product hypotheses, not measured results.
