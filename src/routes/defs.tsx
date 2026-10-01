import { createFileRoute } from "@tanstack/react-router";
import { Definitions } from "@/components/btc/defs";

export const Route = createFileRoute("/defs")({
  component: Definitions,
});