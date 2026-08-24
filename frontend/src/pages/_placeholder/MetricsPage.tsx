import { ComingSoon } from './ComingSoon';

export function MetricsPage() {
  return (
    <ComingSoon
      title="Metrics"
      description="Prometheus-backed dashboards."
      endpoints={['GET /clusters/{c}/metrics/dashboards', 'GET /clusters/{c}/metrics/status']}
    />
  );
}

export default MetricsPage;
