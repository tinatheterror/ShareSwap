import { useState, useEffect, useRef } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useQuery } from "@tanstack/react-query";
import { useWebSocket } from "@/hooks/use-websocket";
import { queryClient } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { MessageCircle, X, Send, ChevronDown, Loader2 } from "lucide-react";

type Conversation = {
  userId: number;
  username: string;
  lastMessage: string;
  lastMessageTime: string;
  unreadCount: number;
  transactionType: string | null;
  itemName: string | null;
};

type Message = {
  id: number;
  content: string;
  senderId: number;
  receiverId: number;
  createdAt: string;
};

type TabType = "all" | "lending" | "renting" | "swapping" | "unread";

export function ChatWidget() {
  const { user } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<TabType>("all");
  const [selectedConversation, setSelectedConversation] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  if (!user) return null;

  // WebSocket setup
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const host = window.location.host;
  const wsUrl = `${protocol}//${host}/ws/chat`;

  const { isConnected, send } = useWebSocket({
    url: wsUrl,
    onMessage: (data) => {
      const message = JSON.parse(data);
      if (message.receiverId === user?.id || message.senderId === user?.id) {
        queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
        if (selectedConversation) {
          queryClient.invalidateQueries({
            queryKey: ["/api/messages", selectedConversation],
          });
        }
      }
    },
    onConnect: () => {
      send({
        type: "authenticate",
        payload: { userId: user.id },
      });
    },
    autoConnect: true,
  });

  // Fetch conversations
  const { data: allConversations = [] } = useQuery<Conversation[]>({
    queryKey: ["/api/conversations"],
    enabled: !!user,
  });

  // Filter conversations based on active tab
  const filteredConversations = allConversations.filter((conv) => {
    if (activeTab === "all") return true;
    if (activeTab === "unread") return conv.unreadCount > 0;
    if (activeTab === "lending") return conv.transactionType === "borrow";
    if (activeTab === "renting") return conv.transactionType === "rent";
    if (activeTab === "swapping") return conv.transactionType === "swap";
    return true;
  });

  // Fetch messages for selected conversation
  const { data: messages = [], isLoading: isLoadingMessages } = useQuery<Message[]>({
    queryKey: ["/api/messages", selectedConversation],
    enabled: !!selectedConversation && !!user,
  });

  // Scroll to bottom when messages change
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSendMessage = async () => {
    if (!message.trim() || !selectedConversation) return;

    try {
      const response = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          receiverId: selectedConversation,
          content: message,
        }),
      });

      if (response.ok) {
        setMessage("");
        if (isConnected) {
          send({
            type: "new_message",
            payload: {
              senderId: user.id,
              receiverId: selectedConversation,
              content: message,
            },
          });
        }
        queryClient.invalidateQueries({
          queryKey: ["/api/messages", selectedConversation],
        });
        queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
      }
    } catch (error) {
      console.error("Failed to send message:", error);
    }
  };

  const totalUnread = allConversations.reduce((sum, conv) => sum + conv.unreadCount, 0);

  return (
    <div className="fixed bottom-4 right-4 z-50">
      {!isOpen ? (
        <Button
          onClick={() => setIsOpen(true)}
          className="rounded-full h-14 w-14 shadow-lg relative"
          size="icon"
        >
          <MessageCircle className="h-6 w-6" />
          {totalUnread > 0 && (
            <Badge className="absolute -top-1 -right-1 h-5 w-5 flex items-center justify-center p-0 rounded-full bg-red-500">
              {totalUnread}
            </Badge>
          )}
        </Button>
      ) : (
        <Card className="w-96 h-[600px] shadow-2xl flex flex-col">
          <div className="flex items-center justify-between p-4 border-b">
            <h3 className="font-semibold">Chats</h3>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setIsOpen(false);
                setSelectedConversation(null);
              }}
            >
              <ChevronDown className="h-4 w-4" />
            </Button>
          </div>

          {!selectedConversation ? (
            <>
              {/* Tabs */}
              <div className="flex gap-1 p-2 border-b overflow-x-auto">
                <button
                  onClick={() => setActiveTab("all")}
                  className={`px-3 py-1.5 rounded-full text-sm whitespace-nowrap ${
                    activeTab === "all"
                      ? "bg-gray-800 text-white"
                      : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                  }`}
                >
                  All
                </button>
                <button
                  onClick={() => setActiveTab("lending")}
                  className={`px-3 py-1.5 rounded-full text-sm whitespace-nowrap ${
                    activeTab === "lending"
                      ? "bg-gray-800 text-white"
                      : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                  }`}
                >
                  Lending
                </button>
                <button
                  onClick={() => setActiveTab("renting")}
                  className={`px-3 py-1.5 rounded-full text-sm whitespace-nowrap ${
                    activeTab === "renting"
                      ? "bg-gray-800 text-white"
                      : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                  }`}
                >
                  Renting
                </button>
                <button
                  onClick={() => setActiveTab("swapping")}
                  className={`px-3 py-1.5 rounded-full text-sm whitespace-nowrap ${
                    activeTab === "swapping"
                      ? "bg-gray-800 text-white"
                      : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                  }`}
                >
                  Swapping
                </button>
                <button
                  onClick={() => setActiveTab("unread")}
                  className={`px-3 py-1.5 rounded-full text-sm whitespace-nowrap ${
                    activeTab === "unread"
                      ? "bg-gray-800 text-white"
                      : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                  }`}
                >
                  Unread
                </button>
              </div>

              {/* Conversation List */}
              <ScrollArea className="flex-1">
                {filteredConversations.length === 0 ? (
                  <div className="p-8 text-center text-muted-foreground">
                    <MessageCircle className="h-12 w-12 mx-auto mb-2 opacity-50" />
                    <p>No conversations yet</p>
                  </div>
                ) : (
                  <div className="divide-y">
                    {filteredConversations.map((conv) => (
                      <button
                        key={conv.userId}
                        onClick={() => setSelectedConversation(conv.userId)}
                        className="w-full p-4 hover:bg-gray-50 text-left transition-colors"
                      >
                        <div className="flex items-start justify-between mb-1">
                          <span className="font-medium">{conv.username}</span>
                          {conv.unreadCount > 0 && (
                            <Badge className="bg-red-500 text-xs h-5 min-w-5 flex items-center justify-center">
                              {conv.unreadCount}
                            </Badge>
                          )}
                        </div>
                        {conv.itemName && (
                          <div className="text-xs text-muted-foreground mb-1">
                            {conv.transactionType === "borrow" && "Lending"} 
                            {conv.transactionType === "rent" && "Renting"} 
                            {conv.transactionType === "swap" && "Swapping"}: {conv.itemName}
                          </div>
                        )}
                        <p className="text-sm text-muted-foreground truncate">
                          {conv.lastMessage}
                        </p>
                        <span className="text-xs text-muted-foreground">
                          {new Date(conv.lastMessageTime).toLocaleString()}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </>
          ) : (
            <>
              {/* Chat View */}
              <div className="p-4 border-b flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelectedConversation(null)}
                >
                  ←
                </Button>
                <span className="font-medium">
                  {allConversations.find((c) => c.userId === selectedConversation)?.username}
                </span>
              </div>

              {isLoadingMessages ? (
                <div className="flex-1 flex items-center justify-center">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                </div>
              ) : (
                <ScrollArea className="flex-1 p-4" ref={scrollRef}>
                  {messages.map((msg) => (
                    <div
                      key={msg.id}
                      className={`mb-3 flex ${
                        msg.senderId === user.id ? "justify-end" : "justify-start"
                      }`}
                    >
                      <div
                        className={`rounded-lg px-3 py-2 max-w-[75%] ${
                          msg.senderId === user.id
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted"
                        }`}
                      >
                        <p className="text-sm">{msg.content}</p>
                        <span className="text-xs opacity-70">
                          {new Date(msg.createdAt).toLocaleTimeString()}
                        </span>
                      </div>
                    </div>
                  ))}
                </ScrollArea>
              )}

              <div className="p-4 border-t flex gap-2">
                <Input
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Type a message..."
                  onKeyPress={(e) => {
                    if (e.key === "Enter" && message.trim()) {
                      handleSendMessage();
                    }
                  }}
                />
                <Button
                  onClick={handleSendMessage}
                  disabled={!message.trim()}
                  size="icon"
                >
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            </>
          )}
        </Card>
      )}
    </div>
  );
}
