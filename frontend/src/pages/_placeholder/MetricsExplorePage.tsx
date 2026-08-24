import { ComingSoon } from './ComingSoon';

export function MetricsExplorePage() {
  return (
    <ComingSoon
      title="PromQL explorer"
      description="Ad-hoc Prometheus queries."
      endpoints={['GET /clusters/{c}/metrics/query_range', 'GET /clusters/{c}/metrics/catalog']}
    />
  );
}

export default MetricsExplorePage;
