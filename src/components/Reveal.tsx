import { useEffect, useRef, useState, type ReactNode } from 'react';

/** Fades a section in once it scrolls into view; static with reduced motion (CSS). */
export function Reveal({ children, as: Tag = 'section', id, label }: { children: ReactNode; as?: 'section' | 'div'; id?: string; label?: string }) {
  const ref = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: '0px 0px -10% 0px', threshold: 0.05 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <Tag ref={ref as never} id={id} aria-label={label} className="reveal" data-visible={visible}>
      {children}
    </Tag>
  );
}
