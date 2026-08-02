'use client';

import { useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import {
  BufferGeometry,
  CanvasTexture,
  Float32BufferAttribute,
  Group,
  MathUtils,
  Quaternion,
  Vector3,
} from 'three';
import { bodyDims, buildTorsoGeometry, bodyRings, type BodySex } from '@/lib/body-profile';
import { BODY_VIEW_H } from '@/lib/body-profile';

/**
 * Manequim corporal 3D (Modo Apresentação — o "momento CarePod"): estátua de
 * alfaiate PARAMÉTRICA, girando devagar sob luz de estúdio com rim dourado.
 * Deliberadamente ABSTRATO (manequim, não humano realista): a referência
 * premium abstrai o corpo (Superpower) e o realismo aqui só compraria uncanny
 * valley. A morfologia vem da MESMA matemática da silhueta 2D
 * (lib/body-profile) — o slider morfa as duas representações igual.
 *
 * A meta (quando existe) é um ANEL verde na cintura, concêntrico ao anel
 * dourado da cintura atual — "onde você está vs onde vamos chegar" (a casca
 * de corpo inteiro foi tentada e abandonada: a meta menor ficava ocluída
 * DENTRO da estátua).
 *
 * Sem interação de câmera (palco, não brinquedo). `animate=false`
 * (prefers-reduced-motion / fora do viewport) desliga o giro e renderiza sob
 * demanda. Nunca importar fora de next/dynamic — three só entra no chunk da
 * Apresentação.
 */

const CENTER_Y = 215;
/** Achatamento dos ANÉIS decorativos (o tronco agora modela a própria
    profundidade por seção — frente ≠ costas; anel elíptico só acompanha). */
const DEPTH_SCALE = 0.78;

/** Corpo completo (cabeça + tronco esculpido + membros) num material só. */
function Mannequin({ imc, sex, color }: { imc: number; sex: BodySex; color: string }) {
  const d = bodyDims(imc, sex);

  // Tronco por seções ASSIMÉTRICAS (peitoral/busto, costas, barriga, glúteo,
  // lordose) — dados puros da lib; normais computadas aqui. Geometria criada
  // manualmente ⇒ dispose manual quando imc/sex trocam (slider/toggle).
  const torsoGeo = useMemo(() => {
    const { positions, indices } = buildTorsoGeometry(imc, sex);
    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(positions, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
  }, [imc, sex]);
  useEffect(() => () => torsoGeo.dispose(), [torsoGeo]);

  const armXTop = d.shoulder + d.armW * 0.4;
  const armXBottom = d.shoulder + 14 + 6 * d.t;
  const Y = (ySvg: number) => BODY_VIEW_H - ySvg;

  const material = <meshStandardMaterial color={color} roughness={0.38} metalness={0.18} />;

  const limbs: { from: [number, number, number]; to: [number, number, number]; r: number }[] = [
    // braços (úmero + antebraço) — mesmos traços do SVG
    { from: [-armXTop, Y(104), 0], to: [-armXBottom, Y(176), 0], r: d.armW },
    { from: [-armXBottom, Y(172), 0], to: [-armXBottom - 3, Y(244), 0], r: d.armW * 0.8 },
    { from: [armXTop, Y(104), 0], to: [armXBottom, Y(176), 0], r: d.armW },
    { from: [armXBottom, Y(172), 0], to: [armXBottom + 3, Y(244), 0], r: d.armW * 0.8 },
    // pernas (coxa + panturrilha)
    { from: [-d.hip / 2 - 4, Y(240), 0], to: [-19, Y(324), 0], r: d.thighW },
    { from: [-19, Y(318), 0], to: [-17, Y(402), 0], r: d.calfW },
    { from: [d.hip / 2 + 4, Y(240), 0], to: [19, Y(324), 0], r: d.thighW },
    { from: [19, Y(318), 0], to: [17, Y(402), 0], r: d.calfW },
  ];

  return (
    <group>
      {/* tronco esculpido — a profundidade já vem por seção, sem scale */}
      <mesh geometry={torsoGeo}>{material}</mesh>
      <mesh position={[0, Y(40), 0]}>
        <sphereGeometry args={[24, 28, 20]} />
        {material}
      </mesh>
      <mesh position={[0, Y(68), 0]}>
        <cylinderGeometry args={[9, 10.5, 20, 16]} />
        {material}
      </mesh>
      <group>
        {limbs.map((l, i) => (
          <group key={i}>
            {/* Limb compartilha o material via clone estrutural: cada mesh
                declara o próprio material — mantido simples e declarativo */}
            <mesh
              position={new Vector3(...l.from).add(new Vector3(...l.to)).multiplyScalar(0.5)}
              quaternion={new Quaternion().setFromUnitVectors(
                new Vector3(0, 1, 0),
                new Vector3(...l.to).sub(new Vector3(...l.from)).normalize(),
              )}
            >
              <capsuleGeometry
                args={[
                  l.r,
                  Math.max(
                    1,
                    new Vector3(...l.to).distanceTo(new Vector3(...l.from)) - l.r * 0.8,
                  ),
                  6,
                  14,
                ]}
              />
              {material}
            </mesh>
          </group>
        ))}
      </group>
    </group>
  );
}

/** Anéis de escaneamento (tórax/cintura/quadril) — vocabulário FUI, dourado. */
function ScanRings({ imc, sex, gold }: { imc: number; sex: BodySex; gold: string }) {
  const rings = bodyRings(imc, sex);
  return (
    <group>
      {rings.map((r) => (
        <mesh key={r.label} position={[0, r.y, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[1, DEPTH_SCALE, 1]}>
          <torusGeometry args={[r.radius + 11, 1.8, 8, 64]} />
          <meshBasicMaterial color={gold} transparent opacity={0.9} />
        </mesh>
      ))}
    </group>
  );
}

/**
 * A META como anel VERDE na cintura — concêntrico ao anel dourado da cintura
 * atual: "onde você está (ouro) vs onde vamos chegar (verde)", sem a oclusão
 * que uma casca-corpo inteira sofria (a meta menor ficava DENTRO da estátua).
 * Cintura porque é O marcador clínico (circunferência abdominal).
 */
function MetaRing({ metaImc, sex }: { metaImc: number; sex: BodySex }) {
  const waist = bodyRings(metaImc, sex)[1]!;
  return (
    <mesh position={[0, waist.y, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[1, DEPTH_SCALE, 1]}>
      <torusGeometry args={[waist.radius + 11, 1.3, 8, 64]} />
      {/* verde PROFUNDO (#059669), como o traço da meta no SVG: o #10b981
          claro reprova contraste não-textual sobre o marfim dos temas claros
          nas laterais em que o anel ultrapassa a estátua */}
      <meshBasicMaterial color="#059669" transparent opacity={0.9} depthTest={false} />
    </mesh>
  );
}

/** Sombra de contato fake: gradiente radial num plano — barata e suficiente. */
function GroundShadow({ imc }: { imc: number }) {
  const texture = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 128;
    const ctx = c.getContext('2d')!;
    const grad = ctx.createRadialGradient(64, 64, 8, 64, 64, 64);
    grad.addColorStop(0, 'rgba(0,0,0,0.34)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 128);
    return new CanvasTexture(c);
  }, []);
  const { t } = bodyDims(imc);
  return (
    <mesh position={[0, 16, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[150 + 34 * t, 110 + 24 * t]} />
      <meshBasicMaterial map={texture} transparent depthWrite={false} />
    </mesh>
  );
}

/**
 * Giro do palco: automático lento (24s/volta) enquanto `spin`, SOMADO ao
 * ângulo manual do médico (arrasto/teclado, controlado pelo Stage). O manual
 * chega como número simples — cada mudança re-renderiza e, em frameloop
 * demand, o próprio re-render agenda o frame (sem invalidate explícito).
 */
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
  const autoAngle = useRef(MathUtils.degToRad(-14)); // partida mostrando volume
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

export function BodyFigure3D({
  imc,
  sex = 'neutro',
  metaImc,
  bodyColor,
  goldColor,
  animate,
  manualAngle = 0,
  onReady,
  onContextLost,
}: {
  imc: number;
  /** Corpo do manequim — opção do médico no palco (default preserva o neutro). */
  sex?: BodySex;
  /** IMC da meta — vira o anel verde na cintura do manequim. */
  metaImc?: number;
  /** Cor da estátua (tinta do tema, lida dos tokens pelo Stage). */
  bodyColor: string;
  /** Dourado do tema para os anéis de escaneamento. */
  goldColor: string;
  /** false sob prefers-reduced-motion ou fora do viewport: sem giro, demand. */
  animate: boolean;
  /** Ângulo manual (rad) somado ao giro — o arrasto/teclado do médico. */
  manualAngle?: number;
  /** Renderer pronto — o Stage solta o SVG que segurava o palco. */
  onReady?: () => void;
  /** Contexto WebGL perdido (TDR/projetor) — o Stage degrada para o SVG. */
  onContextLost?: () => void;
}) {
  return (
    <Canvas
      dpr={[1, 2]}
      frameloop={animate ? 'always' : 'demand'}
      gl={{ alpha: true, antialias: true }}
      // frustum calculado para caber o corpo INTEIRO (0..430 + margem): meia
      // altura tan(17°)·~730 ≈ 223 — cabeça (414) e sombra (16) dentro do quadro
      camera={{ position: [0, 250, 730], fov: 34, near: 10, far: 2000 }}
      onCreated={({ camera, gl }) => {
        camera.lookAt(0, CENTER_Y, 0);
        gl.domElement.addEventListener('webglcontextlost', () => onContextLost?.());
        onReady?.();
      }}
    >
      {/* estúdio: luz ambiente + key fria suave + RIM DOURADO por trás — o
          mesmo "light catcher" dos cards, agora como luz de verdade */}
      <ambientLight intensity={0.55} />
      <directionalLight position={[220, 420, 340]} intensity={1.15} />
      <directionalLight position={[-260, 320, -380]} color={goldColor} intensity={2.4} />
      <Turntable spin={animate} manualAngle={manualAngle}>
        <Mannequin imc={imc} sex={sex} color={bodyColor} />
        {metaImc !== undefined && <MetaRing metaImc={metaImc} sex={sex} />}
        <ScanRings imc={imc} sex={sex} gold={goldColor} />
        <GroundShadow imc={imc} />
      </Turntable>
    </Canvas>
  );
}
