/**
 * Métricas de acurácia de STT para a POC 2.5 (Transcrição Confiável, Story 3).
 *
 * O que importa para a confiança do nutrólogo NÃO é o WER genérico e sim se os
 * TERMOS CLÍNICOS sobreviveram à transcrição (ex.: "precordial" não virar
 * "primordial"). Por isso a métrica primária é o RECALL de termo clínico; o WER
 * entra como métrica de contexto. Funções puras — o harness da POC as aplica sobre
 * pares (referência humana, hipótese do STT) por configuração (nova-2+keywords vs
 * nova-3+keyterm).
 */

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // remove acentos
    .replace(/[^a-z0-9\s]/g, ' ') // pontuação → espaço
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(text: string): string[] {
  const n = normalize(text);
  return n.length === 0 ? [] : n.split(' ');
}

export interface TermRecall {
  /** Termos do vocabulário presentes na referência (denominador). */
  readonly expected: number;
  /** Desses, quantos aparecem na hipótese do STT. */
  readonly found: number;
  /** found / expected (1 quando não há termo esperado — nada a perder). */
  readonly recall: number;
  /** Termos esperados que o STT NÃO capturou — a lista que corrói a confiança. */
  readonly missed: readonly string[];
}

/**
 * Recall de termos clínicos: dos termos do vocabulário que aparecem na referência,
 * quantos o STT capturou. Compara por substring normalizada (cobre termos
 * multi-palavra como "dor torácica").
 */
export function clinicalTermRecall(
  reference: string,
  hypothesis: string,
  vocabulary: readonly string[],
): TermRecall {
  const ref = ` ${normalize(reference)} `;
  const hyp = ` ${normalize(hypothesis)} `;
  const expectedTerms = vocabulary.filter((t) => {
    const nt = normalize(t);
    return nt.length > 0 && ref.includes(` ${nt} `);
  });
  const missed = expectedTerms.filter((t) => !hyp.includes(` ${normalize(t)} `));
  const found = expectedTerms.length - missed.length;
  return {
    expected: expectedTerms.length,
    found,
    recall: expectedTerms.length === 0 ? 1 : found / expectedTerms.length,
    missed,
  };
}

/**
 * Word Error Rate = (substituições + inserções + remoções) / palavras da referência,
 * via distância de edição de Levenshtein em nível de token. Métrica de contexto.
 */
export function wordErrorRate(reference: string, hypothesis: string): number {
  const ref = tokenize(reference);
  const hyp = tokenize(hypothesis);
  if (ref.length === 0) return hyp.length === 0 ? 0 : 1;

  // Levenshtein por linhas (O(min) memória).
  let prev = Array.from({ length: hyp.length + 1 }, (_, i) => i);
  for (let i = 1; i <= ref.length; i++) {
    const curr = [i];
    for (let j = 1; j <= hyp.length; j++) {
      const cost = ref[i - 1] === hyp[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j]! + 1, // remoção
        curr[j - 1]! + 1, // inserção
        prev[j - 1]! + cost, // substituição/acerto
      );
    }
    prev = curr;
  }
  return prev[hyp.length]! / ref.length;
}

export interface SttScore {
  readonly termRecall: TermRecall;
  readonly wer: number;
}

/** Escore combinado de um par (referência, hipótese) para uma configuração de STT. */
export function scoreTranscript(
  reference: string,
  hypothesis: string,
  vocabulary: readonly string[],
): SttScore {
  return {
    termRecall: clinicalTermRecall(reference, hypothesis, vocabulary),
    wer: wordErrorRate(reference, hypothesis),
  };
}
