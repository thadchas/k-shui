# Agent-driven Kafka management documentation alignment

Delivery status and verification evidence are maintained in [Epic #74](https://github.com/thadchas/k-shui/issues/74). This document records the agreed scope and acceptance criteria.

[Private project](https://github.com/users/thadchas/projects/4) ·
[Milestone](https://github.com/thadchas/k-shui/milestone/3) ·
[Epic #74](https://github.com/thadchas/k-shui/issues/74)

Deliverable issues:
[entry points #75](https://github.com/thadchas/k-shui/issues/75),
[workflow/deployment guides #76](https://github.com/thadchas/k-shui/issues/76),
[architecture/editorial alignment #77](https://github.com/thadchas/k-shui/issues/77),
[validation #78](https://github.com/thadchas/k-shui/issues/78).
Repository linkage and all five items' project/milestone membership were verified;
delivery is tracked in the linked issues.

## Objective and scope

Make **open-source, agent-driven Kafka management** the consistent product
positioning across the README, documentation entry points, feature guides,
deployment guides, architecture/API references, package READMEs, design and brand
guidance, and product direction documents. Lead with **k-shui Agent**, supported
by the **k-shui engine** and the visual workspace.

This work updates documentation, navigation, and the selected architecture
illustration. It does not implement new agent capabilities, change runtime
defaults, provision application services, refresh AWS prices, or rewrite historical
release records, licenses, or the Code of Conduct.

The delivery scope includes updating the existing GitHub Pages landing page and
navigation, building the documentation site, and verifying its publication after merge.

## Deliverables

| Deliverable                          | Scope                                                                                                             | Dependencies                                                    | Acceptance criteria                                                                                                                                                                                    |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Product entry points                 | README, documentation index, current agent guide and agent architecture illustration                              | Existing agent implementation and generated illustration        | README leads with the agent workflow; setup is prominent; image has useful alternative text; current operations and limits are explicit                                                                |
| Workflow and deployment guides       | Feature guides, getting started, configuration, deployment and package guides                                     | Entry-point terminology, actual config and deployment contracts | Each guide explains its agent role without implying all UI operations are tools; sign-in, opt-in enablement, server-side credentials, configured usage rates and single-process limits remain accurate |
| Architecture and editorial alignment | Architecture/API references, design, brand, contribution/security guidance, roadmap and product-direction framing | Existing agent routes, tools, operation handlers and policy     | Agent responsibilities appear in architecture; engine branding is consistent; implementation names remain where needed; future capabilities are distinguished from current behavior                    |
| Documentation validation             | Cross-document review, local links and assets, formatting, claim checks                                           | All preceding deliverables                                      | Changed documentation passes local-link/asset and formatting checks; no unauthorized/autonomous capability claims; existing application changes and historical records are preserved                   |

## Existing work and boundaries

- [Release/readme readiness #59](https://github.com/thadchas/k-shui/issues/59)
  remains the source for package-publication verification; this work does not
  claim new releases.
- [Provider capability enforcement #43](https://github.com/thadchas/k-shui/issues/43)
  and [provider evidence #53](https://github.com/thadchas/k-shui/issues/53)
  remain separate engineering and validation work.
- [Website documentation #71](https://github.com/thadchas/k-shui/issues/71)
  is the previous publishing deliverable. Updating repository Markdown does not
  claim that the hosted site has been rebuilt or deployed.
- [AWS decision record epic #61](https://github.com/thadchas/k-shui/issues/61)
  keeps its original project and milestone. Any product-language adjustment in
  that document preserves its dated architecture, estimates, and delivery gates.

Do not move existing issues between milestones or mark planned work complete.
New work starts in Todo. No deadline is assigned.
