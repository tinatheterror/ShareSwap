import { QueryClientProvider } from "@tanstack/react-query";
import { Switch, Route, Redirect, useSearch, Router as WouterRouter } from "wouter";
import { queryClient } from "./lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import { AuthProvider } from "./hooks/use-auth";
import { ChatWidget } from "@/components/chat-widget";
import NotFound from "@/pages/not-found";
import AuthPage from "@/pages/auth-page";

// Redirect component for /register and /join routes to preserve referral code
function RegisterRedirect() {
  const searchString = useSearch();
  const params = new URLSearchParams(searchString);
  const ref = params.get("ref");
  return <Redirect to={ref ? `/auth?ref=${ref}` : "/auth"} />;
}
import HomePage from "@/pages/home-page";
import VerificationPage from "@/pages/verification-page";
import ShareOptionsPage from "@/pages/share-options";
import BorrowPage from "@/pages/borrow-page";
import LendPage from "@/pages/lend-page";
import VerifyItemsPage from "@/pages/admin/verify-items";
import AdminDisputesPage from "@/pages/admin/disputes";
import AdminDashboardPage from "@/pages/admin/index";
import AdminUsersPage from "@/pages/admin/users";
import AdminItemsPage from "@/pages/admin/items";
import AdminTransactionsPage from "@/pages/admin/transactions";
import WalletPage from "@/pages/wallet-page";
import { ProtectedRoute } from "./lib/protected-route";
import { useAuth } from "./hooks/use-auth";
import ChallengesPage from "@/pages/challenges-page";

import ItemDetailsPage from "@/pages/item-details-page";
import DeliveryArrangementsPage from "@/pages/delivery-arrangements";
import GamesPage from "@/pages/games-page";
import SwapPage from "@/pages/swap-page";
import ProfilePage from "@/pages/profile-page";
import AchievementsPage from "@/pages/achievements-page";
import WishlistsPage from "@/pages/wishlists-page";
import CommunityWishlistsPage from "@/pages/community-wishlists-page";
import FAQPage from "@/pages/faq-page";
import ReferralsPage from "@/pages/referrals-page";
import MyItemsPage from "@/pages/my-items-page";
import ShareCoinsInfoPage from "@/pages/sharecoins-info-page";
import NotificationsPage from "@/pages/notifications-page";
import ActivityPage from "@/pages/activity-page";
import TransactionDetailPage from "@/pages/transaction-detail-page";
import RequestsPage from "@/pages/requests-page";
import DiscoverNeighboursPage from "@/pages/discover-neighbours-page";
import SettingsPage from "@/pages/settings-page";
import PaymentMethodsPage from "@/pages/payment-methods-page";
import MyBalancePage from "@/pages/my-balance-page";
import ResetPasswordPage from "@/pages/reset-password-page";
import { VerificationNudge } from "@/components/verification-nudge";
import { BackgroundPolling } from "@/components/background-polling";
import { LocationSetupWrapper } from "@/components/location-setup-wrapper";
import { ErrorBoundary } from "@/components/error-boundary";
import { ShareCoinAnimation } from "@/components/sharecoin-animation";

function AdminRoute({ path, component: Component }: { path: string; component: () => React.JSX.Element | null }) {
  const { user, isLoading } = useAuth();
  if (isLoading) return <Route path={path}><div /></Route>;
  if (!user) return <Route path={path}><Redirect to="/auth" /></Route>;
  if (!(user as any).isAdmin) return <Route path={path}><Redirect to="/" /></Route>;
  return <Route path={path}><Component /></Route>;
}

function Router() {
  return (
    <Switch>
      <Route path="/auth" component={AuthPage} />
      <Route path="/reset-password" component={ResetPasswordPage} />
      <Route path="/register" component={RegisterRedirect} />
      <Route path="/join" component={RegisterRedirect} />
      <ProtectedRoute path="/" component={HomePage} />
      <ProtectedRoute path="/verification" component={VerificationPage} />
      <ProtectedRoute path="/share-options" component={ShareOptionsPage} />
      <ProtectedRoute path="/borrow" component={BorrowPage} />
      <ProtectedRoute path="/lend" component={LendPage} />
      <AdminRoute path="/admin" component={AdminDashboardPage} />
      <AdminRoute path="/admin/users" component={AdminUsersPage} />
      <AdminRoute path="/admin/items" component={AdminItemsPage} />
      <AdminRoute path="/admin/transactions" component={AdminTransactionsPage} />
      <AdminRoute path="/admin/disputes" component={AdminDisputesPage} />
      <AdminRoute path="/admin/verify-items" component={VerifyItemsPage} />
      <ProtectedRoute path="/wallet" component={WalletPage} />
      <ProtectedRoute path="/games" component={GamesPage} />
      <ProtectedRoute path="/challenges" component={ChallengesPage} />

      <ProtectedRoute path="/items/:id" component={ItemDetailsPage} />
      <ProtectedRoute path="/delivery" component={DeliveryArrangementsPage} />
      <ProtectedRoute path="/swap" component={SwapPage} />
      <ProtectedRoute path="/profile/:username" component={ProfilePage} />
      <ProtectedRoute path="/profile" component={ProfilePage} />
      <ProtectedRoute path="/achievements" component={AchievementsPage} />
      <ProtectedRoute path="/wishlists" component={WishlistsPage} />
      <ProtectedRoute path="/community-wishlists" component={CommunityWishlistsPage} />
      <Route path="/sharecoins-info" component={ShareCoinsInfoPage} />
      <Route path="/help" component={FAQPage} />
      <Route path="/faq" component={FAQPage} />
      <ProtectedRoute path="/referrals" component={ReferralsPage} />
      <ProtectedRoute path="/my-items" component={MyItemsPage} />
      <ProtectedRoute path="/requests" component={RequestsPage} />
      <ProtectedRoute path="/notifications" component={ActivityPage} />
      <ProtectedRoute path="/activity" component={ActivityPage} />
      <ProtectedRoute path="/transactions/:id" component={TransactionDetailPage} />
      <ProtectedRoute path="/discover-neighbours" component={DiscoverNeighboursPage} />
      <ProtectedRoute path="/settings" component={SettingsPage} />
      <ProtectedRoute path="/payment-methods" component={PaymentMethodsPage} />
      <ProtectedRoute path="/my-balance" component={MyBalancePage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <AuthProvider>
            <Router />
            <ChatWidget />
            <LocationSetupWrapper />
            <VerificationNudge />
            <BackgroundPolling />
            <ShareCoinAnimation />
            <Toaster />
          </AuthProvider>
        </WouterRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;