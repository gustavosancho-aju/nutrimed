import type { KbChunk, PersonaId } from '@nutrimed/providers';
import type { NamespacedKnowledgeStore } from './store';

/**
 * Pipeline de ingestão VERSIONADO (Story 5.2 — R8, ADR-004).
 *
 * Ingere documentos markdown por persona, gerando chunks com PROVENIÊNCIA
 * (fonte + versão no `source`) — é o que alimenta `kbSources` da contribuição
 * e, por ela, a trilha de auditoria (NFR10/1.5).
 *
 * R8: substituir a semente pela base curada = chamar `ingest` de novo com a
 * nova fonte/versão — o namespace é SUBSTITUÍDO, zero mudança de código.
 */

export interface IngestSource {
  readonly personaId: PersonaId;
  /** Identificador da fonte (ex.: 'personas-knowledge-base-seed.md#paulo'). */
  readonly source: string;
  /** Markdown/texto do conteúdo da persona. */
  readonly content: string;
}

export interface IngestResult {
  readonly personaId: PersonaId;
  readonly version: string;
  readonly chunkCount: number;
}

/**
 * Chunker simples: blocos por linha significativa (bullets/parágrafos),
 * ignorando cabeçalhos vazios. Curadoria real pode trazer chunkers melhores —
 * mesma interface.
 */
export function chunkContent(personaId: PersonaId, source: string, content: string, version: string): KbChunk[] {
  const lines = content
    .split('\n')
    .map((l) => l.replace(/^[-*>\s#]+/, '').trim())
    .filter((l) => l.length >= 20); // descarta títulos/ruído curto
  return lines.map((text, i) => ({
    id: `${personaId}:${version}:${i}`,
    personaId,
    text,
    source: `${source}@${version}`, // proveniência: fonte + versão (NFR10)
  }));
}

/** Ingere (ou RE-ingere) as fontes no store, substituindo cada namespace. */
export function ingest(
  store: NamespacedKnowledgeStore,
  sources: readonly IngestSource[],
  version: string,
): IngestResult[] {
  const results: IngestResult[] = [];
  for (const src of sources) {
    const chunks = chunkContent(src.personaId, src.source, src.content, version);
    store.replaceNamespace(src.personaId, chunks, version);
    results.push({ personaId: src.personaId, version, chunkCount: chunks.length });
  }
  return results;
}

/**
 * Extrai as seções por persona da SEMENTE (`personas-knowledge-base-seed.md`).
 * ⚠️ A semente é placeholder de validação — NÃO usar em produção clínica.
 */
export function seedSources(seedMarkdown: string): IngestSource[] {
  const sections: Array<{ personaId: PersonaId; marker: RegExp }> = [
    { personaId: 'aurelio', marker: /## .*Aur[ée]lio[\s\S]*?(?=\n## |$)/ },
    { personaId: 'paulo', marker: /## .*Paulo[\s\S]*?(?=\n## |$)/ },
    { personaId: 'yara', marker: /## .*Yara[\s\S]*?(?=\n## |$)/ },
  ];
  const sources: IngestSource[] = [];
  for (const { personaId, marker } of sections) {
    const match = marker.exec(seedMarkdown);
    if (match) {
      sources.push({
        personaId,
        source: `personas-knowledge-base-seed.md#${personaId}`,
        content: match[0],
      });
    }
  }
  return sources;
}
