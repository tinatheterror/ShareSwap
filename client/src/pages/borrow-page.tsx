import { Navbar } from "@/components/shared/navbar";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import type { SelectItem } from "@db/schema";
import { useState } from "react";

export default function BorrowPage() {
  const [searchQuery, setSearchQuery] = useState("");
  
  const { data: items = [] } = useQuery<SelectItem[]>({
    queryKey: ['/api/items'],
  });

  const filteredItems = items.filter(
    (item) =>
      item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.description.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <main className="max-w-7xl mx-auto px-4 py-8">
        <div className="flex flex-col md:flex-row justify-between items-center mb-8 gap-4">
          <div>
            <h1 className="text-3xl font-bold mb-2">Available Items</h1>
            <p className="text-muted-foreground">
              Browse items available for borrowing
            </p>
          </div>
          <div className="w-full md:w-72">
            <div className="relative">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search items..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {filteredItems.map((item) => (
            <Card key={item.id}>
              <CardContent className="pt-6">
                {item.photos && item.photos[0] && (
                  <img
                    src={item.photos[0]}
                    alt={item.name}
                    className="w-full h-48 object-cover rounded-md mb-4"
                  />
                )}
                <h3 className="text-xl font-semibold mb-2">{item.name}</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  {item.description}
                </p>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Condition:</span>
                    <span className="font-medium">{item.conditionRating}/10</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span>Duration:</span>
                    <span className="font-medium">{item.lendingDuration} days</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span>Deposit:</span>
                    <span className="font-medium">${item.securityDeposit}</span>
                  </div>
                </div>
              </CardContent>
              <CardFooter>
                <Button className="w-full">Request to Borrow</Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      </main>
    </div>
  );
}
