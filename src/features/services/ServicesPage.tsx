import { useEffect, useMemo } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { HStack } from '@astryxdesign/core/HStack';
import { List, ListItem } from '@astryxdesign/core/List';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import { formatPrice } from '@/lib/money';
import { fmtDuration } from '@/lib/time';
import { useBookingFlow } from '@/features/booking/useBookingFlow';
import { useStudio } from '@/features/studio/StudioContext';

export function ServicesPage() {
  const studio = useStudio();
  const flow = useBookingFlow();
  useEffect(() => {
    document.title = `Услуги — ${studio.name}`;
  }, [studio.name]);

  const groups = useMemo(() => {
    const m = new Map<string, typeof studio.services>();
    for (const s of studio.services) {
      const k = s.category || 'Услуги';
      m.set(k, [...(m.get(k) ?? []), s]);
    }
    return [...m.entries()];
  }, [studio.services]);

  return (
    <main className="app-page">
      <VStack gap={6} padding={4} paddingBlockStart={6}>
        <VStack gap={1}>
          <h1 className="section-title">Услуги и цены</h1>
          <Text color="secondary">Цена «от» уточняется на месте после осмотра автомобиля.</Text>
        </VStack>
        {groups.length === 0 ? (
          <EmptyState title="Услуг пока нет" description="Студия ещё не добавила услуги. Позвоните, чтобы записаться." />
        ) : (
          groups.map(([cat, list]) => (
            <VStack key={cat} gap={2}>
              {groups.length > 1 ? <Text weight="semibold" color="secondary">{cat}</Text> : null}
              <List hasDividers density="spacious">
                {list.map((s) => (
                  <ListItem
                    key={s.id}
                    label={s.name}
                    description={
                      <VStack gap={0.5}>
                        {s.description ? <Text color="secondary">{s.description}</Text> : null}
                        <Text type="supporting">{fmtDuration(s.duration_minutes)}</Text>
                      </VStack>
                    }
                    endContent={
                      <HStack gap={2} vAlign="center">
                        <Text weight="semibold" hasTabularNumbers>
                          {formatPrice(s.price_cents, s.price_is_from, studio.currency)}
                        </Text>
                        <Button size="sm" variant="primary" label="Записаться" onClick={() => flow.open(s.id)} />
                      </HStack>
                    }
                  />
                ))}
              </List>
            </VStack>
          ))
        )}
      </VStack>
    </main>
  );
}
