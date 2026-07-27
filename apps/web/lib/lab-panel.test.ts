import { describe, it, expect } from 'vitest';
import type { LabExamValues, Measurement } from '@nutrimed/patients';
import {
  buildAnalyteSeries,
  existingHistoryKeys,
  groupByCategory,
  historyKey,
  planHistoryImport,
  rangeLabel,
  resolveSlugCollisions,
  selectPresented,
  toStoredAnalyte,
} from './lab-panel';

/** Medição de laboratório com data ISO curta (o resto do shape é irrelevante aqui). */
function m(iso: string, values: LabExamValues, ordem = 0): Measurement<LabExamValues> {
  return {
    id: `${iso}-${ordem}`,
    patientId: 'p1',
    measuredAt: new Date(`${iso}T00:00:00Z`),
    sourceConsultationId: null,
    values,
    createdAt: new Date(`${iso}T00:00:0${ordem}Z`),
  };
}

describe('buildAnalyteSeries — três gerações de dado na mesma série', () => {
  it('une campo LEGADO e painel novo do MESMO exame numa linha só', () => {
    // O ponto central do E14: sem isso o LDL digitado à mão e o LDL importado
    // do PDF virariam duas linhas separadas e a evolução se perderia.
    const series = buildAnalyteSeries([
      m('2025-10-22', { ldl: 143.1 }),
      m('2026-05-19', {
        panel: [{ slug: 'ldl', label: 'LDL', value: 108.5, unit: 'mg/dL', refMax: 130 }],
      }),
    ]);

    const ldl = series.find((s) => s.slug === 'ldl')!;
    expect(ldl.points.map((p) => p.value)).toEqual([143.1, 108.5]);
    expect(ldl.latest).toBe(108.5);
    expect(ldl.unit).toBe('mg/dL');
  });

  it('rotula slots personalizados pela definição atual e ignora slot sem nome', () => {
    const series = buildAnalyteSeries(
      [m('2026-01-10', { custom1: 31.5, custom2: 400 })],
      [{ slot: 1, name: 'Vitamina D', unit: 'ng/mL' }],
    );
    expect(series.map((s) => s.label)).toEqual(['Vitamina D']);
    expect(series[0]!.slug).toBe('custom1');
  });

  it('ordena pontos por data mesmo com medições fora de ordem', () => {
    const series = buildAnalyteSeries([
      m('2026-05-19', { panel: [{ slug: 'tsh', label: 'TSH', value: 1.58 }] }),
      m('2025-03-25', { panel: [{ slug: 'tsh', label: 'TSH', value: 1.4 }] }),
    ]);
    expect(series[0]!.points.map((p) => p.value)).toEqual([1.4, 1.58]);
    expect(series[0]!.latest).toBe(1.58);
  });

  it('rótulo e unidade seguem a medição MAIS RECENTE que os informou', () => {
    const series = buildAnalyteSeries([
      m('2025-01-01', { panel: [{ slug: 'tgp', label: 'TGP', value: 30, unit: 'U/L' }] }),
      m('2026-01-01', { panel: [{ slug: 'tgp', label: 'TGP / ALT', value: 39, unit: 'U/L' }] }),
    ]);
    expect(series[0]!.label).toBe('TGP / ALT');
  });

  it('status vem da faixa da medição mais recente', () => {
    const dentro = buildAnalyteSeries([
      m('2026-05-19', { panel: [{ slug: 'glicose', label: 'Glicose', value: 83, refMin: 60, refMax: 99 }] }),
    ])[0]!;
    expect(dentro.status).toBe('dentro');

    const fora = buildAnalyteSeries([
      m('2026-05-19', { panel: [{ slug: 'pcr', label: 'PCR', value: 7.38, refMax: 2 }] }),
    ])[0]!;
    expect(fora.status).toBe('fora');

    const sem = buildAnalyteSeries([
      m('2026-05-19', { panel: [{ slug: 'x', label: 'X', value: 1 }] }),
    ])[0]!;
    expect(sem.status).toBe('sem-referencia');
  });

  it('a faixa exibida é a do laudo MAIS RECENTE (referências mudam com o tempo)', () => {
    const s = buildAnalyteSeries([
      m('2025-01-01', { panel: [{ slug: 'tsh', label: 'TSH', value: 2, refMin: 0.45, refMax: 4.5 }] }),
      m('2026-01-01', { panel: [{ slug: 'tsh', label: 'TSH', value: 2, refMin: 0.4, refMax: 4.05 }] }),
    ])[0]!;
    expect(s.range).toEqual({ min: 0.4, max: 4.05 });
  });

  it('descarta valores não-finitos vindos do blob', () => {
    const series = buildAnalyteSeries([
      m('2026-05-19', {
        panel: [
          { slug: 'ok', label: 'Ok', value: 1 },
          { slug: 'nan', label: 'NaN', value: Number.NaN },
        ],
      }),
    ]);
    expect(series.map((s) => s.slug)).toEqual(['ok']);
  });

  it('sem medições ⇒ nenhuma série', () => {
    expect(buildAnalyteSeries([])).toEqual([]);
  });

  it('ordena por categoria clínica e depois por rótulo', () => {
    const series = buildAnalyteSeries([
      m('2026-05-19', {
        panel: [
          { slug: 'ferritina', label: 'Ferritina', value: 391 },
          { slug: 'glicose', label: 'Glicose', value: 83 },
          { slug: 'hdl', label: 'HDL', value: 37 },
        ],
      }),
    ]);
    // metabolico < lipidico < minerais na ordem clínica declarada
    expect(series.map((s) => s.slug)).toEqual(['glicose', 'hdl', 'ferritina']);
  });
});

describe('selectPresented — ordem escolhida pelo médico', () => {
  const series = buildAnalyteSeries([
    m('2026-05-19', {
      panel: [
        { slug: 'ldl', label: 'LDL', value: 108 },
        { slug: 'hdl', label: 'HDL', value: 37 },
        { slug: 'glicose', label: 'Glicose', value: 83 },
      ],
    }),
  ]);

  it('respeita a ordem da seleção, não a ordem interna', () => {
    expect(selectPresented(series, ['glicose', 'ldl']).map((s) => s.slug)).toEqual(['glicose', 'ldl']);
  });

  it('ignora slug selecionado que não tem mais dado (nunca card vazio)', () => {
    expect(selectPresented(series, ['ldl', 'exame-removido']).map((s) => s.slug)).toEqual(['ldl']);
  });

  it('seleção vazia ⇒ nada apresentado', () => {
    expect(selectPresented(series, [])).toEqual([]);
  });
});

describe('groupByCategory', () => {
  it('agrupa preservando a ordem clínica', () => {
    const grupos = groupByCategory(
      buildAnalyteSeries([
        m('2026-05-19', {
          panel: [
            { slug: 'ferritina', label: 'Ferritina', value: 391 },
            { slug: 'ldl', label: 'LDL', value: 108 },
            { slug: 'hdl', label: 'HDL', value: 37 },
          ],
        }),
      ]),
    );
    expect(grupos.map((g) => g.category)).toEqual(['lipidico', 'minerais']);
    expect(grupos[0]!.series.map((s) => s.slug)).toEqual(['hdl', 'ldl']);
  });
});

describe('planHistoryImport — resultados anteriores impressos no laudo', () => {
  const analytes = [
    {
      slug: 'ldl',
      label: 'LDL',
      unit: 'mg/dL',
      history: [
        { measuredAt: '2025-10-22', value: 143.1 },
        { measuredAt: '2025-03-25', value: 83.4 },
      ],
    },
    {
      slug: 'triglicerides',
      label: 'Triglicérides',
      unit: 'mg/dL',
      history: [{ measuredAt: '2025-10-22', value: 293 }],
    },
  ];

  it('agrupa por data, uma medição por data, mais antiga primeiro', () => {
    const p = planHistoryImport({ analytes, existing: new Set(), collectionDate: '2026-05-19' });
    expect(p.map((x) => x.measuredAt)).toEqual(['2025-03-25', '2025-10-22']);
    expect(p[1]!.analytes.map((a) => a.slug)).toEqual(['ldl', 'triglicerides']);
    expect(p[1]!.analytes[0]!.value).toBe(143.1);
  });

  it('NÃO replica a faixa de referência nos pontos antigos', () => {
    // O laudo imprime a referência vigente hoje — ela não valia em 2025.
    const p = planHistoryImport({ analytes, existing: new Set(), collectionDate: '2026-05-19' });
    for (const m of p) {
      for (const a of m.analytes) {
        expect(a.refMin).toBeUndefined();
        expect(a.refMax).toBeUndefined();
      }
    }
  });

  it('é idempotente: reimportar o mesmo laudo não duplica pontos', () => {
    const primeira = planHistoryImport({ analytes, existing: new Set(), collectionDate: '2026-05-19' });
    // Simula o que já ficou no banco depois da primeira importação.
    const jaExiste = new Set(
      primeira.flatMap((m) => m.analytes.map((a) => historyKey(m.measuredAt, a.slug))),
    );
    expect(planHistoryImport({ analytes, existing: jaExiste, collectionDate: '2026-05-19' })).toEqual([]);
  });

  it('pula ponto histórico na própria data da coleta (duplicaria o valor atual)', () => {
    const p = planHistoryImport({
      analytes: [{ slug: 'ldl', label: 'LDL', history: [{ measuredAt: '2026-05-19', value: 108 }] }],
      existing: new Set(),
      collectionDate: '2026-05-19',
    });
    expect(p).toEqual([]);
  });

  it('o mesmo exame repetido no laudo não duplica o ponto', () => {
    const p = planHistoryImport({
      analytes: [
        { slug: 'shbg', label: 'SHBG', history: [{ measuredAt: '2025-10-22', value: 12 }] },
        { slug: 'shbg', label: 'SHBG', history: [{ measuredAt: '2025-10-22', value: 12 }] },
      ],
      existing: new Set(),
      collectionDate: '2026-05-19',
    });
    expect(p).toHaveLength(1);
    expect(p[0]!.analytes).toHaveLength(1);
  });

  it('sem histórico ⇒ nada a criar', () => {
    expect(
      planHistoryImport({
        analytes: [{ slug: 'ldl', label: 'LDL' }],
        existing: new Set(),
        collectionDate: '2026-05-19',
      }),
    ).toEqual([]);
  });
});

describe('existingHistoryKeys', () => {
  it('indexa data+slug dos painéis já gravados e ignora medições legadas', () => {
    const chaves = existingHistoryKeys([
      m('2025-10-22', { panel: [{ slug: 'ldl', label: 'LDL', value: 143.1 }] }),
      m('2025-01-01', { ldl: 100 }), // legado, sem panel
    ]);
    expect(chaves.has(historyKey('2025-10-22', 'ldl'))).toBe(true);
    expect(chaves.size).toBe(1);
  });
});

describe('toStoredAnalyte — canonicalização na importação', () => {
  it('casa com o catálogo e adota o rótulo canônico', () => {
    const a = toStoredAnalyte({
      rawName: 'TGP/ALT - TRANSAMINASE PIRÚVICA',
      value: 39,
      unit: 'U/L',
      range: { max: 50 },
      refText: 'Masculino: Inferior a 50 U/L',
    });
    expect(a.slug).toBe('tgp');
    expect(a.label).toBe('TGP / ALT');
    expect(a.refMax).toBe(50);
    expect(a.refMin).toBeUndefined();
    expect(a.rawName).toBe('TGP/ALT - TRANSAMINASE PIRÚVICA');
  });

  it('exame fora do catálogo vira analito LIVRE, com o nome do laudo', () => {
    const a = toStoredAnalyte({ rawName: 'Marcador XPTO-9', value: 3.2 });
    expect(a.slug).toBe('livre:marcador-xpto-9');
    expect(a.label).toBe('Marcador XPTO-9');
  });

  it('unidade do laudo tem precedência sobre a do catálogo', () => {
    expect(toStoredAnalyte({ rawName: 'LDL', value: 108, unit: 'mmol/L' }).unit).toBe('mmol/L');
    expect(toStoredAnalyte({ rawName: 'LDL', value: 108 }).unit).toBe('mg/dL');
  });
});

describe('resolveSlugCollisions — linhas distintas do mesmo exame (laudo real)', () => {
  it('separa as três linhas do TTPA em séries próprias', () => {
    // Sem isto, 38,5 s / 28,8 s / 1,34 virariam três pontos na MESMA série e o
    // "valor atual" do card sairia pela ordem de inserção.
    const r = resolveSlugCollisions([
      { slug: 'ttpa', label: 'TTPA', value: 38.5, rawName: 'Plasma Paciente (TTPA)' },
      { slug: 'ttpa', label: 'TTPA', value: 28.8, rawName: 'Plasma Normal do Dia (TTPA)' },
      { slug: 'ttpa', label: 'TTPA', value: 1.34, rawName: 'Relação Paciente/Normal do Dia (TTPA)' },
    ]);
    expect(new Set(r.map((a) => a.slug)).size).toBe(3);
    expect(r[0]!.slug).toBe('ttpa'); // a primeira mantém o slug canônico
    expect(r[1]!.slug).toBe('livre:plasma-normal-do-dia-ttpa');
    expect(r[1]!.label).toBe('Plasma Normal do Dia (TTPA)'); // rótulo do laudo
    expect(r.map((a) => a.value)).toEqual([38.5, 28.8, 1.34]); // nada se perde
  });

  it('separa as duas estimativas de RFG (adulto negro / não negro)', () => {
    const r = resolveSlugCollisions([
      { slug: 'tfg', label: 'TFG', value: 127.5, rawName: 'RFG - ADULTO NÃO NEGRO' },
      { slug: 'tfg', label: 'TFG', value: 147.4, rawName: 'RFG - ADULTO NEGRO' },
    ]);
    expect(r[0]!.slug).toBe('tfg');
    expect(r[1]!.slug).toBe('livre:rfg-adulto-negro');
  });

  it('rawNames idênticos ganham sufixo — nenhuma linha é perdida', () => {
    const r = resolveSlugCollisions([
      { slug: 'x', label: 'X', value: 1, rawName: 'Igual' },
      { slug: 'x', label: 'X', value: 2, rawName: 'Igual' },
      { slug: 'x', label: 'X', value: 3, rawName: 'Igual' },
    ]);
    expect(new Set(r.map((a) => a.slug)).size).toBe(3);
    expect(r.map((a) => a.value)).toEqual([1, 2, 3]);
  });

  it('painel sem colisão passa intacto', () => {
    const entrada = [
      { slug: 'ldl', label: 'LDL', value: 108 },
      { slug: 'hdl', label: 'HDL', value: 37 },
    ];
    expect(resolveSlugCollisions(entrada)).toEqual(entrada);
  });

  it('preserva os demais campos do analito rebaixado', () => {
    const r = resolveSlugCollisions([
      { slug: 'tfg', label: 'TFG', value: 127.5 },
      { slug: 'tfg', label: 'TFG', value: 147.4, unit: 'mL/min', refMin: 90, rawName: 'RFG negro' },
    ]);
    expect(r[1]!.unit).toBe('mL/min');
    expect(r[1]!.refMin).toBe(90);
  });
});

describe('rangeLabel', () => {
  it('formata a faixa da série ou devolve null', () => {
    const [comFaixa] = buildAnalyteSeries([
      m('2026-05-19', { panel: [{ slug: 'glicose', label: 'Glicose', value: 83, unit: 'mg/dL', refMin: 60, refMax: 99 }] }),
    ]);
    expect(rangeLabel(comFaixa!)).toBe('60 – 99 mg/dL');

    const [semFaixa] = buildAnalyteSeries([
      m('2026-05-19', { panel: [{ slug: 'x', label: 'X', value: 1 }] }),
    ]);
    expect(rangeLabel(semFaixa!)).toBeNull();
  });
});
