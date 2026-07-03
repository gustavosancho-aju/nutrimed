export {
  createConsultation,
  grantConsent,
  revokeConsent,
  getConsentStatus,
  isCaptureAuthorized,
  assertCaptureAuthorized,
  listConsultationsByPatient,
  ConsentRequiredError,
  type ConsentStatus,
  type ConsultationSummary,
} from './consent';
