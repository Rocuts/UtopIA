import { cn } from "@/lib/utils";
import { ButtonHTMLAttributes, forwardRef } from "react";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'glass' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          "inline-flex items-center justify-center whitespace-nowrap rounded-full text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
          {
            "bg-[#00e5ff] text-[#0f172a] hover:bg-[#60a5fa] hover:shadow-[0_0_15px_rgba(0,229,255,0.4)]": variant === 'primary',
            "bg-transparent border border-[var(--surface-border-solid)] text-foreground hover:bg-[var(--surface-border-hover)] hover:text-[#00e5ff]": variant === 'secondary',
            "glass-panel text-foreground hover:text-[#00e5ff]": variant === 'glass',
            "hover:bg-[var(--surface-border-hover)] text-foreground": variant === 'ghost',
            "h-9 px-4 py-2": size === 'sm',
            "h-11 px-6 sm:h-12 sm:px-8 py-2": size === 'md',
            "h-14 px-8 text-base": size === 'lg',
          },
          className
        )}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button };
