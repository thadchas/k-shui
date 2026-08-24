import { ComingSoon } from './ComingSoon';

export function ConnectPage() {
  return (
    <ComingSoon
      title="Kafka Connect"
      description="Connect clusters and their connectors."
      endpoints={['GET /clusters/{c}/connect']}
    />
  );
}

export default ConnectPage;
