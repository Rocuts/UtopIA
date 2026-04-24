import { cn } from "@/lib/utils";
import { ButtonHTMLAttributes, forwardRef } from "react";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'accent' | 'danger' | 'elite';
  size?: 'sm' | 'md' | 'lg';
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          "inline-flex items-center justify-center whitespace-nowrap rounded-sm text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-n-900 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
          {
            "bg-n-900 text-n-0 hover:bg-n-700": variant === 'primary',
            "bg-n-0 text-n-900 border border-n-200 hover:bg-n-50 hover:border-n-300": variant === 'secondary',
            "bg-transparent text-n-600 hover:bg-n-50 hover:text-n-900": variant === 'ghost',
            "bg-gold-500 text-n-0 hover:bg-gold-600 focus-visible:ring-gold-500": variant === 'accent',
            "bg-danger text-n-0 hover:bg-danger/90 focus-visible:ring-danger": variant === 'danger',
            // elite: premium gold token on dark text, used inside data-theme="elite" subtrees.
            // Forwards the look of EliteButton variant="primary" without requiring the Motion wrapper.
            "rounded-lg text-n-1000 font-semibold bg-gold-500 hover:bg-gold-600 focus-visible:ring-gold-500 border border-n-1000/10 shadow-glow-gold-soft hover:shadow-glow-gold": variant === 'elite',
            "h-8 px-3 text-xs": size === 'sm',
            "h-10 px-5": size === 'md',
            "h-12 px-8 text-base": size === 'lg',
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
