'use client';

/**
 * Botão de exclusão com confirmação nativa (feedback do piloto). Client
 * component mínimo: só intercepta o submit para o window.confirm — a exclusão
 * em si é a server action do form (soft-delete auditado).
 */
export function ConfirmDeleteButton({ label = 'Excluir' }: { label?: string }) {
  return (
    <button
      type="submit"
      onClick={(e) => {
        if (!window.confirm('Excluir esta medição? Ela sai dos gráficos e relatórios.')) {
          e.preventDefault();
        }
      }}
      className="rounded-[8px] px-2 py-1 text-xs text-red-700 transition-colors hover:bg-red-400/10"
    >
      {label}
    </button>
  );
}
