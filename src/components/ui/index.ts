// Public barrel for @/components/ui primitives.
//
// Keep imports direct from this file; tree-shaking works because every source
// here already uses named exports and no side effects.

// Elite / premium primitives — deprecated aliases kept for back-compat.
// Prefer `Button` / `Card` below with variant props (sprint-2 unification).
export {
  EliteButton,
  type EliteButtonProps,
  type EliteButtonVariant,
  type EliteButtonSize,
} from './EliteButton';
export {
  EliteCard,
  type EliteCardProps,
  type EliteCardVariant,
  type EliteCardHover,
  type EliteCardPadding,
} from './EliteCard';
export { GlassModal, type GlassModalProps, type GlassModalSize } from './GlassModal';
export {
  PremiumKpiCard,
  type PremiumKpiCardProps,
  type KpiSeverity,
  type KpiAccent,
  type KpiTrend,
  type KpiTrendDirection,
} from './PremiumKpiCard';
export { GradientBorder, type GradientBorderProps, type GradientBorderVariant } from './GradientBorder';
export { ShimmerLoader, type ShimmerLoaderProps, type ShimmerVariant } from './ShimmerLoader';
export { Skeleton, type SkeletonProps } from './Skeleton';
export { SkeletonText, type SkeletonTextProps } from './SkeletonText';
export { SkeletonCard, type SkeletonCardProps } from './SkeletonCard';
export { SkeletonKpi, type SkeletonKpiProps } from './SkeletonKpi';
export {
  SectionHeader,
  type SectionHeaderProps,
  type SectionHeaderAccent,
  type SectionHeaderAlign,
} from './SectionHeader';

// Base primitives (shared between landing light theme and elite subtree)
export {
  Button,
  type ButtonProps,
  type ButtonVariant,
  type ButtonSize,
} from './Button';
export {
  Card,
  type CardProps,
  type CardVariant,
  type CardHover,
  type CardPadding,
} from './Card';
export { Badge, type BadgeProps, type StatusLevel } from './Badge';
export { GlassPanel, type GlassPanelVariant } from './GlassPanel';
