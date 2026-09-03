import { Suspense } from "react";
import ChatView from "@/components/ChatView";

export default function ChatPage() {
  return (
    <div className="h-screen">
      <Suspense>
        <ChatView />
      </Suspense>
    </div>
  );
}
