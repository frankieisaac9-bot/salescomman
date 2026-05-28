"use client";

import { useState } from "react";
import { Plus, Trophy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { createSupabaseBrowserClient, isSupabaseBrowserConfigured } from "@/lib/supabase/client";
import type { ObjectionType, Rep } from "@/lib/types";

const statuses = ["booked", "showed", "no_show", "closed", "lost"];
const products = ["Setter School", "Closer Accelerator", "Sales Team Buildout", "Enterprise Coaching"];
const objectionTypes: ObjectionType[] = ["money_logistics", "partner", "fear", "think_about_it", "na"];
const objectionLabels: Record<ObjectionType, string> = {
  money_logistics: "Money Logistics",
  partner: "Partner",
  fear: "Fear",
  think_about_it: "Think About It",
  na: "N/A",
};

export function CallEntryForm({ reps }: { reps: Rep[] }) {
  const [addTrophy, setAddTrophy] = useState(false);
  const [selectedObjections, setSelectedObjections] = useState<ObjectionType[]>([]);
  const [loading, setLoading] = useState(false);

  async function onSubmit(formData: FormData) {
    if (!isSupabaseBrowserConfigured()) { toast.error("Supabase not configured — add env vars to .env.local"); setLoading(false); return; }
    setLoading(true);
    const supabase = createSupabaseBrowserClient();
    const callPayload = {
      rep_id: String(formData.get("rep_id")),
      contact_id: String(formData.get("contact_id") || ""),
      status: String(formData.get("status")),
      product_offered: String(formData.get("product_offered") || ""),
      outcome: String(formData.get("outcome") || ""),
      cash_collected: Number(formData.get("cash_collected") || 0),
      revenue_generated: Number(formData.get("revenue_generated") || 0),
      call_recording_url: String(formData.get("call_recording_url") || ""),
      call_date: String(formData.get("call_date"))
    };

    const { data: call, error } = await supabase.from("calls").insert(callPayload).select("*").single();
    if (error || !call) {
      toast.error(error?.message ?? "Unable to create call");
      setLoading(false);
      return;
    }

    if (selectedObjections.length) {
      await supabase.from("objections").insert(
        selectedObjections.map((type) => ({
          call_id: call.id,
          rep_id: call.rep_id,
          type,
          notes: String(formData.get(`objection_${type}`) || "")
        }))
      );
    }

    if (addTrophy) {
      await supabase.from("trophy_room").insert({
        rep_id: call.rep_id,
        call_id: call.id,
        title: String(formData.get("trophy_title") || "Winning call"),
        description: String(formData.get("trophy_description") || ""),
        tags: String(formData.get("trophy_tags") || "")
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean),
        thumbnail_url: String(formData.get("thumbnail_url") || ""),
        call_recording_url: call.call_recording_url
      });
      toast.success("Added to Trophy Room");
    }

    toast.success("Call logged");
    setLoading(false);
  }

  return (
    <form action={onSubmit} className="grid gap-5 xl:grid-cols-3">
      <Card className="xl:col-span-2">
        <CardHeader>
          <CardTitle>Call Details</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label>Rep</Label>
            <Select name="rep_id" required>
              <SelectTrigger><SelectValue placeholder="Select rep" /></SelectTrigger>
              <SelectContent>{reps.map((rep) => <SelectItem key={rep.id} value={rep.id}>{rep.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Close Contact ID</Label>
            <Input name="contact_id" placeholder="cont_..." />
          </div>
          <div className="space-y-2">
            <Label>Call Date</Label>
            <Input name="call_date" type="datetime-local" required />
          </div>
          <div className="space-y-2">
            <Label>Status</Label>
            <Select name="status" defaultValue="booked">
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{statuses.map((status) => <SelectItem key={status} value={status}>{status.replace("_", " ")}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Product Offered</Label>
            <Select name="product_offered">
              <SelectTrigger><SelectValue placeholder="Select product" /></SelectTrigger>
              <SelectContent>{products.map((product) => <SelectItem key={product} value={product}>{product}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Recording URL</Label>
            <Input name="call_recording_url" placeholder="https://..." />
          </div>
          <div className="space-y-2">
            <Label>Cash Collected</Label>
            <Input name="cash_collected" type="number" min="0" step="0.01" />
          </div>
          <div className="space-y-2">
            <Label>Revenue Generated</Label>
            <Input name="revenue_generated" type="number" min="0" step="0.01" />
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label>Outcome Notes</Label>
            <Textarea name="outcome" placeholder="What happened on the call?" />
          </div>
        </CardContent>
      </Card>
      <div className="space-y-5">
        <Card>
          <CardHeader>
            <CardTitle>Objections Raised</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {objectionTypes.map((type) => {
              const selected = selectedObjections.includes(type);
              return (
                <div key={type} className="rounded-md border border-white/10 p-3">
                  <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={(event) =>
                        setSelectedObjections((current) =>
                          event.target.checked ? [...current, type] : current.filter((item) => item !== type)
                        )
                      }
                    />
                    {objectionLabels[type]}
                  </label>
                  {selected ? <Textarea name={`objection_${type}`} className="mt-2 min-h-16" placeholder="Notes" /> : null}
                </div>
              );
            })}
          </CardContent>
        </Card>
        <Card className="border-command-gold/30">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Trophy className="h-4 w-4 text-command-gold" /> Trophy Room</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={addTrophy} onChange={(event) => setAddTrophy(event.target.checked)} />
              Add to Trophy Room
            </label>
            {addTrophy ? (
              <div className="space-y-3">
                <Input name="trophy_title" placeholder="Title" />
                <Textarea name="trophy_description" placeholder="Description" />
                <Input name="trophy_tags" placeholder="Tags, comma separated" />
                <Input name="thumbnail_url" placeholder="Thumbnail URL" />
              </div>
            ) : null}
            <Button className="w-full" disabled={loading}><Plus className="h-4 w-4" /> {loading ? "Saving..." : "Log Call"}</Button>
          </CardContent>
        </Card>
      </div>
    </form>
  );
}
