import { ComingSoon } from './ComingSoon';

export function ConnectorDetailPage() {
  return (
    <ComingSoon
      title="Connector"
      description="Overview, config, tasks, topics and offsets."
      endpoints={['GET .../connectors/{n}', 'POST .../pause|resume|restart']}
    />
  );
}

export default ConnectorDetailPage;
