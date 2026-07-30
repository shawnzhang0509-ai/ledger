"use client";

import { useState, useEffect, useCallback } from "react";
import { Order } from "@/lib/data";

export function useOrders() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchOrders = useCallback(async () => {
    try {
      const res = await fetch("/api/orders");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Failed to fetch");
      }
      setOrders(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load orders");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  const createOrder = async (order: Omit<Order, "id" | "createdAt" | "updatedAt" | "grossProfit">) => {
    const res = await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(order),
    });
    if (!res.ok) throw new Error("Failed to create");
    const newOrder = await res.json();
    setOrders((prev) => [...prev, newOrder]);
    return newOrder;
  };

  const updateOrder = async (order: Order) => {
    const res = await fetch("/api/orders", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(order),
    });
    if (!res.ok) throw new Error("Failed to update");
    const updated = await res.json();
    setOrders((prev) => prev.map((o) => (o.id === updated.id ? updated : o)));
    return updated;
  };

  const deleteOrder = async (id: string) => {
    const res = await fetch(`/api/orders?id=${id}`, { method: "DELETE" });
    if (!res.ok) throw new Error("Failed to delete");
    setOrders((prev) => prev.filter((o) => o.id !== id));
  };

  return { orders, loading, error, createOrder, updateOrder, deleteOrder, refresh: fetchOrders };
}
