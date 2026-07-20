/** Temas válidos aplicados pela UI — em sincronia com os blocos [data-theme] do globals.css. */
export const THEMES = ['unic', 'authority', 'classic'] as const;
export type Theme = (typeof THEMES)[number];
