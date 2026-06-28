import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { MapPin, Bell, Plus, X } from "lucide-react";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

interface LocationAlert {
  id: number;
  keywords: string[];
  latitude: string | null;
  longitude: string | null;
  radius: number;
  isActive: boolean;
  createdAt: string;
}

export function LocationAlerts() {
  const [newKeywords, setNewKeywords] = useState("");
  const [showForm, setShowForm] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: alerts = [], isLoading } = useQuery<LocationAlert[]>({
    queryKey: ['/api/location-alerts'],
  });

  const createAlertMutation = useMutation({
    mutationFn: async (data: { keywords: string[]; latitude?: number; longitude?: number; radius?: number }) => {
      return apiRequest("POST", "/api/location-alerts", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/location-alerts'] });
      setNewKeywords("");
      setShowForm(false);
      toast({
        title: "Alert Created",
        description: "You'll be notified when matching items are available nearby.",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to create location alert.",
        variant: "destructive",
      });
    },
  });

  const handleCreateAlert = () => {
    if (!newKeywords.trim()) return;

    const keywords = newKeywords.split(',').map(k => k.trim()).filter(k => k.length > 0);
    if (keywords.length === 0) return;

    // GPS disabled — create alert without location
    createAlertMutation.mutate({ keywords, radius: 10 });
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell className="h-5 w-5" />
            Location Alerts
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse space-y-4">
            <div className="h-4 bg-gray-200 rounded w-3/4"></div>
            <div className="h-4 bg-gray-200 rounded w-1/2"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 justify-between">
          <div className="flex items-center gap-2">
            <Bell className="h-5 w-5" />
            Location Alerts
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowForm(!showForm)}
          >
            <Plus className="h-4 w-4 mr-1" />
            Add Alert
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {showForm && (
          <div className="border rounded-lg p-4 space-y-3">
            <div>
              <label className="text-sm font-medium mb-2 block">
                Keywords (comma-separated)
              </label>
              <Input
                placeholder="e.g., drill, camera, bike"
                value={newKeywords}
                onChange={(e) => setNewKeywords(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleCreateAlert()}
              />
              <p className="text-xs text-muted-foreground mt-1">
                You'll be notified when items matching these keywords become available within 10km
              </p>
            </div>
            <div className="flex gap-2">
              <Button 
                onClick={handleCreateAlert}
                disabled={!newKeywords.trim() || createAlertMutation.isPending}
                size="sm"
              >
                {createAlertMutation.isPending ? "Creating..." : "Create Alert"}
              </Button>
              <Button 
                variant="outline" 
                onClick={() => setShowForm(false)}
                size="sm"
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

        {alerts.length === 0 ? (
          <div className="text-center py-6 text-muted-foreground">
            <Bell className="h-12 w-12 mx-auto mb-2 opacity-50" />
            <p>No location alerts set up yet</p>
            <p className="text-sm">Create alerts to get notified about items near you</p>
          </div>
        ) : (
          <div className="space-y-3">
            {alerts.map((alert) => (
              <div key={alert.id} className="border rounded-lg p-3">
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <MapPin className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-medium">
                      {alert.radius}km radius
                    </span>
                    {alert.isActive ? (
                      <Badge variant="default" className="text-xs">Active</Badge>
                    ) : (
                      <Badge variant="secondary" className="text-xs">Inactive</Badge>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap gap-1 mb-2">
                  {alert.keywords.map((keyword, idx) => (
                    <Badge key={idx} variant="outline" className="text-xs">
                      {keyword}
                    </Badge>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  Created {new Date(alert.createdAt).toLocaleDateString()}
                </p>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}