import { ComingSoon } from './ComingSoon';

export function FlinkJobPage() {
  return (
    <ComingSoon
      title="Flink job"
      description="Overview, graph, checkpoints, exceptions and metrics."
      endpoints={['GET .../jobs/{jid}', 'GET .../checkpoints', 'GET .../exceptions']}
    />
  );
}

export default FlinkJobPage;
