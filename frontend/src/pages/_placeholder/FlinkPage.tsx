import { ComingSoon } from './ComingSoon';

export function FlinkPage() {
  return (
    <ComingSoon
      title="Flink"
      description="Flink session clusters."
      endpoints={['GET /clusters/{c}/flink']}
    />
  );
}

export default FlinkPage;
