export interface Order {
  id: string;
  orderId: string;
  dateSold: string;
  customer: string;
  model: string;
  brand: string;
  scale: string;
  status: "Pending" | "Paid" | "Shipped" | "Completed" | "Cancelled";
  purchaseCost: number;
  airFreight: number;
  tradeMeFee: number;
  shippingCharge: number;
  courierCost: number;
  sellingPrice: number;
  grossProfit: number;
  tracking: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export function calculateGrossProfit(order: Omit<Order, "grossProfit" | "id" | "createdAt" | "updatedAt">): number {
  return (
    order.sellingPrice -
    order.purchaseCost -
    order.airFreight -
    order.tradeMeFee -
    order.shippingCharge -
    order.courierCost
  );
}

export const STATUS_OPTIONS = ["Pending", "Paid", "Shipped", "Completed", "Cancelled"] as const;

export const SAMPLE_ORDERS: Omit<Order, "id" | "createdAt" | "updatedAt" | "grossProfit">[] = [
  {
    orderId: "KP-17494",
    dateSold: "2026-07-15",
    customer: "Piers Crawford",
    model: "VW Golf GTI 1991/1994",
    brand: "Norev",
    scale: "1:18",
    status: "Completed",
    purchaseCost: 45,
    airFreight: 8,
    tradeMeFee: 5.5,
    shippingCharge: 12,
    courierCost: 9,
    sellingPrice: 120,
    tracking: "NZ123456",
    notes: "First sale",
  },
  {
    orderId: "KP-17637",
    dateSold: "2026-07-17",
    customer: "John Smith",
    model: "Porsche 911 Turbo",
    brand: "Minichamps",
    scale: "1:43",
    status: "Shipped",
    purchaseCost: 35,
    airFreight: 6,
    tradeMeFee: 4.2,
    shippingCharge: 10,
    courierCost: 8,
    sellingPrice: 95,
    tracking: "NZ789012",
    notes: "",
  },
];
