import { describe, it, expect } from 'vitest';
import type { PersonaId, ContributionSeverity } from '@nutrimed/providers';
import { TriggerDetector, PAULO_TRIGGERS, YARA_TRIGGERS } from './triggers';
import {
  scoreMatch,
  RelevanceGate,
  DoctorRateLimiter,
  PriorityQueue,
  Deduplicator,
  PauseGate,
  BoardGatekeeper,
  type Candidate,
} from './gate';

function candidate(over: Partial<Candidate> = {}): Candidate {
  return {
    id: over.id ?? 'c1',
    personaId: over.personaId ?? 'paulo',
    personaIds: over.personaIds ?? [over.personaId ?? 'paulo'],
    triggerId: over.triggerId ?? 'paulo-cv-farmacos',
    topicKey: over.topicKey ?? 'cv-farmacos',
    type: over.type ?? 'atencao',
    severity: over.severity ?? 'normal',
    score: over.score ?? 0.8,
    segmentText: over.segmentText ?? 'texto',
    at: over.at ?? 0,
  };
}

describe('Story 4.1 — TriggerDetector (FR3/FR4/FR5, sem LLM)', () => {
  const detector = new TriggerDetector();

  it('FR4: fármacos CV e sintomas CV disparam Paulo como crítico', () => {
    for (const text of [
      'vou prescrever sibutramina',
      'iniciar GLP-1 semanal',
      'paciente com anfepramona',
      'usa termogênico na academia',
      'refere palpitações',
      'dor torácica ao esforço',
      'sente falta de ar',
      'tem pressão alta',
    ]) {
      const matches = detector.detect(text, 0).filter((m) => m.trigger.personaId === 'paulo');
      expect(matches.length, text).toBeGreaterThan(0);
      expect(matches[0]!.trigger.severityHint).toBe('critical');
    }
  });

  it('FR4: dor precordial (incl. corrupção do STT) e dor aos esforços disparam Paulo', () => {
    // regressão da consulta cbb25091 (2026-07-04): STT gerou "dor primordial"
    for (const text of [
      'dor precordial há duas semanas',
      'você tem dor primordial quando faz exercício físico',
      'sente aperto no peito subindo escada',
      'precordialgia atípica',
      'sinto dores quando faço caminhada mais agressiva',
    ]) {
      const matches = detector.detect(text, 0).filter((m) => m.trigger.personaId === 'paulo');
      expect(matches.length, text).toBeGreaterThan(0);
      expect(matches[0]!.trigger.severityHint).toBe('critical');
    }
  });

  it('FR5: sinais tireoidianos e platô disparam Yara como hipótese', () => {
    const tireoide = detector.detect('muito cansaço, queda de cabelo e sente frio', 0);
    expect(tireoide.some((m) => m.trigger.id === 'yara-tireoide')).toBe(true);
    const plato = detector.detect('o peso estagnou, platô há 2 meses', 0);
    expect(plato.some((m) => m.trigger.id === 'yara-plato-metabolico')).toBe(true);
    expect(plato.find((m) => m.trigger.id === 'yara-plato-metabolico')!.trigger.typeHint).toBe('hipotese');
  });

  it('texto neutro não dispara nada', () => {
    expect(detector.detect('Bom dia, como passou a semana?', 0)).toHaveLength(0);
  });

  it('um segmento pode disparar várias personas (insumo da consolidação 4.4)', () => {
    const matches = detector.detect('paciente em GLP-1 com platô no peso', 0);
    const personas = new Set(matches.map((m) => m.trigger.personaId));
    expect(personas.has('paulo')).toBe(true);
    expect(personas.has('yara')).toBe(true);
  });
});

describe('Story 4.2 — Scorer + RelevanceGate (NFR1)', () => {
  it('score combina peso do gatilho e densidade; limitado a [0,1]', () => {
    const detector = new TriggerDetector(PAULO_TRIGGERS);
    const curto = detector.detect('prescrever sibutramina', 0)[0]!;
    const longo = detector.detect(
      'então assim, conversamos bastante sobre várias coisas da rotina e em algum momento foi mencionada a sibutramina entre muitos outros assuntos da vida da paciente',
      0,
    )[0]!;
    expect(scoreMatch(curto)).toBeGreaterThan(scoreMatch(longo));
    expect(scoreMatch(curto)).toBeLessThanOrEqual(1);
  });

  it('gate respeita limiar configurável; crítico tem limiar menor', () => {
    const gate = new RelevanceGate({ threshold: 0.6, criticalThreshold: 0.3 });
    expect(gate.passes(0.59, 'normal')).toBe(false);
    expect(gate.passes(0.6, 'normal')).toBe(true);
    expect(gate.passes(0.35, 'critical')).toBe(true); // recall p/ críticos
    expect(gate.passes(0.2, 'critical')).toBe(false);
  });
});

describe('Story 4.3 — Rate-limit por doutor + fila (NFR2)', () => {
  it('teto por doutor respeitado na janela; outro doutor tem cota própria', () => {
    const limiter = new DoctorRateLimiter({ maxPerMinutePerDoctor: 2, windowMs: 60_000 });
    expect(limiter.allow('paulo', 'normal', 0)).toBe(true);
    expect(limiter.allow('paulo', 'normal', 1000)).toBe(true);
    expect(limiter.allow('paulo', 'normal', 2000)).toBe(false); // estourou
    expect(limiter.allow('yara', 'normal', 2000)).toBe(true); // cota própria
    expect(limiter.allow('paulo', 'normal', 61_001)).toBe(true); // janela girou
  });

  it('crítico fura a fila e NÃO consome cota', () => {
    const limiter = new DoctorRateLimiter({ maxPerMinutePerDoctor: 1 });
    expect(limiter.allow('paulo', 'critical', 0)).toBe(true);
    expect(limiter.allow('paulo', 'critical', 1)).toBe(true);
    expect(limiter.allow('paulo', 'normal', 2)).toBe(true); // cota intacta
  });

  it('fila ordena por severidade > score > chegada e descarta redundância', () => {
    const queue = new PriorityQueue();
    queue.enqueue(candidate({ id: 'a', topicKey: 't1', score: 0.7, at: 1 }));
    queue.enqueue(candidate({ id: 'b', topicKey: 't2', score: 0.9, at: 2 }));
    queue.enqueue(candidate({ id: 'c', topicKey: 't3', severity: 'critical', score: 0.4, at: 3 }));
    queue.enqueue(candidate({ id: 'dup', topicKey: 't1', score: 0.99, at: 4 })); // redundante
    expect(queue.size).toBe(3);
    expect(queue.dequeue()!.id).toBe('c'); // crítico primeiro
    expect(queue.dequeue()!.id).toBe('b'); // maior score
    expect(queue.dequeue()!.id).toBe('a');
  });
});

describe('Story 4.4 — Deduplicação / consolidação (FR11)', () => {
  it('2 personas no mesmo tópico na janela → 1 consolidado com ambas', () => {
    const dedup = new Deduplicator({ windowMs: 60_000 });
    expect(dedup.submit(candidate({ personaId: 'paulo', personaIds: ['paulo'], topicKey: 'glp1', at: 0 })).kind).toBe('fresh');
    const result = dedup.submit(candidate({ personaId: 'yara', personaIds: ['yara'], topicKey: 'glp1', at: 5000 }));
    expect(result.kind).toBe('consolidated');
    if (result.kind === 'consolidated') {
      expect(result.candidate.personaIds).toEqual(['paulo', 'yara']);
    }
  });

  it('mesma persona repetindo o tópico na janela → descartada', () => {
    const dedup = new Deduplicator();
    dedup.submit(candidate({ personaId: 'paulo', topicKey: 'glp1', at: 0 }));
    expect(dedup.submit(candidate({ personaId: 'paulo', topicKey: 'glp1', at: 5000 })).kind).toBe('duplicate');
  });

  it('tópicos distintos ou fora da janela não consolidam', () => {
    const dedup = new Deduplicator({ windowMs: 1000 });
    dedup.submit(candidate({ topicKey: 'glp1', at: 0 }));
    expect(dedup.submit(candidate({ personaId: 'yara', topicKey: 'tireoide', at: 100 })).kind).toBe('fresh');
    expect(dedup.submit(candidate({ personaId: 'yara', topicKey: 'glp1', at: 5000 })).kind).toBe('fresh');
  });

  it('consolidação herda a maior severidade (crítico vence)', () => {
    const dedup = new Deduplicator();
    dedup.submit(candidate({ personaId: 'paulo', severity: 'critical', topicKey: 'glp1', at: 0 }));
    const result = dedup.submit(candidate({ personaId: 'yara', severity: 'normal', topicKey: 'glp1', at: 1 }));
    if (result.kind === 'consolidated') expect(result.candidate.severity).toBe('critical');
    else expect.fail('esperava consolidação');
  });
});

describe('Story 4.5 — PauseGate (FR12 / A4)', () => {
  it('não-crítico é retido durante a fala e liberado na pausa ≥2,5s', () => {
    const gate = new PauseGate({ pauseMs: 2500 });
    gate.onSpeech(1000);
    expect(gate.submit(candidate({ severity: 'normal' }), 2000)).toBeNull(); // falando
    expect(gate.heldCount).toBe(1);
    expect(gate.flushIfPaused(3000)).toHaveLength(0); // só 2s de silêncio
    const released = gate.flushIfPaused(3501); // 2,5s+
    expect(released).toHaveLength(1);
  });

  it('crítico entrega imediatamente mesmo durante a fala', () => {
    const gate = new PauseGate();
    gate.onSpeech(1000);
    const out = gate.submit(candidate({ severity: 'critical' }), 1100);
    expect(out).not.toBeNull();
  });

  it('flush libera em ordem de prioridade', () => {
    const gate = new PauseGate({ pauseMs: 100 });
    gate.onSpeech(0);
    gate.submit(candidate({ id: 'low', score: 0.6, at: 1 }), 10);
    gate.submit(candidate({ id: 'high', score: 0.9, at: 2 }), 20);
    const released = gate.flushIfPaused(200);
    expect(released.map((c) => c.id)).toEqual(['high', 'low']);
  });
});

describe('BoardGatekeeper — pipeline composto (E4)', () => {
  function gk() {
    return new BoardGatekeeper({
      threshold: 0.6,
      criticalThreshold: 0.3,
      maxPerMinutePerDoctor: 1,
      pauseMs: 2500,
    });
  }

  it('crítico forte em pausa → deliver direto', () => {
    const gate = gk();
    const decision = gate.submit(candidate({ severity: 'critical', score: 0.9 }), 10_000);
    expect(decision.kind).toBe('deliver');
  });

  it('score baixo → rejected-score (LLM nunca roda — T2)', () => {
    expect(gk().submit(candidate({ score: 0.2 }), 10_000).kind).toBe('rejected-score');
  });

  it('não-crítico durante a fala → held; pausa → release entrega', () => {
    const gate = gk();
    gate.pauseGate.onSpeech(10_000);
    expect(gate.submit(candidate({ score: 0.8 }), 10_500).kind).toBe('held-for-pause');
    expect(gate.release(11_000)).toHaveLength(0); // ainda falando
    const released = gate.release(13_000); // pausa de 2,5s+
    expect(released).toHaveLength(1);
  });

  it('estouro do teto → rate-limited + fila; janela girando, release drena', () => {
    const gate = gk();
    expect(gate.submit(candidate({ id: 'a', topicKey: 't1', score: 0.8, at: 0 }), 10_000).kind).toBe('deliver');
    expect(gate.submit(candidate({ id: 'b', topicKey: 't2', score: 0.8, at: 1 }), 10_500).kind).toBe('rate-limited');
    expect(gate.release(80_000).map((c) => c.id)).toEqual(['b']); // janela girou
  });

  it('consolidação flui pelo pipeline (FR11 fim-a-fim)', () => {
    const gate = gk();
    expect(gate.submit(candidate({ personaId: 'paulo', personaIds: ['paulo'], topicKey: 'glp1', score: 0.8, severity: 'critical' }), 10_000).kind).toBe('deliver');
    const second = gate.submit(
      candidate({ id: 'c2', personaId: 'yara', personaIds: ['yara'], topicKey: 'glp1', score: 0.7, severity: 'critical', at: 1000 }),
      11_000,
    );
    expect(second.kind).toBe('deliver');
    if (second.kind === 'deliver') expect(second.candidate.personaIds).toEqual(['paulo', 'yara']);
  });
});

// sanity: catálogos cobrem as 3 personas
describe('Catálogos', () => {
  it('Paulo e Yara têm gatilhos FR4/FR5; severidades coerentes', () => {
    const personas = (defs: ReadonlyArray<{ personaId: PersonaId; severityHint: ContributionSeverity }>) =>
      new Set(defs.map((d) => d.personaId));
    expect(personas(PAULO_TRIGGERS)).toEqual(new Set(['paulo']));
    expect(personas(YARA_TRIGGERS)).toEqual(new Set(['yara']));
    expect(PAULO_TRIGGERS.filter((t) => t.severityHint === 'critical').length).toBeGreaterThanOrEqual(2);
  });
});
