/**
 * Hook de instrumentation do Next.js (estável no Next 16) — roda uma vez no
 * startup do servidor.
 *
 * Propósito: warm-up do gateway WS do board (porta BOARD_WS_PORT=3001) no BOOT,
 * para a porta subir junto com o Next em vez de preguiçosamente na primeira
 * consulta. Mantém o single-process do ADR-010 (mitigação #1 do RUNBOOK de
 * deploy). O lazy-start em getBoardRuntime() continua como fallback.
 */
export async function register(): Promise<void> {
  // Guard NEXT_RUNTIME: instrumentation roda em todos os runtimes (edge/node).
  // O board-runtime é server-only e abre um socket TCP — só faz sentido (e só
  // funciona) no runtime Node.js do servidor; nunca no edge nem no browser.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  try {
    // Import dinâmico DENTRO do guard: o módulo é `server-only` e tem efeitos
    // colaterais (abre a porta WS) — não pode ser avaliado no topo do arquivo,
    // que o Next também carrega no bundle edge.
    const { getBoardRuntime } = await import('./lib/board-runtime');
    // getBoardRuntime() é idempotente (singleton em globalThis.__nutrimedBoard):
    // chamar no boot e depois numa consulta NÃO cria dois runtimes nem dois binds.
    await getBoardRuntime();
  } catch (error) {
    // Não derruba o boot do app se o warm-up falhar — loga e segue; o lazy-start
    // na primeira consulta permanece como fallback.
    console.error('[instrumentation] warm-up do gateway WS do board falhou:', error);
  }

  try {
    // Bot de Telegram (E12/12.7): inicia long-polling (dev) ou registra o webhook
    // (prod) no boot. Idempotente (singleton). Sem TELEGRAM_BOT_TOKEN ⇒ no-op.
    const { getTelegramRuntime } = await import('./lib/telegram-runtime');
    await getTelegramRuntime();
  } catch (error) {
    console.error('[instrumentation] warm-up do bot de Telegram falhou:', error);
  }
}
