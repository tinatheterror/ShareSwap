import { MarketplaceCard } from "@/components/shared/marketplace-card";
import { Navbar } from "@/components/shared/navbar";
import { HandshakeIcon, Banknote, ArrowLeftRight } from "lucide-react";
import { useLocation } from "wouter";

export default function HomePage() {
  const [, navigate] = useLocation();

  return (
    <div className="min-h-screen">
      <Navbar />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {/* Hero Section */}
        <div className="text-center mb-16 relative">
          <div className="absolute inset-0 bg-gradient-to-r from-primary/10 via-primary/5 to-transparent rounded-3xl -z-10"></div>
          <div className="py-12 px-8">
            <h1 className="text-5xl font-bold tracking-tight mb-6 bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent">
              Share. Connect. Thrive.
            </h1>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto mb-8">
              Join our trusted community where neighbors help neighbors through secure item sharing
            </p>
            <div className="flex justify-center space-x-4 text-sm text-muted-foreground">
              <span className="flex items-center"><span className="w-2 h-2 bg-green-500 rounded-full mr-2"></span>Verified Users</span>
              <span className="flex items-center"><span className="w-2 h-2 bg-blue-500 rounded-full mr-2"></span>Secure Transactions</span>
              <span className="flex items-center"><span className="w-2 h-2 bg-purple-500 rounded-full mr-2"></span>Community Driven</span>
            </div>
          </div>
        </div>

        {/* Action Cards */}
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8 max-w-5xl mx-auto mb-16">
          <div className="group relative bg-white rounded-2xl p-8 shadow-lg hover:shadow-xl transition-all duration-300 border border-gray-100 hover:border-primary/20 cursor-pointer" onClick={() => navigate("/share-options")}>
            <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity"></div>
            <div className="relative">
              <div className="w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center mb-6 group-hover:bg-primary/20 transition-colors">
                <HandshakeIcon className="w-8 h-8 text-primary" />
              </div>
              <h3 className="text-xl font-bold mb-3">Lend & Borrow</h3>
              <p className="text-muted-foreground mb-4">Share items with trusted community members and build lasting connections</p>
              <div className="text-sm text-primary font-medium">Start sharing →</div>
            </div>
          </div>
          
          <div className="group relative bg-white rounded-2xl p-8 shadow-lg hover:shadow-xl transition-all duration-300 border border-gray-100 hover:border-primary/20 cursor-pointer" onClick={() => navigate("/verify")}>
            <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity"></div>
            <div className="relative">
              <div className="w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center mb-6 group-hover:bg-primary/20 transition-colors">
                <Banknote className="w-8 h-8 text-primary" />
              </div>
              <h3 className="text-xl font-bold mb-3">Rent It</h3>
              <p className="text-muted-foreground mb-4">Earn income by renting out your items securely to verified users</p>
              <div className="text-sm text-primary font-medium">Get verified →</div>
            </div>
          </div>
          
          <div className="group relative bg-white rounded-2xl p-8 shadow-lg hover:shadow-xl transition-all duration-300 border border-gray-100 hover:border-primary/20 cursor-pointer" onClick={() => navigate("/verify")}>
            <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity"></div>
            <div className="relative">
              <div className="w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center mb-6 group-hover:bg-primary/20 transition-colors">
                <ArrowLeftRight className="w-8 h-8 text-primary" />
              </div>
              <h3 className="text-xl font-bold mb-3">Swap It</h3>
              <p className="text-muted-foreground mb-4">Exchange items with other verified users in fair, equal trades</p>
              <div className="text-sm text-primary font-medium">Start swapping →</div>
            </div>
          </div>
        </div>

        {/* Stats Section */}
        <div className="bg-gray-50 rounded-3xl p-8 mb-16">
          <div className="grid md:grid-cols-4 gap-8 text-center">
            <div>
              <div className="text-3xl font-bold text-primary mb-2">2,500+</div>
              <div className="text-sm text-muted-foreground">Verified Users</div>
            </div>
            <div>
              <div className="text-3xl font-bold text-primary mb-2">15,000+</div>
              <div className="text-sm text-muted-foreground">Items Shared</div>
            </div>
            <div>
              <div className="text-3xl font-bold text-primary mb-2">98%</div>
              <div className="text-sm text-muted-foreground">Success Rate</div>
            </div>
            <div>
              <div className="text-3xl font-bold text-primary mb-2">4.9★</div>
              <div className="text-sm text-muted-foreground">User Rating</div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}