import { cn } from "@/lib/utils";
import { HTMLAttributes, forwardRef } from "react";

type StatusLevel = 'bajo' | 'medio' | 'alto' | 'critico' | 'success' | 'warning' | 'danger' | 'info' | 'gold' | 'neutral';

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: 'outline' | 'solid' | 'muted' | 'status';
  status?: StatusLevel;
}

/**
 * Token-driven status colors. Uses CSS class tokens only; no hex.
 *  - bg:   translucent tint of the semantic color
 *  - text: semantic foreground
 *  - dot:  solid accent used for the status dot
 *
 * Consumers that import by hex (legacy) should migrate to `status` names.
 */
const STATUS_TOKENS: Record<StatusLevel, { bg: string; text: string; dot: string }> = {
  // Legacy severity aliases — preserved for back-compat, mapped to semantic tokens.
  bajo:    { bg: 'bg-success/10',  text: 'text-success',  dot: 'bg-success' },
  medio:   { bg: 'bg-warning/10',  text: 'text-warning',  dot: 'bg-warning' },
  alto:    { bg: 'bg-warning/10',  text: 'text-warning',  dot: 'bg-warning' },
  critico: { bg: 'bg-danger/10',   text: 'text-danger',   dot: 'bg-danger'  },
  // Semantic names (preferred).
  success: { bg: 'bg-success/10',  text: 'text-success',  dot: 'bg-success' },
  warning: { bg: 'bg-warning/10',  text: 'text-warning',  dot: 'bg-warning' },
  danger:  { bg: 'bg-danger/10',   text: 'text-danger',   dot: 'bg-danger'  },
  info:    { bg: 'bg-info/10',     text: 'text-info',     dot: 'bg-info'    },
  gold:    { bg: 'bg-gold-500/10', text: 'text-gold-500', dot: 'bg-gold-500'},
  neutral: { bg: 'bg-n-200/60',    text: 'text-n-600',    dot: 'bg-n-400'   },
};

const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant = 'outline', status, children, ...rest }, ref) => {
    const isStatus = variant === 'status' && status;
    const tokens = isStatus ? STATUS_TOKENS[status] : null;

    return (
      <span
        ref={ref}
        className={cn(
          "inline-flex items-center rounded-sm px-2.5 py-0.5 text-xs font-medium tracking-wide",
          {
            "border border-n-200 text-n-600": variant === 'outline',
            "bg-n-900 text-n-0": variant === 'solid',
            "bg-n-50 text-n-600 border border-n-200": variant === 'muted',
          },
          isStatus && tokens ? [tokens.bg, tokens.text] : null,
          className
        )}
        {...rest}
      >
        {isStatus && tokens && (
          <span
            className={cn("mr-1.5 inline-block h-1.5 w-1.5 rounded-full shrink-0", tokens.dot)}
            aria-hidden="true"
          />
        )}
        {children}
      </span>
    );
  }
);
Badge.displayName = "Badge";

export { Badge };
export type { BadgeProps, StatusLevel };
