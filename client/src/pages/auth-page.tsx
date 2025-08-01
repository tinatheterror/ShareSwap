import { useAuth } from "@/hooks/use-auth";
import { Redirect } from "wouter";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { useQuery } from "@tanstack/react-query";
import { RollingCounter } from "@/components/rolling-counter";

const formSchema = z.object({
  username: z.string().min(3).max(20),
  password: z.string().min(6),
});

export default function AuthPage() {
  const { user, loginMutation, registerMutation } = useAuth();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      username: "",
      password: "",
    },
  });

  // Fetch platform statistics
  const { data: stats, isLoading: statsLoading } = useQuery<{
    itemsShared: number;
    totalUsers: number;
    successfulTransactions: number;
  }>({
    queryKey: ['/api/stats'],
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
  });

  if (user) {
    return <Redirect to="/" />;
  }

  return (
    <div className="min-h-screen grid md:grid-cols-2">
      <div className="flex flex-col items-center justify-center p-8">
          <div className="w-full max-w-md" style={{ marginBottom: "1rem" }}>
            <img 
              src="/logo.png"
              alt="SwapShare Logo"
              className="w-full h-auto"
            />
          </div>
          <Card className="w-full max-w-md border-primary/20">
          <CardContent className="pt-6">
            <Tabs defaultValue="login">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="login" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">Login</TabsTrigger>
                <TabsTrigger value="register" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">Register</TabsTrigger>
              </TabsList>

              <TabsContent value="login">
                <Form {...form}>
                  <form
                    onSubmit={form.handleSubmit((data) =>
                      loginMutation.mutate(data)
                    )}
                    className="space-y-4"
                  >
                    <FormField
                      control={form.control}
                      name="username"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Username</FormLabel>
                          <FormControl>
                            <Input {...field} className="focus-visible:ring-primary" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="password"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Password</FormLabel>
                          <FormControl>
                            <Input type="password" {...field} className="focus-visible:ring-primary" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <Button
                      type="submit"
                      className="w-full bg-primary hover:bg-primary/90"
                      disabled={loginMutation.isPending}
                    >
                      Login
                    </Button>
                  </form>
                </Form>
              </TabsContent>

              <TabsContent value="register">
                <Form {...form}>
                  <form
                    onSubmit={form.handleSubmit((data) =>
                      registerMutation.mutate(data)
                    )}
                    className="space-y-4"
                  >
                    <FormField
                      control={form.control}
                      name="username"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Username</FormLabel>
                          <FormControl>
                            <Input {...field} className="focus-visible:ring-primary" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="password"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Password</FormLabel>
                          <FormControl>
                            <Input type="password" {...field} className="focus-visible:ring-primary" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <Button
                      type="submit"
                      className="w-full bg-primary hover:bg-primary/90"
                      disabled={registerMutation.isPending}
                    >
                      Register
                    </Button>
                  </form>
                </Form>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>

      <div
        className="hidden md:block bg-primary"
      >
        <div className="h-full w-full p-12 flex items-center">
          <div className="max-w-lg">
            <h1 className="text-3xl font-bold text-white mb-8">
              Welcome to ShareSwap
            </h1>
            <p className="text-lg text-primary-foreground/90 mb-12">
              Share more, own less. Connect with your neighbours and discover a world of shared resources.
            </p>
            
            {/* Platform Statistics */}
            <div className="flex items-baseline gap-3">
              <span className="text-6xl font-extrabold text-white tracking-tight">
                {statsLoading ? "Loading..." : (
                  <RollingCounter 
                    target={stats?.itemsShared || 0} 
                    duration={3000}
                    className="text-white"
                  />
                )}
              </span>
              <span className="text-xl text-primary-foreground/90 font-bold italic tracking-wide">
                items shared within our community.
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}