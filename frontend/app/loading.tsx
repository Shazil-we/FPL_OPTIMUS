import { OptimusLoader } from "../components/ui";

export default function RootLoading() {
  return (
    <OptimusLoader
      mode="fullscreen"
      label="Loading FPL Optimus"
      sublabel="Initializing tactical decision engine"
    />
  );
}
