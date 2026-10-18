import { BoardApp } from "@/components/board/BoardApp";

// A view-only link: same board, but nothing can be changed.
export default function ViewPage() {
  return <BoardApp viewOnly />;
}
