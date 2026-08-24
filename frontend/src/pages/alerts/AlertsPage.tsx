import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Bell, Plus, Siren, Webhook } from 'lucide-react';
import { useAlertActions, useAlertSummary, useAlertTriggers } from '@/api/hooks/alerts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { StatTile, StatTileRow } from '@/components/StatTile';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ActionsTab } from './components/ActionsTab';
import { HistoryTab } from './components/HistoryTab';
import { TriggersTab } from './components/TriggersTab';
import { isAlertsUnavailable } from './alertsLib';

const TABS = ['history', 'triggers', 'actions'] as const;

export function AlertsPage() {
  const [params, setParams] = useSearchParams();
  const tabParam = params.get('tab') ?? 'history';
  const tab = (TABS as readonly string[]).includes(tabParam) ? tabParam : 'history';

  const summary = useAlertSummary();
  const triggers = useAlertTriggers();
  const actions = useAlertActions();

  const unavailable = isAlertsUnavailable(summary.error) && isAlertsUnavailable(triggers.error);

  const counts = useMemo(() => {
    const s = summary.data;
    return {
      total:
        s?.total ??
        Object.values(s?.bySeverity ?? {}).reduce((a, b) => a + (b ?? 0), 0),
      critical: s?.bySeverity?.critical ?? 0,
      warning: s?.bySeverity?.warning ?? 0,
      info: s?.bySeverity?.info ?? 0,
    };
  }, [summary.data]);

  const enabledTriggers = (triggers.data ?? []).filter((t) => t.enabled).length;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Alerts"
        description="Trigger history, conditions and notification actions across all clusters."
        meta={
          unavailable ? (
            <Badge variant="secondary">unavailable</Badge>
          ) : counts.total > 0 ? (
            <Badge variant="danger">{counts.total} firing</Badge>
          ) : (
            <Badge variant="success">all clear</Badge>
          )
        }
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <Link to="/alerts/actions/new">
                <Webhook /> New action
              </Link>
            </Button>
            <Button asChild size="sm">
              <Link to="/alerts/triggers/new">
                <Plus /> New trigger
              </Link>
            </Button>
          </>
        }
      />

      {unavailable ? null : (
        <StatTileRow columns={4}>
          <StatTile
            label="Firing"
            value={counts.total}
            tone={counts.total > 0 ? 'danger' : 'success'}
            icon={Bell}
            loading={summary.isLoading}
          />
          <StatTile
            label="Critical"
            value={counts.critical}
            tone={counts.critical > 0 ? 'danger' : 'muted'}
            icon={Siren}
            loading={summary.isLoading}
          />
          <StatTile
            label="Warning"
            value={counts.warning}
            tone={counts.warning > 0 ? 'warning' : 'muted'}
            icon={Siren}
            loading={summary.isLoading}
          />
          <StatTile
            label="Triggers enabled"
            value={`${enabledTriggers}/${triggers.data?.length ?? 0}`}
            hint={`${actions.data?.length ?? 0} notification actions`}
            icon={Webhook}
            loading={triggers.isLoading}
          />
        </StatTileRow>
      )}

      <Tabs
        value={tab}
        onValueChange={(v) => setParams(v === 'history' ? {} : { tab: v }, { replace: true })}
      >
        <TabsList>
          <TabsTrigger value="history">History</TabsTrigger>
          <TabsTrigger value="triggers">
            Triggers
            {triggers.data ? (
              <Badge variant="secondary" size="sm">
                {triggers.data.length}
              </Badge>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="actions">
            Actions
            {actions.data ? (
              <Badge variant="secondary" size="sm">
                {actions.data.length}
              </Badge>
            ) : null}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="history">
          <HistoryTab />
        </TabsContent>
        <TabsContent value="triggers">
          <TriggersTab />
        </TabsContent>
        <TabsContent value="actions">
          <ActionsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default AlertsPage;
