import { useEffect, useLayoutEffect } from 'react';
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
    // per-kind look (app.css): beauty salons get the grid page and glass cards
    document.documentElement.dataset.kind = studio.kind ?? 'detailing';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', studio.kind === 'beauty' ? '#0b0c0d' : '#000000');
    // Demo studios are shown to their owners by direct link only: keep them out of search.
    let robots = document.querySelector<HTMLMetaElement>('meta[name="robots"]');
    if (studio.is_preview) {
      if (!robots) {
        robots = document.createElement('meta');
        robots.name = 'robots';
        document.head.append(robots);
      }
      robots.content = 'noindex, nofollow';
    } else if (robots?.content.startsWith('noindex')) {
      robots.remove();
    }
  }, [studio]);

  // The app-wide Theme owns <html data-astryx-theme>, which is what portals
  // (the booking drawer, sheets) are styled by. Point it at this studio's
  // theme while the studio is open, so drawers get its accent and fonts too.
  const themeName = studio ? studioTheme(studio.accent_color, studio.kind).name : null;
  useLayoutEffect(() => {
    if (!themeName) return;
    const html = document.documentElement;
    const prev = html.getAttribute('data-astryx-theme');
    html.setAttribute('data-astryx-theme', themeName);
    return () => {
      if (prev) html.setAttribute('data-astryx-theme', prev);
    };
  }, [themeName]);

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
    <Theme theme={studioTheme(studio.accent_color, studio.kind)} mode="dark">
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
