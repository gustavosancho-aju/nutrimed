/**
 * Projeção corporal por foto: a partir de uma foto real do paciente e de um
 * peso-alvo, a IA gera como o corpo ficaria naquele peso. É apoio VISUAL e
 * MOTIVACIONAL na consulta — não é previsão clínica e não estima composição
 * corporal (isso continua sendo bioimpedância). A imagem gerada só chega ao
 * paciente depois que o médico aprova (gate humano, como no ADR-012).
 *
 * O gerador é PLUGÁVEL (NFR8/ADR-002): hoje Gemini, amanhã outro, sem mexer no
 * resto. Aqui não há escrita no banco nem persistência de nenhum tipo.
 */

export type PhotoMimeType = 'image/jpeg' | 'image/png' | 'image/webp';

/** Formatos aceitos na foto de entrada — a UI e as actions reusam esta lista. */
export const ALLOWED_PHOTO_MIME_TYPES: readonly PhotoMimeType[] = [
  'image/jpeg',
  'image/png',
  'image/webp',
];

/**
 * Teto da foto DEPOIS do downscale feito no cliente (~1024 px no maior lado).
 * Não é limite de upload: é o que efetivamente vai para a API — foto maior só
 * encarece a chamada sem melhorar a projeção.
 */
export const MAX_PHOTO_BYTES = 4 * 1024 * 1024;

/** Faixa de peso plausível (kg) — barra erro de digitação antes de gastar API. */
const MIN_WEIGHT_KG = 20;
const MAX_WEIGHT_KG = 400;

export interface BodyProjectionInput {
  /** Foto do paciente em base64 puro (sem o prefixo `data:`). */
  readonly photoBase64: string;
  readonly mimeType: PhotoMimeType;
  readonly currentWeightKg: number;
  readonly targetWeightKg: number;
  /** Altura em cm, quando conhecida — permite calibrar o prompt por IMC. */
  readonly heightCm?: number;
  readonly sex?: 'F' | 'M';
}

export interface BodyProjectionResult {
  /** Imagem gerada em base64 puro (sem o prefixo `data:`). */
  readonly imageBase64: string;
  readonly mimeType: string;
  /** Versão do modelo — proveniência da auditoria (NFR10). */
  readonly modelVersion: string;
}

export interface IBodyProjector {
  readonly modelVersion?: string;
  /** Gera a projeção. NUNCA persiste. Lança {@link BodyProjectorError}. */
  project(input: BodyProjectionInput): Promise<BodyProjectionResult>;
}

export type BodyProjectorErrorKind =
  /** Credencial ausente/inválida. */
  | 'config'
  /** Entrada rejeitada antes de chamar a API (foto/pesos). */
  | 'input'
  /** A API respondeu erro (rede, cota, 5xx). */
  | 'api'
  /** Respondeu, mas sem imagem utilizável. */
  | 'parse'
  /** O modelo RECUSOU editar a foto (política de conteúdo). */
  | 'safety';

export class BodyProjectorError extends Error {
  constructor(
    message: string,
    readonly kind: BodyProjectorErrorKind,
  ) {
    super(message);
    this.name = 'BodyProjectorError';
  }
}

/** Tamanho em bytes de um base64, sem materializar o Buffer. */
export function base64Bytes(base64: string): number {
  const len = base64.length;
  if (len === 0) return 0;
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.floor((len * 3) / 4) - padding;
}

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Identifica o formato pelos BYTES, e não pelo `type` que o navegador informa
 * (que o cliente escolhe e pode mentir). Null = não é JPEG/PNG/WebP.
 */
export function sniffImageMime(bytes: Buffer): PhotoMimeType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(PNG_MAGIC)) return 'image/png';
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
    bytes.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

export function bmiFrom(weightKg: number, heightCm: number): number {
  const m = heightCm / 100;
  return weightKg / (m * m);
}

/**
 * Fronteira de entrada: devolve a mensagem de erro em pt-BR (pronta para a UI)
 * ou `null` se estiver tudo certo. Nunca lança — quem chama decide o que fazer.
 */
export function validateProjectionInput(input: BodyProjectionInput): string | null {
  if (!input.photoBase64) return 'Selecione uma foto do paciente.';
  if (!ALLOWED_PHOTO_MIME_TYPES.includes(input.mimeType)) {
    return 'Formato de imagem não suportado — use JPEG, PNG ou WebP.';
  }
  if (base64Bytes(input.photoBase64) > MAX_PHOTO_BYTES) {
    return 'Imagem muito grande (máx. 4 MB depois do redimensionamento).';
  }

  for (const [rotulo, peso] of [
    ['atual', input.currentWeightKg],
    ['desejado', input.targetWeightKg],
  ] as const) {
    if (!Number.isFinite(peso)) return `Informe o peso ${rotulo}.`;
    if (peso < MIN_WEIGHT_KG || peso > MAX_WEIGHT_KG) {
      return `Peso ${rotulo} fora da faixa plausível (${MIN_WEIGHT_KG}–${MAX_WEIGHT_KG} kg).`;
    }
  }
  if (Math.abs(input.targetWeightKg - input.currentWeightKg) < 0.5) {
    return 'O peso desejado precisa ser diferente do peso atual.';
  }
  if (input.heightCm !== undefined && (input.heightCm < 100 || input.heightCm > 250)) {
    return 'Altura fora da faixa plausível (100–250 cm).';
  }
  return null;
}
