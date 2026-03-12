import { cn } from "@/lib/utils";
import { HTMLAttributes, forwardRef } from "react";

interface GlassPanelProps extends HTMLAttributes<HTMLDivElement> {
  hoverEffect?: boolean;
}

const GlassPanel = forwardRef<HTMLDivElement, GlassPanelProps>(
  ({ className, hoverEffect = false, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          "bg-[rgba(15,23,42,0.4)] border border-[rgba(148,163,184,0.08)] backdrop-blur-[12px] shadow-[0_4px_30px_rgba(0,0,0,0.1)] rounded-2xl",
          {
            "transition-all duration-300 hover:bg-[rgba(30,41,59,0.6)] hover:border-[rgba(148,163,184,0.15)]": hoverEffect,
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
