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
  returnDate?: string;
  securityDeposit: string;
  depositPaid: boolean;
  status: string;
  qrCodeData?: string;
  specialInstructions?: string;
  riskAccepted: boolean;
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
  const [loadingQR, setLoadingQR] = useState<Record<number, boolean>>({});

  const { data: arrangements, isLoading } = useQuery<DeliveryArrangement[]>({
    queryKey: ['/api/delivery-arrangements'],
  });

  const generateQRCode = async (arrangement: DeliveryArrangement) => {
    try {
      setLoadingQR(prev => ({ ...prev, [arrangement.id]: true }));
      
      // Use server-generated QR data if available, otherwise create our own
      const qrData = arrangement.qrCodeData || JSON.stringify({
        arrangementId: arrangement.id,
        itemName: arrangement.request.item.name,
        deliveryType: arrangement.deliveryType,
        deliveryDate: arrangement.deliveryDate,
        returnDate: arrangement.returnDate,
        address: arrangement.deliveryAddress,
        verificationCode: Math.random().toString(36).substring(2, 15),
        timestamp: new Date().toISOString()
      });

      const qrDataUrl = await QRCode.toDataURL(qrData, {
        width: 300,
        margin: 2,
        color: {
          dark: '#000000',
          light: '#FFFFFF'
        }
      });
      
      setQrCodes(prev => ({
        ...prev,
        [arrangement.id]: qrDataUrl
      }));

      toast({
        title: "QR Code Generated",
        description: "Show this QR code for easy item handover verification.",
      });
    } catch (err) {
      toast({
        title: "Error",
        description: "Failed to generate QR code",
        variant: "destructive",
      });
    } finally {
      setLoadingQR(prev => {
        const newLoading = { ...prev };
        delete newLoading[arrangement.id];
        return newLoading;
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

  const generateCalendarEvents = (arrangements: DeliveryArrangement[]) => {
    const events: any[] = [];
    
    arrangements?.forEach(arr => {
      // Delivery/Pickup event
      events.push({
        title: `${arr.deliveryType === 'pickup' ? 'Pickup' : arr.deliveryType === 'self_delivery' ? 'Self-Delivery' : 'Delivery'}: ${arr.request.item.name}`,
        start: new Date(arr.deliveryDate),
        color: arr.deliveryType === 'self_delivery' ? '#f59e0b' : '#3b82f6',
        extendedProps: {
          arrangement: arr,
          eventType: 'delivery'
        },
      });
      
      // Return event if return date is specified
      if (arr.returnDate) {
        events.push({
          title: `Return: ${arr.request.item.name}`,
          start: new Date(arr.returnDate),
          color: '#10b981',
          extendedProps: {
            arrangement: arr,
            eventType: 'return'
          },
        });
      }
    });
    
    return events;
  };

  const calendarEvents = generateCalendarEvents(arrangements || []);

  const exportToCalendar = (arrangement: DeliveryArrangement) => {
    const startDate = new Date(arrangement.deliveryDate);
    const endDate = new Date(startDate.getTime() + 60 * 60 * 1000); // 1 hour duration
    
    const formatDate = (date: Date) => {
      return date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    };
    
    const title = `${arrangement.deliveryType === 'pickup' ? 'Pickup' : 'Delivery'}: ${arrangement.request.item.name}`;
    const description = `Item: ${arrangement.request.item.name}%0AAddress: ${arrangement.deliveryAddress}%0AType: ${arrangement.deliveryType}${arrangement.specialInstructions ? '%0AInstructions: ' + arrangement.specialInstructions : ''}`;
    
    const icsContent = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//ShareSpace//EN',
      'BEGIN:VEVENT',
      `DTSTART:${formatDate(startDate)}`,
      `DTEND:${formatDate(endDate)}`,
      `SUMMARY:${title}`,
      `DESCRIPTION:${description}`,
      `LOCATION:${arrangement.deliveryAddress}`,
      `UID:delivery-${arrangement.id}@sharespace.com`,
      'END:VEVENT',
      'END:VCALENDAR'
    ].join('\r\n');
    
    const blob = new Blob([icsContent], { type: 'text/calendar' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `delivery-${arrangement.id}.ics`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    
    toast({
      title: "Calendar Event Exported",
      description: "The delivery appointment has been saved to your calendar.",
    });
  };

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
                    <div className="flex justify-between items-start mb-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="font-medium">{arr.request.item.name}</h3>
                          {arr.deliveryType === 'self_delivery' && arr.riskAccepted && (
                            <div className="flex items-center gap-1">
                              <AlertTriangle className="h-3 w-3 text-orange-500" />
                              <span className="text-xs text-orange-600">Self-Delivery</span>
                            </div>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground mb-1">
                          {new Date(arr.deliveryDate).toLocaleDateString()} at {new Date(arr.deliveryDate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </p>
                        {arr.returnDate && (
                          <p className="text-sm text-green-600 mb-1">
                            Return by: {new Date(arr.returnDate).toLocaleDateString()}
                          </p>
                        )}
                        <p className="text-sm text-muted-foreground">
                          {arr.deliveryAddress}
                        </p>
                        {arr.specialInstructions && (
                          <p className="text-xs text-muted-foreground mt-1 italic">
                            "{arr.specialInstructions}"
                          </p>
                        )}
                      </div>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="icon"
                          onClick={() => exportToCalendar(arr)}
                          title="Export to Calendar"
                        >
                          <Download className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="outline"
                          size="icon"
                          onClick={() => qrCodes[arr.id] ? hideQRCode(arr.id) : generateQRCode(arr)}
                          disabled={loadingQR[arr.id]}
                          title="Generate QR Code"
                        >
                          {loadingQR[arr.id] ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : qrCodes[arr.id] ? (
                            <X className="h-4 w-4" />
                          ) : (
                            <QrCode className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                    </div>
                    {qrCodes[arr.id] && (
                      <div className="mt-4 p-4 bg-gray-50 rounded-lg flex flex-col items-center space-y-4">
                        <img
                          src={qrCodes[arr.id]}
                          alt="QR Code for Item Handover"
                          className="w-40 h-40 border border-gray-200 rounded"
                        />
                        <div className="text-center">
                          <p className="text-sm font-medium text-gray-900 mb-1">
                            QR Code for Easy Handover
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Show this code to verify the {arr.deliveryType === 'pickup' ? 'pickup' : 'delivery'} of {arr.request.item.name}
                          </p>
                        </div>
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