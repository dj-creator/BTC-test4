import { createFileRoute } from "@tanstack/react-router";
import { Plan } from "@/components/btc/plan";
import { getSnapshot } from "@/lib/btc/snapshot";

export const Route = createFileRoute("/plan")({
  loader: () => getSnapshot(),
  component: PlanPage,
});

function PlanPage() {
  return <Plan initial={Route.useLoaderData()} />;
}
