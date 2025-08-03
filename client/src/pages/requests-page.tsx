import { useState, useEffect, useRef } from "react";
import { Navbar } from "@/components/shared/navbar";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { z } from "zod";
import { ChevronLeft, ChevronRight, X, Check, Heart, ThumbsDown } from "lucide-react";

type Request = {
  request: {
    id: number;
    requestType: string;
    status: string;
    message: string;
    createdAt: string;
  };
  item: {
    id: number;
    name: string;
    photos: string[];
  };
  requester: {
    id: number;
    username: string;
  };
};

const deliveryFormSchema = z.object({
  deliveryType: z.enum(["SELF_ARRANGED", "IN_APP_SERVICE"]),
  deliveryAddress: z.string().min(1, "Delivery address is required"),
  deliveryDate: z.string().min(1, "Delivery date is required"),
  securityDeposit: z.string().min(1, "Security deposit amount is required"),
});

export default function RequestsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedRequest, setSelectedRequest] = useState<Request | null>(null);
  const [showTutorial, setShowTutorial] = useState<boolean>(false);
  const [currentCardIndex, setCurrentCardIndex] = useState(0);
  const [cardOffsetX, setCardOffsetX] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const startPosRef = useRef({ x: 0, y: 0 });

  const { data: requests = [] } = useQuery<Request[]>({
    queryKey: ['/api/requests'],
  });

  // Filter for pending requests (swipeable) and other requests (regular cards)
  const pendingRequests = requests.filter(req => req.request.status === "PENDING");
  const otherRequests = requests.filter(req => req.request.status !== "PENDING");

  // Check if user has seen tutorial before
  useEffect(() => {
    const hasSeenTutorial = localStorage.getItem('shareswap-swipe-tutorial-seen');
    if (!hasSeenTutorial && pendingRequests.length > 0) {
      setShowTutorial(true);
    }
  }, [pendingRequests.length]);

  const markTutorialSeen = () => {
    localStorage.setItem('shareswap-swipe-tutorial-seen', 'true');
    setShowTutorial(false);
  };

  // Swipe handlers
  const handleCardStart = (e: React.MouseEvent | React.TouchEvent) => {
    if (pendingRequests.length === 0) return;
    
    setIsDragging(true);
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    startPosRef.current = { x: clientX, y: clientY };
  };

  const handleCardMove = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDragging || pendingRequests.length === 0) return;
    
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const deltaX = clientX - startPosRef.current.x;
    setCardOffsetX(deltaX);
  };

  const handleCardEnd = () => {
    if (!isDragging || pendingRequests.length === 0) return;
    
    setIsDragging(false);
    
    const threshold = 120; // Minimum swipe distance
    const currentRequest = pendingRequests[currentCardIndex];
    
    if (Math.abs(cardOffsetX) > threshold && currentRequest) {
      if (cardOffsetX > 0) {
        // Swipe right - Accept
        updateRequestMutation.mutate({
          requestId: currentRequest.request.id,
          status: "ACCEPTED"
        });
      } else {
        // Swipe left - Decline
        updateRequestMutation.mutate({
          requestId: currentRequest.request.id,
          status: "DECLINED"
        });
      }
      
      // Move to next card
      setTimeout(() => {
        setCurrentCardIndex(prev => prev + 1);
        setCardOffsetX(0);
      }, 300);
    } else {
      // Snap back
      setCardOffsetX(0);
    }
  };

  const updateRequestMutation = useMutation({
    mutationFn: async ({ requestId, status }: { requestId: number; status: string }) => {
      const res = await apiRequest("PATCH", `/api/requests/${requestId}`, { status });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/requests'] });
      toast({
        title: "Request updated",
        description: "The request status has been updated successfully.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to update request",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const deliveryMutation = useMutation({
    mutationFn: async ({ requestId, data }: { requestId: number; data: z.infer<typeof deliveryFormSchema> }) => {
      const res = await apiRequest("POST", `/api/requests/${requestId}/delivery`, data);
      return res.json();
    },
    onSuccess: () => {
      setSelectedRequest(null);
      queryClient.invalidateQueries({ queryKey: ['/api/requests'] });
      toast({
        title: "Delivery arranged",
        description: "The delivery has been arranged successfully.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to arrange delivery",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const form = useForm<z.infer<typeof deliveryFormSchema>>({
    resolver: zodResolver(deliveryFormSchema),
    defaultValues: {
      deliveryType: "SELF_ARRANGED",
      deliveryAddress: "",
      deliveryDate: "",
      securityDeposit: "",
    },
  });

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <main className="max-w-7xl mx-auto px-4 py-8">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold mb-2">Item Requests</h1>
          <p className="text-muted-foreground">
            Manage your item requests and arrange deliveries
          </p>
        </div>

        {/* Swipeable Pending Requests */}
        {pendingRequests.length > 0 && (
          <div className="mb-8">
            <h2 className="text-xl font-semibold mb-4 text-center">New Requests</h2>
            <div className="relative max-w-md mx-auto h-96">
              {pendingRequests.slice(currentCardIndex, currentCardIndex + 3).map((req, index) => {
                const isTopCard = index === 0;
                const zIndex = 3 - index;
                const scale = isTopCard ? 1 : 0.95 - (index * 0.05);
                const translateY = index * 10;
                
                return (
                  <Card 
                    key={req.request.id}
                    ref={isTopCard ? cardRef : null}
                    className={`absolute inset-x-0 cursor-grab active:cursor-grabbing shadow-lg border-2 ${
                      isTopCard ? 'border-gray-200' : 'border-gray-100'
                    }`}
                    style={{
                      zIndex,
                      transform: `scale(${scale}) translateY(${translateY}px) ${
                        isTopCard ? `translateX(${cardOffsetX}px) rotate(${cardOffsetX * 0.1}deg)` : ''
                      }`,
                      transition: isDragging && isTopCard ? 'none' : 'transform 0.3s ease-out',
                    }}
                    onMouseDown={isTopCard ? handleCardStart : undefined}
                    onMouseMove={isTopCard ? handleCardMove : undefined}
                    onMouseUp={isTopCard ? handleCardEnd : undefined}
                    onMouseLeave={isTopCard ? handleCardEnd : undefined}
                    onTouchStart={isTopCard ? handleCardStart : undefined}
                    onTouchMove={isTopCard ? handleCardMove : undefined}
                    onTouchEnd={isTopCard ? handleCardEnd : undefined}
                  >
                    <CardContent className="p-6 h-full">
                      <div className="flex flex-col h-full">
                        {/* Item Image */}
                        <div className="h-32 bg-gray-100 rounded-lg mb-4 overflow-hidden">
                          {req.item.photos && req.item.photos[0] ? (
                            <img
                              src={req.item.photos[0]}
                              alt={req.item.name}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-gray-400">
                              No Photo
                            </div>
                          )}
                        </div>
                        
                        {/* Item Details */}
                        <div className="flex-1">
                          <h3 className="text-lg font-semibold mb-2">{req.item.name}</h3>
                          <div className="flex gap-2 mb-3">
                            <Badge className="bg-teal-100 text-teal-800">{req.request.requestType}</Badge>
                          </div>
                          <p className="text-sm text-gray-600 mb-2">
                            <strong>From:</strong> {req.requester.username}
                          </p>
                          <p className="text-sm text-gray-700 line-clamp-3">{req.request.message}</p>
                        </div>
                        
                        {/* Swipe indicators */}
                        <div className="flex justify-between items-center mt-4 px-4">
                          <div className={`flex items-center gap-2 transition-opacity ${
                            cardOffsetX < -50 ? 'opacity-100' : 'opacity-30'
                          }`}>
                            <div className="w-8 h-8 bg-red-500 rounded-full flex items-center justify-center">
                              <ThumbsDown className="h-4 w-4 text-white" />
                            </div>
                            <span className="text-red-600 font-medium">Not today!</span>
                          </div>
                          
                          <div className={`flex items-center gap-2 transition-opacity ${
                            cardOffsetX > 50 ? 'opacity-100' : 'opacity-30'
                          }`}>
                            <span className="text-green-600 font-medium">Let's share!</span>
                            <div className="w-8 h-8 bg-green-500 rounded-full flex items-center justify-center">
                              <Heart className="h-4 w-4 text-white fill-current" />
                            </div>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
              
              {currentCardIndex >= pendingRequests.length && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="text-center">
                    <Check className="h-16 w-16 text-green-500 mx-auto mb-4" />
                    <h3 className="text-lg font-semibold text-gray-700">All caught up!</h3>
                    <p className="text-gray-500">No more pending requests</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Regular Request Cards (Accepted/Declined) */}
        {otherRequests.length > 0 && (
          <div>
            <h2 className="text-xl font-semibold mb-4">Previous Requests</h2>
            <div className="grid gap-6">
              {otherRequests.map((req) => (
                <Card key={req.request.id}>
                  <CardContent className="p-6">
                    <div className="flex justify-between items-start">
                      <div>
                        <h3 className="text-lg font-semibold">{req.item.name}</h3>
                        <div className="flex gap-2 mt-2">
                          <Badge>{req.request.requestType}</Badge>
                          <Badge variant={
                            req.request.status === "ACCEPTED" ? "default" :
                            req.request.status === "DECLINED" ? "destructive" :
                            "secondary"
                          }>
                            {req.request.status}
                          </Badge>
                        </div>
                        <p className="text-sm text-muted-foreground mt-2">
                          From: {req.requester.username}
                        </p>
                        <p className="text-sm mt-2">{req.request.message}</p>
                      </div>
                      <div className="flex gap-2">
                        {req.request.status === "ACCEPTED" && (
                          <Button onClick={() => setSelectedRequest(req)}>
                            Arrange Delivery
                          </Button>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}

        {/* Tutorial Modal */}
        <Dialog open={showTutorial} onOpenChange={setShowTutorial}>
          <DialogContent className="sm:max-w-[400px]">
            <DialogHeader>
              <DialogTitle className="text-center">💫 Quick Tutorial</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="text-center">
                <div className="relative mx-auto w-48 h-32 bg-gradient-to-r from-red-100 to-green-100 rounded-lg mb-4 overflow-hidden">
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-32 h-20 bg-white rounded-lg shadow-md flex items-center justify-center">
                      <span className="text-sm font-medium">Item Request</span>
                    </div>
                  </div>
                  <div className="absolute left-2 top-1/2 transform -translate-y-1/2 text-red-600">
                    <ChevronLeft className="h-6 w-6" />
                    <span className="text-xs">Swipe left</span>
                  </div>
                  <div className="absolute right-2 top-1/2 transform -translate-y-1/2 text-green-600">
                    <span className="text-xs">Swipe right</span>
                    <ChevronRight className="h-6 w-6" />
                  </div>
                </div>
              </div>
              
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-red-500 rounded-full flex items-center justify-center">
                    <ThumbsDown className="h-4 w-4 text-white" />
                  </div>
                  <div>
                    <p className="font-medium">Swipe Left</p>
                    <p className="text-sm text-gray-600">Politely decline the request</p>
                  </div>
                </div>
                
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-green-500 rounded-full flex items-center justify-center">
                    <Heart className="h-4 w-4 text-white fill-current" />
                  </div>
                  <div>
                    <p className="font-medium">Swipe Right</p>
                    <p className="text-sm text-gray-600">Accept and start sharing!</p>
                  </div>
                </div>
              </div>
            </div>
            
            <div className="flex justify-center">
              <Button onClick={markTutorialSeen} className="w-full">
                Got it, let's go!
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={!!selectedRequest} onOpenChange={() => setSelectedRequest(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Arrange Delivery</DialogTitle>
              <DialogDescription>
                Choose how you want to handle the delivery and security deposit
              </DialogDescription>
            </DialogHeader>

            <Form {...form}>
              <form
                onSubmit={form.handleSubmit((data) => {
                  if (!selectedRequest) return;
                  deliveryMutation.mutate({
                    requestId: selectedRequest.request.id,
                    data,
                  });
                })}
                className="space-y-4"
              >
                <FormField
                  control={form.control}
                  name="deliveryType"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Delivery Method</FormLabel>
                      <select
                        {...field}
                        className="w-full p-2 border rounded"
                      >
                        <option value="SELF_ARRANGED">Self Arranged</option>
                        <option value="IN_APP_SERVICE">In-App Service ($10 fee)</option>
                      </select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="deliveryAddress"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Delivery Address</FormLabel>
                      <FormControl>
                        <Textarea {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="deliveryDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Delivery Date</FormLabel>
                      <FormControl>
                        <Input type="datetime-local" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="securityDeposit"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Security Deposit Amount ($)</FormLabel>
                      <FormControl>
                        <Input type="number" step="0.01" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setSelectedRequest(null)}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={deliveryMutation.isPending}
                  >
                    Submit
                  </Button>
                </div>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </main>
    </div>
  );
}
