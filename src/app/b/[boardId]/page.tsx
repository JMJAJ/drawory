import { BoardApp } from "@/components/board/BoardApp";

// A static shell: the board id is read in the browser, and everything else
// (auth, live queries) happens through the API once the app starts.
export default function BoardPage() {
  return <BoardApp />;
}
