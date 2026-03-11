import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Shield, Truck, AlertTriangle, Check, Star, ArrowLeft, ArrowRight, Loader2, MapPin } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { apiRequest } from "@/lib/queryClient";

interface DeliveryDepositModalProps {
  isOpen: boolean;
  onClose: () => void;
  onComplete: (selections: {
    deliveryMethod: 'self_arrange' | 'shareswap_delivery';
    depositMethod: 'self_arrange' | 'shareswap_deposit';
    uberQuoteFee?: number;
    uberQuoteId?: string;
    pickupAddress?: string;
    dropoffAddress?: string;
    depositAmount?: number;
    depositProcessingFee?: number;
  }) => void;
  itemValue: number;
}

interface UberQuote {
  id: string;
  fee: number;
  currency: string;
  duration: number;
}

const PLATFORM_MARGIN = 2.00;

export function DeliveryDepositModal({
  isOpen,
  onClose,
  onComplete,
  itemValue,
}: DeliveryDepositModalProps) {
  const [step, setStep] = useState<1 | 2>(1);
  const [deliveryMethod, setDeliveryMethod] = useState<'self_arrange' | 'shareswap_delivery' | null>(null);
  const [depositMethod, setDepositMethod] = useState<'self_arrange' | 'shareswap_deposit' | null>(null);

  const [isUberConfigured, setIsUberConfigured] = useState<boolean | null>(null);
  const [pickupAddress, setPickupAddress] = useState('');
  const [dropoffAddress, setDropoffAddress] = useState('');
  const [isLoadingQuote, setIsLoadingQuote] = useState(false);
  const [quote, setQuote] = useState<UberQuote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);

  const depositAmount = itemValue || 50;
  const depositProcessingFee = depositAmount * 0.05;

  const displayFee = quote
    ? (quote.fee / 100) + PLATFORM_MARGIN
    : 8.50 + PLATFORM_MARGIN;

  const displayBaseFee = quote
    ? (quote.fee / 100).toFixed(2)
    : '8.50';

  const displayTime = quote
    ? `${Math.round(quote.duration / 60)} min`
    : '30–45 min';

  useEffect(() => {
    if (isOpen) {
      fetch('/api/uber/status')
        .then((r) => r.json())
        .then((d) => setIsUberConfigured(d.configured))
        .catch(() => setIsUberConfigured(false));
    }
  }, [isOpen]);

  const handleClose = () => {
    setStep(1);
    setDeliveryMethod(null);
    setDepositMethod(null);
    setPickupAddress('');
    setDropoffAddress('');
    setQuote(null);
    setQuoteError(null);
    onClose();
  };

  const fetchQuote = async () => {
    if (!pickupAddress || !dropoffAddress) return;
    setIsLoadingQuote(true);
    setQuoteError(null);
    setQuote(null);

    try {
      const data = await apiRequest('POST', '/api/uber/quote', {
        pickupAddress,
        dropoffAddress,
        manifestValueCents: Math.round(itemValue * 100),
      });
      const result = await data.json();
      if (result.error) throw new Error(result.error);
      setQuote(result);
    } catch (err: any) {
      setQuoteError(err.message || 'Could not get a quote. Check the addresses and try again.');
    } finally {
      setIsLoadingQuote(false);
    }
  };

  const handleContinue = () => {
    if (step === 1 && deliveryMethod) {
      setStep(2);
    } else if (step === 2 && depositMethod && deliveryMethod) {
      onComplete({
        deliveryMethod,
        depositMethod,
        uberQuoteFee: deliveryMethod === 'shareswap_delivery'
          ? (quote ? quote.fee / 100 : 8.50)
          : undefined,
        uberQuoteId: quote?.id,
        pickupAddress: deliveryMethod === 'shareswap_delivery' ? pickupAddress : undefined,
        dropoffAddress: deliveryMethod === 'shareswap_delivery' ? dropoffAddress : undefined,
        depositAmount: depositMethod === 'shareswap_deposit' ? depositAmount : undefined,
        depositProcessingFee: depositMethod === 'shareswap_deposit' ? depositProcessingFee : undefined,
      });
      setStep(1);
      setDeliveryMethod(null);
      setDepositMethod(null);
      setPickupAddress('');
      setDropoffAddress('');
      setQuote(null);
      setQuoteError(null);
    }
  };

  const uberReady = deliveryMethod === 'shareswap_delivery'
    ? (!isUberConfigured || !!quote)
    : true;

  const canContinue = step === 1
    ? (!!deliveryMethod && uberReady)
    : !!depositMethod;

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold mb-6">
            {step === 1 ? "How would you like to exchange the item?" : "Secure Your Exchange"}
          </DialogTitle>
        </DialogHeader>

        {/* Progress */}
        <div className="flex items-center justify-center mb-8">
          <div className="flex items-center gap-4">
            <div className={`flex items-center justify-center w-10 h-10 rounded-full border-2 ${
              step >= 1 ? 'bg-primary border-primary text-white' : 'border-gray-300'
            }`}>
              {step > 1 ? <Check className="h-5 w-5" /> : '1'}
            </div>
            <div className={`w-16 h-0.5 ${step > 1 ? 'bg-primary' : 'bg-gray-300'}`} />
            <div className={`flex items-center justify-center w-10 h-10 rounded-full border-2 ${
              step >= 2 ? 'bg-primary border-primary text-white' : 'border-gray-300'
            }`}>
              2
            </div>
          </div>
        </div>

        {step === 1 ? (
          <div className="space-y-6">
            <RadioGroup value={deliveryMethod || ''} onValueChange={(v) => {
              setDeliveryMethod(v as any);
              setQuote(null);
              setQuoteError(null);
            }}>

              {/* Uber Direct via ShareSwap */}
              <Card
                className={`relative cursor-pointer transition-all ${
                  deliveryMethod === 'shareswap_delivery'
                    ? 'border-3 border-primary bg-teal-100 shadow-lg'
                    : 'bg-teal-50 border-2 border-teal-200 hover:bg-teal-100 hover:border-primary/50 hover:shadow-md'
                }`}
                onClick={() => {
                  setDeliveryMethod('shareswap_delivery');
                  setQuote(null);
                  setQuoteError(null);
                }}
              >
                <Badge className="absolute -top-3 right-4 bg-gradient-to-r from-teal-500 to-teal-700 text-white font-semibold px-3 py-1 shadow-md">
                  <Star className="h-3 w-3 mr-1 inline" />
                  RECOMMENDED
                </Badge>
                <CardContent className="p-6">
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <Truck className="h-5 w-5 text-primary" />
                        <h3 className="font-semibold text-lg">Uber Direct via ShareSwap</h3>
                        {isUberConfigured === false && (
                          <Badge variant="outline" className="text-xs text-amber-600 border-amber-400">
                            Estimated pricing
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground mb-3">
                        {isUberConfigured
                          ? "On-demand courier delivery with live tracking"
                          : "On-demand courier service • Enter addresses for a live quote"}
                      </p>
                    </div>
                    <RadioGroupItem value="shareswap_delivery" className="mt-1" />
                  </div>

                  <div className="space-y-2 mb-4">
                    <div className="flex items-center gap-2 text-sm">
                      <Check className="h-4 w-4 text-green-600" />
                      <span>Real-time GPS tracking</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      <Check className="h-4 w-4 text-green-600" />
                      <span>Insurance coverage on all deliveries</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      <Check className="h-4 w-4 text-green-600" />
                      <span>Professional courier service</span>
                    </div>
                  </div>

                  {/* Address inputs — shown when this option is selected */}
                  {deliveryMethod === 'shareswap_delivery' && isUberConfigured && (
                    <div className="mt-4 space-y-3" onClick={(e) => e.stopPropagation()}>
                      <div className="space-y-1">
                        <Label className="text-sm font-medium flex items-center gap-1">
                          <MapPin className="h-3 w-3" /> Pickup address (your address)
                        </Label>
                        <Input
                          placeholder="123 Main St, Toronto, ON M5V 1A1"
                          value={pickupAddress}
                          onChange={(e) => {
                            setPickupAddress(e.target.value);
                            setQuote(null);
                            setQuoteError(null);
                          }}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-sm font-medium flex items-center gap-1">
                          <MapPin className="h-3 w-3" /> Dropoff address (requester's address)
                        </Label>
                        <Input
                          placeholder="456 Other Ave, Toronto, ON M4K 2B3"
                          value={dropoffAddress}
                          onChange={(e) => {
                            setDropoffAddress(e.target.value);
                            setQuote(null);
                            setQuoteError(null);
                          }}
                        />
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="w-full"
                        disabled={!pickupAddress || !dropoffAddress || isLoadingQuote}
                        onClick={fetchQuote}
                      >
                        {isLoadingQuote ? (
                          <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Getting quote…</>
                        ) : (
                          'Get Delivery Quote'
                        )}
                      </Button>
                      {quoteError && (
                        <p className="text-sm text-red-600">{quoteError}</p>
                      )}
                    </div>
                  )}

                  {/* Pricing breakdown */}
                  <div className="bg-teal-100/50 border border-teal-200 rounded-lg p-4 mt-4">
                    {quote ? (
                      <>
                        <div className="flex justify-between text-sm mb-1">
                          <span className="text-muted-foreground">Uber Direct base fee</span>
                          <span className="font-medium">${(quote.fee / 100).toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between text-sm mb-1">
                          <span className="text-muted-foreground">Platform fee</span>
                          <span className="font-medium">${PLATFORM_MARGIN.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between text-sm mb-2">
                          <span className="text-muted-foreground">Estimated time</span>
                          <span className="font-medium">{displayTime}</span>
                        </div>
                        <div className="flex justify-between font-bold text-base border-t border-teal-300 pt-2">
                          <span>Total fee</span>
                          <span className="text-teal-700">${displayFee.toFixed(2)}</span>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="flex justify-between text-sm mb-1">
                          <span className="text-muted-foreground">Estimated base fee</span>
                          <span className="font-medium">${displayBaseFee}</span>
                        </div>
                        <div className="flex justify-between text-sm mb-1">
                          <span className="text-muted-foreground">Platform fee</span>
                          <span className="font-medium">${PLATFORM_MARGIN.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between text-sm mb-2">
                          <span className="text-muted-foreground">Estimated time</span>
                          <span className="font-medium">{displayTime}</span>
                        </div>
                        <div className="flex justify-between font-bold text-base border-t border-teal-300 pt-2">
                          <span>Total estimated fee</span>
                          <span className="text-teal-700">${displayFee.toFixed(2)}</span>
                        </div>
                        {isUberConfigured && (
                          <p className="text-xs text-muted-foreground mt-2">
                            Enter addresses above to get an exact quote
                          </p>
                        )}
                      </>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Self-Arrange */}
              <Card
                className={`cursor-pointer transition-all ${
                  deliveryMethod === 'self_arrange'
                    ? 'border-3 border-primary bg-teal-100 shadow-lg'
                    : 'bg-teal-50 border-2 border-teal-200 hover:bg-teal-100 hover:border-primary/50 hover:shadow-md'
                }`}
                onClick={() => setDeliveryMethod('self_arrange')}
              >
                <CardContent className="p-6">
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <h3 className="font-semibold text-lg">Arrange Yourself</h3>
                      </div>
                      <p className="text-sm text-muted-foreground mb-3">
                        Coordinate directly with your neighbour
                      </p>
                    </div>
                    <RadioGroupItem value="self_arrange" className="mt-1" />
                  </div>

                  <div className="bg-yellow-50 border-l-4 border-yellow-500 p-4 mb-4 rounded">
                    <div className="flex gap-2">
                      <AlertTriangle className="h-5 w-5 text-yellow-600 flex-shrink-0 mt-0.5" />
                      <div className="text-sm text-yellow-800">
                        <p className="font-semibold mb-1">No platform protection</p>
                        <p>ShareSwap is not responsible for lost or damaged items during self-arranged delivery.</p>
                      </div>
                    </div>
                  </div>

                  <div className="font-bold text-lg">Free</div>
                </CardContent>
              </Card>
            </RadioGroup>
          </div>
        ) : (
          // Step 2: Security Deposit
          <div className="space-y-6">
            <p className="text-sm text-muted-foreground mb-4">
              To protect both parties, add a refundable deposit for this item.
            </p>

            <RadioGroup value={depositMethod || ''} onValueChange={(v) => setDepositMethod(v as any)}>
              <Card
                className={`relative cursor-pointer transition-all ${
                  depositMethod === 'shareswap_deposit'
                    ? 'border-3 border-primary bg-teal-100 shadow-lg'
                    : 'bg-teal-50 border-2 border-teal-200 hover:bg-teal-100 hover:border-primary/50 hover:shadow-md'
                }`}
                onClick={() => setDepositMethod('shareswap_deposit')}
              >
                <Badge className="absolute -top-3 right-4 bg-gradient-to-r from-teal-500 to-teal-700 text-white font-semibold px-3 py-1 shadow-md">
                  <Star className="h-3 w-3 mr-1 inline" />
                  RECOMMENDED
                </Badge>
                <CardContent className="p-6">
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <Shield className="h-5 w-5 text-primary" />
                        <h3 className="font-semibold text-lg">Use ShareSwap Deposit</h3>
                      </div>
                      <p className="text-sm text-muted-foreground mb-3">
                        We securely hold your deposit and refund it automatically when the item is returned
                      </p>
                    </div>
                    <RadioGroupItem value="shareswap_deposit" className="mt-1" />
                  </div>

                  <div className="space-y-2 mb-4">
                    <div className="flex items-center gap-2 text-sm">
                      <Check className="h-4 w-4 text-green-600" />
                      <span>Automatic refund on safe return</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      <Check className="h-4 w-4 text-green-600" />
                      <span>Dispute protection via Stripe</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      <Check className="h-4 w-4 text-green-600" />
                      <span>Secure payment authorization hold</span>
                    </div>
                  </div>

                  <div className="bg-teal-100/50 border border-teal-200 rounded-lg p-4">
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-muted-foreground">Security deposit</span>
                      <span className="font-medium">${depositAmount.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-sm mb-2">
                      <span className="text-muted-foreground">Processing fee (5%)</span>
                      <span className="font-medium">${depositProcessingFee.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between font-bold text-base border-t border-teal-300 pt-2">
                      <span>Total hold amount</span>
                      <span className="text-teal-700">${(depositAmount + depositProcessingFee).toFixed(2)}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-2">
                      Deposit + fee are authorized (held) on your card and fully refunded when item is returned safely
                    </p>
                  </div>
                </CardContent>
              </Card>

              <Card
                className={`cursor-pointer transition-all ${
                  depositMethod === 'self_arrange'
                    ? 'border-3 border-primary bg-teal-100 shadow-lg'
                    : 'bg-teal-50 border-2 border-teal-200 hover:bg-teal-100 hover:border-primary/50 hover:shadow-md'
                }`}
                onClick={() => setDepositMethod('self_arrange')}
              >
                <CardContent className="p-6">
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <h3 className="font-semibold text-lg">Arrange Deposit Yourself</h3>
                      </div>
                      <p className="text-sm text-muted-foreground mb-3">
                        Coordinate directly with your neighbour
                      </p>
                    </div>
                    <RadioGroupItem value="self_arrange" className="mt-1" />
                  </div>

                  <div className="bg-red-50 border-l-4 border-red-500 p-4 mb-4 rounded">
                    <div className="flex gap-2">
                      <AlertTriangle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
                      <div className="text-sm text-red-800">
                        <p className="font-semibold mb-1">⚠️ High Risk</p>
                        <p className="mb-2">ShareSwap is not responsible for lost deposits or damages. No platform mediation for disputes.</p>
                        <ul className="list-disc list-inside space-y-1 text-xs">
                          <li>No payment protection</li>
                          <li>No dispute resolution</li>
                          <li>Full liability on you</li>
                        </ul>
                      </div>
                    </div>
                  </div>

                  <div className="font-bold text-lg">Free</div>
                </CardContent>
              </Card>
            </RadioGroup>
          </div>
        )}

        {/* Navigation Footer */}
        <div className="flex items-center justify-between pt-6 border-t mt-6">
          <Button
            variant="ghost"
            onClick={() => {
              if (step === 1) handleClose();
              else setStep(1);
            }}
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            {step === 1 ? 'Cancel' : 'Back'}
          </Button>

          <div className="flex gap-2">
            <div className={`w-2 h-2 rounded-full ${step === 1 ? 'bg-primary' : 'bg-gray-300'}`} />
            <div className={`w-2 h-2 rounded-full ${step === 2 ? 'bg-primary' : 'bg-gray-300'}`} />
          </div>

          <Button
            onClick={handleContinue}
            disabled={!canContinue}
            className="bg-primary hover:bg-primary/90"
          >
            {step === 1 ? 'Continue' : 'Complete'}
            <ArrowRight className="h-4 w-4 ml-2" />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
