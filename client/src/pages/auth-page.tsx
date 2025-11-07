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
import { AlertCircle, Lock } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";

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
      <div className="flex flex-col items-center px-8 pt-2">
          <div className="w-full max-w-md mb-2">
            <img 
              src="/logo.png"
              alt="SwapShare Logo"
              className="w-full h-auto"
              style={{ clipPath: 'inset(28% 0 30% 0)' }}
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
                <div className="space-y-4">
                  <Button
                    onClick={() => window.location.href = '/api/auth/google'}
                    className="w-full bg-primary hover:bg-primary/90 h-11"
                  >
                    Continue with Google
                  </Button>
                  <p className="text-xs text-center text-muted-foreground px-2">
                    Fast and secure. We'll never post or share anything without permission.
                  </p>

                  <Button
                    variant="outline"
                    className="w-full h-11"
                    disabled
                  >
                    Continue with Phone Number
                  </Button>
                  <p className="text-xs text-center text-muted-foreground px-2">
                    No Google account? Verify with your phone number to build trust in your neighbourhood.
                  </p>

                  <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground mt-4">
                    <Lock className="h-3 w-3" />
                    <span>Your identity helps keep ShareSwap safe and neighbourly.</span>
                  </div>

                  <div className="relative my-6">
                    <div className="absolute inset-0 flex items-center">
                      <Separator />
                    </div>
                    <div className="relative flex justify-center text-xs uppercase">
                      <span className="bg-background px-2 text-muted-foreground">
                        Or continue with username
                      </span>
                    </div>
                  </div>

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
                      
                      {loginMutation.error && (
                        <Alert variant="destructive" className="py-2">
                          <AlertCircle className="h-4 w-4" />
                          <AlertDescription>
                            {loginMutation.error.message}
                          </AlertDescription>
                        </Alert>
                      )}
                      
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
                </div>
              </TabsContent>

              <TabsContent value="register">
                <div className="space-y-4">
                  <Button
                    onClick={() => window.location.href = '/api/auth/google'}
                    className="w-full bg-primary hover:bg-primary/90 h-11"
                  >
                    Continue with Google
                  </Button>
                  <p className="text-xs text-center text-muted-foreground px-2">
                    Fast and secure. We'll never post or share anything without permission.
                  </p>

                  <Button
                    variant="outline"
                    className="w-full h-11"
                    disabled
                  >
                    Continue with Phone Number
                  </Button>
                  <p className="text-xs text-center text-muted-foreground px-2">
                    No Google account? Verify with your phone number to build trust in your neighbourhood.
                  </p>

                  <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground mt-4">
                    <Lock className="h-3 w-3" />
                    <span>Your identity helps keep ShareSwap safe and neighbourly.</span>
                  </div>

                  <div className="relative my-6">
                    <div className="absolute inset-0 flex items-center">
                      <Separator />
                    </div>
                    <div className="relative flex justify-center text-xs uppercase">
                      <span className="bg-background px-2 text-muted-foreground">
                        Or create username account
                      </span>
                    </div>
                  </div>

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
                </div>
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
              <span className="text-xl font-bold text-white">
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