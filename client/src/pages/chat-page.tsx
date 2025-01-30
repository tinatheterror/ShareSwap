import { useAuth } from "@/hooks/use-auth";
import { Navbar } from "@/components/shared/navbar";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useState, useEffect, useRef } from "react";
import { Send } from "lucide-react";

type Message = {
  id: number;
  content: string;
  senderId: number;
  receiverId: number;
  createdAt: string;
};

export default function ChatPage() {
  const { user } = useAuth();
  const [message, setMessage] = useState("");
  const { toast } = useToast();
  const wsRef = useRef<WebSocket | null>(null);
  const [receiverId, setReceiverId] = useState<number | null>(null);

  useEffect(() => {
    const ws = new WebSocket(`ws://${window.location.host}/ws/chat`);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.receiverId === user?.id || message.senderId === user?.id) {
        queryClient.invalidateQueries(["/api/messages", receiverId]);
      }
    };

    return () => {
      ws.close();
    };
  }, [user?.id, receiverId]);

  const { data: messages = [] } = useQuery<Message[]>({
    queryKey: ["/api/messages", receiverId],
    enabled: !!receiverId,
  });

  const sendMessageMutation = useMutation({
    mutationFn: async (content: string) => {
      if (!receiverId) throw new Error("No recipient selected");
      await apiRequest("POST", "/api/messages", {
        receiverId,
        content,
      });
      wsRef.current?.send(
        JSON.stringify({
          senderId: user?.id,
          receiverId,
          content,
        })
      );
    },
    onSuccess: () => {
      setMessage("");
      queryClient.invalidateQueries(["/api/messages", receiverId]);
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to send message",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <main className="max-w-4xl mx-auto px-4 py-8">
        <Card>
          <CardContent className="p-6">
            <div className="flex flex-col h-[600px]">
              <ScrollArea className="flex-1 pr-4">
                {messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`mb-4 flex ${
                      msg.senderId === user?.id ? "justify-end" : "justify-start"
                    }`}
                  >
                    <div
                      className={`rounded-lg px-4 py-2 max-w-[70%] ${
                        msg.senderId === user?.id
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted"
                      }`}
                    >
                      <p>{msg.content}</p>
                      <span className="text-xs opacity-70">
                        {new Date(msg.createdAt).toLocaleTimeString()}
                      </span>
                    </div>
                  </div>
                ))}
              </ScrollArea>
              <div className="mt-4 flex gap-2">
                <Input
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Type your message..."
                  onKeyPress={(e) => {
                    if (e.key === "Enter" && message.trim()) {
                      sendMessageMutation.mutate(message);
                    }
                  }}
                />
                <Button
                  onClick={() => {
                    if (message.trim()) {
                      sendMessageMutation.mutate(message);
                    }
                  }}
                  disabled={!message.trim() || sendMessageMutation.isPending}
                >
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
