import { QueryClientProvider } from "@tanstack/react-query";
import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import { AuthProvider } from "./hooks/use-auth";
import NotFound from "@/pages/not-found";
import AuthPage from "@/pages/auth-page";
import HomePage from "@/pages/home-page";
import VerificationPage from "@/pages/verification-page";
import ChatPage from "@/pages/chat-page";
import ShareOptionsPage from "@/pages/share-options";
import BorrowPage from "@/pages/borrow-page";
import LendPage from "@/pages/lend-page";
import VerifyItemsPage from "@/pages/admin/verify-items";
import WalletPage from "@/pages/wallet-page";
import { ProtectedRoute } from "./lib/protected-route";
import ChallengesPage from "@/pages/challenges-page";

import ItemDetailsPage from "@/pages/item-details-page";
import DeliveryArrangementsPage from "@/pages/delivery-arrangements";
import GamesPage from "@/pages/games-page";
import SwapPage from "@/pages/swap-page";
import ProfilePage from "@/pages/profile-page";
import AchievementsPage from "@/pages/achievements-page";
import WishlistsPage from "@/pages/wishlists-page";
import PremiumPage from "@/pages/premium-page";
import ReferralsPage from "@/pages/referrals-page";
import MyItemsPage from "@/pages/my-items-page";

function Router() {
  return (
    <Switch>
      <Route path="/auth" component={AuthPage} />
      <ProtectedRoute path="/" component={HomePage} />
      <ProtectedRoute path="/verify" component={VerificationPage} />
      <ProtectedRoute path="/chat" component={ChatPage} />
      <ProtectedRoute path="/share-options" component={ShareOptionsPage} />
      <ProtectedRoute path="/borrow" component={BorrowPage} />
      <ProtectedRoute path="/lend" component={LendPage} />
      <ProtectedRoute path="/admin/verify-items" component={VerifyItemsPage} />
      <ProtectedRoute path="/wallet" component={WalletPage} />
      <ProtectedRoute path="/games" component={GamesPage} />
      <ProtectedRoute path="/challenges" component={ChallengesPage} />

      <ProtectedRoute path="/items/:id" component={ItemDetailsPage} />
      <ProtectedRoute path="/delivery" component={DeliveryArrangementsPage} />
      <ProtectedRoute path="/swap" component={SwapPage} />
      <ProtectedRoute path="/profile" component={ProfilePage} />
      <ProtectedRoute path="/achievements" component={AchievementsPage} />
      <ProtectedRoute path="/wishlists" component={WishlistsPage} />
      <ProtectedRoute path="/premium" component={PremiumPage} />
      <ProtectedRoute path="/referrals" component={ReferralsPage} />
      <ProtectedRoute path="/my-items" component={MyItemsPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <Router />
        <Toaster />
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;