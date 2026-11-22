"use client";

import React, { useEffect, useRef } from "react";
import { gsap } from "gsap";

interface AshParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  length: number;
  width: number;
  angle: number;
  angularVel: number;
  swayAmp: number;
  swayFreq: number;
  swayPhase: number;
  taperSkew: number;
  color: string;
  peakAlpha: number;
  ageMs: number;
  lifeMs: number;
}

const MAX_PARTICLES = 36;
const MOVE_THRESHOLD_PX = 12;
const AMBIENT_INTERVAL_MS = 450;

function pickAshColor(): string {
  const r = Math.random();
  if (r < 0.35) return "#FF85B3";
  if (r < 0.7) return "#FFF0F6";
  if (r < 0.9) return "#E5225A";
  return "#9EE6FF";
}

function randomRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/**
 * Full-viewport GSAP-driven canvas rendering subtle organic ash particles along pointer movement.
 */
export function AshCursorCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    let reduceMotion = motionQuery.matches;

    let viewportWidth = window.innerWidth;
    let viewportHeight = window.innerHeight;

    const resizeCanvas = () => {
      viewportWidth = window.innerWidth;
      viewportHeight = window.innerHeight;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.floor(viewportWidth * dpr);
      canvas.height = Math.floor(viewportHeight * dpr);
      canvas.style.width = `${viewportWidth}px`;
      canvas.style.height = `${viewportHeight}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    resizeCanvas();

    const particles: AshParticle[] = [];
    let hasPointer = false;
    let mouseX = 0;
    let mouseY = 0;
    let lastSpawnX = 0;
    let lastSpawnY = 0;
    let ambientTimerMs = 0;

    const spawnParticle = (
      x: number,
      y: number,
      deltaX: number,
      deltaY: number,
      isAmbient: boolean
    ) => {
      if (reduceMotion) return;
      if (particles.length >= MAX_PARTICLES) {
        particles.shift();
      }

      const clampedDeltaX = Math.max(-28, Math.min(28, deltaX));
      const clampedDeltaY = Math.max(-28, Math.min(28, deltaY));

      particles.push({
        x: x + randomRange(-6, 6),
        y: y + randomRange(-6, 6),
        vx: clampedDeltaX * 0.12 + randomRange(0.3, 1.1),
        vy: clampedDeltaY * 0.12 + randomRange(-0.9, -0.25),
        length: randomRange(3.5, 8.5),
        width: randomRange(1.5, 3.2),
        angle: randomRange(0, Math.PI * 2),
        angularVel: randomRange(-0.045, 0.045),
        swayAmp: randomRange(0.12, 0.38),
        swayFreq: randomRange(0.003, 0.006),
        swayPhase: randomRange(0, Math.PI * 2),
        taperSkew: randomRange(-0.22, 0.22),
        color: pickAshColor(),
        peakAlpha: isAmbient ? randomRange(0.26, 0.42) : randomRange(0.42, 0.72),
        ageMs: 0,
        lifeMs: randomRange(1100, 1700),
      });
    };

    const handlePointerMove = (e: PointerEvent) => {
      if (reduceMotion) return;
      const nextX = e.clientX;
      const nextY = e.clientY;

      if (!hasPointer) {
        hasPointer = true;
        mouseX = nextX;
        mouseY = nextY;
        lastSpawnX = nextX;
        lastSpawnY = nextY;
        return;
      }

      const stepDx = nextX - mouseX;
      const stepDy = nextY - mouseY;
      mouseX = nextX;
      mouseY = nextY;

      const distFromLastSpawn = Math.hypot(nextX - lastSpawnX, nextY - lastSpawnY);
      if (distFromLastSpawn >= MOVE_THRESHOLD_PX) {
        const count = distFromLastSpawn > 32 ? 2 : 1;
        for (let i = 0; i < count; i += 1) {
          spawnParticle(nextX, nextY, stepDx, stepDy, false);
        }
        lastSpawnX = nextX;
        lastSpawnY = nextY;
      }
    };

    const handleMotionChange = (e: MediaQueryListEvent) => {
      reduceMotion = e.matches;
      if (reduceMotion) {
        particles.length = 0;
        ctx.clearRect(0, 0, viewportWidth, viewportHeight);
      }
    };

    const tick = (_time: number, deltaTime: number) => {
      if (reduceMotion) return;

      const dtMs = Math.min(deltaTime || 16.67, 50);
      const frameScale = dtMs / 16.67;

      if (hasPointer) {
        ambientTimerMs += dtMs;
        if (ambientTimerMs >= AMBIENT_INTERVAL_MS) {
          ambientTimerMs = 0;
          spawnParticle(
            mouseX + randomRange(-18, 18),
            mouseY + randomRange(-18, 18),
            0,
            0,
            true
          );
        }
      }

      ctx.clearRect(0, 0, viewportWidth, viewportHeight);

      for (let i = particles.length - 1; i >= 0; i -= 1) {
        const p = particles[i];
        p.ageMs += dtMs;

        if (p.ageMs >= p.lifeMs) {
          particles.splice(i, 1);
          continue;
        }

        const progress = p.ageMs / p.lifeMs;
        const alphaEnvelope =
          progress < 0.2 ? progress / 0.2 : 1 - (progress - 0.2) / 0.8;
        const alpha = Math.max(0, Math.min(1, alphaEnvelope)) * p.peakAlpha;

        const sway =
          Math.sin(p.ageMs * p.swayFreq + p.swayPhase) * p.swayAmp * frameScale;
        p.x += p.vx * frameScale + sway;
        p.y += p.vy * frameScale;
        p.vx *= 0.992;
        p.vy *= 0.994;
        p.angle += p.angularVel * frameScale;

        const halfLen = p.length * 0.5;
        const halfWid = p.width * 0.5;
        const skewOffset = p.width * p.taperSkew;

        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.angle);
        ctx.globalAlpha = alpha;
        ctx.fillStyle = p.color;
        ctx.shadowBlur = 6;
        ctx.shadowColor = p.color;

        // Irregular tapered petal/ash flake silhouette
        ctx.beginPath();
        ctx.moveTo(-halfLen, 0);
        ctx.quadraticCurveTo(
          -halfLen * 0.2,
          -halfWid + skewOffset,
          halfLen,
          0
        );
        ctx.quadraticCurveTo(
          halfLen * 0.15,
          halfWid + skewOffset * 0.6,
          -halfLen,
          0
        );
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
    };

    window.addEventListener("pointermove", handlePointerMove, { passive: true });
    window.addEventListener("resize", resizeCanvas);
    motionQuery.addEventListener("change", handleMotionChange);
    gsap.ticker.add(tick);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("resize", resizeCanvas);
      motionQuery.removeEventListener("change", handleMotionChange);
      gsap.ticker.remove(tick);
      particles.length = 0;
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none fixed inset-0 z-20"
      aria-hidden="true"
    />
  );
}
