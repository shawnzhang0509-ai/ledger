import "./globals.css";

export const metadata = {
  title: "模型车销售记账",
  description: "模型车销售订单管理与利润统计",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="bg-slate-50 text-slate-900 antialiased">{children}</body>
    </html>
  );
}
