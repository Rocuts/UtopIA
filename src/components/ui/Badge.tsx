import { cn } from "@/lib/utils";
import { HTMLAttributes, forwardRef } from "react";

type StatusLevel = 'bajo' | 'medio' | 'alto' | 'critico' | 'success' | 'warning' | 'danger' | 'info';

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: 'outline' | 'solid' | 'muted' | 'status';
  status?: StatusLevel;
}

const STATUS_COLORS: Record<StatusLevel, { dot: string; bg: string; text: string }> = {
  bajo:     { dot: '#22c55e', bg: 'rgba(34, 197, 94, 0.08)',  text: '#16a34a' },
  medio:    { dot: '#eab308', bg: 'rgba(234, 179, 8, 0.08)',  text: '#ca8a04' },
  alto:     { dot: '#f97316', bg: 'rgba(249, 115, 22, 0.08)', text: '#ea580c' },
  critico:  { dot: '#ef4444', bg: 'rgba(239, 68, 68, 0.08)',  text: '#dc2626' },
  success:  { dot: '#22c55e', bg: 'rgba(34, 197, 94, 0.08)',  text: '#16a34a' },
  warning:  { dot: '#eab308', bg: 'rgba(234, 179, 8, 0.08)',  text: '#ca8a04' },
  danger:   { dot: '#ef4444', bg: 'rgba(239, 68, 68, 0.08)',  text: '#dc2626' },
  info:     { dot: '#525252', bg: 'rgba(82, 82, 82, 0.06)',   text: '#525252' },
};

const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant = 'outline', status, style, children, ...rest }, ref) => {
    const isStatus = variant === 'status' && status;
    const colors = isStatus ? STATUS_COLORS[status] : null;

    const mergedStyle = isStatus
      ? { backgroundColor: colors!.bg, color: colors!.text, ...(style || {}) }
      : style;

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
        style={mergedStyle}
        {...rest}
      >
        {isStatus && (
          <span
            className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full shrink-0"
            style={{ backgroundColor: colors!.dot }}
            aria-hidden="true"
          />
        )}
        {children}
      </span>
    );
  }
);
Badge.displayName = "Badge";

export { Badge };
export type { BadgeProps, StatusLevel };
