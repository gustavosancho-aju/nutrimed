'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * O parecer final do board roda em background (fire-and-forget) no
 * encerramento da consulta — leva dezenas de segundos (3 chamadas de LLM).
 * Enquanto `final_review_status` estiver 'pending', re-renderiza a página
 * (server component) a cada poll até sair de pending — sem API/estado
 * próprio, o servidor já é a fonte de verdade.
 */
export function FinalReviewPoller() {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(timer);
  }, [router]);
  return null;
}
