'use client';

/** Botão "Imprimir / Salvar PDF" — usa o diálogo nativo do navegador. */
export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="rounded-[10px] bg-brand px-4 py-2 text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90"
    >
      🖨 Imprimir / Salvar PDF
    </button>
  );
}
