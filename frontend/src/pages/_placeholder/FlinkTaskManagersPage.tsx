import { ComingSoon } from './ComingSoon';

export function FlinkTaskManagersPage() {
  return (
    <ComingSoon
      title="Task managers"
      description="Flink task managers, logs and metrics."
      endpoints={['GET /clusters/{c}/flink/{f}/taskmanagers']}
    />
  );
}

export default FlinkTaskManagersPage;
