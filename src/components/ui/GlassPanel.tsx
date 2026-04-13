import { cn } from "@/lib/utils";
import { HTMLAttributes, forwardRef } from "react";

interface GlassPanelProps extends HTMLAttributes<HTMLDivElement> {
  hoverEffect?: boolean;
  elevated?: boolean;
}

const GlassPanel = forwardRef<HTMLDivElement, GlassPanelProps>(
  ({ className, hoverEffect = false, elevated = false, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          "bg-white border border-[#e5e5e5] rounded-sm",
          {
            "transition-colors duration-100 hover:border-[#d4d4d4] hover:bg-[#fafafa]": hoverEffect,
            "shadow-sm": elevated,
          },
          className
        )}
        {...props}
      />
    );
  }
);
GlassPanel.displayName = "GlassPanel";

export { GlassPanel };
