# K-Shui AWS demo: architecture, feature coverage, and cost

**Decision record for [Epic #61](https://github.com/thadchas/k-shui/issues/61)** · Verified **8 September 2026** · Singapore (`ap-southeast-1`) · USD, excluding taxes

## 1. Recommended decision

Use **MSK Provisioned Standard, two small brokers**, **Bedrock Nova Micro on demand**, and **ECS Fargate hosting the compatible streaming runtimes**. Use RDS PostgreSQL for application and lineage state. This respects the preference for managed services while preserving the APIs K-Shui actually uses.

Budget approximately **$6.63 for an eight-hour demo**, **$31.19 for five rehearsal days with daily teardown**, or **$64.31 if the environment stays running between rehearsals**. Allow **$10, $45, and $85**, respectively, for startup variability, extra logs and iteration. These are infrastructure planning estimates, not measured bills or guaranteed spending caps.

The cheaper alternative runs the same supporting software on one EC2 host while retaining MSK and Bedrock: approximately **$5.38 / $24.95 / $51.08** for those scenarios. Choose it when minimum cash expenditure matters more than managing the host and database. A continuously provisioned, continuously exercised 730-hour comparison is **$447.12** on the recommended configuration or **$356.05** on EC2, including the defined retention tail.

**There is no substantiated permanently free MSK + Bedrock full-platform demo.** Eligible credits could cover these short sessions, but do not remove ongoing charges or prove account access to a service.

**This document delivers the architecture and pricing work; it does not deploy AWS or implement adapters.** The reviewed workspace contains an AI-agent MVP, but no Bedrock adapter. Several Kafka client operations also need work. “Full coverage” below means every feature has an explicit delivery path or an identified gap, not that every feature is already live. Do not market the hosted demo as fully functional until the gates in section 8 pass.

## 2. Architecture and exact starting capacity

### Managed-first configuration

| Component | Starting configuration | Responsibility and rationale |
|---|---|---|
| Amazon MSK | Standard, `2 × kafka.t3.small`, two AZs, **10 GiB per broker**, Kafka **3.9.x**, private broker endpoints | Real managed Kafka; synthetic topics use RF2, `min.insync.replicas=1`, 24-hour retention. This is a demo availability tradeoff. |
| ECS Fargate: platform task | Linux x86, **2 vCPU / 14 GiB**, one task, nine containers | K-Shui, Kafka Connect, Apicurio, ksqlDB, Marquez, Prometheus, Kafka exporter, SMTP capture and webhook capture. |
| ECS Fargate: processing/lab task | Linux x86, **2 vCPU / 16 GiB**, one task, seven containers | Flink JobManager, TaskManager, SQL Gateway, three disposable Kafka lab brokers/controllers, and a synthetic producer/consumer runner. |
| RDS PostgreSQL | Single-AZ `db.t4g.small`, **20 GiB gp3**, supported PostgreSQL major validated with Marquez | Separate databases/users for K-Shui and Marquez. Exactly one K-Shui replica and one application worker. Disable retained automated backups for this disposable demo; export logical backups to S3. |
| Private presenter access | `t4g.nano` EC2, Standard CPU-credit mode, 8 GiB gp3, SSM Session Manager | Port-forward from the presenter's computer to the platform task's private IP. No inbound SSH or public application listener. |
| Cognito | Essentials user pool, five native users, `admin`, `editor`, `viewer` groups | Target OIDC sign-in after the browser-session handoff gate; map `rolesClaim` to `cognito:groups`. Use basic auth for initial smoke tests and a separate local-user-management walkthrough. |
| Secrets Manager + KMS | Two secrets and one customer-managed key | One `AmazonMSK_` SCRAM secret; one application secret bundle containing DB password, stable JWT secret and OIDC client secret. Use a narrowly scoped role, not browser credentials. |
| S3 + ECR | 1 GiB average artifacts/checkpoints/backups; 5 GiB private images | Pin images by digest, build all needed plugins/reporters, keep artifacts for seven days after the last session. |
| CloudWatch Logs | 0.01 GB ingested per provisioned hour, seven-day retention | Bound application/broker logs. Use local Prometheus for dashboards; no paid Container Insights, custom metrics or Logs Insights queries in the base estimate. |

MSK's API minimum is **1 GiB per broker**; 10 GiB is a practical allocation, not the AWS minimum. Reducing both disks to 1 GiB saves only $2.16 per 730 hours and removes useful headroom. T3 is intended for small workloads; keep **all internal and business partition replicas below 200 per broker**, beneath AWS's 300-partition guidance. Count consumer offsets, transactions, Connect, registry, ksqlDB and MirrorMaker topics before rehearsal. Set Connect's config/status/offset topics explicitly and cap pipeline-created internal topics. Kafka 3.9.x avoids the September 2026 end of support for 3.7.x. ([MSK quotas](https://docs.aws.amazon.com/msk/latest/developerguide/limits.html), [sizing practices](https://docs.aws.amazon.com/msk/latest/developerguide/bestpractices.html), [supported versions](https://docs.aws.amazon.com/msk/latest/developerguide/supported-kafka-versions.html))

Fargate permits at most **ten containers per task**. Both tasks stay below that limit and use a combined four vCPUs; check the account's Fargate quota before scheduling. Containers in one task share a network namespace, so give the three lab brokers and all JMX reporters distinct ports. Use private task IPs discovered at launch to render bootstrap addresses, advertised listeners and integration URLs. Task replacement requires rediscovery and configuration regeneration; this two-task demo does not assume stable task IPs or automatic service discovery. ([ECS quotas](https://docs.aws.amazon.com/general/latest/gr/ecs-service.html))

Start the processing/lab task with workload generation gated off, discover its IP, then start the platform task with those endpoints. Discover the platform IP and release the workload runner with the registry/Connect endpoints. Within-task endpoints use localhost and distinct ports. Across-task endpoints use private IPs and security-group rules. Build JMX instrumentation into existing Java containers rather than adding a container per reporter.

Each task entrypoint must discover its own private IP before rendering externally advertised Kafka listeners. Configure the registry, Connect, ksqlDB and MM2 internal topics with replication factors no greater than **two** when stored on MSK; their common RF3 defaults cannot work on two brokers. Lab-local topics may use RF3.

Reserve approximately 11 GiB of the platform task for JVMs, K-Shui and telemetry and 12 GiB of the processing task for Flink, three 2-GiB lab containers and the workload runner. The remainder is headroom, not additional allocatable capacity. Keep each task within its included 20 GiB ephemeral storage using image-size and disk checks. These are rehearsal starting sizes, not benchmarks; if either fails the load gate, resize and recalculate before the demo. ([Fargate pricing and included storage](https://aws.amazon.com/fargate/pricing/))

### Networking, state and identity

- Put both tasks, the SSM host and RDS in one AZ; MSK spans two private subnets/AZs. A DB subnet group still covers two AZs. MSK broker traffic remains private.
- Give the two Fargate tasks and SSM host public IPv4 addresses **for outbound access only**, with an internet-gateway route. Security groups admit application access only from the SSM host and necessary internal peers. This is controlled private access, not an all-private-subnet topology. It avoids NAT Gateway, PrivateLink, ALB, Route 53 and public-domain charges.
- Use the free S3 gateway endpoint. AWS SDK calls use HTTPS, Kafka uses `SASL_SSL` with SCRAM-SHA-512, and PostgreSQL uses TLS. SSM remote-host port forwarding targets the task's private address; authorize only the presenter roles. Register the exact localhost OIDC callback URI used through the tunnel. ([SSM port forwarding](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-sessions-start.html))
- MSK SCRAM requires a customer-managed KMS key, an `AmazonMSK_` secret and cluster association. Set explicit Kafka ACLs for topic/group access; an IAM role used for inference is not Kafka authority. Do not use the existing native SCRAM-user editor to manage MSK's service-managed secrets. ([MSK password requirements](https://docs.aws.amazon.com/msk/latest/developerguide/msk-password-limitations.html))
- RDS persists audits, investigations, alerts, dashboards and SQL history through application task restarts. Build K-Shui with the optional **`postgres` extra** (`asyncpg`); the default Docker dependency installation does not include it. KafkaSQL persists registry state on MSK. Prometheus, lab broker data and local query runtime state are disposable; collect representative history before showing dashboards and recreate/reseed after task replacement. Flink checkpoints/savepoints go to S3 with its filesystem plugin installed. Export databases before daily teardown and restore them when continuity between rehearsals matters.
- The three-node Apache Kafka **4.2** lab supplies a separate cluster for unrestricted credential/configuration demonstrations, replication and controlled failures. Combined broker/controller processes on one host/task are **not three independent failure domains**. Verify the image and client API support; this lab does not repair missing K-Shui client methods.

### Lower-cost equivalent

Replace Fargate, RDS and the separate SSM host with **one Linux x86 `r6i.xlarge` (4 vCPU, 32 GiB), 80 GiB gp3 and one public IPv4**. Run the same containers plus PostgreSQL under Compose, with persistent host volumes and SSM on that host. Keep MSK, Bedrock, Cognito, secrets, logs and artifact retention unchanged. Maintain the host, patching, startup order, database exports and disk limits yourself. Avoid Spot interruptions during the presentation. Do not reduce this to a free-tier micro instance: the many Java runtimes need substantially more memory.

## 3. Feature coverage and implementation gaps

**Current** means a code path exists in the inspected workspace; it does not assert live AWS validation. **Gate** means additional implementation or compatibility verification is required. The source of truth is [ARCHITECTURE.md](../ARCHITECTURE.md), the backend routers/integrations and [agent deployment notes](k-shui-agent.md), not the Compose profile name.

| Feature | Demonstration target | Current support / gate |
|---|---|---|
| Multi-cluster inventory, health, guided connection testing/config generation | MSK plus lab | Current; deployment-managed YAML and restart. Validate independent probe errors and redaction. |
| Brokers, topic CRUD/config/clone, partitions, purge | MSK synthetic topics; lab for protected settings | Current Kafka APIs; AWS allowlists still apply. Never infer all broker settings are writable. |
| Browse/tail/filter/export/produce; binary, numeric, string and JSON formats | Seeded MSK messages | Current; verify SSE cancellation and each selected format. |
| Avro, Protobuf, JSON Schema; subject lifecycle, compatibility, versions/diffs | Apicurio's Confluent-compatible API | Current integration; validate the exact registry version, integer schema IDs and wire encoding. Glue is not a URL substitution. |
| Consumer groups, offsets/reset, lag/history, CSV | Fast and deliberately slow MSK consumers | Current; demonstrate stopped-group dry-run/reset. Unknown time-lag estimates must remain null. |
| Share groups | Kafka 4.2 lab | **Gate:** current code reuses classic-group paths and the inspected client enum lacks SHARE. Requires true share-group APIs/semantics. |
| ACL CRUD; SCRAM credential CRUD | MSK ACLs with SCRAM; lab native credentials | Current native APIs; MSK credential editing needs a service-specific adapter. IAM-only listeners do not use Kafka ACL authorization. |
| Quotas and native broker log-directory/capacity details | Lab first | **Gate:** required methods are absent in the inspected Python client source. Host metrics are not a replacement for these APIs. |
| KRaft quorum, leader/epoch/high-watermark/voter lag | Lab | **Gate:** current fallback returns `supported:false` and null quorum measurements. Static controller metadata is not a live quorum implementation. |
| Preferred/unclean election, reassignment plan/apply/list/throttles | Disposable lab topics | Election/planning paths exist. **Gate:** missing reassignment methods lead to a documented CLI fallback; UI apply/completion needs client work. Keep unclean election admin-only. |
| Connect connectors/tasks/config/plugins/validation/lifecycle/offsets | Standard Kafka Connect worker | Current REST integration. Pin a worker/plugin combination supporting demonstrated stop/offset APIs. MSK Connect does not expose equivalent endpoints. |
| Replication view | MirrorMaker2 connectors, lab to MSK | Install MM2 plugins, seed heartbeat/checkpoint flows, verify actual connector discovery. MSK Replicator is a different service/API. |
| ksqlDB SQL, push/pull results, history, streams/tables/query termination | ksqlDB runtime using MSK | Current REST integration; seed a persistent query and verify cancellation. No native AWS managed replacement. |
| Flink job graph, metrics, exceptions, watermarks, checkpoints | Flink session cluster with real jobs | Current REST integration; seed meaningful job state and failures. |
| Flink jar lifecycle, stop/cancel/savepoint; SQL sessions/results | Writable Flink REST plus SQL Gateway | Current interfaces; add the gateway and S3 plugin. Managed Flink's read-only dashboard cannot provide this parity. |
| Dashboards, PromQL, catalog/targets, Grafana JSON import | Local Prometheus and exporters | Current API coverage; add recording rules matching actual metric names/labels. Scrape MSK JMX at 60 seconds and application/Connect/Flink at 15 seconds. |
| Lineage graph/search/jobs/runs/datasets/OpenLineage ingestion | Marquez/PostgreSQL plus real emitted events | Current integration; AWS resource creation does not create lineage automatically. Instrument the seeded jobs and supply namespace labels. |
| Alerts, trigger/action management, acknowledgements, history and SSE | Lag/failure injection; local SMTP/webhook receivers | Current engine and transports. Capture notifications locally. Actual Slack, Teams and PagerDuty delivery requires configured external accounts and separate authorized smoke tests. |
| OIDC, RBAC, basic users, read-only mode | Cognito plus separate basic-auth walkthrough | Basic auth/RBAC paths exist. **Gate:** the OIDC callback currently returns login JSON without a complete SPA session handoff; implement and verify the browser login flow, claim mapping and role boundaries. Auth modes are exclusive; unauthenticated mode cannot enable agent access. |
| Audit, server dashboards/alerts, SQL/investigation history | Persistent PostgreSQL | Current server-state paths; install the PostgreSQL extra and verify ownership/persistence after restart with a stable JWT secret. |
| Saved topic views and browser preferences | Presenter's browser localStorage | Current browser-local state; not backed up by RDS. Verify reload behavior and re-create fixtures in a fresh browser. |
| Agent investigate/operate, evidence, previews, confirmation, cancellation, budgets | Bedrock plus controlled MSK/Connect scenarios | **Gate:** Bedrock provider absent. Preserve existing permission, replay, confirmation and audit rules. |
| Health/readiness, structured logs, keyboard/theme/accessibility | Application browser walkthrough and CloudWatch | Existing features; verify deployed image behavior. Optional OTLP export needs an enabled collector and its resources if included. |

The repository's Compose `full` profile lacks ksqlDB, SQL Gateway, broker/Connect JMX wiring, comprehensive fixtures and a persistent K-Shui database volume. The inspected lockfile pins `confluent-kafka` 2.15.0; capability conclusions above come from source inspection, not a running capability probe. **A screenshot of an “unsupported” state is useful limitation evidence, but does not count as implementing that feature.** Related implementation work already exists in [#43](https://github.com/thadchas/k-shui/issues/43), [#45](https://github.com/thadchas/k-shui/issues/45), [#46](https://github.com/thadchas/k-shui/issues/46), [#48](https://github.com/thadchas/k-shui/issues/48), [#51](https://github.com/thadchas/k-shui/issues/51) and [#53](https://github.com/thadchas/k-shui/issues/53).

### Why not use every AWS managed equivalent?

| Alternative | Pricing structure and decision |
|---|---|
| MSK Standard minimum | Two T3 brokers: **$0.1156/h**, plus provisioned storage. Broadest low-cost starting fit; protected AWS settings remain protected. |
| MSK Express minimum | Three `express.m7g.large` brokers: **$1.53/h** before **$0.0125/GB ingress** and **$0.12/GB-month stored**. Three AZs and reduced configuration/Kafka Streams parity make it inappropriate here. |
| MSK Serverless | **$0.9375/cluster-h + $0.001875/partition-h**, **$0.125/GB in**, **$0.0625/GB out**, **$0.12/GB-month**. Thirty business partitions alone make $0.99375/h before internal topics/data. Does not scale fixed charges to zero; IAM-only requires new client authentication and removes native ACL administration. |
| MSK Connect | One worker × one MCU = **$0.138/h** (1 vCPU/4 GiB), per connector. AWS CRUD/update APIs do not provide current Connect task/plugin/offset parity. Price as an optional additional managed-service demonstration after #48, not a replacement. |
| Managed Service for Apache Flink | One worker KPU plus one orchestration KPU = **$0.276/h**, plus **50 × $0.12/730 = $0.00822/h** running storage. Optional backups $0.025/GB-month. Ten-minute minimum per start. The dashboard is read-only; Studio's extra overhead and notebook API do not replace K-Shui's SQL Gateway. |
| Glue Schema Registry | Registry feature has no additional charge, but its UUID wire format and AWS APIs require a separate registry/SerDes adapter. It does not preserve current Confluent subject/version behavior by changing a URL. |
| Managed Prometheus | Singapore paid bands: **$0.90/10M samples ingested**, **$0.03/GB-month**, **$0.10/billion query samples**. Separate managed collector: **$0.04/h + $0.03/10M collected**. SigV4 and capability-aware status/targets handling are missing. Retain local Prometheus for complete current API behavior; price AMP only if later added. |
| EFS | Standard **$0.36/GB-month**; One Zone **$0.192/GB-month**, with throughput-mode charges where applicable. Not required: use PostgreSQL for durable application state, S3 for artifacts and ephemeral metrics/lab state. Do not put SQLite on unvalidated shared NFS. |

These alternatives are **not included** in the base totals. At ten provisioned hours, the Standard broker charge is $1.156 versus $15.30 for Express, or at least $9.9375 for Serverless with thirty partitions. A managed Connect add-on is $1.38; the minimal managed Flink add-on is about $2.84 plus backups. Cost savings from replacing containers must be recalculated rather than assuming an entire Fargate task disappears.

Sources: [MSK Singapore prices](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonMSK/current/ap-southeast-1/index.json), [Express limitations](https://docs.aws.amazon.com/msk/latest/developerguide/msk-broker-types-express.html), [Serverless configuration](https://docs.aws.amazon.com/msk/latest/developerguide/serverless-config.html), [MSK Connect operations](https://docs.aws.amazon.com/MSKC/latest/mskc/API_Operations.html), [Flink dashboard](https://docs.aws.amazon.com/managed-flink/latest/java/how-dashboard.html), [Flink prices](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonKinesisAnalytics/current/ap-southeast-1/index.json), [Glue pricing](https://aws.amazon.com/glue/pricing/), [Glue integration format](https://docs.aws.amazon.com/glue/latest/dg/schema-registry-integrations.html), [AMP APIs](https://docs.aws.amazon.com/prometheus/latest/userguide/AMP-APIReference-Prometheus-Compatible-Apis.html), [AMP prices](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonPrometheus/current/ap-southeast-1/index.json), [EFS prices](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonEFS/current/ap-southeast-1/index.json).

## 4. Small-model selection and required Bedrock adapter

Recommend **Nova Micro**, Standard on-demand, Singapore-origin **`apac.amazon.nova-micro-v1:0`**, subject to an account preflight. It is text-only and supports tool calls; K-Shui supplies bounded text/JSON evidence, so multimodal models add no necessary capability. No GPU, provisioned throughput, embeddings, vector database, Knowledge Base, Bedrock Agents or AgentCore is needed for this agent.

**Regional qualification matters:** current AWS Micro/Lite cards mark Singapore as Geo inference, not in-region hosting. An official AWS API reference lists the APAC profile identifiers, but the model cards omit APAC destination details. Resolve the exact profile using `aws bedrock get-inference-profile --region ap-southeast-1 --inference-profile-identifier apac.amazon.nova-micro-v1:0`, inspect destination model ARNs and IAM/SCP permissions, and complete a tool round-trip. **APAC inference can process prompts outside Singapore**; use only the approved synthetic evidence. Do not invent destination regions or treat the price catalog as proof of account access. If unavailable, explicitly select the Sydney runtime `amazon.nova-micro-v1:0`; this sends synthetic prompt data outside Singapore and requires a network-cost adjustment. Do not silently switch route or model. ([Micro card](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-amazon-nova-micro.html), [official APAC identifiers](https://docs.aws.amazon.com/connect/latest/APIReference/API_amazon-q-connect_AIPromptData.html), [inference-profile discovery](https://docs.aws.amazon.com/bedrock/latest/userguide/inference-profiles-support.html))

| Model and route | Input $/million tokens | Output $/million tokens | 100 investigations | Decision |
|---|---:|---:|---:|---|
| Nova Micro, Singapore-origin Geo | 0.047 | 0.188 | **0.1316** | Recommended after preflight/quality gate |
| Nova Lite, Singapore-origin Geo | 0.081 | 0.324 | 0.2268 | Explicit upgrade if Micro fails evaluation |
| Nova Micro, explicit Sydney runtime | 0.037 | 0.148 | 0.1036 | Alternative route; residency/transport differs |
| Nova 2 Lite, Singapore-origin global | 0.410 | 3.390 | 1.4980 | Higher-cost evaluation option, not the minimum |

Rates come from the [Singapore](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonBedrock/current/ap-southeast-1/index.json) and [Sydney](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonBedrock/current/ap-southeast-2/index.json) catalogs published **1 September 2026**. Catalog units are 1,000 tokens; the table converts them to one million. No batch, caching or commitment discounts are assumed. Nova supports forced tool choice needed by the current connection test. Avoid choosing Claude 3 Haiku merely for low pricing: its published EOL is 10 September 2026. ([Nova tool choice](https://aws.amazon.com/about-aws/whats-new/2025/03/amazon-nova-expands-tool-converse-api/), [Haiku lifecycle](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-3-haiku.html))

An investigation averages **20,000 input + 2,000 output tokens summed across all turns**, including repeated history and tool JSON. Therefore 100 investigations cost `2 × 0.047 + 0.2 × 0.188 = $0.1316`. Five demo days cost $0.658. At 12.5 investigations per active hour, 730 hours cost $12.0085; if people only run 100/day for 30 days, inference is instead $3.948. Ten times the agreed token workload costs **$1.316/day**, an increase of $1.1844. Include capability-test tokens in the actual usage ledger.

The minimum implementation contract is:

1. Extend the backend/frontend provider type with `bedrock`; add server-side `region` and a model ID/profile ID/ARN. Keep `apiKeyEnv` required for existing providers but use the AWS SDK credential chain and task/EC2 role for Bedrock. Scope `bedrock:InvokeModel` to the selected inference profile and its destination model ARNs. Setting `provider: anthropic` does not make the existing adapter call Bedrock.
2. Preserve `Provider.complete(...) -> ProviderReply`. Use signed Bedrock Converse calls; map tools, forced-tool selection, assistant `toolUse`, corresponding user `toolResult`, provider content and input/output usage. Run synchronous SDK work off the event loop with bounded timeouts. Disable hidden SDK retries; any explicit retry must remain inside cancellation and cost accounting.
3. Keep redacted errors, configured input/output rates, conservative preflight, cancellation and token/tool/time limits. Start with `maxRunCostUsd=0.05`, eight tool calls, 120 seconds, two concurrent runs, 2,048 output tokens and 24,000 input characters. These limits constrain runs; they are not an AWS billing kill switch.
4. Preserve one worker/replica, user-scoped evidence, Inspect by default, existing Operate previews/confirmations, audit-before-dispatch, durable operation claims and verification. The model gets no shell or infrastructure-administration tools.

## 5. Cost model, line items and scenarios

### Quantities and billing assumptions

- Five users; ten business topics × three partitions. Generate **10 messages/second aggregate**, each 1 KiB: 0.036864 decimal GB/hour before replication, internal topics and protocol overhead. Retain 24 hours; short demos naturally have less history. Use an explicit one-GB/provisioned-hour **cross-AZ traffic allowance**, covering multiple consumers, monitoring and amplification, billed conservatively on both applicable sides. Network allowances use `H`, including idle monitoring and background traffic.
- The following estimates use a **730-hour normalization** for monthly storage/key rates. Actual invoices use actual billing duration and units; provisioned GiB quantities and byte-based transfer are not interchangeable. Provider billing rounds according to its service rules.
- `A` = active workload hours; `H` = billable infrastructure hours; `T` = retained secrets/key/ECR/S3 hours; `D` = artifact/credential request batches. Each batch allows 1,000 S3 PUT, 10,000 GET, 1,000 secret API requests and 1,000 KMS requests.
- Eight useful hours get **two additional provisioned hours** for creation, seeding and deletion. Five daily teardowns use 50 billable hours. Keeping the same environment Monday through Friday uses 104 elapsed session-span hours plus two overhead hours = 106. Two hours is an allowance, not a provisioning SLA; measure the actual billable intervals.
- Retain images, one-GB average artifacts, two secrets and one KMS key until seven days after the last session: `T=178` for one day; `274` for either rehearsal-week option. The 730-hour comparison uses `T=898`; startup occurs within its illustrative 730 hours. Log bytes each have seven-day retention. Stop generators outside active sessions even if infrastructure stays up.
- Fargate and host disks are deleted at teardown, RDS final snapshots are not retained, and logical exports fit the one-GB artifact allowance. If retained data exceeds this or task storage exceeds included capacity, add the actual storage. No paid Support, tax, labor, external notification subscription or optional service is hidden in the totals.

### Rate card and formulas

These are list-rate equivalents before conditional credits and usage-based free allowances. No-charge control planes/features remain zero. Rates were fetched from official Singapore Price List catalogs on 8 September 2026; follow each source to refresh them before provisioning.

| Item | Quantity and USD rate | Scenario formula | Source |
|---|---|---|---|
| MSK brokers, both options | 2 × $0.0578/broker-h | `0.1156 H` | [MSK](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonMSK/current/ap-southeast-1/index.json) |
| MSK provisioned storage | 20 GiB total × $0.12/GB-month | `2.4 H / 730` | [MSK](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonMSK/current/ap-southeast-1/index.json) |
| Fargate, recommended only | 4 vCPU × $0.05056 + 30 GiB × $0.00553 per hour | `0.36814 H` | [ECS](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonECS/current/ap-southeast-1/index.json) |
| RDS, recommended only | $0.051/h + 20 GiB × $0.138/GB-month | `0.051 H + 2.76 H / 730` | [RDS](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonRDS/current/ap-southeast-1/index.json) |
| SSM host, recommended only | $0.0053/h + 8 GiB gp3 × $0.096/GB-month | `0.0053 H + 0.768 H / 730` | [EC2/EBS](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonEC2/current/ap-southeast-1/index.json) |
| Consolidated EC2, alternative only | $0.304/h + 80 GiB gp3 × $0.096/GB-month | `0.304 H + 7.68 H / 730` | [EC2/EBS](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonEC2/current/ap-southeast-1/index.json) |
| Public IPv4 | $0.005/address-h; recommended 3, alternative 1 | `0.015 H` or `0.005 H` | [VPC](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonVPC/current/ap-southeast-1/index.json) |
| Bedrock Micro | 12.5 investigations/active hour at $0.001316 each | `0.01645 A` | [Bedrock](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonBedrock/current/ap-southeast-1/index.json) |
| CloudWatch Logs | 0.01 GB/H at $0.70/GB ingestion; $0.03/GB-month stored for 168 hours | `0.007 H + 0.0003 H × 168 / 730` | [CloudWatch](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonCloudWatch/current/ap-southeast-1/index.json) |
| Secrets + KMS | 2 × $0.40/secret-month + $1/key-month; API requests $0.05/10k and $0.03/10k | `1.8 T / 730 + 0.008 D` | [Secrets](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSSecretsManager/current/ap-southeast-1/index.json), [KMS](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/awskms/current/ap-southeast-1/index.json) |
| ECR + S3 + requests | ECR 5 GiB × $0.10/month; S3 1 GiB × $0.025/month; PUT $0.005/1k and GET $0.0004/1k | `0.525 T / 730 + 0.009 D` | [ECR](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonECR/current/ap-southeast-1/index.json), [S3](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonS3/current/ap-southeast-1/index.json) |
| Cross-AZ allowance | 1 GB/provisioned hour × $0.01 per applicable side | `0.02 H` | [EC2 transfer](https://aws.amazon.com/ec2/pricing/on-demand/) |
| Internet egress allowance | 0.01 GB/provisioned hour × $0.12/GB | `0.0012 H` | [Data transfer](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSDataTransfer/current/ap-southeast-1/index.json) |

The base RDS estimate assumes **zero billable surplus CPU credits**. RDS T4g runs Unlimited: add **$0.075 × surplus vCPU-hours** (equivalently, `CPUSurplusCreditsCharged / 60 × 0.075` for credits measured in vCPU-minutes). For example, ten surplus vCPU-hours add $0.75. Inspect CPU credit balance and charged-credit metrics, including at shutdown; short-lived instances are not exempt. The SSM host explicitly uses Standard credit mode to avoid Unlimited surcharges, but may throttle; resize and reprice if its tunnel is unreliable. ([RDS credit pricing](https://aws.amazon.com/rds/postgresql/pricing/), [EC2 credit pricing](https://aws.amazon.com/ec2/pricing/on-demand/))

No additional charge is assigned to VPC/subnets/security groups, IAM roles, the ECS control plane, standard EC2 Session Manager access, MSK open monitoring, the S3 gateway endpoint or local Prometheus queries. Broker-to-broker MSK replication is not charged again as client cross-AZ transfer. Cognito's five native users fit its documented 10,000 MAU allowance if available in the account; this does not cover paid SMS, advanced security or enterprise federation. ([MSK monitoring](https://docs.aws.amazon.com/msk/latest/developerguide/open-monitoring.html), [Cognito pricing](https://aws.amazon.com/cognito/pricing/), [SSM pricing](https://aws.amazon.com/systems-manager/pricing/))

### Itemized recommended option

| USD, rounded for display | 8-hour demo | Five days, daily teardown | Five days, kept running | 730-hour comparison |
|---|---:|---:|---:|---:|
| `A / H / T / D` | `8 / 10 / 178 / 1` | `40 / 50 / 274 / 5` | `40 / 106 / 274 / 5` | `730 / 730 / 898 / 30` |
| MSK brokers | 1.1560 | 5.7800 | 12.2536 | 84.3880 |
| MSK storage | 0.0329 | 0.1644 | 0.3485 | 2.4000 |
| Fargate | 3.6814 | 18.4070 | 39.0228 | 268.7422 |
| RDS instance + storage | 0.5478 | 2.7390 | 5.8068 | 39.9900 |
| SSM host + storage | 0.0635 | 0.3176 | 0.6733 | 4.6370 |
| Three IPv4 addresses | 0.1500 | 0.7500 | 1.5900 | 10.9500 |
| Bedrock | 0.1316 | 0.6580 | 0.6580 | 12.0085 |
| Log ingestion + retention | 0.0707 | 0.3535 | 0.7493 | 5.1604 |
| Secrets + key + requests | 0.4469 | 0.7156 | 0.7156 | 2.4542 |
| Artifacts + requests | 0.1370 | 0.2421 | 0.2421 | 0.9158 |
| Cross-AZ allowance | 0.2000 | 1.0000 | 2.1200 | 14.6000 |
| Internet egress allowance | 0.0120 | 0.0600 | 0.1272 | 0.8760 |
| **Recommended total** | **6.63** | **31.19** | **64.31** | **447.12** |
| **EC2 alternative total** | **5.38** | **24.95** | **51.08** | **356.05** |

Totals sum unrounded values. To reproduce the alternative, remove Fargate, RDS, SSM-host and three-IPv4 rows; add `0.304H + 7.68H/730` for the EC2 host/disk and `0.005H` for one IPv4. All common rows remain identical.

Sensitivity: each extra provisioned hour without workload adds about **$0.591** to the recommended live stack or **$0.467** to EC2, before extending artifact retention. Two `m7g.large` Standard brokers instead of T3 add **$0.3944 per provisioned hour** ($3.944 per ten hours). Doubling Fargate memory/CPU or changing tasks requires repricing valid task sizes. A tenfold token workload adds $1.1844 per demo day, much less than leaving the stack provisioned unnecessarily. Cross-AZ and logging volumes are allowances to measure, not predictions from the message payload alone.

## 6. Free allowances, credits and account eligibility

Plan on an **AWS Paid account plan**. Unknown credit eligibility is not a reason to assume $0. New customers may receive $100 at signup and earn up to another $100; the Free account plan ends after six months or credit exhaustion, while the documented credit expiry is twelve months from signup. Joining Organizations/Control Tower can affect eligibility and remaining credits. Older account offers differ. Check the actual Billing credit balance, expiry and eligible services. ([Plan comparison](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/free-tier-plans.html), [Free Tier terms](https://aws.amazon.com/free/terms/), [FAQ](https://aws.amazon.com/free/free-tier-faqs/))

AWS's documented **new-signup experience**, a limited rollout, lists MSK as Paid-plan and restricts Bedrock Geo/global inference in that experience. Verify the account's advanced-feature access before selecting the APAC profile. This is an account-entitlement gate, not proof that all existing AWS accounts have the same restriction. ([Signup service restrictions](https://docs.aws.amazon.com/accounts/latest/reference/supported-services-sign-up-new.html))

| Item | What may reduce cash cost |
|---|---|
| MSK / Fargate / this EC2 size / RDS | No recurring free entitlement assumed for this selected capacity. Eligible promotional credits may offset service charges. |
| Bedrock Nova | No recurring free inference-token entitlement assumed. First-party model usage consumes eligible credits; activity rewards may themselves incur usage charges. |
| Cognito native users | Five users fit the published 10,000 MAU allowance, subject to account/organization aggregation and chosen feature tier. |
| CloudWatch Logs | Published free allowances include 5 GB; shared account use and eligibility determine the actual deduction. Do not silently remove the conservative log allowance from gross estimates. |
| KMS | Up to 20,000 qualifying requests/month can be free; customer-managed key storage remains billed. |
| Internet egress | First 100 GB/month aggregated across eligible AWS services/regions may remove the modeled egress charge. Other workloads share it. |
| Managed Prometheus, if added | Published allowances: 40M ingested samples, 200B query samples, 10 GB stored. Confirm account eligibility and duration; these do not waive a managed collector's charges. |

Sources: [CloudWatch pricing](https://aws.amazon.com/cloudwatch/pricing/), [KMS pricing](https://aws.amazon.com/kms/pricing/), [EC2 transfer/free allowance](https://aws.amazon.com/ec2/pricing/on-demand/), [Prometheus pricing](https://aws.amazon.com/prometheus/pricing/), [Bedrock credit activity](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/free-tier-plans-activities.html).

The following are **conditional upper-bound cash estimates before other free-usage deductions**, assuming every modeled dollar is eligible and the stated unused credit is available for that scenario. They are alternative scenarios, not repeated deductions from one real credit balance.

| Recommended option | No credits | $100 valid unused credit | $200 valid unused credit |
|---|---:|---:|---:|
| Eight-hour demo | 6.63 | 0.00 | 0.00 |
| Daily teardown rehearsal week | 31.19 | 0.00 | 0.00 |
| Kept-running rehearsal week | 64.31 | 0.00 | 0.00 |
| 730-hour comparison | 447.12 | 347.12 | 247.12 |

Actual formula: `cash = noneligible charges + max(0, eligible charges after allowances − valid remaining credits)`. Taxes and excluded purchases remain payable. Promotional-credit exclusions depend on the actual offer; the named **AWS Managed Services** exclusion is not a blanket exclusion of all managed services such as MSK. Do not assume third-party Marketplace purchases are eligible. ([Promotional Credit Terms](https://aws.amazon.com/awscredits/))

## 7. Implementation sequence and presentation story

This sequence is the next engineering backlog, not work completed by the documentation epic. Reuse the existing provider issues; publish any new finalized implementation plan under the repository policy.

1. **Prove the minimum path first:** build the missing Bedrock adapter; validate MSK SCRAM connectivity and native topic/group APIs. Test model profile entitlement before renting the full stack. Complete cheap local SDK/permission tests before a paid smoke test.
2. **Package the compatibility runtimes:** add ksqlDB, SQL Gateway, registry/Connect plugins, S3 filesystem support, JMX reporters, recording rules, persistence and fixtures. Install K-Shui's `postgres` extra and implement the OIDC callback-to-SPA session handoff before claiming Cognito sign-in. Pin versions/digests and inspect licensing of each image/plugin; budget assumes no paid plugin license. Respect the ten-container limit and single K-Shui worker.
3. **Close the native client gaps:** explicit adapters or a suitable client integration for share groups, quotas, quorum, reassignment and log directories. Keep AWS-specific restrictions in capability handling rather than allowing an administrative UI action to fail ambiguously.
4. **Provision in dependency order:** network/IAM/secrets/key → MSK/RDS/artifact storage → processing/lab task → platform task → discovered endpoint configuration → seed jobs/connectors → SSM/OIDC access → readiness gates. Preserve independent failures in onboarding diagnostics.
5. **Rehearse a coherent streaming story:** synthetic orders on MSK → compatible schema registry → Connect and Flink transformation → ksqlDB aggregate → visible lineage. Introduce consumer lag, watch a Prometheus-backed alert, ask the agent to investigate, review evidence and an authorized operation, verify recovery and show the audit record. Then switch to the lab for restricted administration and MirrorMaker replication.

Use a 25–30 minute presentation: onboarding/cluster inventory (3 min), messages and schema evolution (5), Connect/Flink/SQL/lineage (7), lag investigation and reviewed remediation (8), permissions/audit/lab limitations/cost (5). Basic-auth user management is a separate checkpoint because auth modes are exclusive. Seed one incompatible schema candidate, one failing connector task, one slow consumer and one missing telemetry target. Do not inject failures into unrelated clusters.

## 8. Acceptance gates and evidence to retain

| Gate | Required evidence before claiming a live full demo |
|---|---|
| Account and region | Actual MSK/Fargate/RDS quotas; selected Kafka/image versions; Bedrock profile destination ARNs and permissions; exact account credit eligibility. |
| Connectivity and identity | MSK TLS/SCRAM round-trip; registry/Connect/Flink/Prometheus probes; PostgreSQL driver/TLS connection; SSM tunnel; OIDC browser round-trip ending in an authenticated SPA with correct role claims; no public application access. |
| Capacity | Thirty-minute steady-state rehearsal at agreed load; task CPU/memory/disk headroom, T3 broker and SSM-host CPU credits, RDS `CPUSurplusCreditsCharged`, partition counts and connection rates. Inspect credit charges at shutdown too; resize/reprice when exhausted or throttled. |
| Kafka features | Real create/read/change/delete tests on disposable resources, consumer lag/reset dry-run, schema encode/decode/compatibility, ACL checks. Separate native API results for share groups, quorum, quotas, reassignment and log directories; do not substitute fallback states. |
| Streaming ecosystem | Connector/task lifecycle and offset tests, working ksql push-query cancellation, Flink jar/SQL/savepoint lifecycle, actual MM2 replicated records and OpenLineage events. |
| Telemetry and alerts | Each advertised dashboard has real matching series/labels or a documented limitation; expected firing/resolution and local SMTP/webhook capture evidence. |
| Bedrock quality and safety | Fake-SDK tests for tool/forced-tool exchange, usage, errors, cancellation and retries; paid synthetic tool round-trip; evaluation of lag, connector failure, missing/stale evidence and adversarial log content. Findings distinguish observation from hypothesis. |
| Authorization and persistence | Viewer and Inspect mutations denied; user/cluster scope preserved; expired/stale previews rejected; replay does not redispatch; saved investigation, history and audit survive restart. |
| Product experience | Browser walkthrough at desktop/mobile widths; SSE cancellation/reconnect; keyboard navigation; empty/offline states; no exposed secrets or fabricated success. |
| Cost and teardown | Recompute quantities from actual resources; compare billed usage after AWS reporting delay; verify no residual compute/network objects beyond the explicitly retained artifacts. |

For this **documentation delivery**, verification consists of repository/API source review, official regional price extraction, arithmetic recalculation, feature-by-feature coverage and independent review. No AWS resources were provisioned, no live paid model/Kafka test was run, and no missing adapter was implemented for this document.

## 9. Teardown and billing controls

Create account budget notifications at 50%, 80% and 100% of the selected $10/$45/$85 allowance and tag resources with the epic and expiry. Use existing budget notifications without paid budget actions. Budget alerts and Cost Explorer are delayed; they do not stop charges. Keep a local session timer and an inventory of resource IDs. Cap agent runs/concurrency and restrict permitted models. Bound producer rate, topic partitions, retention and log volume before starting.

At the end of a session:

1. Stop producers, consumers, streaming queries and new agent runs; collect final evidence. Take needed Flink savepoints and export K-Shui/Marquez databases to the capped S3 artifact set.
2. Stop both Fargate tasks (or the EC2 Compose stack), disable any service scheduler that could recreate them, delete the RDS instance without retained automated backups/final snapshot, and **delete MSK**. Stopping clients does not pause its broker/storage charges; MSK has no general stop/resume workflow for this demo.
3. Terminate the SSM host or consolidated EC2 instance, delete its EBS volumes, release any allocated addresses and inspect ENIs. Stopped EC2 and stopped RDS can still incur storage charges; RDS stopping is not teardown and can automatically restart.
4. Verify no optional Connect workers, managed Flink applications, AMP scrapers, NAT gateways, VPC endpoints, load balancers, snapshots or retained volumes were created and forgotten. If optional services were used, remove their independently billable resources.
5. Keep only the defined logs/images/artifacts/secrets/key for seven days after the last rehearsal. Delete all S3 object versions/incomplete uploads and ECR images, remove secrets, then schedule key deletion after encrypted material is no longer needed. Remove the empty demo network and Cognito pool when no longer required. Record resource deletion completion, not just the API request.

The retained-object charges are included in the scenarios. Extra time, snapshots, exports, versions, longer log retention or failed deletions must be added. Prefer one disposable deployment per presentation day; keeping the managed-first stack running between five eight-hour sessions roughly doubles this estimate without adding presentation time.

## 10. Delivery traceability

| Epic deliverable | Document evidence |
|---|---|
| [#62: Coverage](https://github.com/thadchas/k-shui/issues/62) | Sections 2–3: every feature, real dependencies, current support and explicit gaps |
| [#63: Architecture](https://github.com/thadchas/k-shui/issues/63) | Sections 1–3 and 7: concrete managed-first sizing, equivalent EC2 alternative and tradeoffs |
| [#64: Bedrock](https://github.com/thadchas/k-shui/issues/64) | Section 4: sourced model/route/prices, adapter contract and evaluation gates |
| [#65: Cost](https://github.com/thadchas/k-shui/issues/65) | Sections 5–6 and 9: formulas, scenarios, allowances, credits and residual charges |
| [#66: Consolidation](https://github.com/thadchas/k-shui/issues/66) | This standalone document, with validation gates and source dates |

All prices and availability statements are a **2026-09-08 snapshot**. Refresh official sources and account capabilities before provisioning; none of the estimates is a deployment authorization or an AWS quote.
