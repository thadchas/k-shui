import { ComingSoon } from './ComingSoon';

export function SchemaDetailPage() {
  return (
    <ComingSoon
      title="Subject"
      description="Versions, diff and compatibility settings."
      endpoints={['GET /clusters/{c}/schemas/subjects/{s}', 'GET .../diff', 'PUT .../config']}
    />
  );
}

export default SchemaDetailPage;
