import { Link, useRouteError, isRouteErrorResponse } from 'react-router';
import { Compass } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';

export function NotFound() {
  const error = useRouteError();
  const is404 = !error || (isRouteErrorResponse(error) && error.status === 404);

  return (
    <div className="flex min-h-[70vh] items-center justify-center">
      <EmptyState
        icon={Compass}
        title={is404 ? 'Page not found' : 'Unexpected routing error'}
        description={
          is404
            ? 'The page you were looking for does not exist or has moved.'
            : isRouteErrorResponse(error)
              ? `${error.status} ${error.statusText}`
              : String(error)
        }
        action={
          <Button asChild>
            <Link to="/clusters">Back to clusters</Link>
          </Button>
        }
      />
    </div>
  );
}

export default NotFound;
