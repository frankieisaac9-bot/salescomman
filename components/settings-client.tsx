"use client";

import { useEffect, useState } from "react";
import { Download, Plus, RefreshCw, Save, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createSupabaseBrowserClient, isSupabaseBrowserConfigured } from "@/lib/supabase/client";
import type { Rep } from "@/lib/types";

async function apiFetch(path: string, options?: RequestInit) {
  const res = await fetch(path, options);
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
  return json;
}

export function SettingsClient() {
  const [reps, setReps] = useState<Rep[]>([]);
  const [products, setProducts] = useState<string[]>([]);
  const [thresholds, setThresholds] = useState({ day3: 3, day7: 7, day10: 10, day14: 14 });
  const [newRep, setNewRep] = useState({ name: "", team: "", avatar_url: "", role: "rep" });
  const [newProduct, setNewProduct] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Load reps via admin API route (bypasses RLS)
    fetch("/api/reps").then((r) => r.json()).then((data) => {
      if (Array.isArray(data)) setReps(data as Rep[]);
    });
    // Load app settings via browser client
    if (!isSupabaseBrowserConfigured()) return;
    const supabase = createSupabaseBrowserClient();
    supabase.from("app_settings").select("*").in("key", ["products", "follow_up_thresholds"]).then((settingsRes) => {
      if (settingsRes.data) {
        const prodRow = settingsRes.data.find((r) => r.key === "products");
        const threshRow = settingsRes.data.find((r) => r.key === "follow_up_thresholds");
        if (prodRow?.value) setProducts(prodRow.value as string[]);
        if (threshRow?.value) setThresholds(threshRow.value as typeof thresholds);
      }
    });
  }, []);

  const addRep = async () => {
    if (!newRep.name.trim()) { toast.error("Rep name is required"); return; }
    setLoading(true);
    try {
      const data = await apiFetch("/api/reps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newRep)
      });
      setReps((prev) => [...prev, data as Rep].sort((a, b) => a.name.localeCompare(b.name)));
      setNewRep({ name: "", team: "", avatar_url: "", role: "rep" });
      toast.success(`${data.name} added`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to add rep");
    }
    setLoading(false);
  };

  const removeRep = async (id: string) => {
    try {
      await apiFetch("/api/reps", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id })
      });
      setReps((prev) => prev.filter((r) => r.id !== id));
      toast.success("Rep removed");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to remove rep");
    }
  };

  async function saveProducts() {
    if (!isSupabaseBrowserConfigured()) { toast.error("Supabase not configured"); return; }
    setLoading(true);
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase
      .from("app_settings")
      .upsert({ key: "products", value: products as unknown as Record<string, unknown>, updated_at: new Date().toISOString() }, { onConflict: "key" });
    if (error) toast.error(error.message);
    else toast.success("Products saved");
    setLoading(false);
  }

  async function saveThresholds() {
    if (!isSupabaseBrowserConfigured()) { toast.error("Supabase not configured"); return; }
    setLoading(true);
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase
      .from("app_settings")
      .upsert({ key: "follow_up_thresholds", value: thresholds as unknown as Record<string, unknown>, updated_at: new Date().toISOString() }, { onConflict: "key" });
    if (error) toast.error(error.message);
    else toast.success("Thresholds saved");
    setLoading(false);
  }

  async function runSync(path: string, label: string) {
    setLoading(true);
    try {
      const response = await fetch(path, { method: "POST" });
      const text = await response.text();
      const result = text ? JSON.parse(text) : {};
      if (!response.ok) {
        toast.error(result.error ?? `${label} failed`);
      } else {
        const pc = result.post_call;
        const calls = pc?.calls_upserted ?? result.calls_upserted ?? 0;
        const leads = pc?.leads_upserted ?? result.leads_upserted ?? 0;
        const rows = result.rows_upserted ?? 0;
        const detail = rows > 0 ? `${rows} rows synced` : `${calls} calls, ${leads} leads synced`;
        toast.success(`${label} complete — ${detail}`);
        setTimeout(() => window.location.reload(), 800);
      }
    } catch (err) {
      toast.error(`${label} failed — check Terminal for details`);
      console.error(err);
    }
    setLoading(false);
  }

  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <Card>
        <CardHeader><CardTitle>Reps</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            {reps.map((rep) => (
              <div key={rep.id} className="flex items-center justify-between rounded-md border border-white/10 bg-white/[0.03] px-3 py-2">
                <div>
                  <div className="font-medium">{rep.name}</div>
                  <div className="text-xs text-muted-foreground">{rep.team ?? "No team"} · {rep.role}</div>
                </div>
                <Button variant="ghost" size="icon" onClick={() => removeRep(rep.id)}>
                  <Trash2 className="h-4 w-4 text-red-400" />
                </Button>
              </div>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>Name *</Label>
              <Input
                placeholder="Rep name"
                value={newRep.name}
                onChange={(e) => setNewRep((prev) => ({ ...prev, name: e.target.value }))}
              />
            </div>
            <div className="space-y-1">
              <Label>Team</Label>
              <Input
                placeholder="e.g. Setters"
                value={newRep.team}
                onChange={(e) => setNewRep((prev) => ({ ...prev, team: e.target.value }))}
              />
            </div>
            <div className="space-y-1">
              <Label>Avatar URL</Label>
              <Input
                placeholder="https://..."
                value={newRep.avatar_url}
                onChange={(e) => setNewRep((prev) => ({ ...prev, avatar_url: e.target.value }))}
              />
            </div>
            <div className="space-y-1">
              <Label>Role</Label>
              <select
                value={newRep.role}
                onChange={(e) => setNewRep((prev) => ({ ...prev, role: e.target.value }))}
                className="flex h-10 w-full rounded-md border border-input bg-white/[0.03] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="rep">Rep</option>
                <option value="admin">Admin</option>
              </select>
            </div>
          </div>
          <Button onClick={addRep} disabled={loading}>
            <Users className="h-4 w-4" /> Add Rep
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Data Sync</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-md border border-blue-400/20 bg-blue-400/5 p-3 text-sm text-blue-300">
            Pull the latest data from the Google Sheets. Sheet IDs are configured as environment variables in your hosting dashboard.
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => runSync("/api/tracking-sheet/sync", "Tracking sheet sync")} disabled={loading}>
              <RefreshCw className="h-4 w-4" /> Sync Tracking Sheet
            </Button>
            <Button onClick={() => runSync("/api/setter-sheet/sync", "Setter sheet sync")} disabled={loading}>
              <RefreshCw className="h-4 w-4" /> Sync Setter Sheet
            </Button>
            <Button variant="outline" onClick={() => runSync("/api/google-sheets/sync", "Google Sheets sync")} disabled={loading}>
              <RefreshCw className="h-4 w-4" /> Sync Post-Call Form
            </Button>
            <Button variant="outline" onClick={() => runSync("/api/closer-calls/sync", "Closer calls sync")} disabled={loading}>
              <RefreshCw className="h-4 w-4" /> Sync Closer Calls
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Products</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {products.map((product, i) => (
            <div key={i} className="flex items-center justify-between rounded-md border border-white/10 p-3">
              <span>{product}</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setProducts((prev) => prev.filter((_, idx) => idx !== i))}
              >
                Remove
              </Button>
            </div>
          ))}
          <div className="flex gap-2">
            <Input
              placeholder="New product name"
              value={newProduct}
              onChange={(e) => setNewProduct(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newProduct.trim()) {
                  setProducts((prev) => [...prev, newProduct.trim()]);
                  setNewProduct("");
                }
              }}
            />
            <Button
              variant="outline"
              onClick={() => {
                if (newProduct.trim()) {
                  setProducts((prev) => [...prev, newProduct.trim()]);
                  setNewProduct("");
                }
              }}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          <Button onClick={saveProducts} disabled={loading}>
            <Save className="h-4 w-4" /> Save Products
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Follow-Up Flag Thresholds</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            {(["day3", "day7", "day10", "day14"] as const).map((key) => (
              <div key={key} className="space-y-1">
                <Label>{key === "day3" ? "First Follow-Up" : key === "day7" ? "Overdue" : key === "day10" ? "At Risk" : "Gone Cold"}</Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={1}
                    max={60}
                    value={thresholds[key]}
                    onChange={(e) => setThresholds((prev) => ({ ...prev, [key]: Number(e.target.value) }))}
                  />
                  <span className="text-sm text-muted-foreground">days</span>
                </div>
              </div>
            ))}
          </div>
          <Button onClick={saveThresholds} disabled={loading}>
            <Save className="h-4 w-4" /> Save Thresholds
          </Button>
        </CardContent>
      </Card>

      <Card className="xl:col-span-2">
        <CardHeader><CardTitle>Export Data</CardTitle></CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3">
            {["calls", "leads", "leaderboard"].map((resource) => (
              <Button key={resource} variant="outline" asChild>
                <a href={`/api/export/${resource}`} download>
                  <Download className="h-4 w-4" /> {resource.charAt(0).toUpperCase() + resource.slice(1)} CSV
                </a>
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
