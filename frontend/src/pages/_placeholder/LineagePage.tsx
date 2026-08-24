import { ComingSoon } from './ComingSoon';

export function LineagePage() {
  return (
    <ComingSoon
      title="Stream lineage"
      description="React Flow graph of topics, connectors, jobs and consumers."
      endpoints={['GET /clusters/{c}/lineage/graph', 'GET .../nodes/{id}']}
    />
  );
}

export default LineagePage;
