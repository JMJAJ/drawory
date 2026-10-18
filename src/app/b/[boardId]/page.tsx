import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { BoardApp } from "@/components/board/BoardApp";

async function BoardLoader({ params }: { params: Promise<{ boardId: string }> }) {
  // Read env at request time, not build time.
  await connection();
  const { boardId } = await params;
  if (!/^[a-z0-9-]{1,40}$/.test(boardId)) notFound();
  const realtimeUrl = process.env.NEXT_PUBLIC_NEON_REALTIME_URL || process.env.NEON_REALTIME_URL;
  if (!realtimeUrl) throw new Error("NEON_REALTIME_URL is not set. Run `neon env pull`.");
  return <BoardApp boardId={boardId} realtimeUrl={realtimeUrl} />;
}

export default function BoardPage({ params }: PageProps<"/b/[boardId]">) {
  return (
    <Suspense fallback={<div className="loading-screen">Opening your board…</div>}>
      <BoardLoader params={params} />
    </Suspense>
  );
}
