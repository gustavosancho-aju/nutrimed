import { describe, it, expect } from 'vitest';
import { isTranscriptSilent } from './pipeline-watchdog';

describe('isTranscriptSilent (A3 — watchdog da consulta ao vivo)', () => {
  const liveSince = 100_000;

  it('sem NENHUM transcript e 10s passados → avisa', () => {
    expect(isTranscriptSilent(liveSince, null, liveSince + 10_000)).toBe(true);
  });

  it('sem transcript mas ainda dentro dos 10s → não avisa', () => {
    expect(isTranscriptSilent(liveSince, null, liveSince + 9_999)).toBe(false);
  });

  it('transcript ANTERIOR ao live não conta (sessão antiga)', () => {
    expect(isTranscriptSilent(liveSince, liveSince - 5_000, liveSince + 12_000)).toBe(true);
  });

  it('transcript recebido após o live → não avisa', () => {
    expect(isTranscriptSilent(liveSince, liveSince + 3_000, liveSince + 60_000)).toBe(false);
  });
});
