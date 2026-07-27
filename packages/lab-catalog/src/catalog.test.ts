import { describe, it, expect } from 'vitest';
import {
  LAB_CATALOG,
  analyteBySlug,
  categoryOf,
  isFreeSlug,
  matchAnalyte,
  normalizeName,
  toFreeSlug,
} from './catalog';

describe('catálogo — integridade', () => {
  it('não tem slugs duplicados', () => {
    const slugs = LAB_CATALOG.map((d) => d.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('nenhum slug do catálogo colide com o prefixo de exame livre', () => {
    expect(LAB_CATALOG.every((d) => !isFreeSlug(d.slug))).toBe(true);
  });

  it('todo slug é resolvível por analyteBySlug', () => {
    for (const def of LAB_CATALOG) expect(analyteBySlug(def.slug)?.label).toBe(def.label);
  });

  it('nenhum alias aponta para dois exames diferentes', () => {
    const seen = new Map<string, string>();
    const colisoes: string[] = [];
    for (const def of LAB_CATALOG) {
      for (const name of [def.slug, def.label, ...(def.aliases ?? [])]) {
        const k = normalizeName(name);
        const dono = seen.get(k);
        if (dono !== undefined && dono !== def.slug) colisoes.push(`${k}: ${dono} vs ${def.slug}`);
        else seen.set(k, def.slug);
      }
    }
    expect(colisoes).toEqual([]);
  });
});

describe('normalizeName', () => {
  it('remove acento, caixa e pontuação', () => {
    expect(normalizeName('Ácido Úrico')).toBe('acido urico');
    expect(normalizeName('TGP/ALT - Transaminase Pirúvica')).toBe('tgp alt transaminase piruvica');
    expect(normalizeName('  25-HIDROXIVITAMINA  D ')).toBe('25 hidroxivitamina d');
  });
});

describe('matchAnalyte — nomes reais de laudo (Santa Helena, 2026-05-19)', () => {
  // O ponto do catálogo: grafias diferentes do MESMO exame caem no mesmo slug,
  // senão a série histórica do paciente se parte em duas linhas.
  const casos: [string, string][] = [
    ['HEMOGLOBINA GLICADA (HBA1C)', 'hba1c'],
    ['Hemoglobina Glicada (A1C)', 'hba1c'],
    ['ÁCIDO ÚRICO', 'acido-urico'],
    ['CREATININA', 'creatinina'],
    ['RITMO DE FILTRACAO GLOMERULAR (RFG)', 'tfg'],
    ['CÁLCIO SÉRICO', 'calcio'],
    ['FOSFATASE ALCALINA', 'fosfatase-alcalina'],
    ['TGO/AST - TRANSAMINASE OXALACÉTICA', 'tgo'],
    ['TGP/ALT - TRANSAMINASE PIRÚVICA', 'tgp'],
    ['GAMA GT', 'gama-gt'],
    ['FERRO SÉRICO', 'ferro'],
    ['TRANSFERRINA', 'transferrina'],
    ['COLESTEROL TOTAL', 'colesterol-total'],
    ['COLESTEROL HDL', 'hdl'],
    ['COLESTEROL LDL', 'ldl'],
    ['TRIGLICERIDES', 'triglicerides'],
    ['CORTISOL', 'cortisol'],
    ['ESTRADIOL - E2 (17 BETA)', 'estradiol'],
    ['FERRITINA', 'ferritina'],
    ['ÁCIDO FÓLICO', 'acido-folico'],
    ['FSH - HORMONIO FOLICULO ESTIMULANTE', 'fsh'],
    ['LH - HORMONIO LUTEINIZANTE', 'lh'],
    ['INSULINA', 'insulina'],
    ['PROLACTINA', 'prolactina'],
    ['TIROXINA LIVRE (T4L)', 't4-livre'],
    ['TSH ULTRA SENSÍVEL', 'tsh'],
    ['VITAMINA B12', 'vitamina-b12'],
    ['25-HIDROXIVITAMINA D', 'vitamina-d'],
    ['TIREOGLOBULINA, ANTICORPOS ANTI', 'anti-tireoglobulina'],
    ['HOMOCISTEÍNA', 'homocisteina'],
    ['PCR - PROTEÍNA C REATIVA QUANTITATIVA ALTA SENSIBILIDADE', 'pcr'],
    ['GLOBULINA LIGADORA DE HORMÔNIOS SEXUAIS - SHBG', 'shbg'],
    ['TESTOSTERONA LIVRE CALCULADA', 'testosterona-livre'],
    ['TESTOSTERONA TOTAL', 'testosterona-total'],
    ['TIREOPEROXIDASE, ANTICORPOS ANTI - TPO', 'anti-tpo'],
    ['ZINCO', 'zinco'],
    ['GLICOSE', 'glicose'],
    ['UREIA', 'ureia'],
    ['MAGNÉSIO', 'magnesio'],
    ['POTÁSSIO', 'potassio'],
    ['SÓDIO', 'sodio'],
  ];

  it.each(casos)('%s ⇒ %s', (raw, slug) => {
    expect(matchAnalyte(raw)?.slug).toBe(slug);
  });

  it('sinônimos do MESMO exame convergem para um slug só', () => {
    for (const grupo of [
      ['TGP', 'ALT', 'Transaminase Pirúvica', 'Alanina Aminotransferase'],
      ['Vitamina D', '25-hidroxivitamina D', 'Calcidiol'],
      ['Triglicérides', 'Triglicerídeos'],
      ['PCR', 'Proteína C Reativa'],
    ]) {
      const slugs = grupo.map((n) => matchAnalyte(n)?.slug);
      expect(new Set(slugs).size, `divergiu: ${grupo.join(' / ')} → ${slugs.join(', ')}`).toBe(1);
      expect(slugs[0]).toBeDefined();
    }
  });

  // Casos que só apareceram ao rodar o extrator contra o laudo REAL — o laudo
  // imprime várias grandezas sob um título só, e o catálogo confundia duas.
  it('separa TEMPO de protrombina (seg) de ATIVIDADE de protrombina (%)', () => {
    // O "Tempo Atividade Protrombina (TP)" traz 12,1 seg E 104% em linhas
    // distintas; mapear o tempo para a atividade exibiria 12,1 contra "> 70%".
    expect(matchAnalyte('Tempo Atividade Protrombina (TP)')?.slug).toBe('tempo-protrombina');
    expect(matchAnalyte('Atividade (TP)')?.slug).toBe('tap');
    expect(analyteBySlug('tempo-protrombina')?.unit).toBe('seg');
    expect(analyteBySlug('tap')?.unit).toBe('%');
  });

  it('as três linhas do TTPA são exames distintos', () => {
    expect(matchAnalyte('Plasma Paciente (TTPA)')?.slug).toBe('ttpa-paciente');
    expect(matchAnalyte('Plasma Normal do Dia (TTPA)')?.slug).toBe('ttpa-normal');
    expect(matchAnalyte('Relação Paciente/Normal do Dia (TTPA)')?.slug).toBe('ttpa');
  });

  it('exame desconhecido ⇒ undefined (o chamador cria analito livre)', () => {
    expect(matchAnalyte('Marcador Exótico XPTO-9')).toBeUndefined();
  });
});

describe('exames livres', () => {
  it('gera slug prefixado e estável', () => {
    expect(toFreeSlug('Marcador Exótico XPTO-9')).toBe('livre:marcador-exotico-xpto-9');
    expect(toFreeSlug('Marcador  EXÓTICO   xpto 9')).toBe(toFreeSlug('Marcador Exótico XPTO-9'));
  });

  it('nome vazio ainda produz slug utilizável', () => {
    expect(toFreeSlug('   ')).toBe('livre:exame');
  });

  it('isFreeSlug distingue livre de canônico', () => {
    expect(isFreeSlug(toFreeSlug('qualquer'))).toBe(true);
    expect(isFreeSlug('ldl')).toBe(false);
  });

  it('categoria de exame livre é "outros"', () => {
    expect(categoryOf(toFreeSlug('qualquer'))).toBe('outros');
    expect(categoryOf('ldl')).toBe('lipidico');
  });
});
