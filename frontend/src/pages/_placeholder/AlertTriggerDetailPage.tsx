import { ComingSoon } from './ComingSoon';

export function AlertTriggerDetailPage() {
  return (
    <ComingSoon
      title="Alert trigger"
      description="Edit or disable a trigger."
      endpoints={['GET /alerts/triggers/{id}', 'PUT /alerts/triggers/{id}']}
    />
  );
}

export default AlertTriggerDetailPage;
