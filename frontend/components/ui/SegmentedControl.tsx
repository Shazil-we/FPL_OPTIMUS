"use client";

import React, { useId } from "react";
import { motion, useReducedMotion } from "motion/react";

export type SegmentedTone = "crimson" | "cobalt" | "neutral";

export interface SegmentedOption<T extends string> {
  value: T;
  label: React.ReactNode;
  disabled?: boolean;
  icon?: React.ReactNode;
}

export interface SegmentedControlProps<T extends string> {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  tone?: SegmentedTone;
  size?: "sm" | "md";
  ariaLabel?: string;
  fullWidth?: boolean;
  className?: string;
}

const ACTIVE_TONE_CLASSES: Record<SegmentedTone, string> = {
  crimson: "bg-crimson-500 text-mist-50 shadow-sm",
  cobalt: "bg-cobalt-500 text-mist-50 shadow-sm",
  neutral: "bg-ink-700 text-mist-50 shadow-sm",
};

const SIZE_CLASSES: Record<"sm" | "md", string> = {
  sm: "px-2.5 py-1 text-xs",
  md: "px-3 py-1.5 text-xs sm:text-sm",
};

/**
 * Typed segmented tab bar with Motion active-pill sliding and reduced-motion fallback.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  tone = "neutral",
  size = "sm",
  ariaLabel = "Options",
  fullWidth = false,
  className = "",
}: SegmentedControlProps<T>) {
  const indicatorId = useId();
  const reduceMotion = useReducedMotion();

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={[
        "inline-flex flex-wrap items-center gap-1 rounded-lg border border-ink-700 bg-ink-950/90 p-1",
        fullWidth ? "w-full" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {options.map((opt) => {
        const isActive = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={isActive}
            disabled={opt.disabled}
            onClick={() => onChange(opt.value)}
            className={[
              "relative inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-semibold",
              "transition-colors duration-150 active:scale-[0.98]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-spark-400/75",
              "disabled:pointer-events-none disabled:opacity-40 cursor-pointer",
              fullWidth ? "flex-1" : "",
              SIZE_CLASSES[size],
              isActive
                ? "text-mist-50"
                : "text-mist-300 hover:bg-ink-800/70 hover:text-mist-50",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            {isActive && (
              <motion.span
                layoutId={reduceMotion ? undefined : `seg-${indicatorId}`}
                transition={
                  reduceMotion
                    ? { duration: 0 }
                    : { type: "spring", stiffness: 420, damping: 34 }
                }
                aria-hidden="true"
                className={[
                  "absolute inset-0 rounded-md",
                  ACTIVE_TONE_CLASSES[tone],
                ].join(" ")}
              />
            )}
            <span className="relative z-10 inline-flex items-center gap-1.5">
              {opt.icon}
              {opt.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
