/**
 * Migrations versionadas (fonte de verdade, em ordem).
 *
 * SQL inline em TS — robusto em qualquer runtime (Node, Vitest, bundle do Next),
 * sem depender de leitura de arquivos `.sql` do disco. Cada entrada é aplicada
 * uma única vez e rastreada em `_migrations` (ver `runMigrations`).
 */
export interface Migration {
  readonly name: string;
  readonly sql: string;
}

export const MIGRATIONS: ReadonlyArray<Migration> = [
  {
    name: '0001_init',
    sql: `
-- Entidades base (architecture.md §8). Idempotente. gen_random_uuid() é nativo (PG13+).
-- Colunas com sufixo _enc guardam ciphertext base64 (AES-256-GCM, @nutrimed/crypto) — NFR9.

CREATE TABLE IF NOT EXISTS app_user (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL UNIQUE,
  display_name  text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS consultation (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES app_user(id),
  patient_label_enc  text NOT NULL,
  status             text NOT NULL DEFAULT 'open',
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_consultation_user_id ON consultation(user_id);

CREATE TABLE IF NOT EXISTS consent (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consultation_id  uuid NOT NULL UNIQUE REFERENCES consultation(id),
  granted          boolean NOT NULL DEFAULT false,
  granted_by       uuid REFERENCES app_user(id),
  granted_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_log (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contribution_id  uuid,
  kb_sources       jsonb,
  model_version    text,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_log_contribution_id ON audit_log(contribution_id);
`,
  },
  {
    name: '0002_auth_session',
    sql: `
-- Autenticação (Story 1.2): estende app_user com credencial e adiciona sessões.
-- password_hash é scrypt (salt embutido) — nunca em claro.

ALTER TABLE app_user ADD COLUMN IF NOT EXISTS password_hash text;

CREATE TABLE IF NOT EXISTS session (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  token_hash  text NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_session_user_id ON session(user_id);
`,
  },
  {
    name: '0003_audit_provenance',
    sql: `
-- Audit Service (Story 1.5 / NFR10): proveniência completa + imutabilidade.
-- A tabela está vazia em todos os ambientes (nenhuma escrita de auditoria antes
-- desta story), então SET NOT NULL é seguro.

ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS triggered_by text;

ALTER TABLE audit_log ALTER COLUMN triggered_by SET NOT NULL;
ALTER TABLE audit_log ALTER COLUMN kb_sources SET NOT NULL;
ALTER TABLE audit_log ALTER COLUMN model_version SET NOT NULL;

-- Append-only (defesa CFM): qualquer UPDATE/DELETE pela aplicação é rejeitado
-- no banco, independente de bug ou bypass na camada de serviço.
CREATE OR REPLACE FUNCTION audit_log_immutable() RETURNS trigger AS $fn$
BEGIN
  RAISE EXCEPTION 'audit_log é append-only (NFR10): % proibido', TG_OP;
END;
$fn$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_log_immutable ON audit_log;
CREATE TRIGGER trg_audit_log_immutable
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();
`,
  },
  {
    name: '0004_clinical_note',
    sql: `
-- Documentação clínica (Story 9.2 / FR17): nota simples editável, 1:1 com a
-- consulta. Conteúdo é dado de saúde ⇒ cifrado em repouso (NFR9, sufixo _enc).

CREATE TABLE IF NOT EXISTS clinical_note (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consultation_id  uuid NOT NULL UNIQUE REFERENCES consultation(id),
  content_enc      text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
`,
  },
  {
    name: '0005_patients_evolution',
    sql: `
-- Pacientes & Evolução (Story 11.1 / E11, FR22/FR25). O paciente vira entidade
-- de primeira classe (dono = médico). PII e dados de saúde são cifrados em
-- repouso (NFR9, sufixo _enc). Idade NÃO é coluna — é derivada de birth_date_enc
-- no servidor. Cada medição guarda os valores num blob JSON cifrado (values_enc),
-- decifrado no servidor ao montar a dashboard (ADR-011) — mesmo padrão da nota.

CREATE TABLE IF NOT EXISTS patient (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES app_user(id),
  name_enc       text NOT NULL,
  phone_enc      text,
  birth_date_enc text,
  goal_enc       text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_patient_user_id ON patient(user_id);

-- Consultas passam a apontar para um paciente. NULLABLE de propósito: consultas
-- antigas (rótulo solto em patient_label_enc) continuam válidas, sem backfill.
ALTER TABLE consultation ADD COLUMN IF NOT EXISTS patient_id uuid REFERENCES patient(id);
CREATE INDEX IF NOT EXISTS idx_consultation_patient_id ON consultation(patient_id);

-- Evolução de composição corporal (bioimpedância) — N por paciente.
-- values_enc = AES-256-GCM de JSON { peso, massaMuscular, massaGordura, cintura, imc, pgc }.
CREATE TABLE IF NOT EXISTS body_composition (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id             uuid NOT NULL REFERENCES patient(id),
  measured_at            timestamptz NOT NULL,
  source_consultation_id uuid REFERENCES consultation(id),
  values_enc             text NOT NULL,
  created_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_body_composition_patient_id ON body_composition(patient_id);

-- Evolução de exames laboratoriais — N por paciente.
-- values_enc = AES-256-GCM de JSON { ldl, hba1c, insulina }.
CREATE TABLE IF NOT EXISTS lab_exam (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id             uuid NOT NULL REFERENCES patient(id),
  measured_at            timestamptz NOT NULL,
  source_consultation_id uuid REFERENCES consultation(id),
  values_enc             text NOT NULL,
  created_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lab_exam_patient_id ON lab_exam(patient_id);
`,
  },
  {
    name: '0006_telegram_nutrition',
    sql: `
-- Bot de Telegram (E12): foto de prato → estimativa nutricional vs. metas.
-- Valores/PII cifrados em repouso (NFR9, values_enc). Toda escrita é auditada (NFR10).
-- Telegram é canal EXTERNO: o vínculo exige consentimento do paciente (ADR-013),
-- default NEGA. Identidade por CÓDIGO DE PAREAMENTO (ADR-014) — sem busca por
-- telefone (phone_enc tem IV aleatório, não é determinístico). A estimativa da
-- foto é aproximada, não prescrição (ADR-015).

-- Metas nutricionais por paciente, definidas pelo nutricionista. Versionadas
-- (append-only, sem UPDATE destrutivo): a meta vigente é a de maior effective_from
-- <= o dia consultado. values_enc = AES-256-GCM de JSON { kcal, protein, carbs, fat }.
CREATE TABLE IF NOT EXISTS nutrition_goal (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id     uuid NOT NULL REFERENCES patient(id),
  set_by_user_id uuid NOT NULL REFERENCES app_user(id),
  effective_from date NOT NULL,
  values_enc     text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_nutrition_goal_patient
  ON nutrition_goal(patient_id, effective_from DESC);

-- Registro diário de consumo (uma linha por foto de prato). photo_ref guarda a
-- REFERÊNCIA do Telegram (file_id), NÃO a imagem — a foto não é persistida (ADR-013).
-- values_enc = AES-256-GCM de JSON { kcal, protein, carbs, fat, confidence, itemsLabel }.
CREATE TABLE IF NOT EXISTS food_log_entry (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id    uuid NOT NULL REFERENCES patient(id),
  eaten_at      timestamptz NOT NULL,
  source        text NOT NULL DEFAULT 'telegram',
  photo_ref     text,
  values_enc    text NOT NULL,
  model_version text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_food_log_patient_eaten
  ON food_log_entry(patient_id, eaten_at);

-- Vínculo chat_id do Telegram → paciente. consent_granted = gate do canal (default
-- NEGA — ADR-013). O índice único parcial garante NO MÁXIMO 1 canal ativo por
-- paciente, sem impedir o histórico de vínculos revogados.
CREATE TABLE IF NOT EXISTS telegram_link (
  chat_id           text PRIMARY KEY,
  patient_id        uuid NOT NULL REFERENCES patient(id),
  consent_granted   boolean NOT NULL DEFAULT false,
  linked_by_user_id uuid REFERENCES app_user(id),
  linked_at         timestamptz,
  revoked_at        timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_telegram_link_patient_active
  ON telegram_link(patient_id) WHERE revoked_at IS NULL;

-- Código de pareamento efêmero (uso único). Guarda apenas o HASH (SHA-256) do
-- código — nunca o código em claro (ADR-014). Busca por hash é determinística
-- (é token efêmero de pareamento, não PII médica).
CREATE TABLE IF NOT EXISTS telegram_pairing_code (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id         uuid NOT NULL REFERENCES patient(id),
  created_by_user_id uuid NOT NULL REFERENCES app_user(id),
  code_hash          text NOT NULL,
  expires_at         timestamptz NOT NULL,
  consumed_at        timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pairing_code_hash ON telegram_pairing_code(code_hash);
`,
  },
  {
    name: '0007_board_synthesis',
    sql: `
-- Sínteses do board persistidas (histórico da consulta). Cada síntese do
-- Aurélio (E6) vira uma linha cifrada (NFR9) no momento em que é gerada — o
-- histórico sobrevive a restart/fim da consulta. A transcrição segue EFÊMERA
-- por minimização LGPD (retenção é a questão CJ-2); o registro permanente da
-- consulta continua sendo a nota clínica validada pelo médico (NFR10).

CREATE TABLE IF NOT EXISTS board_synthesis (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consultation_id uuid NOT NULL REFERENCES consultation(id),
  content_enc     text NOT NULL,
  model_version   text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_board_synthesis_consultation
  ON board_synthesis(consultation_id, created_at);
`,
  },
  {
    name: '0008_transcript_segment',
    sql: `
-- Transcript persistido incrementalmente (A4). Revisa a postura do 0007: um
-- deploy/restart no MEIO da consulta apagava o transcript em memória e a nota
-- clínica ficava impossível ("Sem transcrição nesta sessão" — incidente de
-- 2026-07-01). Cada segmento FINAL vira uma linha cifrada (NFR9) no momento em
-- que chega. Retenção/descarte pós-nota segue sendo a questão jurídica CJ-2.

CREATE TABLE IF NOT EXISTS transcript_segment (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consultation_id uuid NOT NULL REFERENCES consultation(id),
  seq             int NOT NULL,
  content_enc     text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (consultation_id, seq)
);
CREATE INDEX IF NOT EXISTS idx_transcript_segment_consultation
  ON transcript_segment(consultation_id, seq);
`,
  },
  {
    name: '0009_nutrition_report',
    sql: `
-- Relatório nutricional da consulta (E13): recordatório extraído da transcrição,
-- quantificado DETERMINISTICAMENTE pela tabela TACO. content_enc = markdown
-- editável pelo médico (cifrado, NFR9); data_enc = JSON estruturado do cálculo
-- (recordatório + itens TACO + totais) para auditoria e re-render da tabela na UI.
-- 1:1 com a consulta — regenerar sobrescreve o rascunho (mesma postura da nota E9).

CREATE TABLE IF NOT EXISTS nutrition_report (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consultation_id  uuid NOT NULL UNIQUE REFERENCES consultation(id),
  content_enc      text NOT NULL,
  data_enc         text,
  model_version    text,
  taco_version     text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
`,
  },
  {
    name: '0010_transcript_review',
    sql: `
-- Transcrição REVISADA pelo médico (Transcrição Confiável). Os finais crus do STT
-- (transcript_segment) permanecem intactos como proveniência ("o que a máquina
-- ouviu"); esta tabela guarda a versão CORRIGIDA pelo médico ("o que de fato foi
-- dito"). 1:1 com a consulta. Quando existe, é a fonte dos documentos (nota E9 +
-- relatório E13) — o médico decide o que vira registro clínico. content_enc cifrado
-- (NFR9); cada save gera trilha 'transcript-reviewed' (NFR10).
CREATE TABLE IF NOT EXISTS transcript_review (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consultation_id  uuid NOT NULL UNIQUE REFERENCES consultation(id),
  content_enc      text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
`,
  },
  {
    name: '0011_custom_exams_body_goal',
    sql: `
-- Exames personalizados POR PACIENTE (até 3 slots — nome/unidade definidos pelo
-- médico na dashboard). O nome do exame revela condição de saúde => cifrado
-- (NFR9, sufixo _enc). custom_exams_enc = AES-256-GCM de JSON
-- [{ slot, name, unit? }]. Os VALORES vão no blob values_enc de lab_exam
-- (chaves custom1..custom3, estáveis por slot) — sem mudança de schema lá.
ALTER TABLE patient ADD COLUMN IF NOT EXISTS custom_exams_enc text;

-- Metas corporais por paciente (peso/IMC/massa/gordura/cintura/PGC), definidas
-- pelo médico e VERSIONADAS por append — mesmo padrão de nutrition_goal (a
-- vigente é a de maior effective_from <= o dia consultado; sem UPDATE
-- destrutivo). values_enc = AES-256-GCM de JSON com campos opcionais
-- { peso, imc, massaMuscular, massaGordura, cintura, pgc }.
CREATE TABLE IF NOT EXISTS body_goal (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id     uuid NOT NULL REFERENCES patient(id),
  set_by_user_id uuid NOT NULL REFERENCES app_user(id),
  effective_from date NOT NULL,
  values_enc     text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_body_goal_patient
  ON body_goal(patient_id, effective_from DESC);
`,
  },
  {
    name: '0012_totp_2fa',
    sql: `
-- Verificação em duas etapas (TOTP) do login do médico. Opcional por padrão
-- (totp_enabled=false) — não quebra logins existentes. O secret revela o segundo
-- fator => cifrado (NFR9, AES-256-GCM base32 do secret).
ALTER TABLE app_user ADD COLUMN IF NOT EXISTS totp_secret_enc text;
ALTER TABLE app_user ADD COLUMN IF NOT EXISTS totp_enabled boolean NOT NULL DEFAULT false;
`,
  },
  {
    name: '0013_soft_delete',
    sql: `
-- Edição/exclusão de medições pelo médico (feedback do piloto 2026-07-15).
-- SOFT-delete: a linha permanece para trilha/retensão (parecer jurídico CJ-2
-- pendente); deleted_at marca a exclusão e o audit_log registra quem/quando.
ALTER TABLE body_composition ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE lab_exam         ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
`,
  },
  {
    name: '0014_consultation_telemetry',
    sql: `
-- Telemetria agregada persistida por consulta (E10): o registry em memória
-- morria a cada deploy e cegava a investigação de relatos do piloto (15/07).
-- SEM conteúdo clínico — só contadores/durações (NFR9 ok, sem cifra).
-- report = ConsultationReport pronto (JSONB) — a fonte do painel; colunas
-- planas só para agregação SQL.
CREATE TABLE IF NOT EXISTS consultation_telemetry (
  consultation_id uuid PRIMARY KEY REFERENCES consultation(id),
  started_at      timestamptz,
  ended_at        timestamptz,
  llm_calls       integer NOT NULL DEFAULT 0,
  llm_input_tokens  bigint NOT NULL DEFAULT 0,
  llm_output_tokens bigint NOT NULL DEFAULT 0,
  stt_segments    integer NOT NULL DEFAULT 0,
  contributions_delivered integer NOT NULL DEFAULT 0,
  case_state_updates      integer NOT NULL DEFAULT 0,
  report          jsonb NOT NULL,
  updated_at      timestamptz NOT NULL DEFAULT now()
);
`,
  },
  {
    name: '0015_patient_profession',
    sql: `
-- Profissão do paciente (pedido do piloto). PII => cifrada (NFR9); opcional,
-- espelho de goal_enc.
ALTER TABLE patient ADD COLUMN IF NOT EXISTS profession_enc text;
`,
  },
  {
    name: '0016_consultation_record',
    sql: `
-- Prontuário manual da consulta: Conduta + Anotações do médico. 1:1 com a
-- consulta, ambos opcionais (o médico preenche um sem o outro). 100% manual —
-- nenhum campo é gerado por IA ("IA assiste, médico decide"). Cifrado (NFR9);
-- cada save gera trilha 'consultation-record-edit' (NFR10).
CREATE TABLE IF NOT EXISTS consultation_record (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consultation_id  uuid NOT NULL UNIQUE REFERENCES consultation(id),
  conduct_enc      text,
  annotations_enc  text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
`,
  },
  {
    name: '0017_patient_lifecycle',
    sql: `
-- Briefing do piloto (2026-07-19): ciclo de vida do paciente.
-- deleted_at: SOFT-delete do paciente (mesmo padrão de 0013 — a linha fica
-- para trilha/retensão até o parecer CJ-2; o audit_log registra quem/quando).
-- height_cm_enc: altura informada pelo médico — dado clínico => cifrado (NFR9);
-- quando ausente, o dashboard segue derivando de peso+IMC da bioimpedância.
-- photo_enc: foto do paciente (base64 pequena) — PII => cifrada; opcional.
ALTER TABLE patient ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE patient ADD COLUMN IF NOT EXISTS height_cm_enc text;
ALTER TABLE patient ADD COLUMN IF NOT EXISTS photo_enc text;
`,
  },
  {
    name: '0018_board_final_review',
    sql: `
-- Briefing do piloto (2026-07-19): parecer do board NO FINAL da consulta, em
-- vez de (ou além de) contribuir ao vivo — "atrapalha a consulta, tira o
-- foco". board_mode escolhido ao iniciar a consulta ao vivo: 'live' preserva
-- o comportamento atual (contribuições reativas + parecer final ao encerrar);
-- 'final_only' mantém as personas caladas durante a consulta (só STT/transcript
-- rodam) e o parecer sai inteiramente ao encerrar.
ALTER TABLE consultation ADD COLUMN IF NOT EXISTS board_mode text NOT NULL DEFAULT 'live';
ALTER TABLE consultation ADD COLUMN IF NOT EXISTS final_review_status text;

-- Um parecer por persona (o que faltou perguntar / exames a considerar /
-- condutas a considerar), cifrado (NFR9). UNIQUE por consulta+persona com
-- upsert: reabrir e re-encerrar a consulta substitui o parecer anterior.
CREATE TABLE IF NOT EXISTS board_final_review (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consultation_id  uuid NOT NULL REFERENCES consultation(id),
  persona_id       text NOT NULL,
  content_enc      text NOT NULL,
  model_version    text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (consultation_id, persona_id)
);
`,
  },
  {
    name: '0019_user_theme',
    sql: `
-- Briefing do piloto (2026-07-19): tema visual escolhível por médico ("as
-- cores ficam muito clean; de repente algumas opções de combinações"). Não é
-- dado sensível ⇒ sem cifra. Valores válidos aplicados pela UI: 'unic'
-- (default reforçado) | 'authority' | 'classic' — coluna solta (sem CHECK)
-- para não travar deploy se um 4º tema for adicionado antes de uma migration.
ALTER TABLE app_user ADD COLUMN IF NOT EXISTS theme text NOT NULL DEFAULT 'unic';
`,
  },
  {
    name: '0020_patient_self_log',
    sql: `
-- Pedido do médico (2026-07-20): água e sono via Telegram (/agua, /dormi,
-- /acordei). Uma tabela para os dois — espelha food_log_entry, mas sem
-- estimativa por IA: o paciente informa o valor direto. kind='water' guarda
-- {ml}; kind='sleep_start'/'sleep_end' são só o INSTANTE do evento (values_enc
-- cifra um objeto vazio, reservado para futuras notas) — a duração/qualidade
-- do sono é calculada em código, pareando o último sleep_start com o
-- sleep_end mais recente. Cifrado (NFR9); cada insert audita (NFR10).
CREATE TABLE IF NOT EXISTS patient_self_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id  uuid NOT NULL REFERENCES patient(id),
  kind        text NOT NULL,
  logged_at   timestamptz NOT NULL,
  values_enc  text NOT NULL,
  source      text NOT NULL DEFAULT 'telegram',
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS patient_self_log_patient_kind_idx
  ON patient_self_log (patient_id, kind, logged_at);
`,
  },
  {
    name: '0021_food_log_soft_delete',
    sql: `
-- O médico pode remover um registro alimentar claramente errado (ciclo de
-- feedback 2026-07-24). SOFT-delete como na 0013: a linha PERMANECE para
-- trilha/retenção (CJ-2 sem parecer), mas sai das somas, das listagens e do
-- relatório nutricional. NÃO há fila de aprovação: o autorrelato do paciente
-- conta no dia normalmente; o médico apenas corrige o que estiver errado.
ALTER TABLE food_log_entry ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
`,
  },
  {
    name: '0022_patient_lab_prefs',
    sql: `
-- E14 (painel laboratorial dinâmico): quais exames o médico escolheu APRESENTAR
-- ao paciente, e em que ordem. Os VALORES do painel não precisaram de migration
-- (vão no blob JSON já cifrado de lab_exam.values_enc) — esta coluna guarda só a
-- preferência de exibição, 1:1 com o paciente, como custom_exams_enc da 0007.
-- Cifrada (NFR9) pelo mesmo motivo dos exames personalizados: a LISTA de exames
-- que um médico acompanha em um paciente revela condição de saúde. Sem CHECK e
-- sem versionamento — a auditoria 'lab-display-set' registra as edições.
ALTER TABLE patient ADD COLUMN IF NOT EXISTS lab_prefs_enc text;
`,
  },
  {
    name: '0023_body_projection',
    sql: `
-- Projeção corporal por foto: a partir de uma foto real do paciente, a IA
-- (Gemini, atrás de IBodyProjector) gera como o corpo ficaria no peso-alvo.
-- Ferramenta MOTIVACIONAL na consulta, não previsão clínica — por isso a
-- imagem nasce com approved_at NULL: só aparece no Modo Apresentação depois
-- que o médico olhou e aprovou (gate humano, mesmo princípio do ADR-012).
--
-- result_enc guarda a imagem gerada (base64) CIFRADA: rosto de paciente é dado
-- pessoal sensível (LGPD) e não pode virar arquivo servido por URL. A foto de
-- ORIGEM não se repete aqui — vai em patient.photo_enc (0017, até agora sem
-- uso), 1 vigente por paciente; os pesos guardados abaixo já dizem de que
-- ponto a projeção partiu. Soft-delete como na 0013/0021: a linha permanece
-- para trilha (CJ-2) mas some das listagens.
CREATE TABLE IF NOT EXISTS body_projection (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id       uuid NOT NULL REFERENCES patient(id),
  source_weight_kg numeric NOT NULL,
  target_weight_kg numeric NOT NULL,
  result_enc       text NOT NULL,
  model_version    text NOT NULL,
  approved_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  deleted_at       timestamptz
);
CREATE INDEX IF NOT EXISTS body_projection_patient_idx
  ON body_projection (patient_id, created_at);
`,
  },
  {
    name: '0024_body_projection_async',
    sql: `
-- A projeção virou ASSÍNCRONA. Medido em 2026-07-28: o gpt-image-2 leva ~142s
-- por imagem (contra 10s do Gemini, que porém quase não mudava o corpo). Dois
-- minutos e meio dentro de uma server action prendem a página do médico no meio
-- da consulta e estouram timeout de proxy — então a linha passa a nascer ANTES
-- da imagem existir, com status='processing', e a geração termina em segundo
-- plano (o app roda como processo Node persistente no Fly, não serverless).
--
-- result_enc perde o NOT NULL por consequência: a linha existe antes da imagem.
-- Linhas antigas já têm imagem, por isso o DEFAULT 'ready' — nenhuma projeção
-- já aprovada muda de comportamento.
ALTER TABLE body_projection ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'ready';
ALTER TABLE body_projection ADD COLUMN IF NOT EXISTS error_message text;
ALTER TABLE body_projection ALTER COLUMN result_enc DROP NOT NULL;
`,
  },
  {
    name: '0025_consultation_form',
    sql: `
-- Ficha de consulta (modelo do Dr. Rafael Bastos): a anamnese estruturada que
-- ele preenchia em papel, agora gerada como RASCUNHO a partir da transcrição e
-- revisada pelo médico antes de valer. Uma por consulta — UNIQUE em
-- consultation_id, como clinical_note.
--
-- content_enc guarda a ficha INTEIRA como blob JSON cifrado (NFR9), não uma
-- coluna por campo. A ficha é um documento que se lê inteiro; ninguém consulta
-- "todos os pacientes com apneia" por aqui (isso é o dashboard, que tem os
-- dados estruturados do E11/E14). Em colunas, cada campo novo da ficha viraria
-- uma migration — e como tudo seria cifrado, nada disso seria consultável
-- mesmo. model_version distingue o rascunho da IA ('human-edit' após revisão),
-- espelhando a proveniência que a trilha de auditoria registra.
CREATE TABLE IF NOT EXISTS consultation_form (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consultation_id uuid NOT NULL UNIQUE REFERENCES consultation(id),
  content_enc     text NOT NULL,
  model_version   text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
`,
  },
  {
    name: '0026_food_log_meal',
    sql: `
-- O bot passa a PERGUNTAR de que refeição se trata antes de gravar (decisão de
-- produto do Gustavo: perguntar SEMPRE, nunca inferir pelo horário).
--
-- Coluna CLARA, fora do values_enc, por dois motivos:
--
-- (1) FUNCIONAL, e é o decisivo. O lembrete das 22h precisa perguntar "quais
--     refeições de hoje não têm registro" para TODOS os pacientes ativos. Com o
--     dado dentro do blob cifrado isso viraria: ler todas as linhas do dia de
--     todos os pacientes, DECIFRAR cada uma e filtrar em memória — a cada tick,
--     todo dia. É o mesmo erro que o E15 já pagou no listNutritionDiary (2
--     consultas POR DIA; 12 meses ≈ 730). Em coluna clara a cobertura sai em UMA
--     consulta agregada, e a rotina proativa NUNCA precisa da chave de cifra.
--
-- (2) SENSIBILIDADE: o rótulo é um enum fechado de 4 valores, sem conteúdo
--     clínico, e JÁ é derivável de eaten_at, que está em claro desde a 0006 —
--     "12h47" diz "almoço" com mais precisão que o rótulo. O que é sensível (o
--     QUE e QUANTO se comeu) segue inteiro dentro de values_enc. Mesmo desenho
--     de patient_self_log.kind (0020) e food_log_entry.source.
--     Risco aceito e registrado: a SEQUÊNCIA de refeições ao longo de meses é um
--     traço comportamental consultável por SQL (jejum intermitente, p.ex.).
--     Entra no brief jurídico junto com eaten_at, não como decisão silenciosa.
--
-- text e não enum nativo: o projeto nunca usou enum PG (source, kind, status são
-- todos text), e enum exigiria migration para cada valor novo. A validação fica
-- em parseMeal(), que é onde os testes chegam.
--
-- NULL = "não informada". Legado NÃO é preenchido por horário: inferir
-- retroativamente é inventar dado. É também o que grava o pendente que expira —
-- o paciente comeu, e descartar o registro por ele não ter respondido uma
-- pergunta do bot seria tratar ausência de resposta como ausência de refeição.
ALTER TABLE food_log_entry ADD COLUMN IF NOT EXISTS meal text;
`,
  },
  {
    name: '0027_food_log_pending',
    sql: `
-- Registro alimentar À ESPERA da resposta "qual refeição?".
--
-- POR QUE NO BANCO e não em memória (globalThis), que seria mais simples:
--   1. CUSTO. A visão do Claude é chamada ANTES do pendente existir
--      (handlePhoto → estimator.estimate). Com estado em memória, todo deploy
--      (rolling, wait_timeout 5m no fly.toml) e todo crash fariam o paciente
--      reenviar a foto e PAGAR a estimativa de novo. O projeto já pagou caro por
--      custo não-controlado (vazamento de 2026-07-24).
--   2. VÁRIOS PENDENTES. Um Map por chat só comporta um. Com linha no banco e id
--      no callback_data, dois pratos seguidos convivem e cada pergunta é
--      respondida de forma independente.
--   3. JANELA REAL. O paciente responde 40 min depois, no ônibus. TTL curto em
--      memória não serve; TTL longo é vazamento de heap por chat.
--
-- Chaveado por PACIENTE (não por chat): o bot já resolveu chatId→patientId antes
-- de chamar o estimador, e assim grupo e privado se comportam igual.
--
-- values_enc: MESMO blob de food_log_entry (kcal/macros/itemsLabel) — é dado
-- clínico e vai cifrado (NFR9).
--
-- consumed_at é o CLAIM ATÔMICO. O SqlExecutor não expõe transação e em produção
-- é um Pool COMPARTILHADO (ver aviso em packages/audit/src/audit.ts), então
-- BEGIN/COMMIT não valem aqui: a exclusão mútua contra duplo clique no botão
-- precisa caber em UM statement — UPDATE ... WHERE consumed_at IS NULL
-- RETURNING, o mesmo padrão já usado no resgate do código de pareamento.
--
-- food_log_entry_id fecha a cadeia: se o processo morrer ENTRE o claim e o
-- INSERT do food log, a varredura acha consumed_at IS NOT NULL AND
-- food_log_entry_id IS NULL e termina o trabalho. Sem transação, é a única forma
-- honesta de garantir "exatamente uma vez".
CREATE TABLE IF NOT EXISTS food_log_pending (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id        uuid NOT NULL REFERENCES patient(id),
  chat_id           text NOT NULL,
  eaten_at          timestamptz NOT NULL,
  source            text NOT NULL DEFAULT 'telegram',
  photo_ref         text,
  values_enc        text NOT NULL,
  model_version     text,
  expires_at        timestamptz NOT NULL,
  consumed_at       timestamptz,
  food_log_entry_id uuid REFERENCES food_log_entry(id),
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_food_log_pending_patient
  ON food_log_pending(patient_id, created_at) WHERE consumed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_food_log_pending_expiry
  ON food_log_pending(expires_at) WHERE consumed_at IS NULL;
`,
  },
  {
    name: '0028_patient_reminder',
    sql: `
-- Lembretes PROATIVOS (E16 Fase 3): o bot deixa de ser só reativo e passa a
-- INICIAR contato — 16h (consumo do dia abaixo da meta) e 22h (refeição sem
-- registro). Vai ao ar DESLIGADO: ligar depende do parecer do CJ-14.
--
-- patient_reminder_log é a trava de "já mandei". Sem ela: um restart no meio da
-- janela reenviaria, e se algum dia houver 2 instâncias o paciente recebe em
-- dobro. O UNIQUE + ON CONFLICT DO NOTHING RETURNING é um CLAIM em UM statement,
-- porque o SqlExecutor não expõe transação (Pool compartilhado em produção) —
-- mesmo princípio do consumo do código de pareamento.
--
-- TRADE-OFF ASSUMIDO: claim ANTES de enviar torna a entrega "no máximo uma vez".
-- Se a Bot API falhar depois do claim, o lembrete daquele dia se perde. O inverso
-- (enviar e depois marcar) é "pelo menos uma vez" e gera duplicata. Para um
-- cutucão de aderência, um lembrete perdido é MUITO melhor que um repetido:
-- repetir "não recebi seu café da manhã" soa acusatório e quebra a confiança.
--
-- local_day é o dia LOCAL do paciente (BR), não UTC: às 22h em Brasília já é o
-- dia seguinte em UTC, e a trava tem que casar com o dia que o paciente vive.
--
-- Sem values_enc: a linha não guarda nutriente nem alimento. \`detail\` guarda no
-- máximo o RÓTULO da refeição faltante — mesma classe de metadado da coluna
-- food_log_entry.meal (0026), e pelos mesmos motivos.
CREATE TABLE IF NOT EXISTS patient_reminder_log (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES patient(id),
  kind       text NOT NULL,
  local_day  date NOT NULL,
  chat_id    text NOT NULL,
  detail     text,
  sent_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (patient_id, kind, local_day)
);
CREATE INDEX IF NOT EXISTS idx_patient_reminder_day
  ON patient_reminder_log(local_day, kind);

-- Opt-in do lembrete, no CANAL (não no paciente): a preferência é sobre o canal,
-- e revogar o canal já desliga tudo junto.
--
-- DEFAULT FALSE, e isso é o ponto: mensagem proativa é FINALIDADE NOVA sob a
-- LGPD. O texto de pareamento que os pacientes atuais aceitaram descrevia um bot
-- que RESPONDE — não um que inicia contato. Ninguém é migrado para "sim"; o
-- médico liga paciente a paciente, após o paciente re-consentir (CJ-14).
ALTER TABLE telegram_link ADD COLUMN IF NOT EXISTS reminders_enabled boolean NOT NULL DEFAULT false;

-- 'private' | 'group' | 'supergroup'. Preenchido no pareamento a partir do
-- update do Telegram. Serve para NÃO mandar mensagem proativa em GRUPO: um
-- lembrete de aderência num grupo com nutrólogo e nutricionista é divulgação de
-- dado de saúde a terceiros que o paciente não iniciou naquele momento.
-- Vínculo legado sem o valor cai no heurístico do id negativo (grupos no
-- Telegram têm chat_id < 0).
ALTER TABLE telegram_link ADD COLUMN IF NOT EXISTS chat_type text;
`,
  },
];
