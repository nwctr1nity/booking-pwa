import type { ReactNode } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Skeleton } from '@astryxdesign/core/Skeleton';
import { VStack } from '@astryxdesign/core/VStack';
import { WarningCircle, WifiSlash } from '@phosphor-icons/react';
import { ApiError, errorMessage } from '@/lib/errors';

export function LoadingRows({ rows = 3, height = 56 }: { rows?: number; height?: number }) {
  return (
    <VStack gap={2} aria-busy="true" aria-label="Загрузка">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} index={i} height={height} radius={3} />
      ))}
    </VStack>
  );
}

export function ErrorState({ error, onRetry, compact }: { error: unknown; onRetry?: () => void; compact?: boolean }) {
  const offline = (error instanceof ApiError && error.code === 'network') || (typeof navigator !== 'undefined' && !navigator.onLine);
  return (
    <EmptyState
      isCompact={compact}
      icon={offline ? <WifiSlash size={32} /> : <WarningCircle size={32} />}
      title={offline ? 'Нет соединения' : 'Не получилось загрузить'}
      description={errorMessage(error)}
      actions={onRetry ? <Button label="Повторить" onClick={onRetry} /> : undefined}
    />
  );
}

interface QueryLike<T> {
  data: T | undefined;
  error: unknown;
  isPending: boolean;
  refetch: () => unknown;
}

/** Loading, error and empty states for one query in one place. */
export function QueryState<T>({
  query,
  isEmpty,
  empty,
  loading,
  children,
}: {
  query: QueryLike<T>;
  isEmpty?: (data: T) => boolean;
  empty?: ReactNode;
  loading?: ReactNode;
  children: (data: T) => ReactNode;
}) {
  if (query.data === undefined) {
    if (query.isPending) return <>{loading ?? <LoadingRows />}</>;
    return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  }
  if (isEmpty?.(query.data)) return <>{empty}</>;
  return <>{children(query.data)}</>;
}
