import type { ReactNode } from 'react';
import { DisclaimerNote } from './disclaimer-note';

/**
 * Chrome base da aplicação (Story 1.7 / FR19): envolve TODA página com o
 * disclaimer persistente "IA assiste, médico decide". Vive no layout raiz —
 * não é dispensável e nenhuma rota renderiza sem ele (AC1/AC3).
 */
export function AppChrome({ children }: { children: ReactNode }) {
  return (
    <>
      {/* reserva de espaço para a barra fixa não cobrir conteúdo */}
      <div className="pb-10">{children}</div>
      <footer className="fixed inset-x-0 bottom-0 border-t border-gray-200 bg-white/95 px-4 py-2 text-center backdrop-blur-sm">
        <DisclaimerNote variant="chrome" />
      </footer>
    </>
  );
}
