import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router';
import { InternationalizationProvider } from '@astryxdesign/core/i18n';
import { LinkProvider } from '@astryxdesign/core/Link';
import { Theme } from '@astryxdesign/core/theme';
import { ToastViewport } from '@astryxdesign/core/Toast';
import ruRU from '@astryxdesign/core/locales/ru-RU.json';
import { RouterLinkAdapter } from '@/components/RouterLinkAdapter';
import { defaultTheme } from '@/theme/studio-theme';
import { queryClient } from './queryClient';
import { router } from './router';

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <InternationalizationProvider locale="ru-RU" messages={{ 'ru-RU': ruRU }}>
        <Theme theme={defaultTheme()} mode="dark">
          <LinkProvider component={RouterLinkAdapter}>
            <RouterProvider router={router} />
          </LinkProvider>
          <ToastViewport position="topEnd" inset={{ top: 16 }} />
        </Theme>
      </InternationalizationProvider>
    </QueryClientProvider>
  );
}
