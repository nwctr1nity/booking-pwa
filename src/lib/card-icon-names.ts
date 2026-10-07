// Icon names allowed in business.json info_cards (shared by the app and the pipeline schema).
export const CARD_ICON_NAMES = ['shield-check', 'sparkle', 'star', 'camera', 'coffee', 'timer', 'clock', 'warehouse', 'wrench', 'car', 'drop', 'medal', 'thumbs-up', 'scissors', 'heart'] as const;
export type CardIconName = (typeof CARD_ICON_NAMES)[number];
