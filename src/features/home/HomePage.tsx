import { useEffect, useState } from 'react';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { Grid } from '@astryxdesign/core/Grid';
import { HStack } from '@astryxdesign/core/HStack';
import { Lightbox } from '@astryxdesign/core/Lightbox';
import { List, ListItem } from '@astryxdesign/core/List';
import { MetadataList, MetadataListItem } from '@astryxdesign/core/MetadataList';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import { CaretRight, Clock, MapPin, Phone, ShieldCheck, Sparkle, Star, Timer } from '@phosphor-icons/react';
import { GlassButton } from '@/components/GlassButton';
import { Reveal } from '@/components/Reveal';
import { groupHours } from '@/lib/hours';
import { mediaUrl } from '@/lib/media';
import { formatPrice } from '@/lib/money';
import { fmtDuration, fmtLocalDate, studioToday } from '@/lib/time';
import { useBookingFlow } from '@/features/booking/useBookingFlow';
import { useStudio } from '@/features/studio/StudioContext';
import { studioPath } from '@/features/studio/paths';

const CARD_ICONS = { shield: ShieldCheck, sparkle: Sparkle, star: Star, clock: Timer } as const;

export function HomePage() {
  const studio = useStudio();
  const flow = useBookingFlow();
  const [heroReady, setHeroReady] = useState(false);
  const [lightbox, setLightbox] = useState<number | null>(null);
  const hero = mediaUrl(studio.hero_path);
  const logo = mediaUrl(studio.logo_path);
  const today = studioToday(studio.timezone);
  const exceptions = studio.exceptions.filter((e) => e.day >= today).slice(0, 4);

  useEffect(() => {
    document.title = `${studio.name} — онлайн-запись`;
  }, [studio.name]);

  return (
    <main className="app-page">
      <header className="hero" aria-label={studio.name}>
        <div className="hero-media">
          {hero ? <img src={hero} alt="" crossOrigin="anonymous" fetchPriority="high" decoding="async" onLoad={() => setHeroReady(true)} /> : null}
        </div>
        <div className="hero-top">
          <HStack gap={2} vAlign="center">
            {logo ? <img className="hero-logo" src={logo} alt="" /> : null}
            <Text weight="semibold">{studio.short_name}</Text>
          </HStack>
        </div>
        <div className="hero-body">
          <VStack gap={3}>
            {studio.tagline ? <Text color="secondary">{studio.tagline}</Text> : null}
            <h1 className="hero-title">{studio.name}</h1>
            {studio.description ? <Text maxLines={3}>{studio.description}</Text> : null}
            <GlassButton label="Записаться" onClick={() => flow.open()} snapshot=".hero-media" ready={heroReady} />
          </VStack>
        </div>
      </header>

      <VStack gap={8} paddingBlockStart={2}>
        {studio.is_preview ? (
          <div className="app-gutter">
            <Banner status="info" title="Демо-версия студии" description="Записи здесь тестовые, уведомления не отправляются." collapsible={false} />
          </div>
        ) : null}

        {studio.info_cards.length > 0 ? (
          <Reveal label="Преимущества">
            <div className="app-gutter">
              <Grid columns={{ minWidth: 160 }} gap={3}>
                {studio.info_cards.map((c, i) => {
                  const Icon = CARD_ICONS[c.icon as keyof typeof CARD_ICONS] ?? Sparkle;
                  return (
                    <Card key={i} padding={4}>
                      <VStack gap={2}>
                        <Icon size={24} color="var(--color-accent)" aria-hidden />
                        <Text weight="semibold">{c.title}</Text>
                        <Text color="secondary">{c.text}</Text>
                      </VStack>
                    </Card>
                  );
                })}
              </Grid>
            </div>
          </Reveal>
        ) : null}

        <Reveal id="book" label="Запись в студию">
          <VStack gap={3} paddingInline={4}>
            <h2 className="section-title">Запись в студию</h2>
            <Card padding={4}>
              <VStack gap={4}>
                <Text color="secondary">Выберите услугу и свободное время. Регистрация не нужна, подтверждение придёт сразу.</Text>
                <List hasDividers density="compact">
                  {studio.services.slice(0, 3).map((s) => (
                    <ListItem
                      key={s.id}
                      label={s.name}
                      description={fmtDuration(s.duration_minutes)}
                      onClick={() => flow.open(s.id)}
                      endContent={
                        <Text weight="semibold" hasTabularNumbers>
                          {formatPrice(s.price_cents, s.price_is_from, studio.currency)}
                        </Text>
                      }
                    />
                  ))}
                </List>
                <Button variant="primary" size="lg" width="100%" label="Выбрать время" onClick={() => flow.open()} />
              </VStack>
            </Card>
          </VStack>
        </Reveal>

        <Reveal label="Услуги и цены">
          <VStack gap={2} paddingInline={4}>
            <HStack justify="between" vAlign="center">
              <h2 className="section-title">Услуги и цены</h2>
              <Button variant="ghost" size="sm" label="Все" href={studioPath(studio.slug, 'services')} />
            </HStack>
            <List hasDividers>
              {studio.services.map((s) => (
                <ListItem
                  key={s.id}
                  label={s.name}
                  description={s.description || fmtDuration(s.duration_minutes)}
                  onClick={() => flow.open(s.id)}
                  endContent={
                    <HStack gap={1} vAlign="center">
                      <Text weight="semibold" hasTabularNumbers>
                        {formatPrice(s.price_cents, s.price_is_from, studio.currency)}
                      </Text>
                      <CaretRight size={16} aria-hidden />
                    </HStack>
                  }
                />
              ))}
            </List>
          </VStack>
        </Reveal>

        {studio.gallery.length > 0 ? (
          <Reveal label="Наши работы">
            <VStack gap={3}>
              <div className="app-gutter">
                <h2 className="section-title">Наши работы</h2>
              </div>
              <div className="photo-strip">
                {studio.gallery.map((g, i) => (
                  <button key={g.id} type="button" className="photo-card" onClick={() => setLightbox(i)} aria-label={`Открыть фото: ${g.caption || i + 1}`}>
                    <VStack gap={2}>
                      <img src={mediaUrl(g.image_path, g.updated_at) ?? ''} alt={g.caption} loading="lazy" decoding="async" />
                      {g.caption ? <Text color="secondary" maxLines={2}>{g.caption}</Text> : null}
                    </VStack>
                  </button>
                ))}
              </div>
              <Lightbox
                isOpen={lightbox !== null}
                onOpenChange={(o) => !o && setLightbox(null)}
                index={lightbox ?? 0}
                onIndexChange={setLightbox}
                media={studio.gallery.map((g) => ({ src: mediaUrl(g.image_path, g.updated_at) ?? '', alt: g.caption || 'Фото работы', caption: g.caption }))}
              />
            </VStack>
          </Reveal>
        ) : null}

        <Reveal label="Контакты">
          <VStack gap={3} paddingInline={4}>
            <h2 className="section-title">Как нас найти</h2>
            <Card padding={4}>
              <VStack gap={4}>
                <MetadataList>
                  <MetadataListItem label="Адрес" icon={<MapPin size={16} />}>
                    <VStack gap={0.5}>
                      <Text>{studio.address}</Text>
                      {studio.address_note ? <Text type="supporting">{studio.address_note}</Text> : null}
                    </VStack>
                  </MetadataListItem>
                  <MetadataListItem label="Часы" icon={<Clock size={16} />}>
                    <VStack gap={0.5}>
                      {groupHours(studio.hours).map((h) => (
                        <Text key={h.days} hasTabularNumbers>
                          {h.days}: {h.text}
                        </Text>
                      ))}
                      {exceptions.map((e) => (
                        <Text key={e.day} type="supporting">
                          {fmtLocalDate(e.day, 'd MMMM')}: {e.is_closed ? 'не работаем' : `${e.opens?.slice(0, 5)}–${e.closes?.slice(0, 5)}`}
                          {e.note ? ` (${e.note})` : ''}
                        </Text>
                      ))}
                    </VStack>
                  </MetadataListItem>
                </MetadataList>
                <HStack gap={2} wrap="wrap">
                  {studio.phone ? <Button icon={<Phone size={18} />} label="Позвонить" href={`tel:${studio.phone.replace(/[^+\d]/g, '')}`} /> : null}
                  {studio.map_url ? <Button icon={<MapPin size={18} />} label="Маршрут" href={studio.map_url} target="_blank" rel="noopener noreferrer" /> : null}
                </HStack>
              </VStack>
            </Card>
            <Button variant="primary" size="lg" width="100%" label="Записаться" onClick={() => flow.open()} />
          </VStack>
        </Reveal>

        <VStack paddingInline={4} hAlign="center">
          <Button variant="ghost" size="sm" label="Вход для владельца" href={studioPath(studio.slug, 'owner')} />
        </VStack>
      </VStack>
    </main>
  );
}
