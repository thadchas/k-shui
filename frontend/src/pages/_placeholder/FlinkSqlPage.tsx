import { ComingSoon } from './ComingSoon';

export function FlinkSqlPage() {
  return (
    <ComingSoon
      title="Flink SQL"
      description="Flink SQL Gateway session editor."
      endpoints={['POST .../sql/sessions', 'POST .../sql/sessions/{s}/statements']}
    />
  );
}

export default FlinkSqlPage;
