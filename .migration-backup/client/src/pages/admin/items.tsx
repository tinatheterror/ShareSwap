import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { AdminLayout } from "@/components/admin/admin-layout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Search, Package, Trash2, ChevronLeft, ChevronRight } from "lucide-react";
import { format } from "date-fns";
import { useDebounce } from "@/hooks/use-debounce";

interface AdminItem {
  id: number;
  name: string;
  category: string | null;
  conditionRating: number;
  isAvailable: boolean;
  isLendable: boolean;
  isRentable: boolean;
  isGift: boolean;
  securityDeposit: string | null;
  photos: string[];
  createdAt: string;
  ownerId: number | null;
  ownerUsername: string | null;
  ownerHandle: string | null;
  ownerDisplayName: string | null;
}

interface ItemsResponse {
  items: AdminItem[];
  total: number;
  page: number;
  pages: number;
}

function itemTypeBadges(item: AdminItem) {
  const types: string[] = [];
  if (item.isLendable) types.push("Lend");
  if (item.isRentable) types.push("Rent");
  if (item.isGift) types.push("Gift");
  return types.map(t => (
    <Badge key={t} variant="outline" className="text-xs">{t}</Badge>
  ));
}

export default function AdminItemsPage() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [removeTarget, setRemoveTarget] = useState<AdminItem | null>(null);
  const debouncedSearch = useDebounce(search, 400);

  const { data, isLoading } = useQuery<ItemsResponse>({
    queryKey: ["/api/admin/items", debouncedSearch, page],
    queryFn: () =>
      fetch(`/api/admin/items?search=${encodeURIComponent(debouncedSearch)}&page=${page}`).then(r => r.json()),
  });

  const removeMutation = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/admin/items/${id}/remove`).then(r => r.json()),
    onSuccess: () => {
      toast({ title: "Item removed" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/stats"] });
      setRemoveTarget(null);
    },
    onError: () => toast({ title: "Failed to remove item", variant: "destructive" }),
  });

  return (
    <AdminLayout>
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Items</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {data ? `${data.total.toLocaleString()} items` : "Loading…"}
            </p>
          </div>
        </div>

        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search by item name…"
            className="pl-9"
          />
        </div>

        <div className="space-y-3">
          {isLoading && [1,2,3,4,5].map(i => (
            <div key={i} className="h-24 rounded-xl bg-gray-200 animate-pulse" />
          ))}

          {!isLoading && data?.items.length === 0 && (
            <Card><CardContent className="py-12 text-center text-muted-foreground">No items found</CardContent></Card>
          )}

          {data?.items.map(item => (
            <Card key={item.id} className={!item.isAvailable ? "opacity-60 border-gray-300" : ""}>
              <CardContent className="py-3 px-4">
                <div className="flex items-start gap-3">
                  {item.photos?.[0] ? (
                    <img src={item.photos[0]} alt={item.name} className="w-14 h-14 rounded-lg object-cover flex-shrink-0" />
                  ) : (
                    <div className="w-14 h-14 rounded-lg bg-gray-100 flex items-center justify-center flex-shrink-0">
                      <Package className="h-5 w-5 text-gray-400" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm">{item.name}</span>
                      {!item.isAvailable && <Badge className="bg-gray-100 text-gray-600 text-xs">Unavailable</Badge>}
                      {itemTypeBadges(item)}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      By {item.ownerDisplayName || item.ownerUsername || `User ${item.ownerId}`}
                      {item.ownerHandle && ` (@${item.ownerHandle})`}
                    </p>
                    <div className="flex flex-wrap gap-3 mt-1 text-xs text-muted-foreground">
                      {item.category && <span>{item.category}</span>}
                      <span>Condition {item.conditionRating}/10</span>
                      {item.securityDeposit && <span>Deposit ${parseFloat(item.securityDeposit).toFixed(2)}</span>}
                      <span>#{item.id} · Listed {format(new Date(item.createdAt), "MMM d, yyyy")}</span>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-red-700 border-red-200 hover:bg-red-50 flex-shrink-0"
                    onClick={() => setRemoveTarget(item)}
                    disabled={!item.isAvailable}
                  >
                    <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                    Remove
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {data && data.pages > 1 && (
          <div className="flex items-center justify-center gap-3 mt-5">
            <Button variant="outline" size="sm" onClick={() => setPage(p => p - 1)} disabled={page === 1}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm text-muted-foreground">Page {page} of {data.pages}</span>
            <Button variant="outline" size="sm" onClick={() => setPage(p => p + 1)} disabled={page >= data.pages}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>

      <Dialog open={!!removeTarget} onOpenChange={open => !open && setRemoveTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove "{removeTarget?.name}"?</DialogTitle>
            <DialogDescription>
              This will mark the item as unavailable. It will no longer appear in search results or be available for requests. This can be undone by the item owner.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setRemoveTarget(null)}>Cancel</Button>
            <Button
              className="bg-red-600 hover:bg-red-700 text-white"
              onClick={() => removeTarget && removeMutation.mutate(removeTarget.id)}
              disabled={removeMutation.isPending}
            >
              {removeMutation.isPending ? "Removing…" : "Remove item"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
