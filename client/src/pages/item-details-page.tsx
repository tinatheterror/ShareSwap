import { useState } from "react";
import { Navbar } from "@/components/shared/navbar";
import { ItemRequestForm } from "@/components/shared/item-request-form";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Coins } from "lucide-react";
import type { SelectItem } from "@db/schema";

type RequestType = "BORROW" | "RENT" | "SWAP";

export default function ItemDetailsPage() {
  const [requestType, setRequestType] = useState<RequestType | null>(null);
  const [location] = useLocation();
  const { toast } = useToast();

  // Extract item ID from URL
  const itemId = location.split('/').pop();
  
  // Determine which sharing option to prioritize based on referrer
  const getReferrerContext = () => {
    if (typeof window !== 'undefined') {
      const referrer = document.referrer;
      if (referrer.includes('/swap')) return 'swap';
      if (referrer.includes('/rent')) return 'rent';
      if (referrer.includes('/borrow')) return 'borrow';
    }
    return 'borrow';
  };
  
  const prioritizedContext = getReferrerContext();

  const { data: item } = useQuery<SelectItem>({
    queryKey: [`/api/items/${itemId}`],
    enabled: !!itemId,
  });

  if (!item) return null;

  // Create ordered sharing options based on context
  const getSharingOptions = () => {
    const borrowOption = item.isLendable ? (
      <div key="borrow" className="flex justify-between items-center">
        <div>
          <p className="font-medium">Borrow</p>
          <div className="flex items-center gap-2 mb-1">
            <Coins className="h-4 w-4 text-teal-600" />
            <span className="text-lg font-bold text-teal-700">
              {item.shareCoinPrice || 5} ShareCoins
            </span>
          </div>
          <p className="text-sm text-muted-foreground">
            {item.lendingDuration} days · ${Number(item.securityDeposit).toFixed(2)} deposit
          </p>
        </div>
        <Button onClick={() => setRequestType("BORROW")} className="w-32">
          Request to Borrow
        </Button>
      </div>
    ) : null;

    const rentOption = item.isRentable ? (
      <div key="rent" className="flex justify-between items-center">
        <div>
          <p className="font-medium">Rent</p>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-lg font-bold text-green-700">
              ${Number(item.dollarsPrice || 10).toFixed(2)}/day
            </span>
          </div>
          <p className="text-sm text-muted-foreground">
            ${Number(item.securityDeposit).toFixed(2)} deposit required
          </p>
        </div>
        <Button onClick={() => setRequestType("RENT")} className="w-32">
          Request to Rent
        </Button>
      </div>
    ) : null;

    const swapOption = item.isSwappable ? (
      <div key="swap" className="flex justify-between items-center">
        <div>
          <p className="font-medium">Swap</p>
          <div className="flex items-center gap-2 mb-1">
            <Coins className="h-4 w-4 text-green-600" />
            <span className="text-lg font-bold text-green-700">
              No ShareCoins needed
            </span>
          </div>
          <p className="text-sm text-muted-foreground">
            Exchange with your items
          </p>
        </div>
        <Button onClick={() => setRequestType("SWAP")} className="w-32">
          Request to Swap
        </Button>
      </div>
    ) : null;

    // Order options based on context
    const options: JSX.Element[] = [];
    
    if (prioritizedContext === 'swap') {
      if (swapOption) options.push(swapOption);
      if (borrowOption) options.push(borrowOption);
      if (rentOption) options.push(rentOption);
    } else if (prioritizedContext === 'rent') {
      if (rentOption) options.push(rentOption);
      if (borrowOption) options.push(borrowOption);
      if (swapOption) options.push(swapOption);
    } else { // 'borrow' or default
      if (borrowOption) options.push(borrowOption);
      if (rentOption) options.push(rentOption);
      if (swapOption) options.push(swapOption);
    }
    
    return options;
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <main className="max-w-4xl mx-auto px-4 py-8">
        <Card>
          <CardContent className="p-6">
            <div className="grid md:grid-cols-2 gap-8">
              <div>
                <div className="aspect-square bg-muted rounded-lg overflow-hidden">
                  {item.photos[0] && (
                    <img
                      src={item.photos[0]}
                      alt={item.name}
                      className="w-full h-full object-cover"
                    />
                  )}
                </div>
                <div className="grid grid-cols-4 gap-2 mt-2">
                  {item.photos.slice(1).map((photo, i) => (
                    <div key={i} className="aspect-square bg-muted rounded-lg overflow-hidden">
                      <img
                        src={photo}
                        alt={`${item.name} ${i + 2}`}
                        className="w-full h-full object-cover"
                      />
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-6">
                <div>
                  <h1 className="text-2xl font-bold">{item.name}</h1>
                  <p className="text-muted-foreground mt-2">{item.description}</p>
                </div>

                <div className="space-y-2">
                  <h3 className="font-medium">Condition</h3>
                  <Badge variant={item.isConditionVerified ? "default" : "secondary"}>
                    {item.conditionRating}/10 {item.isConditionVerified && "✓ Verified"}
                  </Badge>
                </div>

                <div className="space-y-4">
                  <h3 className="font-medium">Sharing Options</h3>
                  {getSharingOptions()}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {requestType && (
          <ItemRequestForm
            item={item}
            requestType={requestType}
            isOpen={!!requestType}
            onClose={() => setRequestType(null)}
          />
        )}
      </main>
    </div>
  );
}