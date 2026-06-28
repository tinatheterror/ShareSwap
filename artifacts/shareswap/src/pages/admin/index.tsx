import { useQuery } from "@tanstack/react-query";
import { AdminLayout } from "@/components/admin/admin-layout";
import { Card, CardContent } from "@/components/ui/card";
import { Users, Package, ArrowLeftRight, AlertTriangle, ShieldBan } from "lucide-react";
import { Link } from "wouter";

interface Stats {
  totalUsers: number;
  totalItems: number;
  totalTransactions: number;
  openDisputes: number;
  bannedUsers: number;
}

const STAT_CARDS = [
  { key: "totalUsers" as const, label: "Total Users", icon: Users, color: "text-blue-600", bg: "bg-blue-50", href: "/admin/users" },
  { key: "totalItems" as const, label: "Total Items", icon: Package, color: "text-teal-600", bg: "bg-teal-50", href: "/admin/items" },
  { key: "totalTransactions" as const, label: "Transactions", icon: ArrowLeftRight, color: "text-purple-600", bg: "bg-purple-50", href: "/admin/transactions" },
  { key: "openDisputes" as const, label: "Open Disputes", icon: AlertTriangle, color: "text-amber-600", bg: "bg-amber-50", href: "/admin/disputes" },
  { key: "bannedUsers" as const, label: "Banned Users", icon: ShieldBan, color: "text-red-600", bg: "bg-red-50", href: "/admin/users?status=banned" },
];

export default function AdminDashboardPage() {
  const { data: stats, isLoading } = useQuery<Stats>({ queryKey: ["/api/admin/stats"] });

  return (
    <AdminLayout>
      <div className="max-w-5xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Platform overview at a glance</p>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          {STAT_CARDS.map(({ key, label, icon: Icon, color, bg, href }) => (
            <Link key={key} href={href}>
              <a className="block">
                <Card className="hover:shadow-md transition-shadow cursor-pointer">
                  <CardContent className="pt-5 pb-4">
                    <div className={`inline-flex p-2 rounded-lg ${bg} mb-3`}>
                      <Icon className={`h-5 w-5 ${color}`} />
                    </div>
                    <p className="text-2xl font-bold text-gray-900">
                      {isLoading ? "—" : (stats?.[key] ?? 0).toLocaleString()}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
                  </CardContent>
                </Card>
              </a>
            </Link>
          ))}
        </div>

        <div className="mt-8 grid md:grid-cols-2 gap-6">
          <Card>
            <CardContent className="pt-5">
              <h2 className="font-semibold text-gray-800 mb-3">Quick actions</h2>
              <div className="space-y-2">
                {[
                  { href: "/admin/disputes", label: "Review open disputes", badge: stats?.openDisputes },
                  { href: "/admin/users", label: "Manage users" },
                  { href: "/admin/items", label: "Review items" },
                  { href: "/admin/transactions", label: "Transaction overrides" },
                  { href: "/admin/verify-items", label: "Verify item conditions" },
                ].map(({ href, label, badge }) => (
                  <Link key={href} href={href}>
                    <a className="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-gray-50 text-sm text-gray-700 transition-colors">
                      <span>{label}</span>
                      {badge != null && badge > 0 && (
                        <span className="bg-amber-100 text-amber-800 text-xs font-semibold px-2 py-0.5 rounded-full">{badge}</span>
                      )}
                    </a>
                  </Link>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-5">
              <h2 className="font-semibold text-gray-800 mb-3">Admin notes</h2>
              <ul className="text-sm text-muted-foreground space-y-2 list-disc list-inside">
                <li>Ban a user from the <Link href="/admin/users"><a className="text-teal-600 underline">Users</a></Link> page</li>
                <li>Remove listings from the <Link href="/admin/items"><a className="text-teal-600 underline">Items</a></Link> page</li>
                <li>Force-complete or release deposits from <Link href="/admin/transactions"><a className="text-teal-600 underline">Transactions</a></Link></li>
                <li>Resolve damage claims from <Link href="/admin/disputes"><a className="text-teal-600 underline">Disputes</a></Link></li>
                <li>Use the search bar on each page to find records by email, name, or ID</li>
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>
    </AdminLayout>
  );
}
