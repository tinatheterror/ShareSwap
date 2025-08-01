import { MarketplaceCard } from "@/components/shared/marketplace-card";
import { Navbar } from "@/components/shared/navbar";
import { CounterStats } from "@/components/ui/rolling-counter";
import { HandshakeIcon, Banknote, ArrowLeftRight } from "lucide-react";
import { useLocation } from "wouter";

export default function HomePage() {
  const [, navigate] = useLocation();

  const platformStats = [
    {
      label: "Items Shared",
      value: 12547,
      suffix: "+"
    },
    {
      label: "Active Members",
      value: 8392,
      suffix: "+"
    },
    {
      label: "Successful Exchanges",
      value: 25834,
      suffix: "+"
    }
  ];

  return (
    <div className="min-h-screen">
      <Navbar />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold tracking-tight mb-4">
            Choose Your Sharing Option
          </h1>
          <p className="text-lg text-muted-foreground">
            Share more, own less. Connect with your neighbours and discover a world of shared resources
          </p>
        </div>

        {/* Rolling Counter Stats Section */}
        <div className="mb-16 py-12 bg-gradient-to-r from-primary/5 to-primary/10 rounded-2xl">
          <div className="text-center mb-8">
            <h2 className="text-2xl font-semibold mb-2">Join Our Growing Community</h2>
            <p className="text-muted-foreground">Real people sharing real resources every day</p>
          </div>
          <CounterStats stats={platformStats} className="max-w-4xl mx-auto" />
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8 max-w-5xl mx-auto">
          <MarketplaceCard
            title="Lend & Borrow"
            description="Share items with trusted community members"
            icon={<HandshakeIcon className="w-8 h-8 text-primary" />}
            onClick={() => navigate("/share-options")}
          />
          <MarketplaceCard
            title="Rent It"
            description="Earn by renting out your items securely"
            icon={<Banknote className="w-8 h-8 text-primary" />}
            onClick={() => navigate("/verify")}
          />
          <MarketplaceCard
            title="Swap It"
            description="Exchange items with other verified users"
            icon={<ArrowLeftRight className="w-8 h-8 text-primary" />}
            onClick={() => navigate("/verify")}
          />
        </div>
      </main>
    </div>
  );
}