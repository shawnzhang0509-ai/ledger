import { notFound } from "next/navigation";
import { publicUrl } from "@/lib/r2";

// A draft video, opened from the link a bot sends on WeChat. No login: the phone may not have a session, and the
// id can't be guessed. The file itself is on R2 (dt video make puts it there).
export const metadata = { title: "Driftae 视频", robots: { index: false } };

export default async function VideoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const src = publicUrl(`previews/${id}.mp4`);
  if (!src) notFound();
  return (
    <main className="min-h-screen bg-black flex items-center justify-center">
      <video src={src} controls playsInline autoPlay muted className="max-h-screen w-full" />
    </main>
  );
}
