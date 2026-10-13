"use client";

import { useEffect, useMemo, useState } from "react";
import { AuthGate } from "@/components/auth-gate";
import { Camera, Check, Loader2, X } from "lucide-react";

type Product = { id: string; name: string; brand: string; image: string };
type Photo = { id: number; url: string; product_id: string | null; product_name: string | null; note: string | null; created_at: string };
type Job = { name: string; state: "处理中" | "上传中" | "完成" | "失败"; error?: string; url?: string };

const MAX_SIDE = 2048;

// Redraw the photo on a canvas and export a new JPEG: the file that leaves the phone has no EXIF at all
// (no GPS location, no camera serial), is upright, and at most 2048 px on its long side.
async function cleanJpeg(file: File): Promise<{ blob: Blob; width: number; height: number }> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error("这个格式浏览器打不开（比如 HEIC）。请在手机相册里选 JPEG，或用 Safari 上传");
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale), height = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/jpeg", 0.88));
  if (!blob) throw new Error("图片处理失败");
  return { blob, width, height };
}

export default function PhotosPage() {
  return (
    <AuthGate allow="any">
      <Uploader />
    </AuthGate>
  );
}

function Uploader() {
  const [products, setProducts] = useState<Product[]>([]);
  const [recent, setRecent] = useState<Photo[]>([]);
  const [query, setQuery] = useState("");
  const [product, setProduct] = useState<Product | null>(null);
  const [unsure, setUnsure] = useState(false);
  const [note, setNote] = useState("");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [busy, setBusy] = useState(false);

  const loadRecent = () => fetch("/api/uploads").then((r) => (r.ok ? r.json() : [])).then(setRecent).catch(() => {});
  useEffect(() => {
    fetch("/api/products").then((r) => (r.ok ? r.json() : [])).then(setProducts).catch(() => {});
    loadRecent();
  }, []);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (q ? products.filter((p) => `${p.name} ${p.brand} ${p.id}`.toLowerCase().includes(q)) : products).slice(0, 30);
  }, [products, query]);

  const ready = (product || (unsure && note.trim())) && !busy;

  async function upload(files: FileList | null) {
    if (!files?.length || !ready) return;
    setBusy(true);
    const list = Array.from(files);
    setJobs(list.map((f) => ({ name: f.name, state: "处理中" })));
    const set = (i: number, j: Partial<Job>) => setJobs((all) => all.map((x, k) => (k === i ? { ...x, ...j } : x)));
    for (let i = 0; i < list.length; i++) {
      try {
        const { blob, width, height } = await cleanJpeg(list[i]);
        set(i, { state: "上传中" });
        const pre = await fetch("/api/uploads", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "presign", productId: unsure ? "unsorted" : product!.id }),
        }).then(async (r) => (r.ok ? r.json() : Promise.reject(new Error((await r.json().catch(() => ({}))).error || "签名失败"))));
        const put = await fetch(pre.uploadUrl, { method: "PUT", headers: { "Content-Type": "image/jpeg" }, body: blob });
        if (!put.ok) throw new Error(`上传到存储失败（${put.status}）`);
        const done = await fetch("/api/uploads", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "complete", key: pre.key, width, height,
            productId: unsure ? null : product!.id, productName: unsure ? null : product!.name, note,
          }),
        });
        if (!done.ok) throw new Error((await done.json().catch(() => ({}))).error || "登记失败");
        set(i, { state: "完成", url: pre.publicUrl });
      } catch (e) {
        set(i, { state: "失败", error: e instanceof Error ? e.message : String(e) });
      }
    }
    setBusy(false);
    loadRecent();
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-3xl mx-auto p-4 lg:p-8 space-y-6">
        <header className="flex items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">上传产品照片</h1>
            <p className="text-sm text-slate-500 mt-1">照片会在手机上去掉位置信息、转正、缩小后再上传。agent 用它们发帖、做广告。</p>
          </div>
          <a href="/ops" className="text-sm text-slate-500 hover:text-slate-800 whitespace-nowrap">运营看板</a>
        </header>

        <section className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
          <h2 className="font-medium text-slate-800">1. 是哪辆车？</h2>
          {product ? (
            <div className="flex items-center gap-3">
              {product.image && <img src={product.image} alt="" className="w-16 h-12 object-cover rounded" />}
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{product.name}</div>
                <div className="text-xs text-slate-500">{product.brand} · {product.id}</div>
              </div>
              <button onClick={() => setProduct(null)} className="p-1.5 text-slate-500 hover:bg-slate-100 rounded" aria-label="换一辆">
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <>
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜车型、品牌，比如 McRae、Porsche"
                disabled={unsure} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm disabled:bg-slate-50" />
              {!unsure && (
                <ul className="max-h-64 overflow-y-auto divide-y divide-slate-100 border border-slate-100 rounded-lg">
                  {matches.map((p) => (
                    <li key={p.id}>
                      <button onClick={() => setProduct(p)} className="w-full flex items-center gap-3 p-2 text-left hover:bg-slate-50">
                        {p.image && <img src={p.image} alt="" className="w-12 h-9 object-cover rounded" />}
                        <span className="text-sm truncate">{p.name}</span>
                      </button>
                    </li>
                  ))}
                  {matches.length === 0 && <li className="p-3 text-sm text-slate-400">网站上没有这辆车</li>}
                </ul>
              )}
              <label className="flex items-center gap-2 text-sm text-slate-600">
                <input type="checkbox" checked={unsure} onChange={(e) => setUnsure(e.target.checked)} />
                网站上还没有 / 不确定，在备注里写车型
              </label>
            </>
          )}
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300}
            placeholder={unsure ? "车型（必填），比如 Norev 1:18 Fiat 500L 圣诞版" : "备注（可选）：角度、灯光、有没有盒子"}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" />
        </section>

        <section className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
          <h2 className="font-medium text-slate-800">2. 选照片</h2>
          <label className={`flex items-center justify-center gap-2 py-6 border-2 border-dashed rounded-xl text-sm font-medium
            ${ready ? "border-slate-300 text-slate-700 cursor-pointer hover:bg-slate-50" : "border-slate-200 text-slate-300"}`}>
            {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <Camera className="w-5 h-5" />}
            {busy ? "上传中…" : ready ? "从相册选，或直接拍（可多选）" : "先选车"}
            <input type="file" accept="image/*" multiple disabled={!ready} className="hidden"
              onChange={(e) => { upload(e.target.files); e.target.value = ""; }} />
          </label>
          {jobs.length > 0 && (
            <ul className="text-sm space-y-1">
              {jobs.map((j, i) => (
                <li key={i} className="flex items-center gap-2">
                  {j.state === "完成" ? <Check className="w-4 h-4 text-emerald-600" /> : j.state === "失败" ? <X className="w-4 h-4 text-red-600" /> : <Loader2 className="w-4 h-4 animate-spin text-slate-400" />}
                  <span className="truncate">{j.name}</span>
                  <span className={j.state === "失败" ? "text-red-600" : "text-slate-500"}>{j.error ?? j.state}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="space-y-2">
          <h2 className="font-medium text-slate-800">最近上传</h2>
          {recent.length === 0 ? (
            <p className="text-sm text-slate-400">还没有照片</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {recent.map((p) => (
                <a key={p.id} href={p.url} target="_blank" rel="noopener noreferrer" className="bg-white rounded-lg border border-slate-200 overflow-hidden">
                  <img src={p.url} alt="" className="w-full aspect-[4/3] object-cover" loading="lazy" />
                  <div className="p-2 text-xs">
                    <div className="truncate text-slate-700">{p.product_name ?? p.note ?? "未指定车型"}</div>
                    <div className="text-slate-400">{p.created_at.replace("T", " ")}</div>
                  </div>
                </a>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
