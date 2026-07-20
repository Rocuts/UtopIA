import { describe, expect, it } from 'vitest';
import { computeSuggestedRoute } from '../suggested-route';
import type { AgentDomain } from '../../types';

const call = (domains: AgentDomain[], intent: string, confidence = 0.9) =>
  computeSuggestedRoute({ domains, intent, confidence });

describe('computeSuggestedRoute', () => {
  it('devuelve null bajo el umbral de confianza', () => {
    expect(call(['tax'], 'tax_planning', 0.5)).toBeNull();
  });

  it('devuelve null con domains vacío', () => {
    expect(call([], 'anything')).toBeNull();
  });

  it('litigation → Defensa DIAN sin importar el intent', () => {
    const r = call(['litigation'], 'greeting');
    expect(r).toEqual({
      label: 'Defensa DIAN',
      href: '/workspace/escudo/defensa-dian',
      moduleKey: 'defensa-dian',
    });
  });

  it('tax + requerimiento_response → Defensa DIAN', () => {
    expect(call(['tax'], 'requerimiento_response')?.moduleKey).toBe('defensa-dian');
  });

  it('tax + recurso_reconsideracion → Defensa DIAN', () => {
    expect(call(['tax'], 'recurso_reconsideracion')?.moduleKey).toBe('defensa-dian');
  });

  it('tax + precios/transferencia → Precios de Transferencia', () => {
    expect(call(['tax'], 'transfer_pricing_query')?.moduleKey).toBe('precios-transferencia');
    expect(call(['tax'], 'precios_de_transferencia')?.moduleKey).toBe('precios-transferencia');
  });

  it('tax + tax_planning → Planeación Tributaria', () => {
    const r = call(['tax'], 'tax_planning');
    expect(r).toEqual({
      label: 'Planeación Tributaria',
      href: '/workspace/escudo/planeacion-tributaria',
      moduleKey: 'planeacion-tributaria',
    });
  });

  it('strategy + refund_strategy → Planeación Tributaria', () => {
    expect(call(['strategy'], 'refund_strategy')?.moduleKey).toBe('planeacion-tributaria');
  });

  it('strategy + due_diligence → Valor', () => {
    expect(call(['strategy'], 'due_diligence')?.moduleKey).toBe('valor');
  });

  it('strategy + valoración (con acento) → Valor', () => {
    expect(call(['strategy'], 'valoración_empresa')?.moduleKey).toBe('valor');
  });

  it('accounting + revisoria_fiscal → Verdad', () => {
    expect(call(['accounting'], 'revisoria_fiscal')?.moduleKey).toBe('verdad');
  });

  it('accounting + dictamen → Verdad', () => {
    expect(call(['accounting'], 'dictamen_review')?.moduleKey).toBe('verdad');
  });

  it('strategy + feasibility/escenarios → Futuro', () => {
    expect(call(['strategy'], 'feasibility_study')?.moduleKey).toBe('futuro');
    expect(call(['strategy'], 'escenario_projection')?.moduleKey).toBe('futuro');
  });

  it('tax genérico (iva_treatment) → null (conservador)', () => {
    expect(call(['tax'], 'iva_treatment')).toBeNull();
  });

  it('accounting genérico (niif_recognition) → null (conservador)', () => {
    expect(call(['accounting'], 'niif_recognition')).toBeNull();
  });

  it('precedencia: litigation gana sobre un intent de planeación', () => {
    expect(call(['litigation', 'tax'], 'tax_planning')?.moduleKey).toBe('defensa-dian');
  });

  it('todas las rutas devueltas existen bajo /workspace', () => {
    const hrefs = [
      call(['litigation'], 'x')?.href,
      call(['tax'], 'transferencia')?.href,
      call(['tax'], 'tax_planning')?.href,
      call(['strategy'], 'due_diligence')?.href,
      call(['accounting'], 'revisoria')?.href,
      call(['strategy'], 'feasibility')?.href,
    ];
    expect(hrefs).toEqual([
      '/workspace/escudo/defensa-dian',
      '/workspace/escudo/precios-transferencia',
      '/workspace/escudo/planeacion-tributaria',
      '/workspace/valor',
      '/workspace/verdad',
      '/workspace/futuro',
    ]);
  });
});
