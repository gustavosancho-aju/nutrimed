'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import {
  BufferGeometry,
  CanvasTexture,
  Float32BufferAttribute,
  Group,
  MathUtils,
  Uint32BufferAttribute,
} from 'three';
import type { BodySex } from '@/lib/body-profile';
import {
  applyMorphs,
  loadBodyMesh,
  morphWeights,
  type BodyMeshData,
} from '@/lib/body-mesh';

/**
 * Corpo humano 3D do Modo Apresentação (o "momento CarePod").
 *
 * O mesh é escultura de artista do MakeHuman (CC0, set/2020) compilada em
 * `public/models/body.bin`; a deformação por IMC usa os targets de
 * circunferência do próprio MakeHuman (cintura, quadril, coxa, braço, busto)
 * combinados na proporção clínica da adiposidade — ver
 * `scripts/build-body-mesh.mjs`. Substituiu o manequim procedural de
 * primitivas, que nunca passaria de "boneco".
 *
 * Sem interação de câmera (palco, não brinquedo) — a rotação é do médico, via
 * arrasto/teclado no Stage. `animate=false` (reduced-motion / fora do
 * viewport) desliga o giro e renderiza sob demanda. Nunca importar fora de
 * next/dynamic — three + mesh só entram no chunk da Apresentação.
 */

/** Altura do corpo no espaço do palco (o build normaliza para isto). */
const BODY_H = 430;
const CENTER_Y = 215;

/** Níveis anatômicos em fração da altura (medidos no mesh do MakeHuman). */
const LEVELS = { chest: 0.72, waist: 0.62, hip: 0.52 } as const;

/**
 * Meia-largura (X) do TRONCO num nível — abraça o mesh real.
 *
 * O corpo está em A-pose: no tórax e na cintura os braços aparecem na mesma
 * faixa de Y, e o simples máximo devolveria a distância até o braço (anel
 * gigante atravessando a figura). Como existe um VÃO entre tronco e braço,
 * ordena-se |x| e corta-se no primeiro salto relevante — o que sobra é o
 * tronco.
 */
function radiusAt(positions: Float32Array, frac: number): number {
  const y = frac * BODY_H;
  const band = BODY_H * 0.012;
  const xs: number[] = [];
  for (let i = 0; i < positions.length; i += 3) {
    if (Math.abs(positions[i + 1]! - y) > band) continue;
    xs.push(Math.abs(positions[i]!));
  }
  if (xs.length === 0) return 30;
  // Percentil (não o máximo): o corpo está em A-pose e, no tórax/cintura, os
  // braços ocupam a mesma faixa de Y — o máximo devolveria a distância até a
  // mão e o anel viraria um bambolê. O tronco domina a contagem de vértices,
  // então o p80 cai na borda dele.
  xs.sort((a, b) => a - b);
  return xs[Math.floor(xs.length * 0.8)]!;
}

/** Corpo deformado para o IMC/sexo atuais. */
function Body({
  mesh,
  imc,
  sex,
  color,
  onHipRadius,
}: {
  mesh: BodyMeshData;
  imc: number;
  sex: BodySex;
  color: string;
  /**
   * Meia-largura do quadril já MEDIDA (número, não o buffer): reportar o
   * Float32Array reusado não mudava a identidade, o setState do pai virava
   * no-op e a sombra congelava no primeiro peso — além de forçar um novo
   * varrimento dos 13k vértices a cada render do pai.
   */
  onHipRadius: (r: number) => void;
}) {
  const invalidate = useThree((s) => s.invalidate);

  const geometry = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(new Float32Array(mesh.positions.length), 3));
    g.setIndex(new Uint32BufferAttribute(mesh.indices, 1));
    return g;
  }, [mesh]);
  useEffect(() => () => geometry.dispose(), [geometry]);

  // Deformação: reusa o buffer do atributo (sem alocar a cada movimento do
  // slider) e recomputa as normais para a luz acompanhar a nova superfície.
  // `invalidate()` é obrigatório: a escrita acontece DEPOIS do frame, e com o
  // giro pausado (frameloop 'demand') nada agendaria o próximo — o corpo
  // ficava congelado no peso anterior.
  useEffect(() => {
    const attr = geometry.getAttribute('position') as Float32BufferAttribute;
    const arr = attr.array as Float32Array;
    applyMorphs(mesh, morphWeights(imc, sex), arr);
    attr.needsUpdate = true;
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    onHipRadius(radiusAt(arr, LEVELS.hip));
    invalidate();
  }, [geometry, mesh, imc, sex, onHipRadius, invalidate]);

  return (
    <mesh geometry={geometry} position={[0, 0, 0]}>
      {/* mármore, não plástico: roughness alta e zero metalness */}
      <meshStandardMaterial color={color} roughness={0.72} metalness={0} />
    </mesh>
  );
}

/*
 * Os 3 anéis dourados de "escaneamento" (tórax/cintura/quadril) foram
 * REMOVIDOS quando o boneco procedural deu lugar ao corpo humano real: sobre
 * uma figura abstrata eles davam vocabulário de scan; sobre um corpo eles
 * atravessam a anatomia como bambolês e roubam a leitura. O único anel que
 * sobrevive é o VERDE da meta — informação clínica, não decoração.
 */

/*
 * A meta também deixou de ser um ANEL. Com o corpo real, a comparação forte
 * não é um aro na cintura — é o PRÓPRIO CORPO na meta: o simulador ganhou o
 * botão "Ver na meta", que leva o peso (e a anatomia inteira) até o alvo.
 * Um anel a mais só atravessaria a figura.
 */

/** Sombra de contato: gradiente radial num plano — barata e suficiente. */
function GroundShadow({ scale }: { scale: number }) {
  const texture = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 128;
    const ctx = c.getContext('2d')!;
    const grad = ctx.createRadialGradient(64, 64, 8, 64, 64, 64);
    grad.addColorStop(0, 'rgba(0,0,0,0.4)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 128);
    return new CanvasTexture(c);
  }, []);
  useEffect(() => () => texture.dispose(), [texture]);
  return (
    <mesh position={[0, 1, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[130 * scale, 95 * scale]} />
      <meshBasicMaterial map={texture} transparent depthWrite={false} />
    </mesh>
  );
}

/** Giro automático (24s/volta) somado ao ângulo manual do médico. */
function Turntable({
  spin,
  manualAngle,
  children,
}: {
  spin: boolean;
  manualAngle: number;
  children: React.ReactNode;
}) {
  const ref = useRef<Group>(null);
  const autoAngle = useRef(MathUtils.degToRad(-16));
  useFrame((_, delta) => {
    if (spin) autoAngle.current += delta * (Math.PI / 12);
    if (ref.current) ref.current.rotation.y = autoAngle.current + manualAngle;
  });
  return (
    <group ref={ref} rotation={[0, autoAngle.current + manualAngle, 0]}>
      {children}
    </group>
  );
}

/** Cena: carrega o corpo e monta o palco. */
function Stage({
  imc,
  sex,
  bodyColor,
  animate,
  manualAngle,
  onReady,
}: {
  imc: number;
  sex: BodySex;
  bodyColor: string;
  animate: boolean;
  manualAngle: number;
  onReady?: () => void;
}) {
  const [mesh, setMesh] = useState<BodyMeshData | null>(null);
  const [hipRadius, setHipRadius] = useState<number | null>(null);

  useEffect(() => {
    let vivo = true;
    loadBodyMesh()
      .then((m) => {
        if (vivo) setMesh(m);
      })
      .catch((e) => console.error('[corpo 3D] falha ao carregar o mesh:', e));
    return () => {
      vivo = false;
    };
  }, []);

  // "pronto" só quando o corpo está na tela — até lá o Stage segura o SVG
  useEffect(() => {
    if (hipRadius !== null) onReady?.();
  }, [hipRadius, onReady]);

  if (!mesh) return null;

  return (
    <Turntable spin={animate} manualAngle={manualAngle}>
      <Body mesh={mesh} imc={imc} sex={sex} color={bodyColor} onHipRadius={setHipRadius} />
      <GroundShadow scale={(hipRadius ?? 30) / 30} />
    </Turntable>
  );
}

export function BodyFigure3D({
  imc,
  sex = 'neutro',
  bodyColor,
  goldColor,
  animate,
  manualAngle = 0,
  onReady,
  onContextLost,
}: {
  imc: number;
  /** Corpo do manequim — opção do médico no palco. */
  sex?: BodySex;
  /** Cor do corpo (tinta do tema, lida dos tokens pelo Stage do app). */
  bodyColor: string;
  /** Dourado do tema para os anéis de escaneamento. */
  goldColor: string;
  /** false sob prefers-reduced-motion ou fora do viewport: sem giro, demand. */
  animate: boolean;
  /** Ângulo manual (rad) somado ao giro — o arrasto/teclado do médico. */
  manualAngle?: number;
  /** Corpo visível — o Stage solta o SVG que segurava o palco. */
  onReady?: () => void;
  /** Contexto WebGL perdido (TDR/projetor) — o Stage degrada para o SVG. */
  onContextLost?: () => void;
}) {
  return (
    <Canvas
      dpr={[1, 2]}
      frameloop={animate ? 'always' : 'demand'}
      gl={{ alpha: true, antialias: true }}
      // frustum que cabe o corpo inteiro (0..430) com folga
      camera={{ position: [0, 250, 720], fov: 34, near: 10, far: 2000 }}
      onCreated={({ camera, gl }) => {
        camera.lookAt(0, CENTER_Y, 0);
        gl.domElement.addEventListener('webglcontextlost', () => onContextLost?.());
      }}
    >
      {/* estúdio: ambiente + key frontal + RIM DOURADO por trás (o mesmo
          "light catcher" dos cards, agora como luz de verdade) */}
      <ambientLight intensity={0.6} />
      <directionalLight position={[180, 380, 420]} intensity={1.25} />
      <directionalLight position={[-260, 300, -360]} color={goldColor} intensity={2.6} />
      <Stage
        imc={imc}
        sex={sex}
        bodyColor={bodyColor}
        animate={animate}
        manualAngle={manualAngle}
        onReady={onReady}
      />
    </Canvas>
  );
}
