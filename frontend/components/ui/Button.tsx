import React from "react";

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "ghost"
  | "danger"
  | "outline";

export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    "bg-crimson-500 hover:bg-crimson-400 text-mist-50 border border-transparent shadow-sm shadow-crimson-950/60",
  secondary:
    "bg-cobalt-500 hover:bg-cobalt-400 text-mist-50 border border-transparent shadow-sm shadow-cobalt-950/60",
  ghost:
    "bg-ink-800/80 hover:bg-ink-700 text-mist-50 border border-ink-700",
  danger:
    "bg-danger-950 hover:bg-danger-400/20 text-danger-400 border border-danger-400/50",
  outline:
    "bg-ink-950/70 hover:bg-ink-800 text-mist-50 border border-mist-300/40 backdrop-blur-md",
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-xs gap-1.5",
  md: "h-9 px-4 text-xs sm:text-sm gap-2",
  lg: "h-11 px-5 text-sm sm:text-base gap-2.5",
};

/**
 * Shared tactile button primitive with WCAG AA contrast across all variants.
 */
export function Button({
  variant = "primary",
  size = "md",
  type = "button",
  className = "",
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={[
        "inline-flex items-center justify-center whitespace-nowrap rounded-md font-semibold",
        "transition-all duration-150 ease-out active:scale-[0.98]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-spark-400/75 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-950",
        "disabled:pointer-events-none disabled:opacity-45 cursor-pointer",
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...props}
    >
      {children}
    </button>
  );
}
