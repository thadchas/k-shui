import { ComingSoon } from './ComingSoon';

export function AlertsPage() {
  return (
    <ComingSoon
      title="Alerts"
      description="History, triggers and notification actions."
      endpoints={['GET /alerts/history', 'GET /alerts/triggers', 'GET /alerts/actions']}
    />
  );
}

export default AlertsPage;
