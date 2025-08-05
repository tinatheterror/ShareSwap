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

  // Extract item ID from URL and detect source page
  const itemId = location.split('/').pop();
  const urlParams = new URLSearchParams(window.location.search);
  const source = urlParams.get('source'); // 'rent', 'borrow', or 'swap'

  const { data: item } = useQuery<SelectItem>({
    queryKey: [`/api/items/${itemId}`],
    enabled: !!itemId,
  });

  if (!item) return null;

  // Define the order and styling based on source
  const getOptionPriority = () => {
    if (source === 'rent' && item.isRentable) return 'RENT';
    if (source === 'borrow' && item.isLendable) return 'BORROW';
    if (source === 'swap' && item.isSwappable) return 'SWAP';
    // Default priority: BORROW -> RENT -> SWAP
    if (item.isLendable) return 'BORROW';
    if (item.isRentable) return 'RENT';
    if (item.isSwappable) return 'SWAP';
    return null;
  };

  const primaryOption = getOptionPriority();

  const renderOption = (type: 'BORROW' | 'RENT' | 'SWAP', isPrimary: boolean) => {
    if (type === 'BORROW' && !item.isLendable) return null;
    if (type === 'RENT' && !item.isRentable) return null;
    if (type === 'SWAP' && !item.isSwappable) return null;

    const buttonClass = isPrimary 
      ? "w-32" 
      : "w-32";

    if (type === 'BORROW') {
      return (
        <div className="flex justify-between items-center" key="borrow">
          <div>
            <p className={`font-medium ${isPrimary ? 'text-lg' : ''}`}>Borrow</p>
            <div className="flex items-center gap-2 mb-1">
              <Coins className="h-4 w-4 text-teal-600" />
              <span className={`font-bold text-teal-700 ${isPrimary ? 'text-lg' : 'text-sm'}`}>
                {item.shareCoinPrice || 5} ShareCoins
              </span>
            </div>
            <p className="text-sm text-muted-foreground">
              {item.lendingDuration} days · ${Number(item.securityDeposit).toFixed(2)} deposit
            </p>
          </div>
          <Button 
            onClick={() => setRequestType("BORROW")} 
            className={buttonClass}
            variant={isPrimary ? "default" : "outline"}
          >
            Request to Borrow
          </Button>
        </div>
      );
    }

    if (type === 'RENT') {
      return (
        <div className="flex justify-between items-center" key="rent">
          <div>
            <p className={`font-medium ${isPrimary ? 'text-lg' : ''}`}>Rent</p>
            <div className="flex items-center gap-2 mb-1">
              <span className={`font-bold text-green-700 ${isPrimary ? 'text-lg' : 'text-sm'}`}>
                ${Number(item.dollarsPrice || 10).toFixed(2)}/day
              </span>
            </div>
            <p className="text-sm text-muted-foreground">
              ${Number(item.securityDeposit).toFixed(2)} deposit required
            </p>
          </div>
          <Button 
            onClick={() => setRequestType("RENT")} 
            className={buttonClass}
            variant={isPrimary ? "default" : "outline"}
          >
            Request to Rent
          </Button>
        </div>
      );
    }

    if (type === 'SWAP') {
      return (
        <div className="flex justify-between items-center" key="swap">
          <div>
            <p className={`font-medium ${isPrimary ? 'text-lg' : ''}`}>Swap</p>
            <div className="flex items-center gap-2 mb-1">
              <Coins className="h-4 w-4 text-green-600" />
              <span className={`font-bold text-green-700 ${isPrimary ? 'text-lg' : 'text-sm'}`}>
                No ShareCoins needed
              </span>
            </div>
            <p className="text-sm text-muted-foreground">
              Exchange with your items
            </p>
          </div>
          <Button 
            onClick={() => setRequestType("SWAP")} 
            className={buttonClass}
            variant={isPrimary ? "default" : "outline"}
          >
            Request to Swap
          </Button>
        </div>
      );
    }

    return null;
  };

  const allOptions = ['BORROW', 'RENT', 'SWAP'] as const;
  const sortedOptions = [
    primaryOption,
    ...allOptions.filter(opt => opt !== primaryOption)
  ].filter(Boolean) as ('BORROW' | 'RENT' | 'SWAP')[];

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
                  
                  {sortedOptions.map((option, index) => 
                    renderOption(option, index === 0)
                  )}
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