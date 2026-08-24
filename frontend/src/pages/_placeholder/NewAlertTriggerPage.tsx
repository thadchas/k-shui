import { ComingSoon } from './ComingSoon';

export function NewAlertTriggerPage() {
  return (
    <ComingSoon
      title="New alert trigger"
      description="Define a threshold on a component metric."
      endpoints={['GET /alerts/metrics', 'POST /alerts/triggers']}
    />
  );
}

export default NewAlertTriggerPage;
