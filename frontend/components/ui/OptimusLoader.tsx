"use client";

import React from "react";

export type OptimusLoaderMode = "fullscreen" | "panel" | "compact";

export interface OptimusLoaderProps {
  mode?: OptimusLoaderMode;
  label?: string;
  sublabel?: string;
  playbackRate?: number;
  className?: string;
}

const CROWN_PATH =
  "M 119.5 10.8 L 147.6 12.9 L 181.2 22.7 L 185.8 25.2 L 182.3 42.0 L 119.5 83.6 L 56.7 42.0 L 53.2 25.2 L 57.8 22.7 L 91.4 12.9 Z M 84.7 34.6 L 154.3 34.6 L 119.5 59.1 Z";
const RIGHT_BROW_PATH =
  "M 228.0 22.9 L 194.7 24.8 L 190.2 46.2 L 147.0 76.0 L 140.5 118.3 L 180.0 112.3 L 214.5 87.3 Z M 209.6 45.1 L 161.0 78.0 L 160.6 85.0 L 207.5 53.5 Z M 206.5 64.0 L 158.5 95.8 L 157.8 103.8 L 205.4 72.4 Z";
const LEFT_BROW_PATH =
  "M 11.0 22.9 L 44.3 24.8 L 48.8 46.2 L 92.0 76.0 L 98.5 118.3 L 59.0 112.3 L 24.5 87.3 Z M 29.4 45.1 L 78.0 78.0 L 78.4 85.0 L 31.5 53.5 Z M 32.5 64.0 L 80.5 95.8 L 81.2 103.8 L 33.6 72.4 Z";
const NOSE_PATH =
  "M 100.0 81.0 L 119.5 93.4 L 139.0 81.0 L 132.8 120.0 L 132.4 173.0 L 106.6 173.0 L 106.2 120.0 Z";
const MOUTHPLATE_PATH =
  "M 98.5 127.5 L 98.7 181.6 L 140.3 181.6 L 140.5 127.5 L 163.1 139.5 L 162.7 214.8 L 152.5 224.0 L 140.6 194.5 L 119.5 193.5 L 98.4 194.5 L 86.5 224.0 L 76.3 214.8 L 75.9 139.5 Z";
const LEFT_CHEEK_PATH =
  "M 30.0 101.5 L 50.2 115.8 L 51.4 126.6 L 67.0 138.5 L 67.0 207.4 L 36.0 181.4 Z";
const RIGHT_CHEEK_PATH =
  "M 209.0 101.5 L 188.8 115.8 L 187.6 126.6 L 172.0 138.5 L 172.0 207.4 L 203.0 181.4 Z";
const CHIN_PATH =
  "M 104.1 201.9 L 134.9 201.9 L 145.2 228.6 L 93.8 228.6 Z";
const LEFT_EYE_PATH =
  "M 62.0 116.5 L 96.5 121.5 L 94.0 126.5 L 66.0 123.0 Z";
const RIGHT_EYE_PATH =
  "M 177.0 116.5 L 142.5 121.5 L 145.0 126.5 L 173.0 123.0 Z";

interface ShieldFacet {
  id: string;
  d: string;
  fillRule?: "evenodd";
  traceClass: string;
}

const SHIELD_FACETS: readonly ShieldFacet[] = [
  { id: "right-brow", d: RIGHT_BROW_PATH, fillRule: "evenodd", traceClass: "optimus-trace-0" },
  { id: "right-cheek", d: RIGHT_CHEEK_PATH, traceClass: "optimus-trace-1" },
  { id: "chin", d: CHIN_PATH, traceClass: "optimus-trace-2" },
  { id: "left-cheek", d: LEFT_CHEEK_PATH, traceClass: "optimus-trace-3" },
  { id: "left-brow", d: LEFT_BROW_PATH, fillRule: "evenodd", traceClass: "optimus-trace-4" },
  { id: "crown", d: CROWN_PATH, fillRule: "evenodd", traceClass: "optimus-trace-5" },
  { id: "nose", d: NOSE_PATH, traceClass: "optimus-trace-6" },
  { id: "mouthplate", d: MOUTHPLATE_PATH, traceClass: "optimus-trace-7" },
];

const CONTAINER_CLASSES: Record<OptimusLoaderMode, string> = {
  fullscreen:
    "fixed inset-0 z-50 h-[100dvh] w-screen overflow-hidden bg-[#1E1022] flex flex-col items-center justify-center gap-6 px-4 select-none",
  panel:
    "relative w-full min-h-[380px] sm:min-h-[460px] aspect-video overflow-hidden rounded-xl border border-ink-700 bg-[#1E1022] flex flex-col items-center justify-center gap-5 p-6 select-none",
  compact:
    "relative w-full h-44 overflow-hidden rounded-xl border border-ink-700 bg-[#1E1022] flex flex-col items-center justify-center gap-2.5 p-3 select-none",
};

const SVG_SIZE_CLASSES: Record<OptimusLoaderMode, string> = {
  fullscreen: "w-44 h-44 sm:w-56 sm:h-56",
  panel: "w-36 h-36 sm:w-44 sm:h-44",
  compact: "w-20 h-20",
};

const PILL_CLASSES: Record<OptimusLoaderMode, string> = {
  fullscreen:
    "relative z-10 rounded-full border border-[#FAF2F5]/25 bg-[#1E1022]/60 backdrop-blur-md px-5 py-2 text-center",
  panel:
    "relative z-10 rounded-full border border-[#FAF2F5]/25 bg-[#1E1022]/60 backdrop-blur-md px-5 py-2 text-center",
  compact:
    "relative z-10 rounded-full border border-[#FAF2F5]/25 bg-[#1E1022]/60 backdrop-blur-md px-3.5 py-1.5 text-center",
};

const LABEL_CLASSES: Record<OptimusLoaderMode, string> = {
  fullscreen: "font-editorial text-lg sm:text-xl leading-tight text-[#FAF2F5]",
  panel: "font-editorial text-lg sm:text-xl leading-tight text-[#FAF2F5]",
  compact: "font-editorial text-base leading-tight text-[#FAF2F5]",
};

const SUBLABEL_CLASSES: Record<OptimusLoaderMode, string> = {
  fullscreen: "font-code text-[11px] text-[#D6A4B8]",
  panel: "font-code text-[11px] text-[#D6A4B8]",
  compact: "font-code text-[10px] text-[#D6A4B8]",
};

const ATMOSPHERE_STYLE: React.CSSProperties = {
  background: [
    "radial-gradient(circle at 50% 46%, rgba(116, 203, 233, 0.22) 0%, transparent 42%)",
    "radial-gradient(ellipse 60% 70% at 12% 24%, rgba(168, 19, 62, 0.72) 0%, transparent 65%)",
    "radial-gradient(ellipse 55% 60% at 45% 28%, rgba(214, 164, 184, 0.34) 0%, transparent 62%)",
    "radial-gradient(ellipse 60% 65% at 84% 26%, rgba(124, 162, 224, 0.38) 0%, transparent 65%)",
    "linear-gradient(180deg, #1E1022 0%, #140B1A 100%)",
  ].join(", "),
};

const TRACE_KEYFRAMES = [0, 1, 2, 3, 4, 5, 6, 7]
  .map((idx) => {
    const start = idx * 5;
    const emerge = start + 2;
    const end = start + 30;
    return `
      @keyframes optimus-trace-${idx} {
        0%, ${start}% {
          stroke-dashoffset: 100;
          stroke: url(#optimus-trace-grad);
          stroke-width: 2.4;
          opacity: 0;
        }
        ${emerge}% {
          opacity: 0.95;
        }
        ${end}%, 65% {
          stroke-dashoffset: 0;
          stroke: url(#optimus-trace-grad);
          stroke-width: 2.4;
          opacity: 0.95;
        }
        76% {
          stroke-dashoffset: 0;
          stroke: #E0F9FF;
          stroke-width: 2.8;
          opacity: 1;
        }
        88% {
          stroke-dashoffset: 0;
          stroke: url(#optimus-trace-grad);
          stroke-width: 2.4;
          opacity: 0.85;
        }
        98%, 100% {
          stroke-dashoffset: 0;
          stroke: url(#optimus-trace-grad);
          stroke-width: 2.4;
          opacity: 0;
        }
      }
      .optimus-trace-${idx} {
        animation: optimus-trace-${idx} var(--optimus-cycle) linear infinite;
      }
    `;
  })
  .join("\n");

const EMBLEM_STYLES = `
  ${TRACE_KEYFRAMES}

  @keyframes optimus-eye-ignition {
    0%, 52% {
      opacity: 0.08;
    }
    58%, 88% {
      opacity: 1;
    }
    100% {
      opacity: 0.08;
    }
  }

  @keyframes optimus-flare-ignition {
    0%, 52% {
      opacity: 0.04;
      transform: scaleX(0.45);
    }
    58% {
      opacity: 0.95;
      transform: scaleX(1.08);
    }
    74% {
      opacity: 1;
      transform: scaleX(1.16);
    }
    88% {
      opacity: 0.85;
      transform: scaleX(1);
    }
    100% {
      opacity: 0.04;
      transform: scaleX(0.45);
    }
  }

  .optimus-eye {
    animation: optimus-eye-ignition var(--optimus-cycle) ease-in-out infinite;
  }

  .optimus-flare {
    transform-box: fill-box;
    transform-origin: center;
    animation: optimus-flare-ignition var(--optimus-cycle) ease-in-out infinite;
  }

  @media (prefers-reduced-motion: reduce) {
    .optimus-trace,
    .optimus-eye,
    .optimus-flare {
      animation: none !important;
    }
    .optimus-trace {
      stroke-dashoffset: 0 !important;
      opacity: 0.92 !important;
    }
    .optimus-eye {
      opacity: 1 !important;
    }
    .optimus-flare {
      opacity: 0.8 !important;
      transform: scaleX(1) !important;
    }
  }
`;

/**
 * Branded Optimus loading surface with animated cyan-traced SVG emblem.
 */
export function OptimusLoader({
  mode = "fullscreen",
  label,
  sublabel,
  playbackRate = 1.35,
  className = "",
}: OptimusLoaderProps) {
  const safeRate = Number.isFinite(playbackRate) && playbackRate > 0 ? playbackRate : 1.35;
  const cycleSeconds = Number((2.0 / safeRate).toFixed(3));
  const cycleStyle = {
    "--optimus-cycle": `${cycleSeconds}s`,
  } as React.CSSProperties;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={label || "Loading"}
      style={cycleStyle}
      className={[CONTAINER_CLASSES[mode], className].filter(Boolean).join(" ")}
    >
      <style>{EMBLEM_STYLES}</style>

      <div
        aria-hidden="true"
        className="absolute inset-0 pointer-events-none"
        style={ATMOSPHERE_STYLE}
      />

      <svg
        viewBox="0 0 240 240"
        aria-hidden="true"
        className={["relative z-10 shrink-0", SVG_SIZE_CLASSES[mode]].join(" ")}
      >
        <defs>
          <filter
            id="optimus-cyan-glow"
            filterUnits="userSpaceOnUse"
            x="-20"
            y="-20"
            width="280"
            height="280"
          >
            <feGaussianBlur stdDeviation="3.5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>

          <filter
            id="optimus-eye-flare"
            filterUnits="userSpaceOnUse"
            x="-20"
            y="-20"
            width="280"
            height="280"
          >
            <feGaussianBlur stdDeviation="5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>

          <linearGradient id="optimus-trace-grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#38BDF8" />
            <stop offset="100%" stopColor="#E0F9FF" />
          </linearGradient>
        </defs>

        {/* Layer 1: Base dark armor shield facets */}
        <g>
          {SHIELD_FACETS.map((facet) => (
            <path
              key={`base-${facet.id}`}
              d={facet.d}
              fillRule={facet.fillRule}
              fill="#090C14"
              stroke="#1E293B"
              strokeWidth="1.2"
            />
          ))}
        </g>

        {/* Layer 2: Staggered cyan circuit trace */}
        <g>
          {SHIELD_FACETS.map((facet) => (
            <path
              key={`trace-${facet.id}`}
              d={facet.d}
              fillRule={facet.fillRule}
              fill="none"
              pathLength={100}
              strokeDasharray="100"
              strokeDashoffset={100}
              stroke="url(#optimus-trace-grad)"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
              filter="url(#optimus-cyan-glow)"
              className={["optimus-trace", facet.traceClass].join(" ")}
            />
          ))}
        </g>

        {/* Layer 3: Eye ignition and horizontal anamorphic flares */}
        <g>
          <ellipse
            cx="79"
            cy="121.5"
            rx="34"
            ry="1.8"
            fill="#74CBE9"
            filter="url(#optimus-eye-flare)"
            className="optimus-flare"
          />
          <ellipse
            cx="160"
            cy="121.5"
            rx="34"
            ry="1.8"
            fill="#74CBE9"
            filter="url(#optimus-eye-flare)"
            className="optimus-flare"
          />
          <path
            d={LEFT_EYE_PATH}
            fill="#E0F9FF"
            filter="url(#optimus-eye-flare)"
            className="optimus-eye"
          />
          <path
            d={RIGHT_EYE_PATH}
            fill="#E0F9FF"
            filter="url(#optimus-eye-flare)"
            className="optimus-eye"
          />
        </g>
      </svg>

      {(label || sublabel) && (
        <div className={PILL_CLASSES[mode]}>
          {label && <div className={LABEL_CLASSES[mode]}>{label}</div>}
          {sublabel && <div className={SUBLABEL_CLASSES[mode]}>{sublabel}</div>}
        </div>
      )}
    </div>
  );
}
