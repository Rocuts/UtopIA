// primitives/index.ts — Barrel export for editorial PDF primitives.
// ───────────────────────────────────────────────────────────────────────────

export * from '../tokens';
export { registerEditorialFonts, __resetFontsForTesting } from '../fonts';

// ── NEW primitives (ESLOP editorial rebuild) ───────────────────────────────

export { PageNumberBadge } from './PageNumberBadge';
export type { PageNumberBadgeProps } from './PageNumberBadge';

export { NormativePill } from './NormativePill';
export type { NormativePillProps, NormativePillTone } from './NormativePill';

export { MixedWeightHeadline } from './MixedWeightHeadline';
export type { MixedWeightHeadlineProps, HeadlinePart, HeadlineWeight } from './MixedWeightHeadline';

export { NumberedSectionHeader } from './NumberedSectionHeader';
export type { NumberedSectionHeaderProps } from './NumberedSectionHeader';

export { GoldRule } from './GoldRule';
export type { GoldRuleProps } from './GoldRule';

// ── Reworked primitives ────────────────────────────────────────────────────

export { EditorialTitle } from './EditorialTitle';
export type {
  EditorialTitleProps,
  EditorialTitleSize,
  EditorialTitleEmphasis,
  EditorialTitleTone,
} from './EditorialTitle';

export { TopoOrnament } from './TopoOrnament';
export type { TopoOrnamentProps, TopoVariant } from './TopoOrnament';

// ── Unchanged primitives (tokens verified, no hardcoded hexes found) ───────

export { CrescentMask } from './CrescentMask';
export type { CrescentMaskProps, CrescentSatellite } from './CrescentMask';

export { AvatarInitials } from './AvatarInitials';
export type { AvatarInitialsProps } from './AvatarInitials';

export { WatermarkWord } from './WatermarkWord';
export type { WatermarkWordProps } from './WatermarkWord';

export { MarkdownToPdf } from './MarkdownToPdf';
export type { MarkdownToPdfProps, MarkdownTone } from './MarkdownToPdf';

// ── Legacy — kept for backwards-compat; Team Z retires at final integration ─

export { PaginationFooter } from './PaginationFooter';
export type { PaginationFooterProps } from './PaginationFooter';

export { AuthorityChip } from './AuthorityChip';
export type { AuthorityChipProps, AuthorityChipTone } from './AuthorityChip';
