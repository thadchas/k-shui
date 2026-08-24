import { ComingSoon } from './ComingSoon';

export function KsqlPage() {
  return (
    <ComingSoon
      title="ksqlDB"
      description="Editor plus streams, tables and running queries."
      endpoints={[
        'POST /clusters/{c}/ksql/{k}/query (SSE)',
        'GET .../streams',
        'GET .../tables',
        'GET .../queries',
      ]}
    />
  );
}

export default KsqlPage;
