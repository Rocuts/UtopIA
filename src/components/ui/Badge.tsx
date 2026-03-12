import { cn } from "@/lib/utils";
import { HTMLAttributes, forwardRef } from "react";

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: 'outline' | 'glow' | 'accent';
}

const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant = 'outline', ...props }, ref) => {
    return (
      <span
        ref={ref}
        className={cn(
          "inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wider",
          {
            "border border-[var(--surface-border-solid)] text-foreground/80": variant === 'outline',
            "bg-[var(--cyan-glow)] text-[var(--cyan-primary)] border border-[var(--cyan-primary)]/30": variant === 'glow',
            "bg-[var(--surface-border-solid)] text-[var(--cyan-primary)]": variant === 'accent',
          },
          className
        )}
        {...props}
      />
    );
  }
);
Badge.displayName = "Badge";

export { Badge };
