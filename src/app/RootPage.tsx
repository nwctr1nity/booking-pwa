import { Center } from '@astryxdesign/core/Center';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { CalendarCheck } from '@phosphor-icons/react';

export function RootPage() {
  return (
    <Center minHeight="100dvh" padding={4}>
      <EmptyState
        icon={<CalendarCheck size={36} />}
        title="Онлайн-запись в студию"
        description="Откройте ссылку своей студии: она выглядит как /s/название-студии/."
      />
    </Center>
  );
}

export function NotFoundPage() {
  return (
    <Center minHeight="100dvh" padding={4}>
      <EmptyState title="Страница не найдена" description="Проверьте адрес ссылки." />
    </Center>
  );
}
