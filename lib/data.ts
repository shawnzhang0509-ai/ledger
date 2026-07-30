export interface Order {
  id: string;
  orderId: string;
  dateSold: string;
  customer: string;
  model: string;
  brand: string;
  scale: string;
  status: "Pending" | "Paid" | "Shipped" | "Completed" | "Cancelled";
  purchaseCostCny: number;
  exchangeRate: number;
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

/** 根据人民币采购价和汇率（1 NZD = X CNY）计算纽币采购成本 */
export function calculatePurchaseCostNzd(purchaseCostCny: number, exchangeRate: number): number {
  if (purchaseCostCny <= 0 || exchangeRate <= 0) return 0;
  return Math.round((purchaseCostCny / exchangeRate) * 100) / 100;
}

export function getPurchaseCostNzd(
  order: Pick<Order, "purchaseCost" | "purchaseCostCny" | "exchangeRate">
): number {
  const fromCny = calculatePurchaseCostNzd(order.purchaseCostCny, order.exchangeRate);
  return fromCny > 0 ? fromCny : order.purchaseCost;
}

export function normalizeOrderInput<T extends Partial<Order>>(input: T): T & Pick<Order, "purchaseCost" | "purchaseCostCny" | "exchangeRate"> {
  const purchaseCostCny = input.purchaseCostCny ?? 0;
  const exchangeRate = input.exchangeRate ?? 0;
  const purchaseCost = getPurchaseCostNzd({
    purchaseCost: input.purchaseCost ?? 0,
    purchaseCostCny,
    exchangeRate,
  });

  return {
    ...input,
    purchaseCostCny,
    exchangeRate,
    purchaseCost,
  };
}

export function calculateGrossProfit(
  order: Omit<Order, "grossProfit" | "id" | "createdAt" | "updatedAt">
): number {
  const purchaseCostNzd = getPurchaseCostNzd(order);
  return (
    order.sellingPrice -
    purchaseCostNzd -
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
    purchaseCostCny: 200,
    exchangeRate: 4.44,
    purchaseCost: 45.05,
    airFreight: 8,
    tradeMeFee: 5.5,
    shippingCharge: 12,
    courierCost: 9,
    sellingPrice: 120,
    tracking: "NZ123456",
    notes: "首笔销售",
  },
  {
    orderId: "KP-17637",
    dateSold: "2026-07-17",
    customer: "John Smith",
    model: "Porsche 911 Turbo",
    brand: "Minichamps",
    scale: "1:43",
    status: "Shipped",
    purchaseCostCny: 155,
    exchangeRate: 4.43,
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
