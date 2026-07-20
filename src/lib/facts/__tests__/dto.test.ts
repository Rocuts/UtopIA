import { describe, expect, it } from 'vitest';
import { toFactDTO } from '../dto';
import type { WorkspaceFact } from '@/lib/db/schema';

const base: WorkspaceFact = {
  id: 'f1',
  workspaceId: 'w1',
  kind: 'donation',
  title: 'Donación fundación X',
  body: 'Donación a la fundación X.',
  structured: { montoCentavos: '5000000000', articulo: '257', fiscalYear: '2026' },
  fiscalPeriod: '2026',
  status: 'active',
  supersededById: null,
  source: 'manual',
  createdAt: new Date('2026-07-18T10:00:00.000Z'),
  updatedAt: new Date('2026-07-18T10:00:00.000Z'),
  revokedAt: null,
};

describe('toFactDTO', () => {
  it('serializa fechas a ISO y preserva el resto', () => {
    const dto = toFactDTO(base);
    expect(dto.createdAt).toBe('2026-07-18T10:00:00.000Z');
    expect(dto.revokedAt).toBeNull();
    expect(dto.kind).toBe('donation');
    expect(dto.structured).toEqual({ montoCentavos: '5000000000', articulo: '257', fiscalYear: '2026' });
    expect(dto.fiscalPeriod).toBe('2026');
  });

  it('serializa revokedAt cuando existe', () => {
    const dto = toFactDTO({ ...base, status: 'revoked', revokedAt: new Date('2026-07-19T00:00:00.000Z') });
    expect(dto.revokedAt).toBe('2026-07-19T00:00:00.000Z');
    expect(dto.status).toBe('revoked');
  });

  it('structured null (narrative) se preserva', () => {
    const dto = toFactDTO({ ...base, kind: 'narrative', structured: null });
    expect(dto.structured).toBeNull();
  });
});
