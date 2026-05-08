// index.ts — public barrel for the editorial PDF export pipeline.
export { composeEditorialReport } from './compose';
export type { ComposeInput } from './compose';
export { renderEditorialReportToStream } from './render';
export type { EditorialReport, EmittableGate } from './types';
