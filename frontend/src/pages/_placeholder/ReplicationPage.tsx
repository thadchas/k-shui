import { ComingSoon } from './ComingSoon';

export function ReplicationPage() {
  return (
    <ComingSoon
      title="Replication"
      description="MirrorMaker2 / replicator flows detected in Connect."
      endpoints={['GET /clusters/{c}/replication']}
    />
  );
}

export default ReplicationPage;
