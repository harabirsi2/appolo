import { notFound } from "next/navigation";
import { getWebchatConfig } from "@/lib/services/messaging";
import { ChatWidget } from "@/components/chat-widget";

export const dynamic = "force-dynamic";
export const metadata = { title: "Chat" };

export default async function EmbedChatPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const config = await getWebchatConfig(key);
  if (!config) notFound();

  return (
    <div className="h-screen w-full">
      <ChatWidget publicKey={config.publicKey} orgName={config.orgName} />
    </div>
  );
}
