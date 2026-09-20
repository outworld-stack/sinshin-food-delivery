// src/types/models.ts

export interface CartItem {
  id: string;
  sizeId: string | null;    
  sizeName: string | null;  
  name: string;
  imageGradient: string;
  originalPrice: number;
  finalPrice: number;
  quantity: number;
  lineTotal: number;
}
export interface CartData {
  items: CartItem[];
  total: number;
}


export interface InvoiceData {
  orderId: string;
  items: { name: string; quantity: number; price: number }[];
  total: number;
  deliveryType: 'DELIVERY' | 'DINE_IN';
}