import { NavLink } from 'react-router';
import { CalendarCheck, House, ListBullets } from '@phosphor-icons/react';
import { studioPath } from '@/features/studio/paths';

export function BottomNav({ slug }: { slug: string }) {
  const items = [
    { to: studioPath(slug), label: 'Главная', icon: House, end: true },
    { to: studioPath(slug, 'services'), label: 'Услуги', icon: ListBullets, end: false },
    { to: studioPath(slug, 'my'), label: 'Моя запись', icon: CalendarCheck, end: false },
  ];
  return (
    <nav className="bottom-nav" aria-label="Разделы">
      <div className="bottom-nav__bar">
        {items.map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end} className="bottom-nav__item">
            {({ isActive }) => (
              <>
                <Icon size={24} weight={isActive ? 'fill' : 'regular'} aria-hidden />
                <span>{label}</span>
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
