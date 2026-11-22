import React from "react";
import { AshCursorCanvas } from "../components/landing/AshCursorCanvas";
import { HeroSection } from "../components/landing/HeroSection";

export default function LandingPage() {
  return (
    <main className="relative h-[100dvh] w-screen overflow-hidden bg-[#1E1022] text-[#FAF2F5] font-ui select-none">
      <AshCursorCanvas />
      <HeroSection />
    </main>
  );
}
