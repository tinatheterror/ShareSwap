import { AdminLayout } from "@/components/admin/admin-layout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Flag } from "lucide-react";
import { format } from "date-fns";
import { useState } from "react";

export type ReportAction = "dismiss" | "remove_content" | "warn_user" | "ban_user";

export interface AdminReport {
  id: number;
  status: "open" | "actioned" | "dismissed";
  targetType: "user" | "item" | "message" | "review" | "wishlist";
  targetId: number;
  reason: string;
  details: string | null;
  snapshot: Record<string, unknown> | null;
  createdAt: string;
  ageHours: number;
  overdue: boolean;
  resolvedAt: string | null;
  resolutionNote: string | null;
  reporter: { id: number; username: string | null; displayName: string | null } | null;
  author: { id: number; username: string | null; displayName: string | null; accountStatus: string | null } | null;
  otherReportsAgainstAuthor: number;
}

interface ReportsResponse {
  reports: AdminReport[];
  total: number;
  page: number;
  pages: number;
  oldestOpenAgeHours: number | null;
}

const STATUS_TABS = [
  { key: "open", label: "Open" },
  { key: "actioned", label: "Actioned" },
  { key: "dismissed", label: "Dismissed" },
] as const;

export const ACTION_LABELS: Record<ReportAction, string> = {
  dismiss: "Dismiss",
  remove_content: "Remove content",
  warn_user: "Warn user",
  ban_user: "Ban user",
};

const ACTION_HELP: Record<ReportAction, string> = {
  dismiss: "No violation. The reporter is told nothing was found.",
  remove_content: "Hides it from everyone and tells the author. The copy is kept as evidence.",
  warn_user: "Sends the author a reminder of the Community Guidelines.",
  ban_user: "Bans the author, ends their sessions and hides their listings and profile. Closes every open report about them.",
};

const who = (p: { username: string | null; displayName: string | null } | null) => (p ? p.displayName || p.username || "Unknown" : "Unknown");
const text = (value: unknown) => (typeof value === "string" ? value : null);

/** What was reported, as it was when it was reported. */
function Snapshot({ report }: { report: AdminReport }) {
  const s = report.snapshot ?? {};
  const photos = Array.isArray(s.photos) ? (s.photos as string[]).filter((p) => typeof p === "string") : [];
  const lines: [string, string | null][] =
    report.targetType === "item" ? [["Title", text(s.name)], ["Description", text(s.description)]]
    : report.targetType === "message" ? [["Message", text(s.content)]]
    : report.targetType === "review" ? [["Review", text(s.comment)], ["Rating", s.rating != null ? `${s.rating}/5` : null]]
    : report.targetType === "wishlist" ? [["Wanted", text(s.itemName)], ["Description", text(s.description)]]
    : [["Name", text(s.displayName)], ["Bio", text(s.bio)]];
  return (
    <div className="rounded-lg bg-gray-50 border p-3 space-y-1.5 text-sm" data-testid={`report-snapshot-${report.id}`}>
      {lines.filter(([, v]) => v).map(([label, value]) => (
        <p key={label}><span className="text-muted-foreground">{label}: </span><span className="whitespace-pre-wrap break-words">{value}</span></p>
      ))}
      {photos.length > 0 && (
        <div className="flex gap-2 pt-1">
          {photos.slice(0, 4).map((src) => <img key={src} src={src} alt="" className="h-16 w-16 rounded object-cover border" />)}
        </div>
      )}
    </div>
  );
}

export function ReportCard({ report, onAction }: { report: AdminReport; onAction?: (report: AdminReport, action: ReportAction) => void }) {
  const open = report.status === "open";
  const actions: ReportAction[] = ["dismiss", ...(report.targetType === "user" ? [] : (["remove_content"] as ReportAction[])), "warn_user", "ban_user"];
  return (
    <Card className={report.overdue ? "border-red-300" : undefined} data-testid={`report-${report.id}`}>
      <CardContent className="p-5 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-semibold">Report #{report.id}</p>
          <Badge variant="secondary" className="capitalize">{report.targetType}</Badge>
          <Badge className="bg-amber-100 text-amber-800 capitalize">{report.reason.replaceAll("_", " ")}</Badge>
          {open && (
            <Badge className={report.overdue ? "bg-red-100 text-red-800" : "bg-gray-100 text-gray-700"} data-testid={`report-age-${report.id}`}>
              {report.overdue ? `Overdue · ${report.ageHours}h` : `${report.ageHours}h old`}
            </Badge>
          )}
          {!open && <Badge className={report.status === "actioned" ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-700"} data-testid={`report-status-${report.id}`}>{report.status}</Badge>}
        </div>

        <Snapshot report={report} />
        {report.details && <p className="text-sm"><span className="text-muted-foreground">Reporter's note: </span>{report.details}</p>}

        <div className="grid sm:grid-cols-2 gap-1 text-sm text-muted-foreground">
          <p>Reported by <span className="text-foreground">{who(report.reporter)}</span> · {format(new Date(report.createdAt), "MMM d, yyyy p")}</p>
          <p>
            Author <span className="text-foreground">{who(report.author)}</span>
            {report.author?.accountStatus && report.author.accountStatus !== "active" && <Badge className="ml-2 bg-red-100 text-red-800">{report.author.accountStatus}</Badge>}
          </p>
        </div>
        {report.otherReportsAgainstAuthor > 0 && (
          <p className="text-sm font-medium text-amber-700" data-testid={`report-history-${report.id}`}>
            {report.otherReportsAgainstAuthor} other report{report.otherReportsAgainstAuthor === 1 ? "" : "s"} against this person
          </p>
        )}

        {open ? (
          <div className="flex flex-wrap gap-2 pt-1">
            {actions.map((action) => (
              <Button key={action} size="sm" variant={action === "ban_user" ? "destructive" : "outline"} onClick={() => onAction?.(report, action)} data-testid={`report-${report.id}-${action}`}>
                {ACTION_LABELS[action]}
              </Button>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            {report.resolvedAt ? `Handled ${format(new Date(report.resolvedAt), "MMM d, yyyy p")}` : "Handled"}
            {report.resolutionNote ? ` · ${report.resolutionNote}` : ""}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export default function AdminReportsPage() {
  const { toast } = useToast();
  const [status, setStatus] = useState<(typeof STATUS_TABS)[number]["key"]>("open");
  const [page, setPage] = useState(1);
  const [pending, setPending] = useState<{ report: AdminReport; action: ReportAction } | null>(null);
  const [note, setNote] = useState("");

  const { data, isLoading } = useQuery<ReportsResponse>({ queryKey: [`/api/admin/reports?status=${status}&page=${page}`] });

  const resolve = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/admin/reports/${pending!.report.id}/resolve`, { action: pending!.action, note: note.trim() || undefined });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || "Could not resolve the report");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Report handled", description: ACTION_HELP[pending!.action] });
      queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("/api/admin/reports") || String(q.queryKey[0]).startsWith("/api/admin/stats") });
      setPending(null);
      setNote("");
    },
    onError: (e: Error) => toast({ title: "Could not handle the report", description: e.message, variant: "destructive" }),
  });

  return (
    <AdminLayout>
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <Flag className="h-6 w-6 text-red-500" />
          <div>
            <h1 className="text-2xl font-bold">Reports</h1>
            <p className="text-sm text-muted-foreground">Reported profiles, listings, messages, reviews and wishlist posts. Act on each within 24 hours.</p>
          </div>
          {data && status === "open" && <Badge className="ml-auto bg-red-100 text-red-800 text-sm" data-testid="reports-open-count">{data.total} open</Badge>}
        </div>

        {data?.oldestOpenAgeHours != null && data.oldestOpenAgeHours >= 20 && (
          <Card className="mb-4 border-red-300 bg-red-50"><CardContent className="py-3 text-sm text-red-800" data-testid="reports-overdue-banner">
            The oldest open report is {data.oldestOpenAgeHours} hours old.
          </CardContent></Card>
        )}

        <div className="flex gap-2 mb-4" role="tablist">
          {STATUS_TABS.map((tab) => (
            <Button key={tab.key} size="sm" variant={status === tab.key ? "default" : "outline"} onClick={() => { setStatus(tab.key); setPage(1); }} data-testid={`reports-tab-${tab.key}`}>
              {tab.label}
            </Button>
          ))}
        </div>

        <div className="space-y-4">
          {isLoading && <div className="h-40 rounded-xl bg-gray-200 animate-pulse" />}
          {!isLoading && data?.reports.length === 0 && (
            <Card><CardContent className="py-8 text-center text-sm text-muted-foreground" data-testid="reports-empty">
              {status === "open" ? "Nothing waiting. The queue is clear." : "Nothing here yet."}
            </CardContent></Card>
          )}
          {data?.reports.map((report) => (
            <ReportCard key={report.id} report={report} onAction={(r, action) => { setPending({ report: r, action }); setNote(""); }} />
          ))}
        </div>

        {data && data.pages > 1 && (
          <div className="flex items-center justify-between mt-6 text-sm">
            <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
            <span>Page {data.page} of {data.pages}</span>
            <Button size="sm" variant="outline" disabled={page >= data.pages} onClick={() => setPage(page + 1)}>Next</Button>
          </div>
        )}
      </div>

      <Dialog open={!!pending} onOpenChange={(o) => { if (!o) setPending(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{pending ? `${ACTION_LABELS[pending.action]} · report #${pending.report.id}` : ""}</DialogTitle>
            <DialogDescription>{pending ? ACTION_HELP[pending.action] : ""}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="report-note">Note (kept in the audit log)</Label>
            <Textarea id="report-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} data-testid="report-note" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPending(null)}>Cancel</Button>
            <Button variant={pending?.action === "ban_user" ? "destructive" : "default"} disabled={resolve.isPending} onClick={() => resolve.mutate()} data-testid="report-confirm">
              {pending ? ACTION_LABELS[pending.action] : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
