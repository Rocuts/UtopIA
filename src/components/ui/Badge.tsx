import { cn } from "@/lib/utils";
import { HTMLAttributes, forwardRef } from "react";

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: 'outline' | 'solid' | 'muted';
}

const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant = 'outline', ...props }, ref) => {
    return (
      <span
        ref={ref}
        className={cn(
          "inline-flex items-center rounded-sm px-2.5 py-0.5 text-xs font-medium tracking-wide",
          {
            "border border-[#e5e5e5] text-[#525252]": variant === 'outline',
            "bg-[#0a0a0a] text-white": variant === 'solid',
            "bg-[#fafafa] text-[#525252] border border-[#e5e5e5]": variant === 'muted',
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
