export {
  EMPTY_FORM,
  sanitizeForm,
  applyKnownFields,
  OBJETIVO_PRINCIPAL,
  DOENCAS_ASSOCIADAS,
  HISTORICO_FAMILIAR,
  ALIMENTACAO,
  SONO,
  EXAME_FISICO,
  OBJETIVOS_TERAPEUTICOS,
  RISCO_CARDIOMETABOLICO,
  type ConsultationForm,
  type FormOption,
  type KnownFields,
} from './schema';
export { extractConsultationForm } from './extract';
export {
  saveConsultationForm,
  loadConsultationForm,
  type StoredConsultationForm,
} from './store';
