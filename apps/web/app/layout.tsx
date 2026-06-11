import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { AppChrome } from '@/components/app-chrome';
import './globals.css';

export const metadata: Metadata = {
  title: 'NutriMed',
  description: 'Board de especialistas clínicos assistido por IA — a IA assiste, o médico decide.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>
        <AppChrome>{children}</AppChrome>
      </body>
    </html>
  );
}
