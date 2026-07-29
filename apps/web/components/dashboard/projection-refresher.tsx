'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/** De quanto em quanto tempo se pergunta ao servidor se a imagem ficou pronta. */
const INTERVALO_MS = 5_000;

/**
 * Enquanto houver projeção 'processing', recarrega os dados do servidor a cada
 * poucos segundos — a geração leva ~142s e termina fora do ciclo da requisição,
 * então nada avisaria a página sozinho.
 *
 * Polling (e não WebSocket) de propósito: o board já usa o WS para a consulta ao
 * vivo, e pendurar um canal a mais numa tela que fica aberta minutos custaria
 * mais do que resolve. `router.refresh()` só re-renderiza os Server Components,
 * sem recarregar a página nem perder o formulário preenchido.
 */
export function ProjectionRefresher({ ativo }: { ativo: boolean }) {
  const router = useRouter();

  useEffect(() => {
    if (!ativo) return;
    const id = setInterval(() => router.refresh(), INTERVALO_MS);
    return () => clearInterval(id);
  }, [ativo, router]);

  return null;
}
