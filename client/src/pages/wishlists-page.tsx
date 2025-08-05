import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Navbar } from "@/components/shared/navbar";
import { Heart, Plus, MapPin, Clock, ArrowRightLeft, ShoppingCart, Repeat, Calendar, Archive, AlertTriangle } from "lucide-react";
import { useState } from "react";

interface Wishlist {
  id: number;
  userId: number;
  itemName: string;
  description?: string;
  category?: string;
  needType: string;
  preferredLocation?: string;
  urgency: string;
  neededDate?: string;
  returnDate?: string;
  isActive: boolean;
  isExpired?: boolean;
  expirationReason?: string;
  createdAt: string;
}

export default function WishlistsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showAddForm, setShowAddForm] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [formData, setFormData] = useState({
    itemName: '',
    description: '',
    category: '',
    needType: 'borrow',
    preferredLocation: '',
    urgency: 'normal',
    neededDate: '',
    returnDate: ''
  });

  const { data: wishlists = [], isLoading } = useQuery<Wishlist[]>({
    queryKey: ['/api/wishlists'],
  });

  // Filter expired and active wishlists
  const activeWishlists = wishlists.filter((w: Wishlist) => !w.isExpired);
  const expiredWishlists = wishlists.filter((w: Wishlist) => w.isExpired);

  const addWishlistMutation = useMutation({
    mutationFn: async (data: any) => {
      return apiRequest("POST", "/api/wishlists", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/wishlists'] });
      setShowAddForm(false);
      setFormData({
        itemName: '',
        description: '',
        category: '',
        needType: 'borrow',
        preferredLocation: '',
        urgency: 'normal',
        neededDate: '',
        returnDate: ''
      });
      toast({
        title: "Wishlist item added!",
        description: "We'll notify you when matching items become available.",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to add wishlist item. Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.itemName) {
      toast({
        title: "Item name required",
        description: "Please enter the name of the item you're looking for.",
        variant: "destructive",
      });
      return;
    }
    addWishlistMutation.mutate(formData);
  };

  const getUrgencyColor = (urgency: string) => {
    switch (urgency) {
      case 'urgent': return 'bg-red-100 text-red-800';
      case 'high': return 'bg-orange-100 text-orange-800';
      case 'normal': return 'bg-blue-100 text-blue-800';
      case 'low': return 'bg-gray-100 text-gray-800';
      default: return 'bg-blue-100 text-blue-800';
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navbar />
        <main className="max-w-7xl mx-auto px-4 py-12">
          <div className="flex items-center justify-center min-h-[400px]">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <main className="max-w-7xl mx-auto px-4 py-12">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold mb-2 flex items-center justify-center gap-2">
            <Heart className="h-8 w-8 text-primary" />
            Your Wishlist
          </h1>
          <p className="text-muted-foreground">
            Create demand signals for items you need - get notified when they become available
          </p>
          
          {expiredWishlists.length > 0 && (
            <div className="flex justify-center mt-4">
              <Button
                variant="outline"
                onClick={() => setShowArchived(!showArchived)}
                className="text-sm"
              >
                <Archive className="h-4 w-4 mr-2" />
                {showArchived ? 'Hide' : 'Show'} Archived ({expiredWishlists.length})
              </Button>
            </div>
          )}
        </div>

        {/* Add New Wishlist Item */}
        <Card className="mb-8">
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span className="flex items-center gap-2">
                <Plus className="h-5 w-5" />
                Add to Wishlist
              </span>
              {!showAddForm && (
                <Button onClick={() => setShowAddForm(true)}>
                  Add Item
                </Button>
              )}
            </CardTitle>
          </CardHeader>
          
          {showAddForm && (
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium mb-2">Item Name *</label>
                    <Input
                      value={formData.itemName}
                      onChange={(e) => setFormData({...formData, itemName: e.target.value})}
                      placeholder="e.g., Power drill, Camping tent, Stand mixer"
                      required
                    />
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium mb-2">Category</label>
                    <Select value={formData.category} onValueChange={(value) => setFormData({...formData, category: value})}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select category" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="tools">Tools & Equipment</SelectItem>
                        <SelectItem value="electronics">Electronics</SelectItem>
                        <SelectItem value="outdoor">Outdoor & Sports</SelectItem>
                        <SelectItem value="kitchen">Kitchen & Appliances</SelectItem>
                        <SelectItem value="home">Home & Garden</SelectItem>
                        <SelectItem value="other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2">Description</label>
                  <Textarea
                    value={formData.description}
                    onChange={(e) => setFormData({...formData, description: e.target.value})}
                    placeholder="Describe what you need this item for or any specific requirements..."
                    rows={3}
                  />
                </div>

                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium mb-2">Need Type</label>
                    <Select value={formData.needType} onValueChange={(value) => setFormData({...formData, needType: value})}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="borrow">Borrow - Use temporarily</SelectItem>
                        <SelectItem value="rent">Rent - Pay for usage</SelectItem>
                        <SelectItem value="swap">Swap - Exchange items</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-2">Urgency</label>
                    <Select value={formData.urgency} onValueChange={(value) => setFormData({...formData, urgency: value})}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="low">Low - Within a month</SelectItem>
                        <SelectItem value="normal">Normal - Within 2 weeks</SelectItem>
                        <SelectItem value="high">High - Within a week</SelectItem>
                        <SelectItem value="urgent">Urgent - ASAP</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium mb-2">Date Needed</label>
                    <Input
                      type="date"
                      value={formData.neededDate}
                      onChange={(e) => setFormData({...formData, neededDate: e.target.value})}
                      min={new Date().toISOString().split('T')[0]}
                    />
                  </div>

                  {formData.needType === 'borrow' && (
                    <div>
                      <label className="block text-sm font-medium mb-2">Return Date</label>
                      <Input
                        type="date"
                        value={formData.returnDate}
                        onChange={(e) => setFormData({...formData, returnDate: e.target.value})}
                        min={formData.neededDate || new Date().toISOString().split('T')[0]}
                      />
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2">Preferred Location</label>
                  <div className="relative">
                    <MapPin className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-600" />
                    <Input
                      value={formData.preferredLocation}
                      onChange={(e) => setFormData({...formData, preferredLocation: e.target.value})}
                      placeholder="Neighborhood, postal code, or 'nearby'"
                      className="pl-10"
                    />
                  </div>
                </div>

                <div className="flex gap-4">
                  <Button 
                    type="submit" 
                    disabled={addWishlistMutation.isPending}
                    className="flex-1"
                  >
                    {addWishlistMutation.isPending ? 'Adding...' : 'Add to Wishlist'}
                  </Button>
                  <Button 
                    type="button" 
                    variant="outline" 
                    onClick={() => setShowAddForm(false)}
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            </CardContent>
          )}
        </Card>

        {/* Active Wishlist Items */}
        {!showArchived && (
          <>
            <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
              <Heart className="h-5 w-5 text-primary" />
              Active Requests ({activeWishlists.length})
            </h2>
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
              {activeWishlists?.map((item) => (
            <Card key={item.id} className="hover:shadow-md transition-shadow">
              <CardContent className="p-6">
                <div className="flex items-start justify-between mb-4">
                  <h3 className="font-semibold text-lg">{item.itemName}</h3>
                  <Badge className={getUrgencyColor(item.urgency)}>
                    <Clock className="h-3 w-3 mr-1" />
                    {item.urgency}
                  </Badge>
                </div>

                {item.description && (
                  <p className="text-sm text-muted-foreground mb-3">{item.description}</p>
                )}

                <div className="space-y-2 text-sm">
                  {item.category && (
                    <div className="flex items-center gap-2">
                      <span className="font-medium">Category:</span>
                      <Badge variant="outline">{item.category}</Badge>
                    </div>
                  )}

                  <div className="flex items-center gap-2">
                    <span className="font-medium">Need Type:</span>
                    <Badge variant="secondary" className={
                      item.needType === 'borrow' ? 'bg-blue-100 text-blue-800' :
                      item.needType === 'rent' ? 'bg-purple-100 text-purple-800' :
                      'bg-orange-100 text-orange-800'
                    }>
                      {item.needType === 'borrow' && <ShoppingCart className="h-3 w-3 mr-1" />}
                      {item.needType === 'rent' && <ArrowRightLeft className="h-3 w-3 mr-1" />}
                      {item.needType === 'swap' && <Repeat className="h-3 w-3 mr-1" />}
                      {item.needType.charAt(0).toUpperCase() + item.needType.slice(1)}
                    </Badge>
                  </div>

                  {item.neededDate && (
                    <div className="flex items-center gap-2">
                      <span className="font-medium">Date Needed:</span>
                      <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                        <Calendar className="h-3 w-3 mr-1" />
                        {new Date(item.neededDate).toLocaleDateString()}
                      </Badge>
                    </div>
                  )}

                  {item.returnDate && item.needType === 'borrow' && (
                    <div className="flex items-center gap-2">
                      <span className="font-medium">Return Date:</span>
                      <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
                        <Calendar className="h-3 w-3 mr-1" />
                        {new Date(item.returnDate).toLocaleDateString()}
                      </Badge>
                    </div>
                  )}

                  {item.preferredLocation && (
                    <div className="flex items-center gap-2">
                      <span className="font-medium">Location:</span>
                      <span className="text-muted-foreground">{item.preferredLocation}</span>
                    </div>
                  )}
                </div>

                <div className="mt-4 pt-4 border-t">
                  <p className="text-xs text-muted-foreground">
                    Added {new Date(item.createdAt).toLocaleDateString()}
                  </p>
                </div>
              </CardContent>
            </Card>
              ))}
            </div>
          </>
        )}

        {/* Archived/Expired Wishlist Items */}
        {showArchived && (
          <>
            <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
              <Archive className="h-5 w-5 text-gray-600" />
              Archived Requests ({expiredWishlists.length})
            </h2>
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
              {expiredWishlists?.map((item) => (
                <Card key={item.id} className="hover:shadow-md transition-shadow opacity-75 border-gray-300">
                  <CardContent className="p-6">
                    <div className="flex items-start justify-between mb-4">
                      <h3 className="font-semibold text-lg text-gray-700">{item.itemName}</h3>
                      <div className="flex flex-col gap-1">
                        <Badge className="bg-red-100 text-red-800">
                          <AlertTriangle className="h-3 w-3 mr-1" />
                          Expired
                        </Badge>
                        <Badge className={getUrgencyColor(item.urgency)} variant="outline">
                          <Clock className="h-3 w-3 mr-1" />
                          {item.urgency}
                        </Badge>
                      </div>
                    </div>

                    {item.description && (
                      <p className="text-sm text-muted-foreground mb-3">{item.description}</p>
                    )}

                    <div className="space-y-2 text-sm">
                      {item.category && (
                        <div className="flex items-center gap-2">
                          <span className="font-medium">Category:</span>
                          <Badge variant="outline">{item.category}</Badge>
                        </div>
                      )}

                      <div className="flex items-center gap-2">
                        <span className="font-medium">Need Type:</span>
                        <Badge variant="secondary" className={
                          item.needType === 'borrow' ? 'bg-blue-100 text-blue-800' :
                          item.needType === 'rent' ? 'bg-purple-100 text-purple-800' :
                          'bg-orange-100 text-orange-800'
                        }>
                          {item.needType === 'borrow' && <ShoppingCart className="h-3 w-3 mr-1" />}
                          {item.needType === 'rent' && <ArrowRightLeft className="h-3 w-3 mr-1" />}
                          {item.needType === 'swap' && <Repeat className="h-3 w-3 mr-1" />}
                          {item.needType.charAt(0).toUpperCase() + item.needType.slice(1)}
                        </Badge>
                      </div>

                      {item.neededDate && (
                        <div className="flex items-center gap-2">
                          <span className="font-medium">Was Needed:</span>
                          <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">
                            <Calendar className="h-3 w-3 mr-1" />
                            {new Date(item.neededDate).toLocaleDateString()}
                          </Badge>
                        </div>
                      )}

                      {item.returnDate && item.needType === 'borrow' && (
                        <div className="flex items-center gap-2">
                          <span className="font-medium">Return Date:</span>
                          <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">
                            <Calendar className="h-3 w-3 mr-1" />
                            {new Date(item.returnDate).toLocaleDateString()}
                          </Badge>
                        </div>
                      )}

                      {item.expirationReason && (
                        <div className="mt-3 p-2 bg-gray-50 rounded-lg">
                          <p className="text-xs text-gray-600">
                            <strong>Archived:</strong> {item.expirationReason}
                          </p>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </>
        )}

        {!wishlists?.length && (
          <div className="text-center py-12">
            <Heart className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-xl font-semibold mb-2">No wishlist items yet</h3>
            <p className="text-muted-foreground mb-6">
              Add items you're looking for and we'll notify you when they become available in your area.
            </p>
            <Button onClick={() => setShowAddForm(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Add Your First Item
            </Button>
          </div>
        )}
      </main>
    </div>
  );
}