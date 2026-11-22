import React from "react";

export type PanelVariant = "default" | "elevated" | "crimson" | "cobalt";

export interface PanelProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: PanelVariant;
  children: React.ReactNode;
}

const VARIANT_CLASSES: Record<PanelVariant, string> = {
  default: "bg-ink-900 border-ink-700",
  elevated:
    "bg-ink-800/85 border-ink-700 shadow-[inset_0_1px_0_rgba(238,234,244,0.06)] shadow-lg shadow-ink-950/60",
  crimson:
    "bg-ink-900 border-crimson-500/45 shadow-[inset_0_1px_0_rgba(229,34,90,0.16)]",
  cobalt:
    "bg-ink-900 border-cobalt-500/45 shadow-[inset_0_1px_0_rgba(108,140,240,0.16)]",
};

/**
 * Structured dark surface container with consistent border and elevation tokens.
 */
export function Panel({
  variant = "default",
  className = "",
  children,
  ...props
}: PanelProps) {
  return (
    <div
      className={[
        "rounded-xl border",
        VARIANT_CLASSES[variant],
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...props}
    >
      {children}
    </div>
  );
}
