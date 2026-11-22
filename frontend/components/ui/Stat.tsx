import React from "react";

export type StatTone =
  | "neutral"
  | "crimson"
  | "cobalt"
  | "spark"
  | "gold"
  | "danger";

export interface StatProps {
  label: React.ReactNode;
  value: React.ReactNode;
  subValue?: React.ReactNode;
  tone?: StatTone;
  align?: "left" | "center" | "right";
  className?: string;
}

const VALUE_TONE_CLASSES: Record<StatTone, string> = {
  neutral: "text-mist-50",
  crimson: "text-crimson-400",
  cobalt: "text-cobalt-400",
  spark: "text-spark-400",
  gold: "text-gold-400",
  danger: "text-danger-400",
};

const ALIGN_CLASSES: Record<"left" | "center" | "right", string> = {
  left: "items-start text-left",
  center: "items-center text-center",
  right: "items-end text-right",
};

/**
 * Compact telemetry metric block with tabular monospace numerals.
 */
export function Stat({
  label,
  value,
  subValue,
  tone = "neutral",
  align = "left",
  className = "",
}: StatProps) {
  return (
    <div
      className={[
        "flex flex-col gap-0.5",
        ALIGN_CLASSES[align],
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <span className="text-[11px] font-medium text-mist-300">{label}</span>
      <span
        className={[
          "font-mono text-lg sm:text-xl font-bold leading-tight tabular-nums tracking-tight",
          VALUE_TONE_CLASSES[tone],
        ].join(" ")}
      >
        {value}
      </span>
      {subValue !== undefined && subValue !== null && (
        <span className="text-[11px] font-mono text-mist-300 tabular-nums">
          {subValue}
        </span>
      )}
    </div>
  );
}
