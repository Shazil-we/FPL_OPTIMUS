import React from "react";

export type BadgeTone =
  | "neutral"
  | "crimson"
  | "cobalt"
  | "spark"
  | "gold"
  | "danger";

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  children: React.ReactNode;
}

const TONE_CLASSES: Record<BadgeTone, string> = {
  neutral: "bg-ink-800 text-mist-300 border-ink-700",
  crimson: "bg-crimson-950 text-mist-50 border-crimson-500/60",
  cobalt: "bg-cobalt-950 text-cobalt-400 border-cobalt-500/45",
  spark: "bg-spark-950 text-spark-400 border-spark-400/40",
  gold: "bg-gold-950 text-gold-400 border-gold-400/40",
  danger: "bg-danger-950 text-danger-400 border-danger-400/50",
};

/**
 * Compact monospace status and metadata pill.
 */
export function Badge({
  tone = "neutral",
  className = "",
  children,
  ...props
}: BadgeProps) {
  return (
    <span
      className={[
        "inline-flex items-center gap-1 whitespace-nowrap rounded-md px-2 py-0.5 text-[11px] font-mono font-semibold border",
        TONE_CLASSES[tone],
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...props}
    >
      {children}
    </span>
  );
}
