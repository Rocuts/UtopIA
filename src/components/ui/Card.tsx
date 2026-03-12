import { cn } from "@/lib/utils";
import { forwardRef, HTMLAttributes } from "react";
import { GlassPanel } from "./GlassPanel";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  hoverEffect?: boolean;
}

const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ className, children, hoverEffect = true, ...props }, ref) => {
    return (
      <GlassPanel
        ref={ref}
        hoverEffect={hoverEffect}
        className={cn("p-6 sm:p-8 flex flex-col gap-4", className)}
        {...props}
      >
        {children}
      </GlassPanel>
    );
  }
);
Card.displayName = "Card";

export { Card };
