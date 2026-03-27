export type OrderStatus = 'pending' | 'preparing' | 'ready' | 'delivered' | 'cancelled';

export interface Order {
  id: string;
  customerUid: string;
  customerName: string;
  items: { name: string; quantity: number; price: number }[];
  total: number;
  status: OrderStatus;
  createdAt: string;
  updatedAt?: string;
}

export interface SyncEvent {
  id: string;
  timestamp: string;
  type: string;
  data: any;
}
