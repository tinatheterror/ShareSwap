import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { AdminLayout } from "@/components/admin/admin-layout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Search, ShieldBan, ShieldCheck, ChevronLeft, ChevronRight, User, Star, Coins } from "lucide-react";
import { format } from "date-fns";
import { useDebounce } from "@/hooks/use-debounce";

interface AdminUser {
  id: number;
  username: string;
  handle: string | null;
  displayName: string | null;
  email: string | null;
  accountStatus: string;
  isAdmin: boolean;
  isVerified: boolean;
  isPremium: boolean;
  shareCoins: string | null;
  reputationScore: number | null;
  bannedAt: string | null;
  banReason: string | null;
  createdAt: string;
  lastActiveAt: string | null;
}

interface UsersResponse {
  users: AdminUser[];
  total: number;
  page: number;
  pages: number;
}

function statusBadge(u: AdminUser) {
  if (u.accountStatus === "banned") return <Badge className="bg-red-100 text-red-700 border-red-200">Banned</Badge>;
  if (u.isAdmin) return <Badge className="bg-purple-100 text-purple-700 border-purple-200">Admin</Badge>;
  if (u.isVerified) return <Badge className="bg-teal-100 text-teal-700 border-teal-200">Verified</Badge>;
  if (u.isPremium) return <Badge className="bg-amber-100 text-amber-700 border-amber-200">Premium</Badge>;
  return <Badge variant="outline" className="text-xs">Active</Badge>;
}

export default function AdminUsersPage() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [banTarget, setBanTarget] = useState<AdminUser | null>(null);
  const [banReason, setBanReason] = useState("");
  const [unbanTarget, setUnbanTarget] = useState<AdminUser | null>(null);
  const debouncedSearch = useDebounce(search, 400);

  const { data, isLoading } = useQuery<UsersResponse>({
    queryKey: ["/api/admin/users", debouncedSearch, page],
    queryFn: () =>
      fetch(`/api/admin/users?search=${encodeURIComponent(debouncedSearch)}&page=${page}`).then(r => r.json()),
  });

  const banMutation = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) =>
      apiRequest("POST", `/api/admin/users/${id}/ban`, { reason }).then(r => r.json()),
    onSuccess: () => {
      toast({ title: "User banned" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/stats"] });
      setBanTarget(null);
      setBanReason("");
    },
    onError: () => toast({ title: "Failed to ban user", variant: "destructive" }),
  });

  const unbanMutation = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/admin/users/${id}/unban`).then(r => r.json()),
    onSuccess: () => {
      toast({ title: "User unbanned" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/stats"] });
      setUnbanTarget(null);
    },
    onError: () => toast({ title: "Failed to unban user", variant: "destructive" }),
  });

  return (
    <AdminLayout>
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Users</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {data ? `${data.total.toLocaleString()} users` : "Loading…"}
            </p>
          </div>
        </div>

        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search by email, username, handle…"
            className="pl-9"
          />
        </div>

        <div className="space-y-3">
          {isLoading && [1,2,3,4,5].map(i => (
            <div key={i} className="h-20 rounded-xl bg-gray-200 animate-pulse" />
          ))}

          {!isLoading && data?.users.length === 0 && (
            <Card><CardContent className="py-12 text-center text-muted-foreground">No users found</CardContent></Card>
          )}

          {data?.users.map(u => (
            <Card key={u.id} className={u.accountStatus === "banned" ? "border-red-200 bg-red-50/30" : ""}>
              <CardContent className="py-3 px-4">
                <div className="flex items-start gap-3">
                  <div className="flex-shrink-0 w-9 h-9 rounded-full bg-gray-200 flex items-center justify-center">
                    <User className="h-4 w-4 text-gray-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm">{u.displayName || u.username}</span>
                      {u.handle && <span className="text-xs text-muted-foreground">@{u.handle}</span>}
                      {statusBadge(u)}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{u.email || "No email"}</p>
                    <div className="flex flex-wrap gap-3 mt-1.5 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1"><Star className="h-3 w-3" />{u.reputationScore ?? 0} rep</span>
                      <span className="flex items-center gap-1"><Coins className="h-3 w-3" />{parseFloat(u.shareCoins || "0").toFixed(0)} ShareCoins</span>
                      <span>Joined {format(new Date(u.createdAt), "MMM d, yyyy")}</span>
                      {u.lastActiveAt && <span>Active {format(new Date(u.lastActiveAt), "MMM d, yyyy")}</span>}
                    </div>
                    {u.accountStatus === "banned" && u.banReason && (
                      <p className="text-xs text-red-600 mt-1">Ban reason: {u.banReason}</p>
                    )}
                  </div>
                  <div className="flex-shrink-0">
                    {u.accountStatus === "banned" ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-green-700 border-green-200 hover:bg-green-50"
                        onClick={() => setUnbanTarget(u)}
                      >
                        <ShieldCheck className="h-3.5 w-3.5 mr-1.5" />
                        Unban
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-red-700 border-red-200 hover:bg-red-50"
                        onClick={() => setBanTarget(u)}
                        disabled={u.isAdmin}
                      >
                        <ShieldBan className="h-3.5 w-3.5 mr-1.5" />
                        Ban
                      </Button>
                    )}
                  </div>
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

      <Dialog open={!!banTarget} onOpenChange={open => !open && setBanTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ban {banTarget?.displayName || banTarget?.username}?</DialogTitle>
            <DialogDescription>This will set their account status to banned. They will not be able to access the platform.</DialogDescription>
          </DialogHeader>
          <Textarea
            placeholder="Reason for ban (optional)"
            value={banReason}
            onChange={e => setBanReason(e.target.value)}
            rows={3}
          />
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setBanTarget(null)}>Cancel</Button>
            <Button
              className="bg-red-600 hover:bg-red-700 text-white"
              onClick={() => banTarget && banMutation.mutate({ id: banTarget.id, reason: banReason })}
              disabled={banMutation.isPending}
            >
              {banMutation.isPending ? "Banning…" : "Confirm ban"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!unbanTarget} onOpenChange={open => !open && setUnbanTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Unban {unbanTarget?.displayName || unbanTarget?.username}?</DialogTitle>
            <DialogDescription>Their account will be restored to active status.</DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setUnbanTarget(null)}>Cancel</Button>
            <Button
              className="bg-green-600 hover:bg-green-700 text-white"
              onClick={() => unbanTarget && unbanMutation.mutate(unbanTarget.id)}
              disabled={unbanMutation.isPending}
            >
              {unbanMutation.isPending ? "Unbanning…" : "Confirm unban"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
