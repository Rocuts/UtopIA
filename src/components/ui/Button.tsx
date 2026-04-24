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
          "inline-flex items-center justify-center whitespace-nowrap rounded-sm text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0a0a0a] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
          {
            "bg-[#0a0a0a] text-white hover:bg-[#262626]": variant === 'primary',
            "bg-white text-[#0a0a0a] border border-[#e5e5e5] hover:bg-[#fafafa] hover:border-[#d4d4d4]": variant === 'secondary',
            "bg-transparent text-[#525252] hover:bg-[#fafafa] hover:text-[#0a0a0a]": variant === 'ghost',
            "bg-[#d4a017] text-white hover:bg-[#b8901a] focus-visible:ring-[#d4a017]": variant === 'accent',
            "bg-[#ef4444] text-white hover:bg-[#dc2626] focus-visible:ring-[#ef4444]": variant === 'danger',
            // elite: premium gold gradient on dark text, used inside data-theme="elite" subtrees.
            // Forwards the look of EliteButton variant="primary" without requiring the Motion wrapper.
            "rounded-[10px] text-black font-semibold bg-[linear-gradient(135deg,#D4A017_0%,#E8B42C_100%)] hover:bg-[linear-gradient(135deg,#E8B42C_0%,#F5C63F_100%)] focus-visible:ring-[#D4A017] border border-[rgba(0,0,0,0.12)] shadow-[0_0_22px_rgba(212,160,23,0.18)] hover:shadow-[0_0_32px_rgba(212,160,23,0.32)]": variant === 'elite',
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
