import { defineTheme, type DefinedTheme } from '@astryxdesign/core/theme';
import { neutralTheme } from '@astryxdesign/theme-neutral';
import type { Studio } from '@/lib/types';

const FALLBACK_ACCENT = '#4690FF';
const cache = new Map<string, DefinedTheme>();

const MANROPE = { family: 'Manrope Variable', fallbacks: 'system-ui, -apple-system, sans-serif' };
// Beauty salons: the Экспресс БС look, Onest text and wide Unbounded headings
// on a warm graphite page with glass cards.
const ONEST = { family: 'Onest Variable', fallbacks: "-apple-system, 'SF Pro Text', system-ui, sans-serif" };
const UNBOUNDED = { family: 'Unbounded Variable', fallbacks: "'Onest Variable', -apple-system, system-ui, sans-serif" };

/**
 * One theme per studio accent and kind. The app is always dark: black page,
 * white text, a single accent taken from the studio settings.
 */
export function studioTheme(accent: string | null | undefined, kind?: Studio['kind']): DefinedTheme {
  const color = /^#[0-9a-fA-F]{6}$/.test(accent ?? '') ? accent! : FALLBACK_ACCENT;
  const beauty = kind === 'beauty';
  const key = `${color}:${beauty ? 'beauty' : 'auto'}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const theme = defineTheme({
    name: `studio-${color.slice(1).toLowerCase()}${beauty ? '-beauty' : ''}`,
    extends: neutralTheme,
    color: { accent: [color, color], neutralStyle: beauty ? 'warm' : 'neutral' },
    typography: { body: beauty ? ONEST : MANROPE, heading: beauty ? UNBOUNDED : MANROPE },
    radius: beauty ? { base: 8, multiplier: 1.5 } : { base: 6, multiplier: 1.4 },
    tokens: beauty
      ? {
          '--color-background-body': ['#0b0c0d', '#0b0c0d'],
          '--color-background-surface': ['#101113', '#101113'],
          '--color-background-card': ['#15161a', '#15161a'],
          '--color-background-popover': ['#1a1b1f', '#1a1b1f'],
          '--color-text-primary': ['#f2f1ee', '#f2f1ee'],
        }
      : {
          '--color-background-body': ['#000000', '#000000'],
          '--color-background-surface': ['#0d0d0f', '#0d0d0f'],
          '--color-background-card': ['#141417', '#141417'],
          '--color-background-popover': ['#18181b', '#18181b'],
          '--color-text-primary': ['#ffffff', '#ffffff'],
        },
  });
  cache.set(key, theme);
  return theme;
}

export const defaultTheme = () => studioTheme(FALLBACK_ACCENT);
