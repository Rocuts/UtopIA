import { cn } from "@/lib/utils";
import { forwardRef, HTMLAttributes } from "react";
import { GlassPanel } from "./GlassPanel";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  hoverEffect?: boolean;
  elevated?: boolean;
}

interface CardSubComponentProps extends HTMLAttributes<HTMLDivElement> {
  children?: React.ReactNode;
}

const CardHeader = forwardRef<HTMLDivElement, CardSubComponentProps>(
  ({ className, children, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("pb-4 border-b border-n-200", className)}
      {...props}
    >
      {children}
    </div>
  )
);
CardHeader.displayName = "Card.Header";

const CardBody = forwardRef<HTMLDivElement, CardSubComponentProps>(
  ({ className, children, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("py-4", className)}
      {...props}
    >
      {children}
    </div>
  )
);
CardBody.displayName = "Card.Body";

const CardFooter = forwardRef<HTMLDivElement, CardSubComponentProps>(
  ({ className, children, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("pt-4 border-t border-n-200", className)}
      {...props}
    >
      {children}
    </div>
  )
);
CardFooter.displayName = "Card.Footer";

const CardBase = forwardRef<HTMLDivElement, CardProps>(
  ({ className, children, hoverEffect = true, elevated = false, ...props }, ref) => {
    return (
      <GlassPanel
        ref={ref}
        hoverEffect={hoverEffect}
        elevated={elevated}
        className={cn("p-5 sm:p-7 flex flex-col gap-4", className)}
        {...props}
      >
        {children}
      </GlassPanel>
    );
  }
);
CardBase.displayName = "Card";

const Card = Object.assign(CardBase, {
  Header: CardHeader,
  Body: CardBody,
  Footer: CardFooter,
});

export { Card };
export type { CardProps };
