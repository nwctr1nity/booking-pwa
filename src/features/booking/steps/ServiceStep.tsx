import { List, ListItem } from '@astryxdesign/core/List';
import { Text } from '@astryxdesign/core/Text';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { CaretRight } from '@phosphor-icons/react';
import { formatPrice } from '@/lib/money';
import { fmtDuration } from '@/lib/time';
import { useStudio } from '@/features/studio/StudioContext';

export function ServiceStep({ onPick }: { onPick: (serviceId: string) => void }) {
  const studio = useStudio();
  if (studio.services.length === 0) {
    return <EmptyState title="Услуг пока нет" description="Студия ещё не добавила услуги для онлайн-записи. Позвоните, чтобы записаться." />;
  }
  return (
    <List hasDividers density="spacious">
      {studio.services.map((s) => (
        <ListItem
          key={s.id}
          label={s.name}
          description={fmtDuration(s.duration_minutes)}
          onClick={() => onPick(s.id)}
          endContent={
            <>
              <Text weight="semibold" hasTabularNumbers>
                {formatPrice(s.price_cents, s.price_is_from, studio.currency)}
              </Text>
              <CaretRight size={18} aria-hidden />
            </>
          }
        />
      ))}
    </List>
  );
}
