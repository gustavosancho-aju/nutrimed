import { describe, expect, it } from 'vitest';
import { getFood } from '@nutrimed/taco';
import { BLOCKED, CORPUS } from './corpus.fixture';
import { FOOD_CATALOG, catalogSize, normalizeTerm } from './catalog';
import { EXTRA_FOODS, getExtraFood } from './extra-foods';
import { resolveFood } from './resolve';

/** Sem acento e em minúsculas, para comparar descrição sem brigar com grafia. */
function norm(text: string): string {
  return text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

describe('corpus de regressão — resolução de alimentos', () => {
  for (const c of CORPUS) {
    const marca = c.regressao ? '🔴 regressão' : 'caso';
    it(`${marca}: "${c.term}" → ${c.expect}${c.nota ? ` (${c.nota})` : ''}`, () => {
      const r = resolveFood(c.term);

      if (c.expect === BLOCKED) {
        expect(r.ok, `"${c.term}" deveria ser RECUSADO, mas resolveu`).toBe(false);
        if (!r.ok) expect(r.miss.message.length).toBeGreaterThan(10);
        return;
      }

      expect(r.ok, `"${c.term}" não resolveu`).toBe(true);
      if (!r.ok) return;

      expect(
        norm(r.food.description),
        `"${c.term}" resolveu para "${r.food.description}", que não contém "${c.expect}"`,
      ).toContain(norm(c.expect));

      if (c.reject) {
        expect(
          norm(r.food.description),
          `"${c.term}" voltou a cair em "${r.food.description}" — este é o bug que o caso impede`,
        ).not.toContain(norm(c.reject));
      }
    });
  }
});

describe('integridade do catálogo', () => {
  it('toda referência aponta para um alimento que existe', () => {
    const quebradas: string[] = [];
    for (const alias of FOOD_CATALOG) {
      const achou = alias.ref.source === 'taco' ? getFood(alias.ref.id) : getExtraFood(alias.ref.id);
      if (!achou) quebradas.push(`${alias.slug} → ${alias.ref.source}:${alias.ref.id}`);
    }
    expect(quebradas, `referências quebradas:\n${quebradas.join('\n')}`).toEqual([]);
  });

  it('nenhum sinônimo se repete entre alias diferentes', () => {
    // Sinônimo duplicado não quebra (o primeiro vence), mas significa que alguém
    // escreveu uma regra que nunca vai disparar — é bug de curadoria silencioso.
    const dono = new Map<string, string>();
    const colisoes: string[] = [];
    for (const alias of FOOD_CATALOG) {
      for (const s of alias.synonyms) {
        const key = normalizeTerm(s);
        const anterior = dono.get(key);
        if (anterior && anterior !== alias.slug) colisoes.push(`"${s}": ${anterior} vs ${alias.slug}`);
        else dono.set(key, alias.slug);
      }
    }
    expect(colisoes, `sinônimos duplicados:\n${colisoes.join('\n')}`).toEqual([]);
  });

  it('cobre um vocabulário de tamanho útil', () => {
    const { aliases, synonyms } = catalogSize();
    expect(aliases).toBeGreaterThan(80);
    expect(synonyms).toBeGreaterThan(200);
  });

  it('resolução pelo catálogo é sempre confiante; pela busca, nem sempre', () => {
    const r = resolveFood('frango grelhado');
    expect(r.ok && r.food.via).toBe('catalogo');
    expect(r.ok && r.food.confident).toBe(true);
    expect(r.ok && r.food.score).toBe(1);
  });

  it('termo desconhecido não resolve, e explica em pt-BR', () => {
    const r = resolveFood('xyzabc inexistente');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.miss.reason).toBe('sem-match');
      expect(r.miss.message).toMatch(/não encontrei/i);
    }
  });
});

describe('tabela de extensão (alimentos fora da TACO)', () => {
  it('creatina resolve com ZERO em todos os macros', () => {
    // Não é detalhe: bases públicas trazem creatina com ~88 g de "proteína"
    // (artefato de Kjeldahl — 32% de nitrogênio × fator 6,25). Registrar isso
    // injetaria proteína que não existe no plano inteiro do paciente.
    const r = resolveFood('creatina');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.food.per100g.kcal).toBe(0);
    expect(r.food.per100g.protein).toBe(0);
    expect(r.food.per100g.carbs).toBe(0);
    expect(r.food.per100g.fat).toBe(0);
  });

  it('whey isolado tem mais proteína e menos carboidrato que o concentrado', () => {
    const iso = resolveFood('whey isolado');
    const conc = resolveFood('whey concentrado');
    expect(iso.ok && conc.ok).toBe(true);
    if (!iso.ok || !conc.ok) return;
    expect(iso.food.per100g.protein).toBeGreaterThan(conc.food.per100g.protein!);
    expect(iso.food.per100g.carbs).toBeLessThan(conc.food.per100g.carbs!);
  });

  it('os dois iogurtes gregos são alimentos distintos', () => {
    // Juntá-los erraria a proteína em ~2× e o carboidrato em ~3×.
    const sobremesa = resolveFood('iogurte grego');
    const proteico = resolveFood('yopro');
    expect(sobremesa.ok && proteico.ok).toBe(true);
    if (!sobremesa.ok || !proteico.ok) return;
    expect(sobremesa.food.id).not.toBe(proteico.food.id);
    expect(proteico.food.per100g.protein).toBeGreaterThan(sobremesa.food.per100g.protein! * 1.8);
    expect(sobremesa.food.per100g.carbs).toBeGreaterThan(proteico.food.per100g.carbs! * 3);
  });

  it('todo item respeita Atwater (kcal ≈ 4P + 4C + 9G) dentro de 10%', () => {
    // Regra de sanidade que pega erro de transcrição de rótulo. Vale para tudo
    // que não é gordura pura nem tem álcool/poliol — nenhum item aqui é.
    const fora: string[] = [];
    for (const f of EXTRA_FOODS) {
      const { kcal = 0, protein = 0, carbs = 0, fat = 0 } = f.per100g;
      if (kcal === 0) continue; // creatina: 0 por regra da IN 75/2020
      const estimado = 4 * protein + 4 * carbs + 9 * fat;
      const desvio = Math.abs(estimado - kcal) / kcal;
      if (desvio > 0.1) {
        fora.push(`${f.id}: rótulo ${kcal} kcal vs Atwater ${estimado.toFixed(0)} (${(desvio * 100).toFixed(0)}%)`);
      }
    }
    expect(fora, `itens fora de Atwater:\n${fora.join('\n')}`).toEqual([]);
  });

  it('nenhum item soma mais de 100 g de macros por 100 g', () => {
    const impossiveis = EXTRA_FOODS.filter((f) => {
      const { protein = 0, carbs = 0, fat = 0 } = f.per100g;
      return protein + carbs + fat > 100;
    }).map((f) => f.id);
    expect(impossiveis).toEqual([]);
  });

  it('todo item declara origem rastreável', () => {
    for (const f of EXTRA_FOODS) {
      expect(f.origin.length, `${f.id} sem origem`).toBeGreaterThan(5);
      expect(['usda-cc0', 'rotulo-anvisa']).toContain(f.source);
    }
  });
});
