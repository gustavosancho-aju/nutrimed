/**
 * Disclaimer "IA assiste, médico decide" (FR19). Versão mínima para o shell;
 * a Story 1.7 formaliza o Atom `<DisclaimerNote>` (acessibilidade, biblioteca de componentes).
 */
export function DisclaimerNote() {
  return (
    <p role="note" className="text-xs text-gray-500">
      ⓘ Sugestão de apoio. A conduta é sua. — NutriMed
    </p>
  );
}
