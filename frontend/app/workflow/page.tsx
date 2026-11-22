import React from "react";
import type { Metadata } from "next";
import { WorkflowPageClient } from "../../components/workflow/WorkflowPageClient";

export const metadata: Metadata = {
  title: "ML Workflow | FPL-Optimus",
  description:
    "Interactive architecture walkthrough of the FPL-Optimus data pipeline, decoupled expected points models, Gaussian tactical archetypes, simulated annealing solver, and 38-gameweek backtest.",
};

export default function WorkflowPage() {
  return <WorkflowPageClient />;
}
