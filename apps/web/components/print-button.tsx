'use client';

import { IconPrinter } from '@/components/icons';

/** Botão "Imprimir / Salvar PDF" — usa o diálogo nativo do navegador. */
export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="flex items-center gap-1.5 rounded-[10px] bg-brand px-4 py-2 text-sm font-semibold text-on-brand shadow-sm transition-opacity hover:opacity-90"
    >
      <IconPrinter className="h-4 w-4" /> Imprimir / Salvar PDF
    </button>
  );
}
