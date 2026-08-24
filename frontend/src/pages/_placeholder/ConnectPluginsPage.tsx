import { ComingSoon } from './ComingSoon';

export function ConnectPluginsPage() {
  return (
    <ComingSoon
      title="Connect plugins"
      description="Installed connector plugins."
      endpoints={['GET /clusters/{c}/connect/{k}/plugins']}
    />
  );
}

export default ConnectPluginsPage;
