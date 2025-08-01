import { MarketplaceCard } from "@/components/shared/marketplace-card";
import { Navbar } from "@/components/shared/navbar";
import { CounterStats } from "@/components/ui/rolling-counter";
import { HandshakeIcon, Banknote, ArrowLeftRight } from "lucide-react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

export default function HomePage() {
  const [, navigate] = useLocation();
  const [realTimeStats, setRealTimeStats] = useState({
    itemsShared: 348293427342,
    activeMembers: 8392,
    successfulExchanges: 25834
  });

  // Fetch community stats
  const { data: communityStats } = useQuery<{
    totalItemsShared: number;
    platformItems: number;
    baseCount: number;
  }>({
    queryKey: ['/api/community-stats'],
    refetchInterval: 5000, // Refetch every 5 seconds for real-time updates
  });

  // Update stats when new data arrives
  useEffect(() => {
    if (communityStats) {
      setRealTimeStats(prev => ({
        ...prev,
        itemsShared: communityStats.totalItemsShared
      }));
    }
  }, [communityStats]);

  // Connect to WebSocket for real-time stats updates
  useEffect(() => {
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//${window.location.host}/ws/chat`;
    
    const ws = new WebSocket(wsUrl);
    
    ws.onopen = () => {
      console.log('Connected to WebSocket for stats updates');
    };
    
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'community_stats_update') {
          setRealTimeStats(prev => ({
            ...prev,
            itemsShared: data.payload.totalItemsShared
          }));
        }
      } catch (error) {
        console.error('Error parsing WebSocket message:', error);
      }
    };
    
    return () => {
      ws.close();
    };
  }, []);

  // Add small random increments to simulate additional community activity
  useEffect(() => {
    const interval = setInterval(() => {
      if (Math.random() < 0.3) { // 30% chance every interval
        setRealTimeStats(prev => ({
          ...prev,
          itemsShared: prev.itemsShared + Math.floor(Math.random() * 3) + 1, // Add 1-3 items
          activeMembers: prev.activeMembers + (Math.random() < 0.1 ? 1 : 0), // Occasionally add member
          successfulExchanges: prev.successfulExchanges + (Math.random() < 0.2 ? 1 : 0) // Occasionally add exchange
        }));
      }
    }, 3000); // Every 3 seconds

    return () => clearInterval(interval);
  }, []);

  const platformStats = [
    {
      label: "Items Shared Within Our Community",
      value: realTimeStats.itemsShared,
      formatter: (value: number) => {
        return new Intl.NumberFormat('en-US').format(value);
      }
    },
    {
      label: "Active Members",
      value: realTimeStats.activeMembers,
      suffix: "+"
    },
    {
      label: "Successful Exchanges",
      value: realTimeStats.successfulExchanges,
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