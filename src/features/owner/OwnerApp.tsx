import { useEffect } from 'react';
import { Route, Routes, useLocation, useNavigate } from 'react-router';
import { Button } from '@astryxdesign/core/Button';
import { Center } from '@astryxdesign/core/Center';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { HStack } from '@astryxdesign/core/HStack';
import { Spinner } from '@astryxdesign/core/Spinner';
import { Tab, TabList } from '@astryxdesign/core/TabList';
import { Text } from '@astryxdesign/core/Text';
import { Token } from '@astryxdesign/core/Token';
import { VStack } from '@astryxdesign/core/VStack';
import { SignOut } from '@phosphor-icons/react';
import { ErrorState } from '@/components/QueryState';
import { StudioShell } from '@/features/studio/StudioLayout';
import { useStudio } from '@/features/studio/StudioContext';
import { studioPath } from '@/features/studio/paths';
import { signOut, useSession } from './auth';
import { LoginPage } from './LoginPage';
import { OwnerTenantContext } from './OwnerContext';
import { useMyTenants } from './queries';
import { BookingsView } from './BookingsView';
import { StatsView } from './StatsView';
import { SettingsView } from './settings/SettingsView';

export function OwnerApp() {
  return (
    <StudioShell>
      <OwnerGate />
    </StudioShell>
  );
}

function OwnerGate() {
  const studio = useStudio();
  const { session, loading } = useSession();
  const tenants = useMyTenants(!!session);

  useEffect(() => {
    document.title = `Кабинет — ${studio.name}`;
  }, [studio.name]);

  if (loading || (session && tenants.isPending)) {
    return (
      <Center minHeight="100dvh">
        <Spinner size="lg" label="Загрузка" />
      </Center>
    );
  }
  if (!session) return <LoginPage />;
  if (!tenants.data) {
    return (
      <Center minHeight="100dvh" padding={4}>
        <ErrorState error={tenants.error} onRetry={() => void tenants.refetch()} />
      </Center>
    );
  }
  // Membership is checked by the server on every call; this only picks the studio.
  const tenant = tenants.data.find((t) => t.slug === studio.slug);
  if (!tenant) {
    return (
      <Center minHeight="100dvh" padding={4}>
        <EmptyState
          title="Нет доступа к этой студии"
          description={`Вы вошли как ${session.user.email}. У этой учётной записи нет доступа к кабинету «${studio.name}».`}
          actions={<Button label="Выйти" onClick={() => void signOut()} />}
        />
      </Center>
    );
  }
  return (
    <OwnerTenantContext value={tenant}>
      <OwnerHome email={session.user.email ?? ''} />
    </OwnerTenantContext>
  );
}

const TABS = [
  { value: '', label: 'Записи' },
  { value: 'stats', label: 'Деньги' },
  { value: 'settings', label: 'Настройки' },
];

function OwnerHome({ email }: { email: string }) {
  const studio = useStudio();
  const navigate = useNavigate();
  const loc = useLocation();
  const base = studioPath(studio.slug, 'owner');
  const sub = loc.pathname.startsWith(base) ? loc.pathname.slice(base.length).replace(/^\/|\/$/g, '').split('/')[0] ?? '' : '';
  const current = TABS.some((t) => t.value === sub) ? sub : '';

  return (
    <main className="app-page app-page--owner">
      <VStack gap={4} padding={4} paddingBlockStart={4}>
        <HStack justify="between" vAlign="center" gap={2}>
          <VStack gap={0.5}>
            <HStack gap={2} vAlign="center">
              <Text weight="bold" size="lg">
                {studio.name}
              </Text>
              {studio.is_preview ? <Token size="sm" color="orange" label="Демо" /> : null}
            </HStack>
            <Text type="supporting" maxLines={1}>
              {email}
            </Text>
          </VStack>
          <Button variant="ghost" icon={<SignOut size={18} />} label="Выйти" onClick={() => void signOut()} />
        </HStack>
        <TabList value={current} onChange={(v) => navigate(v ? `${base}${v}` : base)} layout="fill" hasDivider>
          {TABS.map((t) => (
            <Tab key={t.value} value={t.value} label={t.label} />
          ))}
        </TabList>
        <Routes>
          <Route index element={<BookingsView />} />
          <Route path="stats" element={<StatsView />} />
          <Route path="settings/*" element={<SettingsView />} />
          <Route path="*" element={<BookingsView />} />
        </Routes>
      </VStack>
    </main>
  );
}
