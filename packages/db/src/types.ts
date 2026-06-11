/** Tipos das linhas das entidades base (architecture.md §8). */

export interface AppUserRow {
  id: string;
  email: string;
  display_name: string;
  created_at: Date;
  updated_at: Date;
}

export interface ConsultationRow {
  id: string;
  user_id: string;
  /** PII/dado de saúde cifrado em repouso (AES-256-GCM, base64). */
  patient_label_enc: string;
  status: string;
  created_at: Date;
  updated_at: Date;
}

export interface ConsentRow {
  id: string;
  consultation_id: string;
  granted: boolean;
  granted_by: string | null;
  granted_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface AuditLogRow {
  id: string;
  contribution_id: string | null;
  /** Gatilho que disparou a contribuição (Trigger Detector — E4). */
  triggered_by: string;
  /** Fontes de KB usadas (Persona Reasoner/RAG — E5). Proveniência CFM (NFR10). */
  kb_sources: unknown;
  model_version: string;
  created_at: Date;
}
