import { Navbar } from "@/components/shared/navbar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ArrowLeftRight,
  Coins,
  HandHeart,
  DollarSign,
  Gift,
  Shield,
  Gamepad2,
  Users,
  TrendingUp,
  Clock,
  HelpCircle,
  Package,
  Wallet,
  Sparkles,
  UserCheck,
  Leaf,
  Search,
  Lock,
  CheckCircle,
  RotateCcw,
  Camera,
  ThumbsUp,
  ChevronRight,
  ChevronDown,
  MapPin,
  Send,
  BadgeCheck,
  Star,
  ShieldCheck,
  Flag,
  Heart,
  Truck,
} from "lucide-react";

export default function FAQPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <main className="max-w-4xl mx-auto px-4 py-8">
        <div className="mb-8">
          <h1 className="text-2xl font-semibold text-gray-800 mb-2">
            Help & FAQ
          </h1>
          <p className="text-gray-600">
            Everything you need to know to use the platform with confidence
          </p>
        </div>

        {/* Why ShareSwap? */}
        <Card className="mb-6">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Sparkles className="h-5 w-5 text-[#0DCEA1]" />
              Why ShareSwap?
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {/* Save Money or Earn Money */}
              <div className="bg-gradient-to-br from-[#E6FBF5] to-[#D0F5EB] rounded-xl p-5 py-6 text-center">
                <div className="w-20 h-20 mx-auto mb-4 bg-white rounded-full flex items-center justify-center relative">
                  {/* Paper money stack illustration */}
                  <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 scale-125">
                    {/* Back bill */}
                    <div className="absolute -left-0.5 top-1 w-11 h-6 bg-[#2E8B57] rounded-md rotate-[-8deg]">
                      <div className="absolute left-1 top-1 w-1.5 h-1.5 bg-[#3CB371] rounded-full opacity-60"></div>
                      <div className="absolute right-1 bottom-1 w-1.5 h-1.5 bg-[#3CB371] rounded-full opacity-60"></div>
                    </div>
                    {/* Front bill */}
                    <div className="w-11 h-6 bg-[#3CB371] rounded-md relative rotate-[5deg]">
                      {/* Center circle with $ */}
                      <div className="absolute inset-0 flex items-center justify-center">
                        <div className="w-4 h-4 bg-[#2E8B57] rounded-full flex items-center justify-center">
                          <span className="text-[10px] text-[#90EE90] font-bold">
                            $
                          </span>
                        </div>
                      </div>
                      {/* Corner dots */}
                      <div className="absolute left-1 top-1 w-1.5 h-1.5 bg-[#2E8B57] rounded-full opacity-50"></div>
                      <div className="absolute right-1 top-1 w-1.5 h-1.5 bg-[#2E8B57] rounded-full opacity-50"></div>
                      <div className="absolute left-1 bottom-1 w-1.5 h-1.5 bg-[#2E8B57] rounded-full opacity-50"></div>
                      <div className="absolute right-1 bottom-1 w-1.5 h-1.5 bg-[#2E8B57] rounded-full opacity-50"></div>
                    </div>
                  </div>
                </div>
                <p className="text-sm font-medium text-gray-700 mb-1">
                  Save or Earn Money
                </p>
                <p className="text-[11px] text-gray-500 leading-tight">
                  Borrow for less or rent out for extra cash.
                </p>
              </div>

              {/* Turn Unused Items Into Value */}
              <div className="bg-gradient-to-br from-[#E6FBF5] to-[#D0F5EB] rounded-xl p-5 py-6 text-center">
                <div className="w-20 h-20 mx-auto mb-4 bg-white rounded-full flex items-center justify-center relative">
                  {/* Sofa with price tag illustration */}
                  <div className="absolute bottom-4 left-1/2 -translate-x-1/2 scale-125">
                    {/* Sofa body */}
                    <div className="w-10 h-4 bg-[#7C9EB2] rounded-t-lg border border-[#5A7A8A]"></div>
                    {/* Sofa back */}
                    <div className="w-10 h-3 bg-[#5A7A8A] rounded-t-md -mt-3.5 mx-auto"></div>
                    {/* Sofa arms */}
                    <div className="absolute -left-1.5 bottom-0 w-2 h-3.5 bg-[#7C9EB2] rounded-l-md border border-[#5A7A8A]"></div>
                    <div className="absolute -right-1.5 bottom-0 w-2 h-3.5 bg-[#7C9EB2] rounded-r-md border border-[#5A7A8A]"></div>
                    {/* Sofa legs */}
                    <div className="absolute left-1.5 -bottom-1 w-1 h-1 bg-[#8B7355] rounded-sm"></div>
                    <div className="absolute right-1.5 -bottom-1 w-1 h-1 bg-[#8B7355] rounded-sm"></div>
                    {/* Price tag hanging from arm */}
                    <div className="absolute -right-3 -top-1">
                      <div className="w-0.5 h-2 bg-amber-600 mx-auto"></div>
                      <div className="w-5 h-6 bg-amber-100 border-2 border-amber-400 rounded-sm shadow-sm -mt-0.5">
                        <div className="absolute top-0.5 left-1/2 -translate-x-1/2 w-1 h-1 bg-amber-400 rounded-full"></div>
                        <div className="flex items-center justify-center h-full text-[10px] text-amber-700 font-bold mt-0.5">
                          $
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                <p className="text-sm font-medium text-gray-700 mb-1">
                  Turn Idle Items Into Value
                </p>
                <p className="text-[11px] text-gray-500 leading-tight">
                  Your unused items can help others.
                </p>
              </div>

              {/* Built on Local Trust */}
              <div className="bg-gradient-to-br from-[#E6FBF5] to-[#D0F5EB] rounded-xl p-5 py-6 text-center">
                <div className="w-20 h-20 mx-auto mb-4 bg-white rounded-full flex items-center justify-center relative">
                  {/* ID card with shield illustration */}
                  <div className="w-11 h-8 bg-[#87CEEB] rounded-md border border-[#5F9EA0] absolute">
                    <div className="absolute top-1.5 left-1.5 w-3 h-3 bg-white/60 rounded-full"></div>
                    <div className="absolute bottom-1.5 left-1.5 right-1.5 h-0.5 bg-white/40 rounded"></div>
                    <div className="absolute bottom-3 left-1.5 right-3 h-0.5 bg-white/40 rounded"></div>
                  </div>
                  <div className="absolute right-4 bottom-4">
                    <Shield className="h-5 w-5 text-[#5F9EA0] fill-[#E0F4F4]" />
                  </div>
                </div>
                <p className="text-sm font-medium text-gray-700 mb-1">
                  Built on Local Trust
                </p>
                <p className="text-[11px] text-gray-500 leading-tight">
                  Verified profiles and fair rules.
                </p>
              </div>

              {/* Reduce Waste Effortlessly */}
              <div className="bg-gradient-to-br from-[#E6FBF5] to-[#D0F5EB] rounded-xl p-5 py-6 text-center">
                <div className="w-20 h-20 mx-auto mb-4 bg-white rounded-full flex items-center justify-center relative">
                  {/* Earth with leaf illustration */}
                  <div className="w-10 h-10 bg-[#7DD3C0] rounded-full relative overflow-hidden">
                    {/* Land masses - green spots */}
                    <div className="absolute top-1 left-1.5 w-3 h-2.5 bg-[#4CAF7C] rounded-full"></div>
                    <div className="absolute top-3.5 right-1 w-2.5 h-3 bg-[#4CAF7C] rounded-full"></div>
                    <div className="absolute bottom-1 left-2 w-2 h-2 bg-[#4CAF7C] rounded-full"></div>
                    <div className="absolute bottom-2.5 right-2.5 w-1.5 h-1.5 bg-[#4CAF7C] rounded-full"></div>
                  </div>
                  <div className="absolute top-2 right-3">
                    <Leaf className="h-5 w-5 text-[#22C55E] fill-[#86EFAC]" />
                  </div>
                </div>
                <p className="text-sm font-medium text-gray-700 mb-1">
                  Reduce Waste
                </p>
                <p className="text-[11px] text-gray-500 leading-tight">
                  Less buying, less clutter, less impact.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* What is ShareSwap */}
        <Card className="mb-6">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              <img
                src="/shareswap-logo.jpeg"
                alt="ShareSwap Logo"
                className="w-9 h-9 rounded-lg"
              />
              What is ShareSwap?
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-gray-700 text-sm mb-6">
              A community platform where neighbours share their own items
              through{" "}
              <span className="font-;789bold">
                borrowing, renting, swapping, or gifting.
              </span>
            </p>

            <Tabs defaultValue="borrow" className="w-full">
              <TabsList className="grid grid-cols-4 gap-2 h-auto bg-transparent p-0 mb-4">
                <TabsTrigger
                  value="borrow"
                  className="flex items-center gap-2 bg-[#E6FBF5] rounded-lg p-3 text-black data-[state=active]:bg-[#0DCEA1] data-[state=active]:text-white"
                >
                  <HandHeart className="h-5 w-5 flex-shrink-0" />
                  <span className="text-sm font-medium hidden md:inline">
                    Borrow & Lend
                  </span>
                </TabsTrigger>
                <TabsTrigger
                  value="rent"
                  className="flex items-center gap-2 bg-[#E6FBF5] rounded-lg p-3 text-black data-[state=active]:bg-[#0DCEA1] data-[state=active]:text-white"
                >
                  <DollarSign className="h-5 w-5 flex-shrink-0" />
                  <span className="text-sm font-medium hidden md:inline">
                    Rent
                  </span>
                </TabsTrigger>
                <TabsTrigger
                  value="swap"
                  className="flex items-center gap-2 bg-[#E6FBF5] rounded-lg p-3 text-black data-[state=active]:bg-[#0DCEA1] data-[state=active]:text-white"
                >
                  <ArrowLeftRight className="h-5 w-5 flex-shrink-0" />
                  <span className="text-sm font-medium hidden md:inline">
                    Swap
                  </span>
                </TabsTrigger>
                <TabsTrigger
                  value="gift"
                  className="flex items-center gap-2 bg-[#E6FBF5] rounded-lg p-3 text-black data-[state=active]:bg-[#0DCEA1] data-[state=active]:text-white"
                >
                  <Gift className="h-5 w-5 flex-shrink-0" />
                  <span className="text-sm font-medium hidden md:inline">
                    Gift
                  </span>
                </TabsTrigger>
              </TabsList>

              {/* Borrow & Lend Tab Content */}
              <TabsContent value="borrow" className="mt-0">
                <h3 className="font-semibold text-gray-800 mb-2">
                  How Borrowing & Lending Works
                </h3>
                <p className="text-sm text-gray-600 mb-4">
                  Use <span className="font-bold">ShareCoins</span> to borrow
                  from neighbours. ShareCoin prices are set based on item tier
                  and duration.
                </p>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {/* Borrow Flow */}
                  <div className="bg-gradient-to-br from-amber-50 to-amber-100 rounded-xl p-3">
                    <p className="text-sm font-semibold text-gray-800 mb-2 text-center">
                      Borrow
                    </p>

                    <div className="flex flex-col gap-0.5">
                      {[
                        { icon: Search, label: "Find & Request Item" },
                        {
                          icon: Lock,
                          label: "Cash Trust-Deposit placed",
                        },
                        { icon: MapPin, label: "Item Pickup" },
                        {
                          icon: Coins,
                          label: "ShareCoins charged upon pickup",
                        },
                        { icon: Package, label: "Use Item With Care" },
                        { icon: CheckCircle, label: "Return Item" },
                        { icon: Wallet, label: "Receive Deposit Back" },
                      ].map((step, i, arr) => (
                        <div key={i} className="flex items-center gap-2">
                          <div className="flex flex-col items-center">
                            <div className="w-6 h-6 rounded-full bg-white border-2 border-[#0DCEA1] flex items-center justify-center">
                              <step.icon className="h-3 w-3 text-[#0DCEA1]" />
                            </div>
                            {i < arr.length - 1 && (
                              <div className="w-0.5 h-2 bg-[#0DCEA1]/30"></div>
                            )}
                          </div>
                          <span className="text-xs font-medium text-gray-700">
                            {step.label}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Lend Flow */}
                  <div className="bg-gradient-to-br from-[#E6FBF5] to-[#D0F5EB] rounded-xl p-3">
                    <p className="text-sm font-semibold text-gray-800 mb-2 text-center">
                      Lend
                    </p>

                    <div className="flex flex-col gap-0.5">
                      {[
                        { icon: Camera, label: "List Item" },
                        { icon: ThumbsUp, label: "Approve Request" },
                        {
                          icon: Lock,
                          label: "Cash Trust-Deposit held",
                        },
                        { icon: MapPin, label: "Item Handoff" },
                        {
                          icon: Coins,
                          label: "ShareCoins earned upon delivery",
                        },
                        { icon: RotateCcw, label: "Item Returned" },
                        { icon: Wallet, label: "Give Deposit Back" },
                      ].map((step, i, arr) => (
                        <div key={i} className="flex items-center gap-2">
                          <div className="flex flex-col items-center">
                            <div className="w-6 h-6 rounded-full bg-white border-2 border-[#0DCEA1] flex items-center justify-center">
                              <step.icon className="h-3 w-3 text-[#0DCEA1]" />
                            </div>
                            {i < arr.length - 1 && (
                              <div className="w-0.5 h-2 bg-[#0DCEA1]/30"></div>
                            )}
                          </div>
                          <span className="text-xs font-medium text-gray-700">
                            {step.label}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </TabsContent>

              {/* Rent Tab Content */}
              <TabsContent value="rent" className="mt-0">
                <h3 className="font-semibold text-gray-800 mb-3">
                  How Renting Works
                </h3>
                <p className="text-gray-700 text-sm mb-4">
                  Use <span className="font-bold">real money</span> to rent
                  items. Choose renting if you want to earn cash from your
                  items.
                </p>
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <p className="text-sm font-medium text-gray-700">
                      Suggested Pricing
                    </p>
                    <p className="text-xs text-gray-500">
                      Rental rates and security deposits are suggested based on
                      item category, but owners can adjust them.
                    </p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-700">
                      Platform Fees
                    </p>
                    <p className="text-xs text-gray-500">
                      0% platform fee for 2025. Only 3% payment processing.
                    </p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-700">
                      Security Deposits
                    </p>
                    <p className="text-xs text-gray-500">
                      Rental deposits are cash-based and returned when the item
                      is returned in good condition.
                    </p>
                  </div>
                </div>
              </TabsContent>

              {/* Swap Tab Content */}
              <TabsContent value="swap" className="mt-0">
                <h3 className="font-semibold text-gray-800 mb-3">
                  How Swapping Works
                </h3>
                <p className="text-gray-700 text-sm mb-4">
                  Trade item-for-item between neighbours. No cash. No deposits.
                  Just swap. Value differences are balanced with ShareCoins. Our
                  tier system ensures fair exchanges.
                </p>

                <div className="bg-gradient-to-br from-[#E6FBF5] to-[#D0F5EB] rounded-xl p-4">
                  <p className="text-[#0DCEA1] font-medium text-sm mb-3">
                    Tiers & ShareCoin Values
                  </p>
                  <div className="grid grid-cols-4 gap-2">
                    <div className="bg-white rounded-lg p-3 text-center border border-gray-100">
                      <p className="text-sm font-medium text-gray-700">
                        Tier 1
                      </p>
                      <p className="text-xs text-gray-500">Everyday items</p>
                      <p className="text-[#0DCEA1] font-medium text-sm mt-1">
                        5 ShareCoins
                      </p>
                    </div>
                    <div className="bg-white rounded-lg p-3 text-center border border-gray-100">
                      <p className="text-sm font-medium text-gray-700">
                        Tier 2
                      </p>
                      <p className="text-xs text-gray-500">Mid-value items</p>
                      <p className="text-[#0DCEA1] font-medium text-sm mt-1">
                        10 ShareCoins
                      </p>
                    </div>
                    <div className="bg-white rounded-lg p-3 text-center border border-gray-100">
                      <p className="text-sm font-medium text-gray-700">
                        Tier 3
                      </p>
                      <p className="text-xs text-gray-500">High-value items</p>
                      <p className="text-[#0DCEA1] font-medium text-sm mt-1">
                        20 ShareCoins
                      </p>
                    </div>
                    <div className="bg-white rounded-lg p-3 text-center border border-gray-100">
                      <p className="text-sm font-medium text-gray-700">
                        Tier 4
                      </p>
                      <p className="text-xs text-gray-500">Premium items</p>
                      <p className="text-[#0DCEA1] font-medium text-sm mt-1">
                        40 ShareCoins
                      </p>
                    </div>
                  </div>
                </div>

                <div className="mt-4">
                  <p className="font-medium text-gray-800 text-sm mb-3">
                    Swap Tier Offset
                  </p>
                  <p className="text-xs text-gray-500 mb-3">
                    Balance value differences to how ShareCoins are earned.
                  </p>
                </div>

                <div className="mt-4">
                  <p className="font-medium text-gray-800 text-sm mb-3">
                    Swap Rules
                  </p>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="flex items-start gap-2">
                      <div className="w-3 h-3 rounded-full bg-green-500 mt-1 flex-shrink-0"></div>
                      <div>
                        <p className="text-sm font-medium text-gray-700">
                          Same-tier swaps
                        </p>
                        <p className="text-xs text-gray-500">Direct swaps.</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-2">
                      <div className="w-3 h-3 rounded-full bg-yellow-400 mt-1 flex-shrink-0"></div>
                      <div>
                        <p className="text-sm font-medium text-gray-700">
                          One-tier difference
                        </p>
                        <p className="text-xs text-gray-500">
                          The person with the lower-tier item adds ShareCoins to
                          balance the value.
                        </p>
                      </div>
                    </div>
                    <div className="flex items-start gap-2">
                      <div className="w-3 h-3 rounded-full bg-red-400 mt-1 flex-shrink-0"></div>
                      <div>
                        <p className="text-sm font-medium text-gray-700">
                          Two tier difference
                        </p>
                        <p className="text-xs text-gray-500">Not allowed.</p>
                      </div>
                    </div>
                  </div>
                </div>
              </TabsContent>

              {/* Gift Tab Content */}
              <TabsContent value="gift" className="mt-0">
                <h3 className="font-semibold text-gray-800 mb-3">
                  How Gifting Works
                </h3>
                <p className="text-gray-700 text-sm mb-4">
                  Give away items you no longer need. The recipient keeps the
                  item permanently. No payments or deposits required.
                </p>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        {/* What are ShareCoins? */}
        <Card className="mb-6">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Coins className="h-5 w-5 text-[#0DCEA1]" />
              What are ShareCoins?
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-gray-700 text-sm">
              ShareCoins are our{" "}
              <span className="font-bold">community currency</span>. They help
              keep sharing fair and accessible for everyone. They mainly{" "}
              <span className="font-bold">reward lending</span>, but also
              encourage sharing and help build community reputation.
            </p>
          </CardContent>
        </Card>

        {/* Spent & Earned Side by Side */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          {/* How ShareCoins Are Spent */}
          <Card className="md:col-span-1">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base whitespace-nowrap">
                <div className="flex items-center">
                  <span className="text-orange-500 font-bold text-base mr-0.5">
                    −
                  </span>
                  <Coins className="h-4 w-4 text-orange-500" />
                </div>
                How ShareCoins Are Spent
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-2">
                {/* Borrowing Items */}
                <div className="bg-gradient-to-br from-amber-50 to-amber-100 rounded-xl p-3 border border-amber-200">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 bg-amber-200 rounded-lg flex items-center justify-center flex-shrink-0">
                      <HandHeart className="h-4 w-4 text-amber-600" />
                    </div>
                    <div>
                      <p className="text-xs font-medium text-gray-700">
                        Borrowing Items
                      </p>
                      <p className="text-[10px] text-gray-500">Pay to borrow</p>
                    </div>
                  </div>
                </div>

                {/* Swap Offset */}
                <div className="bg-gradient-to-br from-[#E6FBF5] to-[#D0F5EB] rounded-xl p-3 border border-[#0DCEA1]/20">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 bg-[#0DCEA1]/20 rounded-lg flex items-center justify-center flex-shrink-0">
                      <ArrowLeftRight className="h-4 w-4 text-[#0DCEA1]" />
                    </div>
                    <div>
                      <p className="text-xs font-medium text-gray-700">
                        Swap Tier Offset
                      </p>
                      <p className="text-[10px] text-gray-500">
                        Balance value differences
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* How ShareCoins Are Earned */}
          <Card className="md:col-span-2">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <div className="flex items-center">
                  <span className="text-teal-600 font-bold text-lg mr-0.5">
                    +
                  </span>
                  <Coins className="h-5 w-5 text-teal-600" />
                </div>
                How ShareCoins Are Earned
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-2">
                {/* Lending */}
                <div className="bg-gradient-to-br from-amber-50 to-amber-100 rounded-xl p-3 border border-amber-200">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 bg-amber-200 rounded-lg flex items-center justify-center flex-shrink-0">
                      <HandHeart className="h-4 w-4 text-amber-600" />
                    </div>
                    <div>
                      <p className="text-xs font-medium text-gray-700">
                        Lending Items
                      </p>
                      <p className="text-[10px] text-gray-500">
                        Earn when you lend
                      </p>
                    </div>
                  </div>
                </div>

                {/* Swaps */}
                <div className="bg-gradient-to-br from-[#E6FBF5] to-[#D0F5EB] rounded-xl p-3 border border-[#0DCEA1]/20">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 bg-[#0DCEA1]/20 rounded-lg flex items-center justify-center flex-shrink-0">
                      <ArrowLeftRight className="h-4 w-4 text-[#0DCEA1]" />
                    </div>
                    <div>
                      <p className="text-xs font-medium text-gray-700">
                        Completed Swap
                      </p>
                      <p className="text-[10px] text-gray-500">
                        Each party earns
                      </p>
                    </div>
                  </div>
                </div>

                {/* Rentals */}
                <div className="bg-gradient-to-br from-green-50 to-green-100 rounded-xl p-3 border border-green-200">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 bg-green-200 rounded-lg flex items-center justify-center flex-shrink-0">
                      <DollarSign className="h-4 w-4 text-green-600" />
                    </div>
                    <div>
                      <p className="text-xs font-medium text-gray-700">
                        Completed Rental
                      </p>
                      <p className="text-[10px] text-gray-500">
                        Owner & renter each
                      </p>
                    </div>
                  </div>
                </div>

                {/* Gifts */}
                <div className="bg-gradient-to-br from-pink-50 to-pink-100 rounded-xl p-3 border border-pink-200">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 bg-pink-200 rounded-lg flex items-center justify-center flex-shrink-0">
                      <Gift className="h-4 w-4 text-pink-500" />
                    </div>
                    <div>
                      <p className="text-xs font-medium text-gray-700">
                        Completed Gift
                      </p>
                      <p className="text-[10px] text-gray-500">
                        Giver and receiver earn
                      </p>
                    </div>
                  </div>
                </div>

                {/* Urgent Help */}
                <div className="bg-gradient-to-br from-orange-50 to-orange-100 rounded-xl p-3 border border-orange-200">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 bg-orange-200 rounded-lg flex items-center justify-center flex-shrink-0">
                      <Clock className="h-4 w-4 text-orange-600" />
                    </div>
                    <div>
                      <p className="text-xs font-medium text-gray-700">
                        Urgent Help
                      </p>
                      <p className="text-[10px] text-gray-500">
                        Fulfilled in time
                      </p>
                    </div>
                  </div>
                </div>

                {/* Sponsored Games */}
                <div className="bg-gradient-to-br from-purple-50 to-purple-100 rounded-xl p-3 border border-purple-200">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 bg-purple-200 rounded-lg flex items-center justify-center flex-shrink-0">
                      <Gamepad2 className="h-4 w-4 text-purple-600" />
                    </div>
                    <div>
                      <p className="text-xs font-medium text-gray-700">
                        Sponsored Games
                      </p>
                      <p className="text-[10px] text-gray-500">
                        Daily play limit
                      </p>
                    </div>
                  </div>
                </div>

                {/* Referrals */}
                <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-xl p-3 border border-blue-200">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 bg-blue-200 rounded-lg flex items-center justify-center flex-shrink-0">
                      <Users className="h-4 w-4 text-blue-600" />
                    </div>
                    <div>
                      <p className="text-xs font-medium text-gray-700">
                        Friend Referral
                      </p>
                      <p className="text-[10px] text-gray-500">
                        Friend's first transaction
                      </p>
                    </div>
                  </div>
                </div>

                {/* Level Up */}
                <div className="bg-gradient-to-br from-teal-50 to-teal-100 rounded-xl p-3 border border-teal-200">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 bg-teal-200 rounded-lg flex items-center justify-center flex-shrink-0">
                      <TrendingUp className="h-4 w-4 text-teal-600" />
                    </div>
                    <div>
                      <p className="text-xs font-medium text-gray-700">
                        Level Up
                      </p>
                      <p className="text-[10px] text-gray-500">
                        Community standing
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* What are Tiers? */}
        <Card className="mb-6">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Package className="h-5 w-5 text-[#0DCEA1]" />
              What are Tiers?
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-gray-700 text-sm mb-4">
              Tiers{" "}
              <span className="font-bold">group items by overall value</span> so
              borrowing, swapping, and pricing stay fair. The app uses your
              photos and details to assign the item to:
            </p>

            <div className="bg-gradient-to-br from-[#E6FBF5] to-[#D0F5EB] rounded-xl p-4">
              <p className="text-[#0DCEA1] font-medium text-sm mb-3">
                Tiers & ShareCoin Values
              </p>
              <div className="grid grid-cols-4 gap-2">
                <div className="bg-white rounded-lg p-3 text-center border border-gray-100">
                  <p className="text-sm font-medium text-gray-700">Tier 1</p>
                  <p className="text-xs text-gray-500">Everyday items</p>
                  <p className="text-[#0DCEA1] font-medium text-sm mt-1">
                    5 ShareCoins
                  </p>
                </div>
                <div className="bg-white rounded-lg p-3 text-center border border-gray-100">
                  <p className="text-sm font-medium text-gray-700">Tier 2</p>
                  <p className="text-xs text-gray-500">Mid-value items</p>
                  <p className="text-[#0DCEA1] font-medium text-sm mt-1">
                    10 ShareCoins
                  </p>
                </div>
                <div className="bg-white rounded-lg p-3 text-center border border-gray-100">
                  <p className="text-sm font-medium text-gray-700">Tier 3</p>
                  <p className="text-xs text-gray-500">High-value items</p>
                  <p className="text-[#0DCEA1] font-medium text-sm mt-1">
                    20 ShareCoins
                  </p>
                </div>
                <div className="bg-white rounded-lg p-3 text-center border border-gray-100">
                  <p className="text-sm font-medium text-gray-700">Tier 4</p>
                  <p className="text-xs text-gray-500">Premium items</p>
                  <p className="text-[#0DCEA1] font-medium text-sm mt-1">
                    40 ShareCoins
                  </p>
                </div>
              </div>
            </div>

            <div className="mt-4">
              <p className="font-medium text-gray-800 text-sm mb-2">
                Tiers decide:
              </p>
              <ul className="list-disc list-inside text-sm text-gray-700 space-y-1">
                <li>ShareCoin value</li>
                <li>Swap eligibility & offsets</li>
                <li>Security Deposit and Trust-Deposit amounts</li>
              </ul>
            </div>
          </CardContent>
        </Card>

        {/* Trust & Safety */}
        <Card className="mb-6">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Shield className="h-5 w-5 text-gray-600" />
              Trust & Safety
            </CardTitle>
            <p className="text-gray-500 text-sm mt-1">
              Real people. Real accountability. Built-in protection for both
              sides of every exchange.
            </p>
          </CardHeader>
          <CardContent className="pt-1 pb-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Identity Verification */}
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-full border border-gray-200 flex items-center justify-center flex-shrink-0">
                    <BadgeCheck className="h-4 w-4 text-gray-500" />
                  </div>
                  <h3 className="font-medium text-gray-800 text-sm">
                    Identity verification
                  </h3>
                </div>
                <p className="text-xs text-gray-600 leading-relaxed pl-10">
                  Members can verify their identity, and verified profiles are
                  clearly marked. This keeps interactions tied to real people
                  and not anonymous accounts.
                </p>
              </div>

              {/* Trust & Reviews */}
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-full border border-gray-200 flex items-center justify-center flex-shrink-0">
                    <Star className="h-4 w-4 text-gray-500" />
                  </div>
                  <h3 className="font-medium text-gray-800 text-sm">
                    Trust scores & reviews
                  </h3>
                </div>
                <p className="text-xs text-gray-600 leading-relaxed pl-10">
                  Reputation is earned through completed transactions. Reviews
                  from neighbours help you decide who to borrow from, rent to,
                  or swap with.
                </p>
              </div>

              {/* Security Deposits */}
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-full border border-gray-200 flex items-center justify-center flex-shrink-0">
                    <ShieldCheck className="h-4 w-4 text-gray-500" />
                  </div>
                  <h3 className="font-medium text-gray-800 text-sm">
                    Security deposits & dispute resolution
                  </h3>
                </div>
                <p className="text-xs text-gray-600 leading-relaxed pl-10">
                  Deposits help protect items during borrowing and renting. If
                  something goes wrong, we provide a clear, fair process to
                  review and resolve issues.
                </p>
              </div>

              {/* Reporting & Moderation */}
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-full border border-gray-200 flex items-center justify-center flex-shrink-0">
                    <Flag className="h-4 w-4 text-gray-500" />
                  </div>
                  <h3 className="font-medium text-gray-800 text-sm">
                    Reporting & accountability
                  </h3>
                </div>
                <p className="text-xs text-gray-600 leading-relaxed pl-10">
                  Report concerns anytime. Our moderation team reviews issues
                  and takes action when community rules aren’t followed.
                </p>
                ``
              </div>
            </div>
          </CardContent>
        </Card>

        {/* FAQ */}
        <Card className="mb-6">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              <HelpCircle className="h-5 w-5 text-[#0DCEA1]" />
              FAQ
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <Accordion type="single" collapsible className="w-full">
              {/* ShareCoin Questions */}
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mt-2 mb-2">
                ShareCoin Questions
              </p>
              <AccordionItem value="sc-1">
                <AccordionTrigger className="text-sm">
                  Are ShareCoin rewards fixed?
                </AccordionTrigger>
                <AccordionContent className="text-gray-600">
                  Yes. Each action has a{" "}
                  <span className="font-semibold">set reward amount</span>.
                  Rewards are{" "}
                  <span className="font-semibold">not negotiable</span> and are
                  credited <span className="font-semibold">automatically</span>{" "}
                  upon completion.
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="sc-2">
                <AccordionTrigger className="text-sm">
                  Are there any limits on ShareCoin rewards?
                </AccordionTrigger>
                <AccordionContent className="text-gray-600">
                  Some activities have{" "}
                  <span className="font-semibold">
                    daily or per-request limits
                  </span>{" "}
                  to keep things fair. Sponsored games can be played{" "}
                  <span className="font-semibold">once per day</span>. Urgent
                  request bonuses apply{" "}
                  <span className="font-semibold">once per request</span>.
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="sc-3">
                <AccordionTrigger className="text-sm">
                  One-time ShareCoin bonuses
                </AccordionTrigger>
                <AccordionContent className="text-gray-600">
                  Earn <span className="font-semibold">bonus ShareCoins</span>{" "}
                  for completing your{" "}
                  <span className="font-semibold">
                    first swap, gift, rent, or borrow
                  </span>
                  . You also get a one-time bonus for{" "}
                  <span className="font-semibold">completing your profile</span>{" "}
                  with verification, photo, and bio.
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="sc-4">
                <AccordionTrigger className="text-sm">
                  Can I farm ShareCoins with a friend or partner?
                </AccordionTrigger>
                <AccordionContent className="text-gray-600">
                  No. We{" "}
                  <span className="font-semibold">
                    detect repeated transactions
                  </span>{" "}
                  between the same two accounts. Suspicious activity{" "}
                  <span className="font-semibold">reduces trust scores</span>{" "}
                  and ShareCoin earnings.
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="sc-5">
                <AccordionTrigger className="text-sm">
                  Do ShareCoins convert to real money?
                </AccordionTrigger>
                <AccordionContent className="text-gray-600">
                  No. ShareCoins are{" "}
                  <span className="font-semibold">community credits</span> used
                  only within ShareSwap. They{" "}
                  <span className="font-semibold">
                    cannot be withdrawn, sold, or exchanged
                  </span>{" "}
                  for cash.
                </AccordionContent>
              </AccordionItem>

              {/* Tiers & Pricing Questions */}
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mt-6 mb-2">
                Tiers & Pricing
              </p>
              <AccordionItem value="tier-1">
                <AccordionTrigger className="text-sm">
                  Who assigns the item Tiers?
                </AccordionTrigger>
                <AccordionContent className="text-gray-600">
                  <p className="mb-2">
                    The system assigns it automatically based on:
                  </p>
                  <ul className="list-disc list-inside space-y-1 text-sm">
                    <li>Photos</li>
                    <li>Brand</li>
                    <li>Category</li>
                    <li>Condition</li>
                    <li>Typical price range</li>
                  </ul>
                  <p className="mt-2 text-sm italic">
                    You don't have to calculate anything.
                  </p>
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="tier-2">
                <AccordionTrigger className="text-sm">
                  Can I change the Tier or ShareCoin value?
                </AccordionTrigger>
                <AccordionContent className="text-gray-600">
                  No. That's <span className="font-semibold">locked</span> to
                  keep the system{" "}
                  <span className="font-semibold">fair for everyone</span>.
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="tier-3">
                <AccordionTrigger className="text-sm">
                  Why do I need photos?
                </AccordionTrigger>
                <AccordionContent className="text-gray-600">
                  <p className="mb-2">Photos help AI:</p>
                  <ul className="list-disc list-inside space-y-1 text-sm">
                    <li>Verify the item</li>
                    <li>Estimate value</li>
                    <li>Place it in the right Tier</li>
                    <li>Calculate fair rates</li>
                  </ul>
                  <p className="mt-2 text-sm italic">
                    At least one photo is required. Clear photos = accurate
                    pricing.
                  </p>
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="tier-4">
                <AccordionTrigger className="text-sm">
                  Can I edit rental prices?
                </AccordionTrigger>
                <AccordionContent className="text-gray-600 space-y-2">
                  <p>
                    Yes! Rental prices{" "}
                    <span className="font-semibold">fully customizable</span> by
                    the owner.
                  </p>
                  <ul className="list-disc list-inside space-y-1 text-sm">
                    <li>AI suggests a starting price based on item details</li>
                    <li>You can adjust the weekly rental rate to any amount</li>
                  </ul>
                  <p className="text-sm italic text-gray-500">
                    Set prices that work for you and your community.
                  </p>
                </AccordionContent>
              </AccordionItem>

              {/* Deposits & Protection Questions */}
              <p
                id="deposits-coverage"
                className="text-xs font-semibold text-gray-500 uppercase tracking-wide mt-6 mb-2 scroll-mt-24"
              >
                Deposits & Protection
              </p>
              <AccordionItem value="deposit-1">
                <AccordionTrigger className="text-sm">
                  What is a trust deposit for borrowing?
                </AccordionTrigger>
                <AccordionContent className="text-gray-600 space-y-3">
                  <p>
                    A <span className="font-semibold">trust deposit</span> is
                    real money temporarily held when you borrow an item. It's
                    there to protect the lender and it's{" "}
                    <span className="font-semibold">fully refunded</span> when
                    the item is returned on time and in good condition.
                  </p>
                  <p className="text-sm italic text-gray-500">
                    <span className="font-medium">
                      Your deposit is not a fee
                    </span>{" "}
                    — it's a temporary hold.
                  </p>
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="deposit-2">
                <AccordionTrigger className="text-sm">
                  How are trust deposits calculated?
                </AccordionTrigger>
                <AccordionContent className="text-gray-600">
                  <ul className="list-disc list-inside space-y-1 text-sm">
                    <li>Your trust score lowers the deposit</li>
                    <li>Higher trust = smaller deposit</li>
                    <li>Each Tier has a base deposit percentage</li>
                    <li>Trust score discount is applied on top</li>
                  </ul>
                  <p className="mt-2 text-sm italic">
                    This keeps borrowing safe without punishing good users.
                  </p>
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="deposit-3">
                <AccordionTrigger className="text-sm">
                  What is the security deposit for renting?
                </AccordionTrigger>
                <AccordionContent className="text-gray-600 space-y-2">
                  <p>
                    A security deposit is
                    <span className="font-semibold">
                      cash held during a rental
                    </span>{" "}
                    to protect the owner. It's{" "}
                    <span className="font-semibold">fully refunded</span> when
                    the item is returned in good condition.
                  </p>
                  <p className="text-sm">
                    AI provides a suggestion that reflects the replacement
                    coverage, but the final price is up to you.
                  </p>
                  <p className="text-sm italic text-gray-500">
                    Deposits are held via payment authorization, not charged
                    upfront.
                  </p>
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="deposit-4">
                <AccordionTrigger className="text-sm">
                  What is the difference between borrowing and renting?
                </AccordionTrigger>
                <AccordionContent className="text-gray-600">
                  <div className="space-y-3">
                    <div className="bg-white rounded-lg p-3">
                      <p className="font-medium text-gray-800 text-sm mb-2">
                        Borrowing{" "}
                        <p className="text-sm italic text-gray-500">
                          (ShareCoins)
                        </p>
                      </p>
                      <ul className="list-disc list-inside space-y-1 text-sm">
                        <li>Community-based</li>
                        <li>Pay in ShareCoins</li>
                        <li>Lower cash trust-based deposit</li>
                        <li>Good for helping neighbors</li>
                        <li>No cash earnings</li>
                      </ul>
                    </div>
                    <div className="bg-white rounded-lg p-3">
                      <p className="font-medium text-gray-800 text-sm mb-2">
                        Renting{" "}
                        <p className="text-sm italic text-gray-500">(Cash)</p>
                      </p>
                      <ul className="list-disc list-inside space-y-1 text-sm">
                        <li>Peer-to-peer income</li>
                        <li>Pay in cash</li>
                        <li>Security deposit</li>
                        <li>Ideal for side hustle vibes</li>
                      </ul>
                    </div>
                  </div>
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="deposit-5">
                <AccordionTrigger className="text-sm">
                  What is replacement coverage?
                </AccordionTrigger>
                <AccordionContent className="text-gray-600 space-y-3">
                  <p>
                    Replacement coverage is the{" "}
                    <span className="font-semibold">maximum amount</span> that
                    may be charged{" "}
                    <span className="font-semibold">
                      only if an item is not returned
                    </span>
                    .
                  </p>
                  <ul className="space-y-2 text-sm">
                    <li className="flex items-start gap-2">
                      <CheckCircle className="h-4 w-4 text-[#0DCEA1] mt-0.5 flex-shrink-0" />
                      <span>It's shown clearly before you send a request</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle className="h-4 w-4 text-[#0DCEA1] mt-0.5 flex-shrink-0" />
                      <span>You must acknowledge it before borrowing</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle className="h-4 w-4 text-[#0DCEA1] mt-0.5 flex-shrink-0" />
                      <span>If the item is returned, you're not charged</span>
                    </li>
                  </ul>
                  <p className="font-medium text-gray-700">
                    No surprises. Ever.
                  </p>
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="deposit-6">
                <AccordionTrigger className="text-sm">
                  What happens when the item is returned?
                </AccordionTrigger>
                <AccordionContent className="text-gray-600">
                  <ul className="space-y-2">
                    <li className="flex items-start gap-2">
                      <CheckCircle className="h-4 w-4 text-[#0DCEA1] mt-0.5 flex-shrink-0" />
                      <span>
                        The lender confirms the item is returned safely
                      </span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle className="h-4 w-4 text-[#0DCEA1] mt-0.5 flex-shrink-0" />
                      <span>Your trust deposit is released back to you</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle className="h-4 w-4 text-[#0DCEA1] mt-0.5 flex-shrink-0" />
                      <span>
                        <span className="font-semibold">
                          No extra charges. No hidden fees.
                        </span>
                      </span>
                    </li>
                  </ul>
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="deposit-7">
                <AccordionTrigger className="text-sm">
                  What if the item isn't returned?
                </AccordionTrigger>
                <AccordionContent className="text-gray-600 space-y-3">
                  <p>If an item isn't returned:</p>
                  <ul className="list-disc list-inside space-y-1 text-sm">
                    <li>The trust deposit is applied first</li>
                    <li>
                      If needed, an additional charge may cover the remaining
                      replacement value
                    </li>
                    <li>
                      The{" "}
                      <span className="font-semibold">
                        total charge will never exceed
                      </span>{" "}
                      the listed replacement value
                    </li>
                  </ul>
                  <p className="text-sm text-gray-500">
                    This ensures lenders are protected without overcharging
                    borrowers.
                  </p>
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="deposit-8">
                <AccordionTrigger className="text-sm">
                  What if someone damages my item?
                </AccordionTrigger>
                <AccordionContent className="text-gray-600 space-y-3">
                  <p>
                    Accidents happen. Here's how ShareSwap handles damage
                    fairly:
                  </p>
                  <ul className="space-y-2 text-sm">
                    <li className="flex items-start gap-2">
                      <CheckCircle className="h-4 w-4 text-[#0DCEA1] mt-0.5 flex-shrink-0" />
                      <span>
                        A trust deposit is held during each borrowing
                        transaction
                      </span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle className="h-4 w-4 text-[#0DCEA1] mt-0.5 flex-shrink-0" />
                      <span>
                        Normal wear is expected and isn't considered damage
                      </span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle className="h-4 w-4 text-[#0DCEA1] mt-0.5 flex-shrink-0" />
                      <span>
                        If damage is reported, the deposit is temporarily held
                      </span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle className="h-4 w-4 text-[#0DCEA1] mt-0.5 flex-shrink-0" />
                      <span>Both parties share details and photos</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle className="h-4 w-4 text-[#0DCEA1] mt-0.5 flex-shrink-0" />
                      <span>Support reviews the case if needed</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle className="h-4 w-4 text-[#0DCEA1] mt-0.5 flex-shrink-0" />
                      <span>
                        If damage is confirmed, funds may be used to cover
                        repair or replacement costs
                      </span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle className="h-4 w-4 text-[#0DCEA1] mt-0.5 flex-shrink-0" />
                      <span>
                        If no damage is found, the full deposit is returned
                      </span>
                    </li>
                  </ul>
                  <p className="font-medium text-gray-700">
                    You're never charged more than the item's replacement value.
                  </p>
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="deposit-9">
                <AccordionTrigger className="text-sm">
                  Deposit Exchange Options
                </AccordionTrigger>
                <AccordionContent className="text-gray-600 space-y-3">
                  <p>You can exchange deposits in two ways:</p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="bg-[#E6FBF5] rounded-lg p-3">
                      <p className="font-medium text-[#0BB88C] mb-2">
                        In-App (Recommended)
                      </p>
                      <ul className="text-sm space-y-1">
                        <li>• Secure payment handling</li>
                        <li>• Automatic deposit tracking</li>
                        <li>• Small service fee applies</li>
                      </ul>
                    </div>
                    <div className="bg-gray-100 rounded-lg p-3">
                      <p className="font-medium text-gray-700 mb-2">
                        In Person (Free)
                      </p>
                      <ul className="text-sm space-y-1">
                        <li>• Exchange items and deposits directly</li>
                        <li>• No platform fees</li>
                        <li>• You handle the handoff yourselves</li>
                      </ul>
                    </div>
                  </div>
                  <p className="text-sm text-gray-500">
                    Same protections. Different convenience levels.
                  </p>
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="deposit-10">
                <AccordionTrigger className="text-sm">
                  Why this system works
                </AccordionTrigger>
                <AccordionContent className="text-gray-600">
                  <ul className="space-y-2">
                    <li className="flex items-start gap-2">
                      <Shield className="h-4 w-4 text-[#0DCEA1] mt-0.5 flex-shrink-0" />
                      <span>
                        <span className="font-semibold">Protects lenders</span>
                      </span>
                    </li>
                    <li className="flex items-start gap-2">
                      <Star className="h-4 w-4 text-[#0DCEA1] mt-0.5 flex-shrink-0" />
                      <span>
                        <span className="font-semibold">
                          Rewards trustworthy borrowers
                        </span>
                      </span>
                    </li>
                    <li className="flex items-start gap-2">
                      <Heart className="h-4 w-4 text-[#0DCEA1] mt-0.5 flex-shrink-0" />
                      <span>
                        Keeps sharing{" "}
                        <span className="font-semibold">
                          fair, simple, and low-stress
                        </span>
                      </span>
                    </li>
                  </ul>
                  <p className="mt-3 text-sm font-medium text-gray-700">
                    No insurance drama. No fine print games.
                  </p>
                </AccordionContent>
              </AccordionItem>

              {/* Privacy & Account Questions */}
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mt-6 mb-2">
                Privacy & Account
              </p>
              <AccordionItem value="privacy-1">
                <AccordionTrigger className="text-sm">
                  Is my address shown to other users?
                </AccordionTrigger>
                <AccordionContent className="text-gray-600">
                  No. Only approximate neighborhood is shown.
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="privacy-2">
                <AccordionTrigger className="text-sm">
                  Can I list items I want to borrow?
                </AccordionTrigger>
                <AccordionContent className="text-gray-600">
                  Yes — use the Wishlist to request items you need.
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="privacy-3">
                <AccordionTrigger className="text-sm">
                  Item Exchange Options
                </AccordionTrigger>
                <AccordionContent className="text-gray-600 space-y-2">
                  <p>You have two options:</p>
                  <ul className="list-disc list-inside space-y-1 text-sm">
                    <li>
                      <span className="font-medium">Pick up yourself</span> —
                      Meet at a public location you both agree on (free)
                    </li>
                    <li>
                      <span className="font-medium">Uber Direct</span> — A
                      courier picks up the item and delivers it to you (small
                      fee applies)
                    </li>
                  </ul>
                  <p className="text-sm italic text-gray-500">
                    Choose whatever feels most comfortable for you.
                  </p>
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="privacy-4">
                <AccordionTrigger className="text-sm">
                  Who is responsible during delivery?
                </AccordionTrigger>
                <AccordionContent className="text-gray-600 space-y-3">
                  <p>
                    Responsibility depends on your delivery method and who books
                    the courier:
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="bg-white rounded-lg p-3">
                      <p className="font-medium text-[#0BB88C] mb-2 flex items-center gap-2">
                        <MapPin className="h-4 w-4" />
                        Pick Up Yourself
                      </p>
                      <ul className="text-sm space-y-1">
                        <li>• Responsibility transfers at handoff</li>
                        <li>• Both parties confirm in-person</li>
                        <li>• Trust-deposit active immediately</li>
                      </ul>
                    </div>
                    <div className="bg-white rounded-lg p-3">
                      <p className="font-medium text-blue-700 mb-2 flex items-center gap-2">
                        <Truck className="h-4 w-4" />
                        Uber Direct Courier
                      </p>
                      <ul className="text-sm space-y-1">
                        <li>
                          • Any loss or damage during transit is the
                          responsibility of the courier service
                        </li>
                        <li>• Sender handles courier issues</li>
                        <li>
                          • Trust-deposit activates after delivery confirmation
                        </li>
                        <li>
                          • ShareSwap does not cover courier-related loss or
                          damage
                        </li>
                      </ul>
                    </div>
                  </div>
                  <div className="bg-white border border-amber-200 rounded-md p-3 text-sm">
                    <p className="font-medium text-amber-800 mb-1">
                      What happens if the courier loses or damages the item?
                    </p>
                    <p className="text-amber-700">
                      The party who booked the courier handles the claim with
                      the delivery service. The trust-deposit is{" "}
                      <strong>not</strong> charged for courier issues — only for
                      issues after successful delivery.
                    </p>
                  </div>
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="privacy-5">
                <AccordionTrigger className="text-sm">
                  Can I deactivate my account?
                </AccordionTrigger>
                <AccordionContent className="text-gray-600 space-y-3">
                  <p>
                    Yes. Go to <strong>Profile → Settings</strong> and select
                    "Deactivate Account".
                  </p>
                  <div className="bg-gray-50 rounded-lg p-3 space-y-2">
                    <p className="font-medium text-gray-800">
                      When you deactivate:
                    </p>
                    <ul className="text-sm space-y-1">
                      <li>• Your profile is hidden from discovery</li>
                      <li>• All your listings are archived</li>
                      <li>• You can't send or receive new requests</li>
                      <li>• Your trust score and reputation are frozen</li>
                    </ul>
                  </div>
                  <p className="text-sm text-gray-500">
                    Want to come back? Simply log in again with your credentials
                    and you can instantly reactivate your account.
                  </p>
                  <div className="bg-blue-50 rounded-lg p-3">
                    <p className="text-sm text-blue-800">
                      <strong>Your data is preserved:</strong> Transaction
                      history, messages, and reviews are retained for trust,
                      safety, and legal compliance.
                    </p>
                  </div>
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="privacy-6">
                <AccordionTrigger className="text-sm">
                  What if I want to permanently delete my account?
                </AccordionTrigger>
                <AccordionContent className="text-gray-600 space-y-3">
                  <p>
                    You can request permanent deletion, but it isn't instant.
                    ShareSwap keeps a short cooling-off period to ensure safety
                    and unresolved issues.
                  </p>
                  <div className="bg-gray-50 rounded-lg p-3 space-y-2">
                    <p className="font-medium text-gray-800">
                      Here's how it works:
                    </p>
                    <ul className="text-sm space-y-1">
                      <li>
                        • You must have no active transactions, disputes, or
                        pending balances
                      </li>
                      <li>
                        • Your account is first deactivated (hidden and
                        inactive)
                      </li>
                      <li>
                        • After the cooling-off period, your account data is
                        permanently deleted
                      </li>
                      <li>• This action cannot be undone</li>
                    </ul>
                  </div>
                  <div className="bg-amber-50 rounded-lg p-3">
                    <p className="text-sm text-amber-800">
                      <strong>Note:</strong> Some data may be retained for legal
                      compliance.
                    </p>
                  </div>
                  <p className="text-sm text-gray-500">
                    <strong>Why the delay?</strong> To protect users and ensure
                    deposits, disputes, and safety checks are fully resolved
                    before anything disappears. If you change your mind during
                    the cooling-off period, you can reactivate your account
                    instantly.
                  </p>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
