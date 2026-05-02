/**
 * PUC PYMES Colombia — Plan Unico de Cuentas para Microempresas y PYMES.
 *
 * Base normativa:
 *   - Decreto 2706/2012 (PUC para microempresas, Grupo 3 NIIF).
 *   - Decreto 2420/2015 Anexo 2 (NIIF para PYMES — IFRS for SMEs ES, Grupo 2).
 *   - PUC para Comerciantes (Decreto 2650/1993) como referencia jerarquica de
 *     codigos hasta el quinto digito (subcuenta/auxiliar).
 *
 * Estructura jerarquica del codigo PUC:
 *   - Nivel 1 (clase):     1 digito  — ej. "1" (ACTIVO)
 *   - Nivel 2 (grupo):     2 digitos — ej. "11" (DISPONIBLE)
 *   - Nivel 3 (cuenta):    4 digitos — ej. "1105" (CAJA)
 *   - Nivel 4 (subcuenta): 6 digitos — ej. "110505" (CAJA GENERAL)
 *   - Nivel 5 (auxiliar):  7-8+ digitos — opcional, definido por la empresa.
 *
 * Reglas de postabilidad:
 *   - Niveles 1, 2 y 3 NO son postables (sirven solo para sumarizar
 *     reportes financieros). En este seed los nivel-3 los marcamos
 *     `is_postable=false` y dejamos las nivel-4 como las hojas postables.
 *   - Nivel 4 ES postable por defecto. Si una empresa quiere abrir
 *     auxiliares (nivel 5), creara filas hijas con `is_postable=true` y
 *     marcara la nivel-4 padre como `is_postable=false` en runtime.
 *
 * Subset PYMES vs PUC completo:
 *   - Cubrimos las 6 clases principales (1..6). Las clases 7 (costos de
 *     producción), 8 y 9 (orden) las omitimos en este seed inicial — una
 *     PYME comercial/servicios típica no las usa. Quedan disponibles via
 *     accountTypeEnum.ORDEN_DEUDORA / ORDEN_ACREEDORA / COSTO si se
 *     necesitan en el futuro.
 *
 * Aplicación:
 *   - `seedPucForWorkspace(db, workspaceId)` hace bulk INSERT con
 *     ON CONFLICT (workspace_id, code) DO NOTHING — idempotente y seguro
 *     para correr múltiples veces sin duplicar.
 *   - El padre (`parent_id`) se resuelve en dos pasadas: primero se
 *     inserta sin parent_id (todas las cuentas existen), después se hace
 *     UPDATE para enlazar parent_id mediante el `parent_code`.
 *   - NO se llama automaticamente desde getOrCreateWorkspace en este
 *     commit — los Agentes B/C y la UI lo invocaran cuando el wizard de
 *     "configurar empresa" decida arrancar el libro.
 */

import { sql } from 'drizzle-orm';
import { chartOfAccounts } from '../schema';
import type { getDb } from '../client';

type DrizzleDb = ReturnType<typeof getDb>;

// Subset de account_type que el seed referencia. La columna real acepta
// los valores extendidos (ORDEN_DEUDORA / ORDEN_ACREEDORA), pero en el
// seed PYMES solo tocamos los principales.
type SeedAccountType =
  | 'ACTIVO'
  | 'PASIVO'
  | 'PATRIMONIO'
  | 'INGRESO'
  | 'GASTO'
  | 'COSTO';

export interface AccountSeed {
  code: string;
  name: string;
  type: SeedAccountType;
  level: 1 | 2 | 3 | 4 | 5;
  parentCode: string | null;
  isPostable: boolean;
  requiresThirdParty?: boolean;
  requiresCostCenter?: boolean;
}

/**
 * PUC PYMES — subset comercial/servicios. ~80 cuentas.
 *
 * Convencion: niveles 1-3 NO postables, nivel 4 SI. Los grupos cubren los
 * casos canonicos del Decreto 2706/2012 + 2420/2015 Anexo 2.
 */
export const PUC_PYME_COLOMBIA: AccountSeed[] = [
  // ════════════════════════════════════════════════════════════════════════
  // CLASE 1 — ACTIVO
  // ════════════════════════════════════════════════════════════════════════
  { code: '1',     name: 'ACTIVO',                                                   type: 'ACTIVO', level: 1, parentCode: null,    isPostable: false },

  // 11 DISPONIBLE
  { code: '11',    name: 'DISPONIBLE',                                                type: 'ACTIVO', level: 2, parentCode: '1',     isPostable: false },
  { code: '1105',  name: 'CAJA',                                                      type: 'ACTIVO', level: 3, parentCode: '11',    isPostable: false },
  { code: '110505', name: 'Caja general',                                              type: 'ACTIVO', level: 4, parentCode: '1105',  isPostable: true },
  { code: '110510', name: 'Cajas menores',                                             type: 'ACTIVO', level: 4, parentCode: '1105',  isPostable: true },
  { code: '1110',  name: 'BANCOS',                                                    type: 'ACTIVO', level: 3, parentCode: '11',    isPostable: false },
  { code: '111005', name: 'Moneda nacional - Cuenta corriente',                        type: 'ACTIVO', level: 4, parentCode: '1110',  isPostable: true,  requiresThirdParty: true },
  { code: '111010', name: 'Moneda extranjera - Cuenta corriente',                      type: 'ACTIVO', level: 4, parentCode: '1110',  isPostable: true,  requiresThirdParty: true },
  { code: '1120',  name: 'CUENTAS DE AHORRO',                                         type: 'ACTIVO', level: 3, parentCode: '11',    isPostable: false },
  { code: '112005', name: 'Bancos - Cuenta de ahorros moneda nacional',                type: 'ACTIVO', level: 4, parentCode: '1120',  isPostable: true,  requiresThirdParty: true },
  { code: '112010', name: 'Bancos - Cuenta de ahorros moneda extranjera',              type: 'ACTIVO', level: 4, parentCode: '1120',  isPostable: true,  requiresThirdParty: true },

  // 13 DEUDORES
  { code: '13',    name: 'DEUDORES',                                                  type: 'ACTIVO', level: 2, parentCode: '1',     isPostable: false },
  { code: '1305',  name: 'CLIENTES',                                                  type: 'ACTIVO', level: 3, parentCode: '13',    isPostable: false },
  { code: '130505', name: 'Clientes nacionales',                                       type: 'ACTIVO', level: 4, parentCode: '1305',  isPostable: true,  requiresThirdParty: true },
  { code: '130510', name: 'Clientes del exterior',                                     type: 'ACTIVO', level: 4, parentCode: '1305',  isPostable: true,  requiresThirdParty: true },
  { code: '1355',  name: 'ANTICIPO DE IMPUESTOS Y CONTRIBUCIONES',                    type: 'ACTIVO', level: 3, parentCode: '13',    isPostable: false },
  { code: '135515', name: 'Retención en la fuente (anticipo)',                         type: 'ACTIVO', level: 4, parentCode: '1355',  isPostable: true },
  { code: '135517', name: 'Impuesto a las ventas retenido',                            type: 'ACTIVO', level: 4, parentCode: '1355',  isPostable: true },
  { code: '135518', name: 'Industria y comercio retenido',                             type: 'ACTIVO', level: 4, parentCode: '1355',  isPostable: true },

  // 14 INVENTARIOS
  { code: '14',    name: 'INVENTARIOS',                                                type: 'ACTIVO', level: 2, parentCode: '1',     isPostable: false },
  { code: '1435',  name: 'MERCANCIAS NO FABRICADAS POR LA EMPRESA',                    type: 'ACTIVO', level: 3, parentCode: '14',    isPostable: false },
  { code: '143505', name: 'Mercancia para la venta',                                    type: 'ACTIVO', level: 4, parentCode: '1435',  isPostable: true },

  // 15 PROPIEDADES, PLANTA Y EQUIPO
  { code: '15',    name: 'PROPIEDADES PLANTA Y EQUIPO',                                type: 'ACTIVO', level: 2, parentCode: '1',     isPostable: false },
  { code: '1504',  name: 'TERRENOS',                                                   type: 'ACTIVO', level: 3, parentCode: '15',    isPostable: false },
  { code: '150405', name: 'Urbanos',                                                    type: 'ACTIVO', level: 4, parentCode: '1504',  isPostable: true },
  { code: '1516',  name: 'CONSTRUCCIONES Y EDIFICACIONES',                             type: 'ACTIVO', level: 3, parentCode: '15',    isPostable: false },
  { code: '151605', name: 'Edificios',                                                  type: 'ACTIVO', level: 4, parentCode: '1516',  isPostable: true },
  { code: '1524',  name: 'EQUIPO DE OFICINA',                                          type: 'ACTIVO', level: 3, parentCode: '15',    isPostable: false },
  { code: '152405', name: 'Muebles y enseres',                                          type: 'ACTIVO', level: 4, parentCode: '1524',  isPostable: true,  requiresCostCenter: true },
  { code: '1528',  name: 'EQUIPO DE COMPUTACION Y COMUNICACION',                       type: 'ACTIVO', level: 3, parentCode: '15',    isPostable: false },
  { code: '152805', name: 'Equipos de procesamiento de datos',                          type: 'ACTIVO', level: 4, parentCode: '1528',  isPostable: true,  requiresCostCenter: true },
  { code: '152810', name: 'Equipos de telecomunicaciones',                              type: 'ACTIVO', level: 4, parentCode: '1528',  isPostable: true,  requiresCostCenter: true },
  // Depreciacion acumulada (saldo natural credito, presentado restando)
  { code: '1592',  name: 'DEPRECIACION ACUMULADA',                                     type: 'ACTIVO', level: 3, parentCode: '15',    isPostable: false },
  { code: '159205', name: 'Construcciones y edificaciones',                             type: 'ACTIVO', level: 4, parentCode: '1592',  isPostable: true },
  { code: '159210', name: 'Equipo de oficina',                                          type: 'ACTIVO', level: 4, parentCode: '1592',  isPostable: true },
  { code: '159215', name: 'Equipo de computacion y comunicacion',                       type: 'ACTIVO', level: 4, parentCode: '1592',  isPostable: true },

  // ════════════════════════════════════════════════════════════════════════
  // CLASE 2 — PASIVO
  // ════════════════════════════════════════════════════════════════════════
  { code: '2',     name: 'PASIVO',                                                    type: 'PASIVO', level: 1, parentCode: null,    isPostable: false },

  // 21 OBLIGACIONES FINANCIERAS
  { code: '21',    name: 'OBLIGACIONES FINANCIERAS',                                  type: 'PASIVO', level: 2, parentCode: '2',     isPostable: false },
  { code: '2105',  name: 'BANCOS NACIONALES',                                         type: 'PASIVO', level: 3, parentCode: '21',    isPostable: false },
  { code: '210505', name: 'Sobregiros bancarios',                                       type: 'PASIVO', level: 4, parentCode: '2105',  isPostable: true,  requiresThirdParty: true },
  { code: '210510', name: 'Pagares',                                                    type: 'PASIVO', level: 4, parentCode: '2105',  isPostable: true,  requiresThirdParty: true },

  // 22 PROVEEDORES
  { code: '22',    name: 'PROVEEDORES',                                                type: 'PASIVO', level: 2, parentCode: '2',     isPostable: false },
  { code: '2205',  name: 'NACIONALES',                                                 type: 'PASIVO', level: 3, parentCode: '22',    isPostable: false },
  { code: '220505', name: 'Proveedores nacionales',                                     type: 'PASIVO', level: 4, parentCode: '2205',  isPostable: true,  requiresThirdParty: true },

  // 23 CUENTAS POR PAGAR
  { code: '23',    name: 'CUENTAS POR PAGAR',                                          type: 'PASIVO', level: 2, parentCode: '2',     isPostable: false },
  { code: '2335',  name: 'COSTOS Y GASTOS POR PAGAR',                                  type: 'PASIVO', level: 3, parentCode: '23',    isPostable: false },
  { code: '233505', name: 'Gastos financieros',                                         type: 'PASIVO', level: 4, parentCode: '2335',  isPostable: true,  requiresThirdParty: true },
  { code: '233525', name: 'Honorarios',                                                 type: 'PASIVO', level: 4, parentCode: '2335',  isPostable: true,  requiresThirdParty: true },
  { code: '233530', name: 'Servicios tecnicos',                                         type: 'PASIVO', level: 4, parentCode: '2335',  isPostable: true,  requiresThirdParty: true },

  // 24 IMPUESTOS, GRAVAMENES Y TASAS
  { code: '24',    name: 'IMPUESTOS GRAVAMENES Y TASAS',                               type: 'PASIVO', level: 2, parentCode: '2',     isPostable: false },
  { code: '2365',  name: 'RETENCION EN LA FUENTE',                                     type: 'PASIVO', level: 3, parentCode: '24',    isPostable: false },
  { code: '236505', name: 'Salarios y pagos laborales',                                  type: 'PASIVO', level: 4, parentCode: '2365',  isPostable: true },
  { code: '236510', name: 'Honorarios',                                                  type: 'PASIVO', level: 4, parentCode: '2365',  isPostable: true },
  { code: '236525', name: 'Servicios',                                                   type: 'PASIVO', level: 4, parentCode: '2365',  isPostable: true },
  { code: '236540', name: 'Compras',                                                     type: 'PASIVO', level: 4, parentCode: '2365',  isPostable: true },
  { code: '2404',  name: 'IMPUESTO SOBRE LAS VENTAS POR PAGAR (IVA)',                   type: 'PASIVO', level: 3, parentCode: '24',    isPostable: false },
  { code: '240405', name: 'IVA generado (debito)',                                       type: 'PASIVO', level: 4, parentCode: '2404',  isPostable: true },
  { code: '240410', name: 'IVA descontable (credito)',                                   type: 'PASIVO', level: 4, parentCode: '2404',  isPostable: true },
  { code: '2408',  name: 'IMPUESTO DE INDUSTRIA Y COMERCIO',                            type: 'PASIVO', level: 3, parentCode: '24',    isPostable: false },
  { code: '240805', name: 'Vigencia fiscal corriente',                                   type: 'PASIVO', level: 4, parentCode: '2408',  isPostable: true },

  // 25 OBLIGACIONES LABORALES
  { code: '25',    name: 'OBLIGACIONES LABORALES',                                     type: 'PASIVO', level: 2, parentCode: '2',     isPostable: false },
  { code: '2505',  name: 'SALARIOS POR PAGAR',                                         type: 'PASIVO', level: 3, parentCode: '25',    isPostable: false },
  { code: '250505', name: 'Salarios por pagar',                                          type: 'PASIVO', level: 4, parentCode: '2505',  isPostable: true,  requiresThirdParty: true },

  // 26 PASIVOS ESTIMADOS Y PROVISIONES
  { code: '26',    name: 'PASIVOS ESTIMADOS Y PROVISIONES',                            type: 'PASIVO', level: 2, parentCode: '2',     isPostable: false },
  { code: '2610',  name: 'PARA OBLIGACIONES LABORALES',                                type: 'PASIVO', level: 3, parentCode: '26',    isPostable: false },
  { code: '261005', name: 'Cesantias',                                                   type: 'PASIVO', level: 4, parentCode: '2610',  isPostable: true,  requiresThirdParty: true },
  { code: '261010', name: 'Intereses sobre cesantias',                                   type: 'PASIVO', level: 4, parentCode: '2610',  isPostable: true,  requiresThirdParty: true },
  { code: '261015', name: 'Vacaciones',                                                  type: 'PASIVO', level: 4, parentCode: '2610',  isPostable: true,  requiresThirdParty: true },
  { code: '261020', name: 'Prima de servicios',                                          type: 'PASIVO', level: 4, parentCode: '2610',  isPostable: true,  requiresThirdParty: true },

  // 28 OTROS PASIVOS / DIFERIDOS
  { code: '28',    name: 'OTROS PASIVOS',                                              type: 'PASIVO', level: 2, parentCode: '2',     isPostable: false },
  { code: '2815',  name: 'INGRESOS RECIBIDOS POR ANTICIPADO',                          type: 'PASIVO', level: 3, parentCode: '28',    isPostable: false },
  { code: '281505', name: 'Anticipos de clientes',                                       type: 'PASIVO', level: 4, parentCode: '2815',  isPostable: true,  requiresThirdParty: true },

  // ════════════════════════════════════════════════════════════════════════
  // CLASE 3 — PATRIMONIO
  // ════════════════════════════════════════════════════════════════════════
  { code: '3',     name: 'PATRIMONIO',                                                 type: 'PATRIMONIO', level: 1, parentCode: null, isPostable: false },
  { code: '31',    name: 'CAPITAL SOCIAL',                                             type: 'PATRIMONIO', level: 2, parentCode: '3',  isPostable: false },
  { code: '3115',  name: 'APORTES SOCIALES',                                           type: 'PATRIMONIO', level: 3, parentCode: '31', isPostable: false },
  { code: '311505', name: 'Cuotas o partes de interes social',                           type: 'PATRIMONIO', level: 4, parentCode: '3115', isPostable: true },
  { code: '32',    name: 'SUPERAVIT DE CAPITAL',                                       type: 'PATRIMONIO', level: 2, parentCode: '3',  isPostable: false },
  { code: '3205',  name: 'PRIMA EN COLOCACION DE ACCIONES',                            type: 'PATRIMONIO', level: 3, parentCode: '32', isPostable: false },
  { code: '320505', name: 'Prima en colocacion de acciones',                             type: 'PATRIMONIO', level: 4, parentCode: '3205', isPostable: true },
  { code: '33',    name: 'RESERVAS',                                                   type: 'PATRIMONIO', level: 2, parentCode: '3',  isPostable: false },
  { code: '3305',  name: 'RESERVAS OBLIGATORIAS',                                       type: 'PATRIMONIO', level: 3, parentCode: '33', isPostable: false },
  { code: '330505', name: 'Reserva legal',                                                type: 'PATRIMONIO', level: 4, parentCode: '3305', isPostable: true },
  { code: '36',    name: 'RESULTADOS DEL EJERCICIO',                                    type: 'PATRIMONIO', level: 2, parentCode: '3',  isPostable: false },
  { code: '3605',  name: 'UTILIDAD DEL EJERCICIO',                                      type: 'PATRIMONIO', level: 3, parentCode: '36', isPostable: false },
  { code: '360505', name: 'Utilidad del ejercicio',                                      type: 'PATRIMONIO', level: 4, parentCode: '3605', isPostable: true },
  { code: '3610',  name: 'PERDIDA DEL EJERCICIO',                                       type: 'PATRIMONIO', level: 3, parentCode: '36', isPostable: false },
  { code: '361005', name: 'Perdida del ejercicio',                                       type: 'PATRIMONIO', level: 4, parentCode: '3610', isPostable: true },
  { code: '37',    name: 'RESULTADOS DE EJERCICIOS ANTERIORES',                          type: 'PATRIMONIO', level: 2, parentCode: '3',  isPostable: false },
  { code: '3705',  name: 'UTILIDADES ACUMULADAS',                                        type: 'PATRIMONIO', level: 3, parentCode: '37', isPostable: false },
  { code: '370505', name: 'Utilidades acumuladas',                                        type: 'PATRIMONIO', level: 4, parentCode: '3705', isPostable: true },

  // ════════════════════════════════════════════════════════════════════════
  // CLASE 4 — INGRESOS
  // ════════════════════════════════════════════════════════════════════════
  { code: '4',     name: 'INGRESOS',                                                   type: 'INGRESO', level: 1, parentCode: null,   isPostable: false },
  { code: '41',    name: 'OPERACIONALES',                                              type: 'INGRESO', level: 2, parentCode: '4',    isPostable: false },
  { code: '4135',  name: 'COMERCIO AL POR MAYOR Y AL POR MENOR',                       type: 'INGRESO', level: 3, parentCode: '41',   isPostable: false },
  { code: '413505', name: 'Venta de mercancias',                                         type: 'INGRESO', level: 4, parentCode: '4135', isPostable: true,  requiresCostCenter: true },
  { code: '4170',  name: 'ACTIVIDADES DE SERVICIOS',                                    type: 'INGRESO', level: 3, parentCode: '41',   isPostable: false },
  { code: '417005', name: 'Servicios profesionales',                                     type: 'INGRESO', level: 4, parentCode: '4170', isPostable: true,  requiresCostCenter: true },
  { code: '4175',  name: 'DEVOLUCIONES EN VENTAS',                                       type: 'INGRESO', level: 3, parentCode: '41',   isPostable: false },
  { code: '417505', name: 'Devoluciones en ventas',                                      type: 'INGRESO', level: 4, parentCode: '4175', isPostable: true },
  { code: '42',    name: 'NO OPERACIONALES',                                            type: 'INGRESO', level: 2, parentCode: '4',    isPostable: false },
  { code: '4210',  name: 'FINANCIEROS',                                                 type: 'INGRESO', level: 3, parentCode: '42',   isPostable: false },
  { code: '421005', name: 'Intereses ganados',                                           type: 'INGRESO', level: 4, parentCode: '4210', isPostable: true },
  { code: '421020', name: 'Diferencia en cambio',                                        type: 'INGRESO', level: 4, parentCode: '4210', isPostable: true },

  // ════════════════════════════════════════════════════════════════════════
  // CLASE 5 — GASTOS
  // ════════════════════════════════════════════════════════════════════════
  { code: '5',     name: 'GASTOS',                                                     type: 'GASTO', level: 1, parentCode: null,    isPostable: false },
  { code: '51',    name: 'OPERACIONALES DE ADMINISTRACION',                             type: 'GASTO', level: 2, parentCode: '5',    isPostable: false },
  { code: '5105',  name: 'GASTOS DE PERSONAL',                                          type: 'GASTO', level: 3, parentCode: '51',   isPostable: false },
  { code: '510506', name: 'Sueldos',                                                     type: 'GASTO', level: 4, parentCode: '5105', isPostable: true,  requiresCostCenter: true },
  { code: '510527', name: 'Auxilio de transporte',                                       type: 'GASTO', level: 4, parentCode: '5105', isPostable: true,  requiresCostCenter: true },
  { code: '510530', name: 'Cesantias',                                                   type: 'GASTO', level: 4, parentCode: '5105', isPostable: true,  requiresCostCenter: true },
  { code: '510536', name: 'Prima de servicios',                                          type: 'GASTO', level: 4, parentCode: '5105', isPostable: true,  requiresCostCenter: true },
  { code: '510568', name: 'Aportes ARL/EPS/Pension',                                     type: 'GASTO', level: 4, parentCode: '5105', isPostable: true,  requiresCostCenter: true },
  { code: '5110',  name: 'HONORARIOS',                                                   type: 'GASTO', level: 3, parentCode: '51',   isPostable: false },
  { code: '511015', name: 'Asesoria juridica',                                           type: 'GASTO', level: 4, parentCode: '5110', isPostable: true,  requiresThirdParty: true,  requiresCostCenter: true },
  { code: '511020', name: 'Asesoria contable y tributaria',                               type: 'GASTO', level: 4, parentCode: '5110', isPostable: true,  requiresThirdParty: true,  requiresCostCenter: true },
  { code: '5120',  name: 'ARRENDAMIENTOS',                                               type: 'GASTO', level: 3, parentCode: '51',   isPostable: false },
  { code: '512010', name: 'Construcciones y edificaciones',                              type: 'GASTO', level: 4, parentCode: '5120', isPostable: true,  requiresThirdParty: true,  requiresCostCenter: true },
  { code: '5135',  name: 'SERVICIOS',                                                    type: 'GASTO', level: 3, parentCode: '51',   isPostable: false },
  { code: '513525', name: 'Acueducto y alcantarillado',                                   type: 'GASTO', level: 4, parentCode: '5135', isPostable: true,  requiresCostCenter: true },
  { code: '513530', name: 'Energia electrica',                                           type: 'GASTO', level: 4, parentCode: '5135', isPostable: true,  requiresCostCenter: true },
  { code: '513535', name: 'Telefono',                                                    type: 'GASTO', level: 4, parentCode: '5135', isPostable: true,  requiresCostCenter: true },
  { code: '513540', name: 'Correo, portes y telegramas',                                  type: 'GASTO', level: 4, parentCode: '5135', isPostable: true,  requiresCostCenter: true },
  { code: '513550', name: 'Internet',                                                    type: 'GASTO', level: 4, parentCode: '5135', isPostable: true,  requiresCostCenter: true },
  { code: '5145',  name: 'MANTENIMIENTO Y REPARACIONES',                                  type: 'GASTO', level: 3, parentCode: '51',   isPostable: false },
  { code: '514510', name: 'Construcciones y edificaciones',                              type: 'GASTO', level: 4, parentCode: '5145', isPostable: true,  requiresCostCenter: true },
  { code: '514520', name: 'Equipo de oficina',                                           type: 'GASTO', level: 4, parentCode: '5145', isPostable: true,  requiresCostCenter: true },
  { code: '514525', name: 'Equipo de computacion',                                       type: 'GASTO', level: 4, parentCode: '5145', isPostable: true,  requiresCostCenter: true },
  { code: '5160',  name: 'DEPRECIACIONES',                                               type: 'GASTO', level: 3, parentCode: '51',   isPostable: false },
  { code: '516005', name: 'Construcciones y edificaciones',                              type: 'GASTO', level: 4, parentCode: '5160', isPostable: true },
  { code: '516010', name: 'Equipo de oficina',                                           type: 'GASTO', level: 4, parentCode: '5160', isPostable: true },
  { code: '516015', name: 'Equipo de computacion y comunicacion',                         type: 'GASTO', level: 4, parentCode: '5160', isPostable: true },

  { code: '52',    name: 'OPERACIONALES DE VENTAS',                                     type: 'GASTO', level: 2, parentCode: '5',    isPostable: false },
  { code: '5205',  name: 'GASTOS DE PERSONAL DE VENTAS',                                 type: 'GASTO', level: 3, parentCode: '52',   isPostable: false },
  { code: '520506', name: 'Sueldos vendedores',                                          type: 'GASTO', level: 4, parentCode: '5205', isPostable: true,  requiresCostCenter: true },
  { code: '520527', name: 'Comisiones de ventas',                                        type: 'GASTO', level: 4, parentCode: '5205', isPostable: true,  requiresCostCenter: true },

  { code: '53',    name: 'NO OPERACIONALES',                                            type: 'GASTO', level: 2, parentCode: '5',    isPostable: false },
  { code: '5305',  name: 'FINANCIEROS',                                                  type: 'GASTO', level: 3, parentCode: '53',   isPostable: false },
  { code: '530505', name: 'Gastos bancarios',                                             type: 'GASTO', level: 4, parentCode: '5305', isPostable: true },
  { code: '530520', name: 'Intereses',                                                    type: 'GASTO', level: 4, parentCode: '5305', isPostable: true },
  { code: '530525', name: 'Diferencia en cambio',                                         type: 'GASTO', level: 4, parentCode: '5305', isPostable: true },
  { code: '530595', name: 'Gravamen movimientos financieros (4 x 1000)',                  type: 'GASTO', level: 4, parentCode: '5305', isPostable: true },
  { code: '5315',  name: 'GASTOS EXTRAORDINARIOS',                                        type: 'GASTO', level: 3, parentCode: '53',   isPostable: false },
  { code: '531505', name: 'Costas y procesos judiciales',                                 type: 'GASTO', level: 4, parentCode: '5315', isPostable: true },
  { code: '531520', name: 'Multas, sanciones y litigios',                                 type: 'GASTO', level: 4, parentCode: '5315', isPostable: true },

  { code: '54',    name: 'IMPUESTO DE RENTA Y COMPLEMENTARIOS',                          type: 'GASTO', level: 2, parentCode: '5',    isPostable: false },
  { code: '5405',  name: 'IMPUESTO DE RENTA Y COMPLEMENTARIOS',                          type: 'GASTO', level: 3, parentCode: '54',   isPostable: false },
  { code: '540505', name: 'Impuesto de renta y complementarios',                          type: 'GASTO', level: 4, parentCode: '5405', isPostable: true },

  // ════════════════════════════════════════════════════════════════════════
  // CLASE 6 — COSTOS DE VENTAS
  // ════════════════════════════════════════════════════════════════════════
  { code: '6',     name: 'COSTOS DE VENTAS',                                            type: 'COSTO', level: 1, parentCode: null,   isPostable: false },
  { code: '61',    name: 'COSTO DE VENTAS Y DE PRESTACION DE SERVICIOS',                  type: 'COSTO', level: 2, parentCode: '6',    isPostable: false },
  { code: '6135',  name: 'COMERCIO AL POR MAYOR Y AL POR MENOR',                          type: 'COSTO', level: 3, parentCode: '61',   isPostable: false },
  { code: '613505', name: 'Costo de mercancias vendidas',                                  type: 'COSTO', level: 4, parentCode: '6135', isPostable: true,  requiresCostCenter: true },
];

/**
 * Aplica el seed PUC PYMES Colombia a un workspace.
 *
 * Estrategia idempotente:
 *   1. Bulk INSERT con `ON CONFLICT (workspace_id, code) DO NOTHING` —
 *      la migración ya creó el unique index `coa_ws_code_uniq`.
 *   2. Resolver `parent_id` con un UPDATE post-insert que mapea
 *      `parent_code` → `chart_of_accounts.id`. Solo actualizamos filas
 *      cuyo parent_id sigue NULL (idempotencia).
 *
 * @returns numero de cuentas insertadas (0 si ya estaba seedeado).
 */
export async function seedPucForWorkspace(
  db: DrizzleDb,
  workspaceId: string,
): Promise<number> {
  if (PUC_PYME_COLOMBIA.length === 0) {
    return 0;
  }

  const rows = PUC_PYME_COLOMBIA.map((seed) => ({
    workspaceId,
    code: seed.code,
    name: seed.name,
    type: seed.type,
    level: seed.level,
    isPostable: seed.isPostable,
    requiresThirdParty: seed.requiresThirdParty ?? false,
    requiresCostCenter: seed.requiresCostCenter ?? false,
    // parentId queda null en el insert; lo resolvemos en la siguiente
    // sentencia con un UPDATE FROM. Esto evita el problema del orden de
    // inserción y el overhead de un grafo de dependencias.
    parentId: null as string | null,
    active: true,
    currency: 'COP',
  }));

  const inserted = await db
    .insert(chartOfAccounts)
    .values(rows)
    .onConflictDoNothing({
      target: [chartOfAccounts.workspaceId, chartOfAccounts.code],
    })
    .returning({ id: chartOfAccounts.id });

  // Resolver parent_id en una sola pasada SQL. Usamos un VALUES list con
  // los pares (childCode, parentCode) y un JOIN contra la tabla.
  const parentPairs = PUC_PYME_COLOMBIA.filter((s) => s.parentCode !== null).map(
    (s) => `('${s.code}','${s.parentCode}')`,
  );

  if (parentPairs.length > 0) {
    const valuesList = parentPairs.join(', ');
    await db.execute(sql`
      UPDATE chart_of_accounts AS child
      SET parent_id = parent.id
      FROM (VALUES ${sql.raw(valuesList)}) AS map(child_code, parent_code)
      JOIN chart_of_accounts AS parent
        ON parent.workspace_id = ${workspaceId}
       AND parent.code = map.parent_code
      WHERE child.workspace_id = ${workspaceId}
        AND child.code = map.child_code
        AND child.parent_id IS NULL
    `);
  }

  return inserted.length;
}
