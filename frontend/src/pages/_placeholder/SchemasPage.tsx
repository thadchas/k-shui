import { ComingSoon } from './ComingSoon';

export function SchemasPage() {
  return (
    <ComingSoon
      title="Schemas"
      description="Schema Registry subjects, versions and compatibility."
      endpoints={['GET /clusters/{c}/schemas/subjects']}
    />
  );
}

export default SchemasPage;
