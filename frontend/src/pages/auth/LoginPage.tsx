import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { LogIn } from 'lucide-react';
import { useInfo, useLogin } from '@/api/hooks/system';
import { apiUrl } from '@/api/client';
import { useAuthStore } from '@/stores/auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { InlineError } from '@/components/ui/error-state';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';

export function LoginPage() {
  const navigate = useNavigate();
  const { data: info, isLoading } = useInfo();
  const login = useLogin();
  const token = useAuthStore((s) => s.token);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const authType = info?.auth?.type ?? 'none';

  useEffect(() => {
    if (!isLoading && (authType === 'none' || token)) {
      void navigate('/clusters', { replace: true });
    }
  }, [isLoading, authType, token, navigate]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    login.mutate(
      { username, password },
      { onSuccess: () => void navigate('/clusters', { replace: true }) },
    );
  };

  return (
    <div className="flex min-h-dvh items-center justify-center bg-[var(--background)] p-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <span className="flex size-11 items-center justify-center rounded-[12px] bg-[var(--primary)] font-mono text-lg font-bold text-[var(--primary-foreground)]">
            k
          </span>
          <div>
            <h1 className="text-xl font-semibold">Sign in to k-shui</h1>
            <p className="mt-1 text-xs text-[var(--muted)]">Kafka Streaming Hub</p>
          </div>
        </div>

        <Card>
          <CardContent className="p-5">
            {isLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
              </div>
            ) : authType === 'oidc' ? (
              <div className="space-y-4">
                <p className="text-xs text-[var(--muted)]">
                  This instance uses single sign-on. You will be redirected to your identity
                  provider.
                </p>
                <Button asChild className="w-full" size="lg">
                  <a href={apiUrl('/auth/oidc/login')}>
                    <LogIn /> Continue with SSO
                  </a>
                </Button>
              </div>
            ) : (
              <form onSubmit={submit} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="username" required>
                    Username
                  </Label>
                  <Input
                    id="username"
                    autoFocus
                    autoComplete="username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="password" required>
                    Password
                  </Label>
                  <Input
                    id="password"
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
                {login.error ? <InlineError error={login.error} /> : null}
                <Button
                  type="submit"
                  className="w-full"
                  size="lg"
                  loading={login.isPending}
                  disabled={!username || !password}
                >
                  <LogIn /> Sign in
                </Button>
              </form>
            )}
          </CardContent>
        </Card>

        <p className="text-center text-2xs text-[var(--muted)]">
          {info?.version ? `k-shui v${info.version}` : 'k-shui'}
        </p>
      </div>
    </div>
  );
}

export default LoginPage;
