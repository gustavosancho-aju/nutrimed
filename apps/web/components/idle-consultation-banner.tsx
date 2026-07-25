'use client';

import { useEffect, useState } from 'react';
import { useBoardStore } from '@/lib/board-store';

/**
 * Aviso "consulta ativa e parada" (correção do vazamento de custo, 2026-07-24).
 *
 * O estado que sangrou dinheiro era INVISÍVEL: a consulta seguia ativa, o board
 * seguia perguntando à IA a cada 90s e nada aparecia na tela. Aqui o estado
 * deixa de ser invisível — mas SEM banner permanente, que brigaria com o
 * princípio da sala calma (E7: o olho do médico fica livre p/ o paciente).
 * Aparece só na combinação de risco: sessão rodando + silêncio prolongado.
 *
 * Camada de "cenoura", complementar às travas automáticas do servidor: o aviso
 * vem aos 5 min para o médico encerrar direito ANTES de a máquina agir (o custo
 * para aos 10 min de silêncio, a sessão cai sozinha aos 60).
 */

/** Silêncio a partir do qual vale lembrar o médico de encerrar. */
const IDLE_NUDGE_MS = 5 * 60_000;
/** Releitura do relógio: o silêncio cresce sem novos eventos no store. */
const RECHECK_MS = 15_000;

export function IdleConsultationBanner() {
  const stt = useBoardStore((s) => s.pipeline.stt);
  const lastTranscriptAt = useBoardStore((s) => s.pipeline.lastTranscriptAt);
  // 0 = ainda não medido no cliente (evita divergência de hidratação no SSR)
  const [now, setNow] = useState(0);

  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), RECHECK_MS);
    return () => clearInterval(timer);
  }, []);

  const running = stt === 'live' || stt === 'degraded';
  // lastTranscriptAt null = sessão armada mas nada falado ainda: nada a cobrar
  // (o case review exige fala), então não há por que incomodar o médico.
  if (now === 0 || !running || lastTranscriptAt === null) return null;
  const idleMs = now - lastTranscriptAt;
  if (idleMs < IDLE_NUDGE_MS) return null;

  return (
    <p
      role="status"
      data-testid="idle-consultation-banner"
      className="rounded-md border border-amber-300/40 bg-amber-400/15 px-3 py-1.5 text-[11px] font-medium text-amber-200"
    >
      🔴 Consulta ativa, sem fala há {Math.floor(idleMs / 60_000)} min. Se já terminou, use “⏹ Encerrar
      consulta” — salvar a nota clínica também encerra a sessão.
    </p>
  );
}
