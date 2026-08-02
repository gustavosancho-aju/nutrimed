'use client';

import { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { classifyImc } from '@/lib/dashboard';
import { IMC_TONE_HEX } from '@/lib/imc-colors';
import { BodyFigure } from './body-figure';

/**
 * Palco da figura corporal: decide entre o manequim 3D (WebGL2) e a silhueta
 * SVG. O 3D é realce progressivo — a silhueta é a linha de base em TODO
 * cenário sem 3D pronto: SSR, sem JS, sem WebGL2, chunk do three ainda
 * baixando (o SVG segura o palco até o primeiro frame) e perda de contexto no
 * meio da consulta (TDR/projetor ⇒ degrada de volta ao SVG). three.js só entra
 * no bundle da Apresentação, e só quando o navegador prova que consegue usá-lo.
 */

const BodyFigure3D = dynamic(
  () => import('./body-figure-3d').then((m) => m.BodyFigure3D),
  // o "loading" real é o SVG mantido montado por baixo até o onReady (render)
  { ssr: false, loading: () => null },
);

/** Lê um token HSL cru ("43 40% 93%") do tema e devolve cor CSS utilizável. */
function readToken(name: string, fallback: string): string {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return raw ? `hsl(${raw})` : fallback;
}

export function BodyFigureStage({
  imc,
  ghostImc,
  className = '',
}: {
  imc: number;
  /** IMC da meta — contorno tracejado no SVG, anel de cintura no manequim 3D. */
  ghostImc?: number;
  /** Dimensões do palco (aplicadas ao container das DUAS representações). */
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [webgl, setWebgl] = useState(false);
  /** true a partir do 1º frame do 3D — até lá o SVG segura o palco. */
  const [ready, setReady] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [visible, setVisible] = useState(true);
  const [colors, setColors] = useState<{ body: string; gold: string } | null>(null);

  useEffect(() => {
    try {
      // three >= r163 é WebGL2-ONLY: aceitar 'webgl' (1) aqui montaria o Canvas
      // e o renderer lançaria — palco vazio no exato ambiente que o fallback
      // SVG existe para cobrir. Sonda-se APENAS webgl2.
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl2');
      if (!gl) return;
      // libera o contexto do probe — sem isto cada visita deixa um contexto
      // GPU órfão até o GC ("Too many active WebGL contexts" no console)
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    } catch {
      return;
    }
    setWebgl(true);
    // Estátua na tinta do tema + anéis no dourado do tema — o 3D respeita os
    // 4 temas pelos MESMOS tokens do resto do app.
    setColors({
      body: readToken('--text', 'hsl(72 15% 10%)'),
      gold: readToken('--accent-gold', 'hsl(39 52% 48%)'),
    });
    // reduced-motion AO VIVO: ativar a preferência com a Apresentação aberta
    // para o giro na hora (não só no próximo mount).
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // A página da Apresentação é longa (evolução/exames abaixo): fora do
  // viewport o palco para de renderizar — rAF de canvas rolado para fora NÃO
  // é throttlado pelo navegador (só aba oculta é).
  useEffect(() => {
    if (!webgl || !containerRef.current) return;
    const io = new IntersectionObserver(([entry]) => {
      setVisible(entry?.isIntersecting ?? true);
    });
    io.observe(containerRef.current);
    return () => io.disconnect();
  }, [webgl]);

  if (!webgl || !colors) {
    return <BodyFigure imc={imc} ghostImc={ghostImc} showLandmarks className={className} />;
  }

  // Aura da categoria atrás do manequim — o mesmo vocabulário informativo da
  // silhueta (aura + chip + medidor; cor nunca sozinha).
  const aura = IMC_TONE_HEX[classifyImc(imc).tone];

  return (
    <div>
      <div
        ref={containerRef}
        role="img"
        aria-label={`Manequim corporal ilustrativo para IMC ${imc.toFixed(1)}${
          ghostImc !== undefined
            ? `; anel verde na cintura = circunferência na meta (IMC ${ghostImc.toFixed(1)})`
            : ''
        }`}
        className={`relative ${className}`}
        style={{
          background: `radial-gradient(48% 42% at 50% 46%, ${aura}2b, transparent 72%)`,
        }}
      >
        {/* rede lenta nunca vê palco vazio: a silhueta fica até o 1º frame 3D */}
        {!ready && (
          <BodyFigure
            imc={imc}
            ghostImc={ghostImc}
            className="absolute inset-0 h-full w-full"
          />
        )}
        <div className={ready ? 'h-full w-full' : 'invisible absolute inset-0'}>
          <BodyFigure3D
            imc={imc}
            metaImc={ghostImc}
            bodyColor={colors.body}
            goldColor={colors.gold}
            animate={visible && !reduced}
            onReady={() => setReady(true)}
            onContextLost={() => setWebgl(false)}
          />
        </div>
      </div>
      {/* os rótulos anatômicos que o SVG dá de graça (showLandmarks) o 3D
          entrega como microlegenda — anel sem nome não informa */}
      {ready && (
        <p className="mt-1.5 text-center text-[10px] text-ink-muted">
          Anéis dourados: tórax · cintura · quadril
        </p>
      )}
    </div>
  );
}
