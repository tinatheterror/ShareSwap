import { useAuth } from "@/hooks/use-auth";
import { Navbar } from "@/components/shared/navbar";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useState, useEffect, useRef } from "react";
import { Send, AlertCircle, Loader2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useWebSocket } from "@/hooks/use-websocket";
import { Redirect } from "wouter";

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
  const scrollRef = useRef<HTMLDivElement>(null);

  if (!user) {
    return <Redirect to="/auth" />;
  }

  // Only set up WebSocket after authentication is confirmed
  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${wsProtocol}//${window.location.host}/ws/chat?userId=${user.id}`;

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
      // Send authentication message
      send({
        type: 'authenticate',
        payload: { userId: user.id }
      });
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
    autoConnect: true,
    initialRetryDelayMs: 1000,
    maxRetryDelayMs: 30000,
    maxRetries: Infinity,
  });

  const { data: messages = [], isLoading } = useQuery<Message[]>({
    queryKey: ['/api/messages', receiverId],
    enabled: !!receiverId && !!user,
  });

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const sendMessageMutation = useMutation({
    mutationFn: async (content: string) => {
      if (!receiverId || !user) throw new Error("No recipient selected or not authenticated");
      const res = await apiRequest("POST", "/api/messages", {
        receiverId,
        content,
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to send message");
      }
      return res.json();
    },
    onSuccess: () => {
      setMessage("");
      if (isConnected && user) {
        send({
          type: 'new_message',
          payload: {
            senderId: user.id,
            receiverId,
            content: message,
          }
        });
      }
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
              {isLoading ? (
                <div className="flex-1 flex items-center justify-center">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                </div>
              ) : (
                <ScrollArea className="flex-1 pr-4" ref={scrollRef}>
                  {messages.map((msg) => (
                    <div
                      key={msg.id}
                      className={`mb-4 flex ${
                        msg.senderId === user.id ? "justify-end" : "justify-start"
                      }`}
                    >
                      <div
                        className={`rounded-lg px-4 py-2 max-w-[70%] ${
                          msg.senderId === user.id
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
              )}
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
                  {sendMessageMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}