import { describe, it, expect } from 'vitest';
import { getHealth } from './health';

describe('getHealth (smoke)', () => {
  it('reporta status ok para o NutriMed', () => {
    const report = getHealth();
    expect(report.status).toBe('ok');
    expect(report.app.name).toBe('NutriMed');
  });

  it('expõe a versão do app a partir do tipo compartilhado', () => {
    expect(getHealth().app.version).toBe('0.1.0');
  });
});
