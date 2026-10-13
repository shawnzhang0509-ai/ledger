import { NextRequest, NextResponse } from "next/server";
import { sessionRole } from "@/lib/session";

// The storefront catalogue (public), trimmed to what the photo picker needs.
export async function GET(request: NextRequest) {
  if (!sessionRole(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const res = await fetch("https://www.driftae.com/products.json", { next: { revalidate: 600 } });
  if (!res.ok) return NextResponse.json({ error: "Catalogue unavailable" }, { status: 502 });
  const data = await res.json();
  const products = (data.products ?? []).map((p: { id: string; name: string; brand?: string; image?: string }) => ({
    id: p.id, name: p.name, brand: p.brand ?? "", image: p.image ?? "",
  }));
  return NextResponse.json(products);
}
