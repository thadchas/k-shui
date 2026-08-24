import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertOctagon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CodeBlock } from '@/components/ui/code-block';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  error: Error | null;
  stack: string | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, stack: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unhandled UI error', error, info);
    this.setState({ stack: info.componentStack ?? null });
  }

  private reset = () => this.setState({ error: null, stack: null });

  render() {
    const { error, stack } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback) return this.props.fallback;

    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-6 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--danger)_12%,transparent)]">
          <AlertOctagon className="size-6 text-[var(--danger)]" />
        </div>
        <div className="max-w-lg space-y-1">
          <h2 className="text-lg font-semibold">Something broke in the UI</h2>
          <p className="text-xs text-[var(--muted)]">{error.message}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={this.reset}>
            Try again
          </Button>
          <Button onClick={() => window.location.reload()}>Reload page</Button>
        </div>
        {stack ? (
          <details className="w-full max-w-2xl text-left">
            <summary className="cursor-pointer text-xs text-[var(--muted)]">
              Component stack
            </summary>
            <CodeBlock className="mt-2" code={stack.trim()} maxHeight={240} />
          </details>
        ) : null}
      </div>
    );
  }
}
