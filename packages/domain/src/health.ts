import type { AppInfo, HealthReport } from '@nutrimed/shared-types';

const APP: AppInfo = { name: 'NutriMed', version: '0.1.0' };

/**
 * Health check de domínio — usado pelo esqueleto para provar o linking
 * cross-package (domain → shared-types) e como alvo do teste smoke (AC 4).
 */
export function getHealth(): HealthReport {
  return { status: 'ok', app: APP };
}
