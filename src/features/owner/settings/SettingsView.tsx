import { Route, Routes, useNavigate } from 'react-router';
import { Button } from '@astryxdesign/core/Button';
import { List, ListItem } from '@astryxdesign/core/List';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import { ArrowLeft, CalendarX, Car, Clock, Images, Info, Storefront, Users, Wrench } from '@phosphor-icons/react';
import { QueryState } from '@/components/QueryState';
import { useStudio } from '@/features/studio/StudioContext';
import { studioPath } from '@/features/studio/paths';
import type { OwnerSettings } from '@/lib/types';
import { useOwnerTenant } from '../OwnerContext';
import { useOwnerSettings } from '../queries';
import { ProfileSection } from './ProfileSection';
import { InfoCardsSection } from './InfoCardsSection';
import { ServicesSection } from './ServicesSection';
import { ResourcesSection } from './ResourcesSection';
import { HoursSection } from './HoursSection';
import { ExceptionsSection } from './ExceptionsSection';
import { GallerySection } from './GallerySection';

const SECTIONS = [
  { path: 'profile', label: 'Студия', description: 'Название, адрес, телефон, логотип, фото', icon: Storefront, el: ProfileSection },
  { path: 'cards', label: 'Инфо-карточки', description: 'Три коротких преимущества на главной', icon: Info, el: InfoCardsSection },
  { path: 'services', label: 'Услуги и цены', description: 'Цены, длительность, посты', icon: Wrench, el: ServicesSection },
  { path: 'resources', label: 'Посты', description: 'Боксы и рабочие места', icon: Car, el: ResourcesSection },
  { path: 'hours', label: 'Часы работы', description: 'Расписание по дням недели', icon: Clock, el: HoursSection },
  { path: 'exceptions', label: 'Выходные и особые дни', description: 'Праздники, сокращённые дни', icon: CalendarX, el: ExceptionsSection },
  { path: 'gallery', label: 'Фото работ', description: 'Добавить, заменить, подписать', icon: Images, el: GallerySection },
] as const;

// A beauty salon calls its resources masters.
const BEAUTY_LABELS: Partial<Record<(typeof SECTIONS)[number]['path'], { label?: string; description: string; icon?: typeof Car }>> = {
  profile: { label: 'Салон', description: 'Название, адрес, телефон, логотип, фото' },
  services: { description: 'Цены, длительность, мастера' },
  resources: { label: 'Мастера', description: 'Кто принимает клиентов', icon: Users },
};

export type SectionProps = { settings: OwnerSettings };

export function SettingsView() {
  const tenant = useOwnerTenant();
  const q = useOwnerSettings(tenant.id);
  return (
    <Routes>
      <Route index element={<SettingsIndex />} />
      {SECTIONS.map((s) => (
        <Route
          key={s.path}
          path={s.path}
          element={
            <SectionFrame title={s.label}>
              <QueryState query={q}>{(data) => <s.el settings={data} />}</QueryState>
            </SectionFrame>
          }
        />
      ))}
    </Routes>
  );
}

function SettingsIndex() {
  const studio = useStudio();
  const base = studioPath(studio.slug, 'owner/settings/');
  return (
    <VStack gap={3}>
      <List hasDividers density="spacious">
        {SECTIONS.map((s) => ({ ...s, ...(studio.kind === 'beauty' ? BEAUTY_LABELS[s.path] : null) })).map((s) => (
          <ListItem key={s.path} label={s.label} description={s.description} href={base + s.path} startContent={<s.icon size={22} aria-hidden />} />
        ))}
      </List>
      <Text type="supporting">Изменения видны клиентам сразу. Поля, изменённые здесь, не перезаписываются при повторной публикации конфигурации.</Text>
    </VStack>
  );
}

function SectionFrame({ title, children }: { title: string; children: React.ReactNode }) {
  const navigate = useNavigate();
  const studio = useStudio();
  return (
    <VStack gap={4}>
      <VStack gap={1} hAlign="start">
        <Button variant="ghost" size="sm" icon={<ArrowLeft size={16} />} label="Все настройки" onClick={() => navigate(studioPath(studio.slug, 'owner/settings'))} />
        <Text weight="bold" size="xl">
          {title}
        </Text>
      </VStack>
      {children}
    </VStack>
  );
}
