import { ComingSoon } from './ComingSoon';

export function NewAlertActionPage() {
  return (
    <ComingSoon
      title="New alert action"
      description="Email, Slack, PagerDuty, Teams or webhook."
      endpoints={['POST /alerts/actions', 'POST /alerts/actions/{id}/test']}
    />
  );
}

export default NewAlertActionPage;
