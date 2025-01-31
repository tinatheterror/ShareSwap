import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import * as z from "zod";
import type { SelectItem } from "@db/schema";

const formSchema = z.object({
  message: z.string().min(1, "Please include a message to the owner"),
});

type Props = {
  item: SelectItem;
  requestType: "BORROW" | "RENT" | "SWAP";
  isOpen: boolean;
  onClose: () => void;
};

export function ItemRequestForm({ item, requestType, isOpen, onClose }: Props) {
  const { toast } = useToast();
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      message: "",
    },
  });

  const createRequestMutation = useMutation({
    mutationFn: async (data: z.infer<typeof formSchema>) => {
      const res = await apiRequest("POST", `/api/items/${item.id}/request`, {
        ...data,
        requestType,
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
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Request to {requestType.toLowerCase()} {item.name}</DialogTitle>
          <DialogDescription>
            Send a message to the owner explaining why you'd like to {requestType.toLowerCase()} this item.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit((data) => createRequestMutation.mutate(data))}
            className="space-y-4 mt-4"
          >
            <FormField
              control={form.control}
              name="message"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Message to Owner</FormLabel>
                  <FormControl>
                    <Textarea {...field} />
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
