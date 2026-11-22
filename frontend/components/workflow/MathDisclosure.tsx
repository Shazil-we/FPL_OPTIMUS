"use client";

import React, { useId, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { CaretDown, Function as FunctionIcon } from "@phosphor-icons/react";

export interface MathDisclosureProps {
  title?: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  className?: string;
}

/**
 * Expandable mathematical disclosure panel with reduced-motion support.
 */
export function MathDisclosure({
  title = "Inspect the Math",
  children,
  defaultOpen = false,
  className = "",
}: MathDisclosureProps) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();
  const reduceMotion = useReducedMotion();

  return (
    <div
      className={[
        "rounded-xl border border-ink-700 bg-ink-950/85 overflow-hidden",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((prev) => !prev)}
        className="w-full px-4 py-3 flex items-center justify-between gap-3 text-left transition-colors duration-150 hover:bg-ink-800/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-spark-400/75 cursor-pointer"
      >
        <span className="flex items-center gap-2.5 min-w-0">
          <FunctionIcon
            size={16}
            weight="bold"
            aria-hidden="true"
            className="text-crimson-400 shrink-0"
          />
          <span className="text-xs sm:text-sm font-medium text-mist-50 truncate">
            {title}
          </span>
        </span>
        <span className="flex items-center gap-2 shrink-0">
          <span className="hidden sm:inline text-[11px] font-mono text-mist-300">
            {open ? "Hide" : "Equations & Protocol"}
          </span>
          <CaretDown
            size={15}
            weight="bold"
            aria-hidden="true"
            className={[
              "text-mist-300 transition-transform duration-200",
              open ? "rotate-180 text-mist-50" : "",
            ].join(" ")}
          />
        </span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id={panelId}
            initial={
              reduceMotion ? { opacity: 1 } : { height: 0, opacity: 0 }
            }
            animate={{ height: "auto", opacity: 1 }}
            exit={reduceMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={
              reduceMotion
                ? { duration: 0 }
                : { duration: 0.24, ease: [0.22, 1, 0.36, 1] }
            }
            className="overflow-hidden border-t border-ink-700/80"
          >
            <div className="p-4 sm:p-5 text-xs sm:text-sm text-mist-300 leading-relaxed space-y-3 bg-ink-950/60">
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default MathDisclosure;
