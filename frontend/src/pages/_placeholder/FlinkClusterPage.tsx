import { ComingSoon } from './ComingSoon';

export function FlinkClusterPage() {
  return (
    <ComingSoon
      title="Flink cluster"
      description="Cluster overview and jobs."
      endpoints={['GET /clusters/{c}/flink/{f}/overview', 'GET .../jobs']}
    />
  );
}

export default FlinkClusterPage;
