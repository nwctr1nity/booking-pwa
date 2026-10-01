import { useEffect, useId, useRef } from 'react';

type LiquidLens = { destroy?: () => void };

function prefersReducedMotion() {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Wide glass button over the hero photo. The pane under the label is turned
 * into refractive glass by liquid-gl, which snapshots ONLY the hero media
 * element: text from neighbouring sections can never appear inside it. The
 * label is a separate layer above the pane, so it stays sharp. Without
 * WebGL/WebGPU liquid-gl falls back to CSS backdrop-filter, and the pane is
 * already styled as frosted glass before the lens is ready.
 */
export function GlassButton({ label, onClick, snapshot, ready }: { label: string; onClick: () => void; snapshot: string; ready: boolean }) {
  const paneRef = useRef<HTMLSpanElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const id = `glass-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;

  useEffect(() => {
    const btn = btnRef.current;
    if (!ready || !paneRef.current || !btn) return;
    let lens: LiquidLens | LiquidLens[] | undefined;
    let cancelled = false;
    // Defer so the hero image is decoded and laid out before the snapshot.
    const start = () => {
      import('liquid-gl')
        .then(({ default: liquidGL }) => {
          if (cancelled || !document.querySelector(`[data-glass-id="${id}"]`)) return;
          lens = liquidGL({
            target: `[data-glass-id="${id}"]`,
            snapshot,
            resolution: 1.5,
            refraction: 0.012,
            bevelDepth: 0.09,
            bevelWidth: 0.2,
            frost: 1.5,
            shadow: true,
            specular: !prefersReducedMotion(),
            reveal: prefersReducedMotion() ? 'none' : 'fade',
            tint: 'rgba(255, 255, 255, 0.1)',
            content: false,
            zIndex: 3,
            on: {
              init: () => {
                if (!cancelled) btn.setAttribute('data-liquid', 'on');
              },
            },
          });
        })
        .catch(() => {
          /* CSS glass stays as the fallback */
        });
    };
    const idle = typeof window.requestIdleCallback === 'function';
    const handle = idle ? window.requestIdleCallback(start, { timeout: 800 }) : setTimeout(start, 200);
    return () => {
      cancelled = true;
      if (idle) window.cancelIdleCallback(handle as number);
      else clearTimeout(handle);
      const list = Array.isArray(lens) ? lens : lens ? [lens] : [];
      for (const l of list) l.destroy?.();
      btn.removeAttribute('data-liquid');
    };
  }, [ready, snapshot, id]);

  return (
    <button ref={btnRef} type="button" className="glass-cta" onClick={onClick}>
      <span ref={paneRef} className="glass-cta__pane" data-glass-id={id} aria-hidden />
      <span className="glass-cta__label">{label}</span>
    </button>
  );
}
