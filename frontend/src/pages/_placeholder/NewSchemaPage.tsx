import { ComingSoon } from './ComingSoon';

export function NewSchemaPage() {
  return (
    <ComingSoon
      title="Register schema"
      description="Create a new subject version."
      endpoints={['POST /clusters/{c}/schemas/subjects/{s}/versions']}
    />
  );
}

export default NewSchemaPage;
