import { ComingSoon } from './ComingSoon';

export function NewConnectorPage() {
  return (
    <ComingSoon
      title="New connector"
      description="Create a connector from a plugin."
      endpoints={['GET .../plugins', 'PUT .../plugins/{class}/validate', 'POST .../connectors']}
    />
  );
}

export default NewConnectorPage;
