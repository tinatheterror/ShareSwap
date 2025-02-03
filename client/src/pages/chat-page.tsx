import { useAuth } from "@/hooks/use-auth";
import { Navbar } from "@/components/shared/navbar";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useState } from "react";
import { Send, AlertCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useWebSocket } from "@/hooks/use-websocket";

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
  const [receiverId, setReceiverId] = useState<number | null>(null);

  // Determine WebSocket protocol based on page protocol
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/ws/chat`;

  const { isConnected, send } = useWebSocket({
    url: wsUrl,
    onMessage: (data) => {
      const message = JSON.parse(data);
      if (message.receiverId === user?.id || message.senderId === user?.id) {
        queryClient.invalidateQueries({ queryKey: ['/api/messages', receiverId] });
      }
    },
    onConnect: () => {
      console.log("WebSocket connection established");
    },
    onDisconnect: () => {
      console.log("WebSocket disconnected. Attempting to reconnect...");
    },
    onError: (error) => {
      console.error("WebSocket error:", error);
      toast({
        title: "Connection Error",
        description: "Chat connection interrupted. Attempting to reconnect...",
        variant: "destructive",
      });
    },
    // Configure reconnection parameters
    initialRetryDelayMs: 1000,
    maxRetryDelayMs: 30000,
    maxRetries: Infinity,
  });

  const { data: messages = [] } = useQuery<Message[]>({
    queryKey: ['/api/messages', receiverId],
    enabled: !!receiverId,
  });

  const sendMessageMutation = useMutation({
    mutationFn: async (content: string) => {
      if (!receiverId) throw new Error("No recipient selected");
      await apiRequest("POST", "/api/messages", {
        receiverId,
        content,
      });
      try {
        if (isConnected) {
          send({
            senderId: user?.id,
            receiverId,
            content,
          });
        }
      } catch (error) {
        console.error("Error sending WebSocket message:", error);
        // Still allow the message to be sent via HTTP even if WebSocket fails
      }
    },
    onSuccess: () => {
      setMessage("");
      queryClient.invalidateQueries({ queryKey: ['/api/messages', receiverId] });
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
        {!isConnected && (
          <Alert variant="destructive" className="mb-4">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Chat connection lost. Attempting to reconnect...
            </AlertDescription>
          </Alert>
        )}
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