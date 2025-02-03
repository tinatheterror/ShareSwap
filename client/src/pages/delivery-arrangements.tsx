import { Navbar } from "@/components/shared/navbar";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useQuery } from "@tanstack/react-query";
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin from '@fullcalendar/interaction';
import QRCode from 'qrcode';
import { useState } from 'react';
import { Loader2, Truck, QrCode, Calendar as CalendarIcon, X } from 'lucide-react';
import type { EventClickArg } from '@fullcalendar/core';

interface DeliveryArrangement {
  id: number;
  requestId: number;
  deliveryType: string;
  deliveryFee: string;
  deliveryAddress: string;
  deliveryDate: string;
  securityDeposit: string;
  depositPaid: boolean;
  status: string;
  createdAt: string;
  request: {
    id: number;
    item: {
      id: number;
      name: string;
      photos: string[];
    };
  };
}

export default function DeliveryArrangementsPage() {
  const { toast } = useToast();
  const [qrCodes, setQrCodes] = useState<Record<number, string>>({});

  const { data: arrangements, isLoading } = useQuery<DeliveryArrangement[]>({
    queryKey: ['/api/delivery-arrangements'],
  });

  const generateQRCode = async (arrangement: DeliveryArrangement) => {
    try {
      const qrData = JSON.stringify({
        arrangementId: arrangement.id,
        itemName: arrangement.request.item.name,
        deliveryDate: arrangement.deliveryDate,
        address: arrangement.deliveryAddress,
      });

      const qrDataUrl = await QRCode.toDataURL(qrData);
      setQrCodes(prev => ({
        ...prev,
        [arrangement.id]: qrDataUrl
      }));
    } catch (err) {
      toast({
        title: "Error",
        description: "Failed to generate QR code",
        variant: "destructive",
      });
    }
  };

  const hideQRCode = (arrangementId: number) => {
    setQrCodes(prev => {
      const newCodes = { ...prev };
      delete newCodes[arrangementId];
      return newCodes;
    });
  };

  const calendarEvents = arrangements?.map(arr => ({
    title: `Delivery: ${arr.request.item.name}`,
    start: new Date(arr.deliveryDate),
    extendedProps: {
      arrangement: arr,
    },
  })) || [];

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navbar />
        <main className="max-w-7xl mx-auto px-4 py-12">
          <div className="flex items-center justify-center min-h-[400px]">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
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
          <h1 className="text-3xl font-bold mb-2">Delivery Arrangements</h1>
          <p className="text-muted-foreground">
            Manage your item pickups and deliveries
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-8">
          <Card>
            <CardContent className="pt-6">
              <h2 className="text-xl font-semibold mb-4 flex items-center">
                <CalendarIcon className="w-5 h-5 mr-2" />
                Delivery Calendar
              </h2>
              <FullCalendar
                plugins={[dayGridPlugin, interactionPlugin]}
                initialView="dayGridMonth"
                events={calendarEvents}
                eventClick={(info: EventClickArg) => {
                  const arrangement = info.event.extendedProps.arrangement;
                  generateQRCode(arrangement);
                }}
              />
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <h2 className="text-xl font-semibold mb-4 flex items-center">
                <Truck className="w-5 h-5 mr-2" />
                Upcoming Deliveries
              </h2>
              <div className="space-y-4">
                {arrangements?.map((arr) => (
                  <div
                    key={arr.id}
                    className="p-4 rounded-lg border hover:border-primary/50 transition-colors"
                  >
                    <div className="flex justify-between items-start">
                      <div>
                        <h3 className="font-medium">{arr.request.item.name}</h3>
                        <p className="text-sm text-muted-foreground">
                          {new Date(arr.deliveryDate).toLocaleDateString()}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {arr.deliveryAddress}
                        </p>
                      </div>
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => qrCodes[arr.id] ? hideQRCode(arr.id) : generateQRCode(arr)}
                      >
                        {qrCodes[arr.id] ? (
                          <X className="h-4 w-4" />
                        ) : (
                          <QrCode className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                    {qrCodes[arr.id] && (
                      <div className="mt-4 flex flex-col items-center">
                        <img
                          src={qrCodes[arr.id]}
                          alt="QR Code"
                          className="w-32 h-32"
                        />
                        <p className="text-sm text-muted-foreground mt-2">
                          Show this QR code during delivery
                        </p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}