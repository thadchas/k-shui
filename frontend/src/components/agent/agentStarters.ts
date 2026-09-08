import type { AgentMode, AgentResource } from '@/api/agentTypes';

export function agentStarters(
  resource: AgentResource | undefined,
  mode: AgentMode,
  tools: string[] = [],
) {
  const starters: string[] = [];
  const has = (tool: string) => tools.includes(tool);
  if (has('get_cluster_health'))
    starters.push('Inspect current cluster metadata and partition health.');
  if (resource?.type === 'consumer_group' && has('get_group_lag'))
    starters.push(
      'Is this group’s backlog growing or draining? Check recent lag history and explain any gaps.',
    );
  if (resource?.type === 'topic') {
    if (has('get_topic_metadata'))
      starters.push('Inspect this topic’s partitions and retention settings.');
    if (has('get_lineage_neighbors'))
      starters.push('Which downstream resources depend on this topic?');
  }
  if (resource?.type === 'connector' && resource.connectCluster && has('get_connector_task_errors'))
    starters.push('Inspect this connector’s task states and available error categories.');
  if (['schema', 'subject'].includes(resource?.type ?? '') && has('get_schema_summary'))
    starters.push(
      'Summarize this subject’s registered fields and compatibility policy. Explain how to check a candidate schema.',
    );
  if (mode === 'operate') {
    if (resource?.type === 'topic')
      starters.push('Prepare an update to this topic’s retention to one day.');
    if (resource?.type === 'consumer_group')
      starters.push('Help me choose the parameters for an offset reset preview for this group.');
    if (resource?.type === 'connector' && resource.connectCluster)
      starters.push('Help me identify a failed task and prepare its restart for review.');
    if (!resource)
      starters.push(
        'Help me specify a topic name, partitions, replication and retention for a creation preview.',
      );
  }
  return starters;
}
