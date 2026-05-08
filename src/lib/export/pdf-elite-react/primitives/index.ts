// primitives/index.ts — Barrel export for editorial PDF primitives.
// ───────────────────────────────────────────────────────────────────────────

export * from '../tokens';
export { registerEditorialFonts, __resetFontsForTesting } from '../fonts';

export { EditorialTitle } from './EditorialTitle';
export type {
  EditorialTitleProps,
  EditorialTitleSize,
  EditorialTitleEmphasis,
  EditorialTitleTone,
} from './EditorialTitle';

export { AuthorityChip } from './AuthorityChip';
export type { AuthorityChipProps, AuthorityChipTone } from './AuthorityChip';

export { TopoOrnament } from './TopoOrnament';
export type { TopoOrnamentProps, TopoVariant } from './TopoOrnament';

export { CrescentMask } from './CrescentMask';
export type { CrescentMaskProps, CrescentSatellite } from './CrescentMask';

export { AvatarInitials } from './AvatarInitials';
export type { AvatarInitialsProps } from './AvatarInitials';

export { WatermarkWord } from './WatermarkWord';
export type { WatermarkWordProps } from './WatermarkWord';

export { PaginationFooter } from './PaginationFooter';
export type { PaginationFooterProps } from './PaginationFooter';

export { MarkdownToPdf } from './MarkdownToPdf';
export type { MarkdownToPdfProps, MarkdownTone } from './MarkdownToPdf';
