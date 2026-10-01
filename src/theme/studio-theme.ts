import { defineTheme, type DefinedTheme } from '@astryxdesign/core/theme';
import { neutralTheme } from '@astryxdesign/theme-neutral';

const FALLBACK_ACCENT = '#4690FF';
const cache = new Map<string, DefinedTheme>();

/**
 * One theme per studio accent. The app is always dark: black page, white
 * text, a single accent taken from the studio settings.
 */
export function studioTheme(accent: string | null | undefined): DefinedTheme {
  const color = /^#[0-9a-fA-F]{6}$/.test(accent ?? '') ? accent! : FALLBACK_ACCENT;
  const hit = cache.get(color);
  if (hit) return hit;
  const theme = defineTheme({
    name: `studio-${color.slice(1).toLowerCase()}`,
    extends: neutralTheme,
    color: { accent: [color, color], neutralStyle: 'neutral' },
    typography: {
      body: { family: 'Manrope Variable', fallbacks: 'system-ui, -apple-system, sans-serif' },
      heading: { family: 'Manrope Variable', fallbacks: 'system-ui, -apple-system, sans-serif' },
    },
    radius: { base: 6, multiplier: 1.4 },
    tokens: {
      '--color-background-body': ['#000000', '#000000'],
      '--color-background-surface': ['#0d0d0f', '#0d0d0f'],
      '--color-background-card': ['#141417', '#141417'],
      '--color-background-popover': ['#18181b', '#18181b'],
      '--color-text-primary': ['#ffffff', '#ffffff'],
    },
  });
  cache.set(color, theme);
  return theme;
}

export const defaultTheme = () => studioTheme(FALLBACK_ACCENT);
