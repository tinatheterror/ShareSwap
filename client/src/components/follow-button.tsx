import { Button } from "@/components/ui/button";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { UserPlus, UserMinus } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";

interface FollowButtonProps {
  userId: number;
  username?: string;
  variant?: "default" | "outline" | "ghost";
  size?: "default" | "sm" | "lg";
}

export function FollowButton({ userId, username, variant = "outline", size = "sm" }: FollowButtonProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Don't show follow button for own profile
  if (!user || user.id === userId) {
    return null;
  }

  const { data: connections, isLoading } = useQuery<{
    followerCount: number;
    followingCount: number;
    isFollowing: boolean;
  }>({
    queryKey: ['/api/users', userId, 'connections'],
  });

  const followMutation = useMutation({
    mutationFn: () => apiRequest(`/api/users/${userId}/follow`, 'POST', {}),
    onMutate: async () => {
      // Optimistically update the UI
      await queryClient.cancelQueries({ queryKey: ['/api/users', userId, 'connections'] });
      const previousData = queryClient.getQueryData(['/api/users', userId, 'connections']);

      queryClient.setQueryData(['/api/users', userId, 'connections'], (old: any) => ({
        ...old,
        isFollowing: true,
        followerCount: (old?.followerCount || 0) + 1,
      }));

      return { previousData };
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: username ? `You are now following ${username}` : "You are now following this user",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/users', userId, 'connections'] });
      queryClient.invalidateQueries({ queryKey: ['/api/users', user.id, 'connections'] });
      queryClient.invalidateQueries({ queryKey: ['/api/feed/following-items'] });
    },
    onError: (error, variables, context) => {
      // Rollback on error
      if (context?.previousData) {
        queryClient.setQueryData(['/api/users', userId, 'connections'], context.previousData);
      }
      toast({
        title: "Error",
        description: "Failed to follow user. Please try again.",
        variant: "destructive",
      });
    },
  });

  const unfollowMutation = useMutation({
    mutationFn: () => apiRequest(`/api/users/${userId}/follow`, 'DELETE', {}),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: ['/api/users', userId, 'connections'] });
      const previousData = queryClient.getQueryData(['/api/users', userId, 'connections']);

      queryClient.setQueryData(['/api/users', userId, 'connections'], (old: any) => ({
        ...old,
        isFollowing: false,
        followerCount: Math.max((old?.followerCount || 1) - 1, 0),
      }));

      return { previousData };
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: username ? `You unfollowed ${username}` : "You unfollowed this user",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/users', userId, 'connections'] });
      queryClient.invalidateQueries({ queryKey: ['/api/users', user.id, 'connections'] });
      queryClient.invalidateQueries({ queryKey: ['/api/feed/following-items'] });
    },
    onError: (error, variables, context) => {
      if (context?.previousData) {
        queryClient.setQueryData(['/api/users', userId, 'connections'], context.previousData);
      }
      toast({
        title: "Error",
        description: "Failed to unfollow user. Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleClick = () => {
    if (connections?.isFollowing) {
      unfollowMutation.mutate();
    } else {
      followMutation.mutate();
    }
  };

  return (
    <Button
      variant={connections?.isFollowing ? "ghost" : variant}
      size={size}
      onClick={handleClick}
      disabled={isLoading || followMutation.isPending || unfollowMutation.isPending}
    >
      {connections?.isFollowing ? (
        <>
          <UserMinus className="h-4 w-4 mr-2" />
          Following
        </>
      ) : (
        <>
          <UserPlus className="h-4 w-4 mr-2" />
          Follow
        </>
      )}
    </Button>
  );
}
