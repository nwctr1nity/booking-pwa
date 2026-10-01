import { useEffect } from 'react';
import { Outlet, useParams } from 'react-router';
import { Theme } from '@astryxdesign/core/theme';
import { Center } from '@astryxdesign/core/Center';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Spinner } from '@astryxdesign/core/Spinner';
import { Storefront } from '@phosphor-icons/react';
import { BottomNav } from '@/components/BottomNav';
import { ErrorState } from '@/components/QueryState';
import { ApiError } from '@/lib/errors';
import { studioTheme } from '@/theme/studio-theme';
import { BookingDrawer } from '@/features/booking/BookingDrawer';
import { StudioContext } from './StudioContext';
import { useStudioQuery } from './queries';

export function StudioShell({ children }: { children: React.ReactNode }) {
  const { slug = '' } = useParams();
  const q = useStudioQuery(slug);
  const studio = q.data;

  useEffect(() => {
    if (!studio) return;
    document.documentElement.style.setProperty('--studio-accent', studio.accent_color);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', '#000000');
  }, [studio]);

  if (!studio) {
    if (q.isPending) {
      return (
        <Center minHeight="100dvh">
          <Spinner size="lg" label="Загружаем студию" />
        </Center>
      );
    }
    if (q.error instanceof ApiError && q.error.code === 'tenant_not_found') {
      return (
        <Center minHeight="100dvh" padding={4}>
          <EmptyState icon={<Storefront size={36} />} title="Студия не найдена" description="Проверьте ссылку или спросите её у студии." />
        </Center>
      );
    }
    return (
      <Center minHeight="100dvh" padding={4}>
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      </Center>
    );
  }

  return (
    <Theme theme={studioTheme(studio.accent_color)} mode="dark">
      <StudioContext value={studio}>{children}</StudioContext>
    </Theme>
  );
}

export function StudioLayout() {
  const { slug = '' } = useParams();
  return (
    <StudioShell>
      <Outlet />
      <BottomNav slug={slug} />
      <BookingDrawer />
    </StudioShell>
  );
}
