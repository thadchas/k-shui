import { ComingSoon } from './ComingSoon';

export function MetricsDashboardPage() {
  return (
    <ComingSoon
      title="Dashboard"
      description="Panels evaluated from Prometheus."
      endpoints={['GET /clusters/{c}/metrics/dashboards/{id}', 'GET .../data']}
    />
  );
}

export default MetricsDashboardPage;
