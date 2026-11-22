import { OptimusLoader } from "../../components/ui";

export default function AppLoading() {
  return (
    <OptimusLoader
      mode="fullscreen"
      label="Launching Tactical Optimizer"
      sublabel="Preparing 5,000-iteration Simulated Annealing studio"
    />
  );
}
