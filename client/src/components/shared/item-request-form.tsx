import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Sparkles, Calendar, ArrowLeftRight, Camera, Coins, Check } from "lucide-react";
import { useState } from "react";
import * as z from "zod";
import type { SelectItem } from "@db/schema";
import { calculateSwap, getSwapTierLabel } from "@/lib/swap-calculator";

const formSchema = z.object({
  message: z.string().min(1, "Please include a message to the owner"),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  conditionConfirmed: z.boolean().optional(),
});

type Props = {
  item: SelectItem;
  requestType: "BORROW" | "RENT" | "SWAP";
  isOpen: boolean;
  onClose: () => void;
  swapOfferItem?: SelectItem | null;
};

export function ItemRequestForm({ item, requestType, isOpen, onClose, swapOfferItem }: Props) {
  const { toast } = useToast();
  const [showTemplates, setShowTemplates] = useState(false);
  
  // Get current user info for personalized messages
  const { data: user } = useQuery({
    queryKey: ['/api/user'],
  });

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      message: "",
      startDate: "",
      endDate: "",
      conditionConfirmed: false,
    },
  });

  // Generate automated message templates
  const generateAutomatedMessage = (templateType: 'quick' | 'polite' | 'detailed') => {
    const ownerName = "there"; // Will be populated with actual owner name from API
    const itemName = item.name;
    const action = requestType.toLowerCase();
    const userName = (user as any)?.username || "I";
    
    // Get dates for the message
    const startDate = form.getValues('startDate');
    const endDate = form.getValues('endDate');
    const dateRange = startDate && endDate ? 
      ` from ${new Date(startDate).toLocaleDateString()} to ${new Date(endDate).toLocaleDateString()}` : 
      ` for a few days`;

    let message = "";
    
    switch (templateType) {
      case 'quick':
        message = `Hi ${ownerName}! I would like to ${action} your ${itemName}${dateRange}. 😊😊`;
        break;
      case 'polite': 
        message = `Hello ${ownerName},\n\nI hope you're doing well! I would love to ${action} your ${itemName}${dateRange}. Would this work for you?\n\nThank you so much! 😊😊`;
        break;
      case 'detailed':
        message = `Hi ${ownerName},\n\nI'm ${userName} and I'm interested in your ${itemName}. I would like to ${action} it${dateRange}. I'll take great care of it and return it in perfect condition.\n\nPlease let me know if these dates work for you!\n\nBest regards! 😊😊`;
        break;
    }
    
    form.setValue('message', message);
    setShowTemplates(false);
  };

  // Auto-populate dates with common ranges
  const setQuickDateRange = (days: number) => {
    const today = new Date();
    const start = new Date(today);
    start.setDate(today.getDate() + 1); // Start tomorrow
    const end = new Date(start);
    end.setDate(start.getDate() + days - 1);
    
    form.setValue('startDate', start.toISOString().split('T')[0]);
    form.setValue('endDate', end.toISOString().split('T')[0]);
  };

  const createRequestMutation = useMutation({
    mutationFn: async (data: z.infer<typeof formSchema>) => {
      const res = await apiRequest("POST", `/api/items/${item.id}/request`, {
        ...data,
        requestType,
        swapOfferItemId: swapOfferItem?.id,
      });
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: "Request Sent!",
        description: "The owner will be notified of your request.",
      });
      onClose();
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to send request",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[425px] bg-white max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="truncate pr-6">Request to {requestType.toLowerCase()} {item.name}</DialogTitle>
          {requestType !== "SWAP" && (
            <DialogDescription>
              Send a message to the owner explaining why you'd like to {requestType.toLowerCase()} this item.
            </DialogDescription>
          )}
        </DialogHeader>

        {requestType === "SWAP" && swapOfferItem && (
          <div className="bg-[#E6FBF5] border border-[#0DCEA1]/30 rounded-lg p-4 space-y-3">
            <div className="flex items-center gap-2 text-[#0BB88C] font-medium">
              <ArrowLeftRight className="h-4 w-4" />
              Swap Summary
            </div>
            <div className="flex items-center gap-4">
              <div className="flex-1">
                <div className="text-xs text-[#0DCEA1] mb-1">You're offering:</div>
                <div className="flex items-center gap-2">
                  <div className="w-10 h-10 bg-gray-100 rounded overflow-hidden flex-shrink-0">
                    {swapOfferItem.photos?.[0] ? (
                      <img src={swapOfferItem.photos[0]} alt={swapOfferItem.name} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center"><Camera className="h-4 w-4 text-gray-400" /></div>
                    )}
                  </div>
                  <div className="min-w-0 max-w-[100px]">
                    <p className="text-sm font-medium text-gray-900 truncate leading-normal">{swapOfferItem.name}</p>
                    <Badge variant="outline" className="text-xs border-[#0DCEA1]/50 text-[#0BB88C]">
                      {getSwapTierLabel((swapOfferItem as any).tier || 2)}
                    </Badge>
                  </div>
                </div>
              </div>
              <ArrowLeftRight className="h-5 w-5 text-[#0DCEA1]/70" />
              <div className="flex-1">
                <div className="text-xs text-[#0DCEA1] mb-1">For their:</div>
                <div className="flex items-center gap-2">
                  <div className="w-10 h-10 bg-gray-100 rounded overflow-hidden flex-shrink-0">
                    {item.photos?.[0] ? (
                      <img src={item.photos[0]} alt={item.name} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center"><Camera className="h-4 w-4 text-gray-400" /></div>
                    )}
                  </div>
                  <div className="min-w-0 max-w-[100px]">
                    <p className="text-sm font-medium text-gray-900 truncate leading-normal">{item.name}</p>
                    <Badge variant="outline" className="text-xs border-[#0DCEA1]/50 text-[#0BB88C]">
                      {getSwapTierLabel((item as any).tier || 2)}
                    </Badge>
                  </div>
                </div>
              </div>
            </div>
            {(() => {
              const yourTier = (swapOfferItem as any).tier || 2;
              const theirTier = (item as any).tier || 2;
              const swap = calculateSwap(yourTier, theirTier);
              if (swap.fairness === "fair") {
                return (
                  <div className="flex items-center gap-2 text-green-600 text-sm bg-green-50 p-2 rounded">
                    <Check className="h-4 w-4" />
                    Fair swap - no offset needed!
                  </div>
                );
              } else if (swap.fairness === "offset_required") {
                return (
                  <div className="flex items-center gap-2 text-[#0BB88C] text-sm bg-[#E6FBF5] p-2 rounded">
                    <Coins className="h-4 w-4" />
                    {swap.message}
                  </div>
                );
              }
              return null;
            })()}
          </div>
        )}

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit((data) => createRequestMutation.mutate(data))}
            className="space-y-4 mt-4"
          >
            {/* Date Selection - Hide for SWAP */}
            {requestType !== "SWAP" && (
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="startDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center gap-2">
                        <Calendar className="h-4 w-4" />
                        Start Date
                      </FormLabel>
                      <FormControl>
                        <Input 
                          type="date" 
                          {...field} 
                          min={new Date().toISOString().split('T')[0]}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="endDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>End Date</FormLabel>
                      <FormControl>
                        <Input 
                          type="date" 
                          {...field} 
                          min={form.watch('startDate') || new Date().toISOString().split('T')[0]}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            )}

            {/* Condition Confirmation - Only for SWAP */}
            {requestType === "SWAP" && (
              <FormField
                control={form.control}
                name="conditionConfirmed"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-3">
                    <FormControl>
                      <input
                        type="checkbox"
                        checked={field.value}
                        onChange={field.onChange}
                        className="h-4 w-4 mt-0.5 accent-[#0DCEA1]"
                      />
                    </FormControl>
                    <div className="space-y-1 leading-none">
                      <FormLabel className="text-sm font-normal cursor-pointer">
                        I confirm this item matches the condition stated.
                      </FormLabel>
                    </div>
                  </FormItem>
                )}
              />
            )}

            {/* Automated Message Templates */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <FormLabel>Message to Owner</FormLabel>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowTemplates(!showTemplates)}
                  className="text-xs"
                >
                  <Sparkles className="h-3 w-3 mr-1" />
                  Quick Messages
                </Button>
              </div>

              {showTemplates && (
                <div className="flex gap-2 flex-wrap mb-2">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => generateAutomatedMessage('quick')}
                  >
                    Quick & Friendly
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => generateAutomatedMessage('polite')}
                  >
                    Polite & Formal
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => generateAutomatedMessage('detailed')}
                  >
                    Detailed & Personal
                  </Button>
                </div>
              )}
            </div>

            <FormField
              control={form.control}
              name="message"
              render={({ field }) => (
                <FormItem>
                  <FormControl>
                    <Textarea 
                      {...field} 
                      rows={6}
                      placeholder={requestType === "SWAP" ? "Send a message to the owner explaining why you'd like to swap items, or use the quick messages above..." : "Type your message here, or use the Quick Messages above..."}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="flex justify-end gap-4">
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button 
                type="submit"
                disabled={createRequestMutation.isPending}
              >
                Send Request
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
