import { createFileRoute } from "@tanstack/react-router";
import { Book } from "@/components/btc/book";

export const Route = createFileRoute("/book")({
  component: Book,
});
