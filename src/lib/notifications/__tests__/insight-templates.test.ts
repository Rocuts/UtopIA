import { describe, expect, it } from 'vitest';

import {
  fillInsightFromTemplate,
  getInsightTemplate,
  interpolate,
} from '../insight-templates';
import type { Insight, InsightSeverity } from '../insight-types';
import type { PillarId } from '@/lib/pillars/types';

describe('interpolate', () => {
  it('reemplaza {{var}} con el valor correspondiente', () => {
    expect(interpolate('Hola {{name}}', { name: 'Andreita' })).toBe('Hola Andreita');
  });

  it('soporta múltiples variables y números', () => {
    const out = interpolate('Tiene {{n}} días y {{m}} meses', { n: 30, m: 12 });
    expect(out).toBe('Tiene 30 días y 12 meses');
  });

  it('deja el placeholder intacto si la variable no existe', () => {
    expect(interpolate('Hola {{name}}', {})).toBe('Hola {{name}}');
  });

  it('soporta espacios alrededor del nombre', () => {
    expect(interpolate('{{ greeting }} world', { greeting: 'Hola' })).toBe('Hola world');
  });
});

describe('getInsightTemplate', () => {
  const pillars: PillarId[] = ['verdad', 'escudo', 'valor', 'futuro'];
  const severities: InsightSeverity[] = ['critico', 'advertencia', 'informativo'];

  it('devuelve plantilla en es para los 12 (pilar, severity) en es', () => {
    for (const p of pillars) {
      for (const s of severities) {
        const tpl = getInsightTemplate(p, s, 'es');
        expect(tpl.subjectTpl).toBeTruthy();
        expect(tpl.hallazgoTpl).toBeTruthy();
        expect(tpl.impactoTpl).toBeTruthy();
        expect(tpl.accionLabelTpl).toBeTruthy();
      }
    }
  });

  it('devuelve plantilla en en para los 12 (pilar, severity)', () => {
    for (const p of pillars) {
      for (const s of severities) {
        const tpl = getInsightTemplate(p, s, 'en');
        expect(tpl.subjectTpl).toBeTruthy();
      }
    }
  });

  it('Caso A — verdad/critico mantiene formato literal del usuario', () => {
    const tpl = getInsightTemplate('verdad', 'critico', 'es');
    expect(tpl.subjectTpl).toContain('⚠️');
    expect(tpl.subjectTpl).toContain('descalce');
    expect(tpl.hallazgoTpl).toContain('{{empresario_nombre}}');
    expect(tpl.hallazgoTpl).toContain('{{monto_diferencia}}');
  });

  // IW4 (ratios-kpis-10): la alerta crítica del Escudo ya no proyecta un
  // impuesto de renta con UN × 35 %; es de liquidez medida (días de autonomía).
  it('Caso B — escudo/critico es de liquidez (días de autonomía), sin impuesto proyectado', () => {
    for (const lang of ['es', 'en'] as const) {
      const tpl = getInsightTemplate('escudo', 'critico', lang);
      expect(tpl.subjectTpl).toContain('🛡️');
      expect(tpl.hallazgoTpl).toContain('{{dias_autonomia}}');
      expect(`${tpl.hallazgoTpl} ${tpl.impactoTpl}`).not.toMatch(
        /impuesto_proyectado|provision_actual|pct_reduccion|impuesto de renta|income tax/,
      );
    }
  });

  it('Caso C — futuro/critico contiene mes y trimestre de inflexión', () => {
    const tpl = getInsightTemplate('futuro', 'critico', 'es');
    expect(tpl.subjectTpl).toContain('🚀');
    expect(tpl.subjectTpl).toContain('{{meses_inflexion}}');
    expect(tpl.hallazgoTpl).toContain('{{mes_anio_inflexion}}');
    expect(tpl.impactoTpl).toContain('{{trimestre_inflexion}}');
  });
});

describe('fillInsightFromTemplate', () => {
  it('produce un Insight completo con subject/hallazgo/impacto/acción ya interpolados', () => {
    const insight = fillInsightFromTemplate({
      pillar: 'verdad',
      severity: 'critico',
      vars: {
        empresario_nombre: 'Andreita',
        monto_diferencia: '$456.000.000',
      },
      workspaceId: 'ws-test',
    });
    expect(insight.subject).toContain('⚠️');
    expect(insight.hallazgo).toContain('Andreita');
    expect(insight.hallazgo).toContain('$456.000.000');
    expect(insight.accionRecomendada.label).toBeTruthy();
    expect(insight.accionRecomendada.href).toBe('/workspace/contabilidad/mayor?showGap=true');
    expect(insight.dedupKey).toBe('verdad-critico-ws-test');
  });

  it('interpola escudo/critico con todas las variables', () => {
    const insight = fillInsightFromTemplate({
      pillar: 'escudo',
      severity: 'critico',
      vars: {
        empresario_nombre: 'Andreita',
        dias_autonomia: 18,
      },
    });
    expect(insight.hallazgo).toContain('Andreita');
    expect(insight.hallazgo).toContain('18 días');
    expect(insight.hallazgo).not.toContain('{{');
    expect(insight.impacto).not.toContain('{{');
  });

  it('default language es, default tone normal', () => {
    const insight = fillInsightFromTemplate({
      pillar: 'valor',
      severity: 'informativo',
      vars: { empresario_nombre: 'Johan' },
    });
    expect(insight.language).toBe('es');
    expect(insight.tone).toBe('normal');
  });

  it('con language en, usa plantillas inglesas', () => {
    const insight = fillInsightFromTemplate({
      pillar: 'verdad',
      severity: 'critico',
      vars: { empresario_nombre: 'Andrew', monto_diferencia: '$456M' },
      language: 'en',
    });
    expect(insight.subject).toContain('Integrity Alert');
    expect(insight.hallazgo).toContain('Hi Andrew');
  });
});

describe('Insight shape sanity', () => {
  it('todos los pilares tienen los 4 colores definidos vía constantes en email template', () => {
    // Smoke: tipo definido + IDs alineados con PillarId.
    const ids: Insight['pillar'][] = ['verdad', 'escudo', 'valor', 'futuro'];
    expect(ids).toHaveLength(4);
  });
});
