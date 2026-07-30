import { Order } from "@/lib/data";

export const STATUS_LABELS: Record<Order["status"], string> = {
  Pending: "待处理",
  Paid: "已付款",
  Shipped: "已发货",
  Completed: "已完成",
  Cancelled: "已取消",
};

export const FIELD_LABELS = {
  orderId: "订单编号",
  dateSold: "销售日期",
  customer: "客户",
  model: "车型",
  brand: "品牌",
  scale: "比例",
  status: "状态",
  purchaseCost: "采购成本（纽币）",
  purchaseCostCny: "采购成本（人民币）",
  exchangeRate: "汇率 (NZD:CNY)",
  airFreight: "空运费",
  tradeMeFee: "Trade Me 手续费",
  shippingCharge: "运费收入",
  courierCost: "快递成本",
  sellingPrice: "售价",
  grossProfit: "毛利",
  tracking: "物流单号",
  notes: "备注",
} as const;

export function getStatusLabel(status: Order["status"]): string {
  return STATUS_LABELS[status];
}
