import { useSearchParams } from 'react-router';
import { Monitor, Moon, Sun, Users } from 'lucide-react';
import { useInfo } from '@/api/hooks/system';
import { FEATURE_LABELS } from '@/lib/nav';
import { formatUptime } from '@/lib/format';
import { useThemeStore, type ThemeMode } from '@/stores/theme';
import { useUiStore } from '@/stores/ui';
import { REFRESH_OPTIONS } from '@/components/ui/refresh-picker';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardToolbarHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/ui/page-header';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { RefreshIntervalMs } from '@/stores/ui';

const THEMES: { mode: ThemeMode; label: string; icon: typeof Sun }[] = [
  { mode: 'light', label: 'Light', icon: Sun },
  { mode: 'dark', label: 'Dark', icon: Moon },
  { mode: 'system', label: 'System', icon: Monitor },
];

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <span className="text-xs text-[var(--muted)]">{label}</span>
      <span className="truncate font-mono text-[13px]">{value}</span>
    </div>
  );
}

export function AppSettingsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get('tab') ?? 'appearance';
  const { data: info } = useInfo();

  const themeMode = useThemeStore((s) => s.mode);
  const setThemeMode = useThemeStore((s) => s.setMode);
  const sidebarCollapsed = useUiStore((s) => s.sidebarCollapsed);
  const setSidebarCollapsed = useUiStore((s) => s.setSidebarCollapsed);
  const refreshInterval = useUiStore((s) => s.refreshInterval);
  const setRefreshInterval = useUiStore((s) => s.setRefreshInterval);

  const basicAuth = info?.auth?.type === 'basic';

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Settings" description="Appearance, defaults and build information." />

      <Tabs
        value={tab}
        onValueChange={(v) => {
          const next = new URLSearchParams(searchParams);
          next.set('tab', v);
          setSearchParams(next, { replace: true });
        }}
      >
        <TabsList>
          <TabsTrigger value="appearance">Appearance</TabsTrigger>
          <TabsTrigger value="about">About</TabsTrigger>
          {basicAuth ? <TabsTrigger value="users">Users</TabsTrigger> : null}
        </TabsList>

        <TabsContent value="appearance" className="space-y-4">
          <Card>
            <CardToolbarHeader
              title="Theme"
              description="Applies immediately and is stored in this browser."
            />
            <CardContent className="space-y-4">
              <div className="grid grid-cols-3 gap-2">
                {THEMES.map((t) => (
                  <Button
                    key={t.mode}
                    variant={themeMode === t.mode ? 'default' : 'outline'}
                    className="h-auto flex-col gap-1.5 py-4"
                    onClick={() => setThemeMode(t.mode)}
                  >
                    <t.icon className="size-4" />
                    {t.label}
                  </Button>
                ))}
              </div>

              <Separator />

              <div className="flex items-center justify-between gap-4">
                <div>
                  <Label>Collapsed sidebar</Label>
                  <p className="mt-0.5 text-2xs text-[var(--muted)]">
                    Show the icon rail instead of the full sidebar.
                  </p>
                </div>
                <Switch
                  checked={sidebarCollapsed}
                  onCheckedChange={setSidebarCollapsed}
                  aria-label="Collapse sidebar"
                />
              </div>

              <Separator />

              <div className="space-y-2">
                <Label>Default auto-refresh</Label>
                <div className="flex flex-wrap gap-2">
                  {REFRESH_OPTIONS.map((option) => (
                    <Button
                      key={option.value}
                      size="sm"
                      variant={refreshInterval === option.value ? 'default' : 'outline'}
                      onClick={() => setRefreshInterval(option.value as RefreshIntervalMs)}
                    >
                      {option.label}
                    </Button>
                  ))}
                </div>
                <p className="text-2xs text-[var(--muted)]">
                  Controls how often every page re-queries the API. Also available from the topbar.
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="about">
          <Card>
            <CardToolbarHeader
              title="About k-shui"
              description="Server build and enabled integrations."
            />
            <CardContent>
              <div className="divide-y divide-[var(--border)]">
                <Row label="Version" value={info?.version ?? '—'} />
                <Row label="Uptime" value={formatUptime(info?.uptimeSeconds)} />
                <Row label="Authentication" value={info?.auth?.type ?? '—'} />
                <Row label="Clusters" value={info?.clusters?.length ?? 0} />
              </div>

              {info?.features ? (
                <div className="mt-4 space-y-2">
                  <Label>Features</Label>
                  <div className="flex flex-wrap gap-1.5">
                    {Object.entries(info.features).map(([key, enabled]) => (
                      <Badge key={key} variant={enabled ? 'success' : 'secondary'} size="sm">
                        {FEATURE_LABELS[key] ?? key}
                      </Badge>
                    ))}
                  </div>
                </div>
              ) : null}

              <p className="mt-5 text-2xs text-[var(--muted)]">
                k-shui is open source under the Apache-2.0 license.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        {basicAuth ? (
          <TabsContent value="users">
            <Card>
              <EmptyState
                icon={Users}
                title="Users are configured in k-shui.yaml"
                description="With basic auth, accounts and roles come from the auth.users section of the server config. Restart the server after changing them."
              />
            </Card>
          </TabsContent>
        ) : null}
      </Tabs>
    </div>
  );
}

export default AppSettingsPage;
