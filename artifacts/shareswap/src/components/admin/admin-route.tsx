import { Redirect, Route } from "wouter";
import { useAuth } from "@/hooks/use-auth";

/**
 * A page only an admin may open. A signed-out visitor is sent to sign in and anyone else who is not an admin to the home page;
 * the page is never rendered for them. (The data behind it is protected again on the server: every /api/admin route is admin-only.)
 */
export function AdminRoute({ path, component: Component }: { path: string; component: () => React.JSX.Element | null }) {
  const { user, isLoading } = useAuth();
  if (isLoading) return <Route path={path}><div /></Route>;
  if (!user) return <Route path={path}><Redirect to="/auth" /></Route>;
  if (!(user as any).isAdmin) return <Route path={path}><Redirect to="/" /></Route>;
  return <Route path={path}><Component /></Route>;
}
