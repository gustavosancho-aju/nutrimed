import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Fraunces, IBM_Plex_Mono, Inter } from 'next/font/google';
import { AppChrome } from '@/components/app-chrome';
import './globals.css';

/* Tipografia premium (frontend-spec §6 — evolução "Clinical Quiet Luxury"):
   Fraunces = títulos (autoridade médica), Inter = corpo (legibilidade clínica),
   Plex Mono = dados/medidas. Carregadas via next/font (self-hosted, zero FOUT). */
const fontDisplay = Fraunces({
  subsets: ['latin'],
  weight: ['500', '600'],
  variable: '--font-display',
});
const fontBody = Inter({ subsets: ['latin'], variable: '--font-body' });
const fontMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-mono-data',
});

export const metadata: Metadata = {
  title: 'NutriMed',
  description: 'Board de especialistas clínicos assistido por IA — a IA assiste, o médico decide.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="pt-BR"
      className={`${fontDisplay.variable} ${fontBody.variable} ${fontMono.variable}`}
    >
      <body>
        <AppChrome>{children}</AppChrome>
      </body>
    </html>
  );
}
