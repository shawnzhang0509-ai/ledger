"use client";

import { useState, useEffect } from "react";
import { Lock } from "lucide-react";

export function AuthGate({ children }: { children: React.ReactNode }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [authed, setAuthed] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    fetch("/api/auth")
      .then(async (res) => {
        const data = await res.json();
        if (res.status === 500) {
          setError("服务器未配置密码，请在 Vercel 设置 APP_PASSWORD 后重新部署");
          return;
        }
        if (data.authenticated) {
          setAuthed(true);
        }
      })
      .catch(() => {
        setError("无法连接服务器，请稍后重试");
      })
      .finally(() => {
        setChecking(false);
      });
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    const res = await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });

    if (res.ok) {
      setAuthed(true);
      return;
    }

    if (res.status === 500) {
      setError("服务器未配置密码，请在 Vercel 设置 APP_PASSWORD 后重新部署");
      return;
    }

    setError("密码错误");
  };

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100">
        <p className="text-slate-600">加载中...</p>
      </div>
    );
  }

  if (authed) return <>{children}</>;

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100">
      <div className="bg-white p-8 rounded-xl shadow-lg w-full max-w-sm">
        <div className="flex items-center gap-2 mb-6">
          <Lock className="w-6 h-6 text-slate-700" />
          <h1 className="text-xl font-bold text-slate-800">Diecast Sales Tracker</h1>
        </div>
        <form onSubmit={handleSubmit}>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="输入共享密码"
            className="w-full px-4 py-2 border border-slate-300 rounded-lg mb-4 focus:outline-none focus:ring-2 focus:ring-slate-500"
          />
          {error && <p className="text-red-500 text-sm mb-3">{error}</p>}
          <button
            type="submit"
            className="w-full bg-slate-800 text-white py-2 rounded-lg hover:bg-slate-700 transition"
          >
            进入
          </button>
        </form>
      </div>
    </div>
  );
}
