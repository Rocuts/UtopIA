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
          "bg-[rgba(10,15,26,0.5)] border border-[rgba(212,160,23,0.08)] backdrop-blur-[12px] shadow-[0_4px_30px_rgba(0,0,0,0.15)] rounded-2xl",
          {
            "transition-all duration-300 hover:bg-[rgba(30,58,95,0.3)] hover:border-[rgba(212,160,23,0.2)]": hoverEffect,
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
