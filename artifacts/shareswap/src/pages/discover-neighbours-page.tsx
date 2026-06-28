import { Navbar } from "@/components/shared/navbar";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Users, UserPlus, UserCheck, Package } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface User {
  id: number;
  username: string;
  followerCount: number;
  followingCount: number;
  shareCoins: number;
  itemCount: number;
  isFollowing: boolean;
}

export default function DiscoverNeighboursPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: users = [], isLoading } = useQuery<User[]>({
    queryKey: ['/api/users/discover'],
  });

  const followMutation = useMutation({
    mutationFn: async (userId: number) => {
      return apiRequest('POST', `/api/users/${userId}/follow`);
    },
    onMutate: async (userId) => {
      await queryClient.cancelQueries({ queryKey: ['/api/users/discover'] });
      const previousUsers = queryClient.getQueryData(['/api/users/discover']);

      queryClient.setQueryData(['/api/users/discover'], (old: User[] | undefined) => {
        if (!old) return old;
        return old.map(user =>
          user.id === userId
            ? { ...user, isFollowing: true, followerCount: user.followerCount + 1 }
            : user
        );
      });

      return { previousUsers };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/users/discover'] });
      queryClient.invalidateQueries({ queryKey: ['/api/feed/following-items'] });
      toast({
        title: "Followed!",
        description: "You're now following this neighbour",
      });
    },
    onError: (error, userId, context) => {
      if (context?.previousUsers) {
        queryClient.setQueryData(['/api/users/discover'], context.previousUsers);
      }
      toast({
        title: "Error",
        description: "Failed to follow user. Please try again.",
        variant: "destructive",
      });
    },
  });

  const unfollowMutation = useMutation({
    mutationFn: async (userId: number) => {
      return apiRequest('DELETE', `/api/users/${userId}/follow`);
    },
    onMutate: async (userId) => {
      await queryClient.cancelQueries({ queryKey: ['/api/users/discover'] });
      const previousUsers = queryClient.getQueryData(['/api/users/discover']);

      queryClient.setQueryData(['/api/users/discover'], (old: User[] | undefined) => {
        if (!old) return old;
        return old.map(user =>
          user.id === userId
            ? { ...user, isFollowing: false, followerCount: Math.max(user.followerCount - 1, 0) }
            : user
        );
      });

      return { previousUsers };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/users/discover'] });
      queryClient.invalidateQueries({ queryKey: ['/api/feed/following-items'] });
      toast({
        title: "Unfollowed",
        description: "You unfollowed this neighbour",
      });
    },
    onError: (error, userId, context) => {
      if (context?.previousUsers) {
        queryClient.setQueryData(['/api/users/discover'], context.previousUsers);
      }
      toast({
        title: "Error",
        description: "Failed to unfollow user. Please try again.",
        variant: "destructive",
      });
    },
  });

  return (
    <div className="min-h-screen bg-[#F3F4F6]">
      <Navbar />
      <main className="max-w-7xl mx-auto px-4 py-8">
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <Users className="h-8 w-8 text-primary" />
            <h1 className="text-3xl font-bold">Find Neighbours</h1>
          </div>
          <p className="text-muted-foreground">
            Discover and follow neighbours in your community to see what they're sharing
          </p>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[...Array(6)].map((_, i) => (
              <Card key={i} className="animate-pulse">
                <CardContent className="p-6">
                  <div className="h-20 bg-gray-200 rounded mb-4"></div>
                  <div className="h-4 bg-gray-200 rounded mb-2"></div>
                  <div className="h-4 bg-gray-200 rounded w-2/3"></div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : users.length === 0 ? (
          <div className="text-center py-12">
            <Users className="h-16 w-16 text-gray-300 mx-auto mb-4" />
            <p className="text-muted-foreground">No neighbours found at the moment</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {users.map((user) => (
              <Card key={user.id} className="hover:shadow-md transition-shadow">
                <CardContent className="p-6">
                  <div className="flex items-start gap-4 mb-4">
                    <Avatar className="h-16 w-16">
                      <AvatarFallback className="bg-primary text-white text-lg">
                        {user.username.charAt(0).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-lg truncate">
                        @{user.username}
                      </h3>
                      <div className="flex gap-3 text-sm text-muted-foreground mt-1">
                        <span>{user.followerCount} followers</span>
                        <span>{user.followingCount} following</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 text-sm text-muted-foreground mb-4">
                    <Package className="h-4 w-4" />
                    <span>{user.itemCount} items shared</span>
                  </div>

                  {user.isFollowing ? (
                    <Button
                      variant="outline"
                      className="w-full"
                      onClick={() => unfollowMutation.mutate(user.id)}
                      disabled={unfollowMutation.isPending}
                    >
                      <UserCheck className="h-4 w-4 mr-2" />
                      Following
                    </Button>
                  ) : (
                    <Button
                      className="w-full"
                      onClick={() => followMutation.mutate(user.id)}
                      disabled={followMutation.isPending}
                    >
                      <UserPlus className="h-4 w-4 mr-2" />
                      Follow
                    </Button>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
