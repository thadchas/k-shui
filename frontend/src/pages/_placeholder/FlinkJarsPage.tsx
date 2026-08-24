import { ComingSoon } from './ComingSoon';

export function FlinkJarsPage() {
  return (
    <ComingSoon
      title="Flink jars"
      description="Upload and run job jars."
      endpoints={['GET .../jars', 'POST .../jars/upload', 'POST .../jars/{id}/run']}
    />
  );
}

export default FlinkJarsPage;
