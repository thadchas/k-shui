import { ComingSoon } from './ComingSoon';

export function ConnectClusterPage() {
  return (
    <ComingSoon
      title="Connect cluster"
      description="Connectors on this Connect cluster."
      endpoints={['GET /clusters/{c}/connect/{k}/connectors']}
    />
  );
}

export default ConnectClusterPage;
