"use client";

import { useCallback, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Play, Trophy as TrophyIcon, X } from "lucide-react";
import { toast } from "sonner";
import type { Call, Rep, Trophy } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createSupabaseBrowserClient, isSupabaseBrowserConfigured } from "@/lib/supabase/client";
import { currency } from "@/lib/utils";

function launchConfetti() {
  import("canvas-confetti").then(({ default: confetti }) => {
    confetti({ particleCount: 140, spread: 90, origin: { y: 0.6 }, colors: ["#f59e0b", "#3b82f6", "#ffffff"] });
    setTimeout(() => confetti({ particleCount: 60, spread: 60, origin: { y: 0.5 }, colors: ["#f59e0b", "#fbbf24"] }), 250);
  });
}

export function TrophyRoomClient({
  trophies: initialTrophies,
  reps,
  calls
}: {
  trophies: Trophy[];
  reps: Rep[];
  calls: Call[];
}) {
  const [trophies, setTrophies] = useState<Trophy[]>(initialTrophies);
  const [selected, setSelected] = useState<Trophy | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [addLoading, setAddLoading] = useState(false);
  const [filterRep, setFilterRep] = useState<string>("all");
  const [filterTag, setFilterTag] = useState<string>("");
  const formRef = useRef<HTMLFormElement>(null);

  const allTags = Array.from(new Set(trophies.flatMap((t) => t.tags ?? [])));

  const filtered = trophies.filter((t) => {
    if (filterRep !== "all" && t.rep_id !== filterRep) return false;
    if (filterTag && !(t.tags ?? []).includes(filterTag)) return false;
    return true;
  });

  const handleAdd = useCallback(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      setAddLoading(true);
      if (!isSupabaseBrowserConfigured()) { toast.error("Supabase not configured"); setAddLoading(false); return; }
      const form = e.currentTarget;
      const data = new FormData(form);
      const callId = String(data.get("call_id") || "");
      const repId = String(data.get("rep_id") || "");
      const supabase = createSupabaseBrowserClient();

      const payload = {
        rep_id: repId || null,
        call_id: callId || null,
        title: String(data.get("title")),
        description: String(data.get("description") || ""),
        call_recording_url: String(data.get("call_recording_url") || ""),
        thumbnail_url: String(data.get("thumbnail_url") || ""),
        tags: String(data.get("tags") || "")
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean)
      };

      const { data: newTrophy, error } = await supabase
        .from("trophy_room")
        .insert(payload)
        .select("*, reps(*), calls(*)")
        .single();

      if (error || !newTrophy) {
        toast.error(error?.message ?? "Failed to add trophy");
      } else {
        setTrophies((prev) => [newTrophy as Trophy, ...prev]);
        setShowAddForm(false);
        form.reset();
        toast.success("Trophy added to the room!");
        launchConfetti();
      }
      setAddLoading(false);
    },
    []
  );

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <select
          value={filterRep}
          onChange={(e) => setFilterRep(e.target.value)}
          className="rounded-md border border-white/15 bg-transparent px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="all">All Reps</option>
          {reps.map((r) => (
            <option key={r.id} value={r.id}>{r.name}</option>
          ))}
        </select>
        {allTags.length > 0 && (
          <select
            value={filterTag}
            onChange={(e) => setFilterTag(e.target.value)}
            className="rounded-md border border-white/15 bg-transparent px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">All Tags</option>
            {allTags.map((tag) => (
              <option key={tag} value={tag}>{tag}</option>
            ))}
          </select>
        )}
        <div className="ml-auto">
          <Button variant="gold" onClick={() => setShowAddForm(true)}>
            <TrophyIcon className="h-4 w-4" /> Add Trophy
          </Button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-white/10 bg-white/[0.02] py-20 text-center">
          <TrophyIcon className="mb-4 h-12 w-12 text-command-gold/40" />
          <div className="text-lg font-semibold">No trophies yet</div>
          <div className="mt-2 text-sm text-muted-foreground">Add winning calls to celebrate your team&apos;s victories</div>
        </div>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((trophy, index) => (
            <motion.button
              key={trophy.id}
              type="button"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.04 }}
              onClick={() => setSelected(trophy)}
              className="text-left"
            >
              <Card className="border-command-gold/40 shadow-gold transition-transform hover:-translate-y-1">
                <CardContent className="p-4">
                  <div className="mb-4 flex aspect-video items-center justify-center rounded-md bg-command-gold/10">
                    {trophy.thumbnail_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={trophy.thumbnail_url}
                        alt={trophy.title}
                        className="h-full w-full rounded-md object-cover"
                      />
                    ) : (
                      <TrophyIcon className="h-10 w-10 text-command-gold" />
                    )}
                  </div>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-bold">{trophy.title}</div>
                      <div className="mt-1 text-sm text-muted-foreground">
                        {trophy.reps?.name ?? "Unknown rep"} · {trophy.calls?.product_offered ?? "Product"}
                      </div>
                    </div>
                    <Badge variant="gold">{currency(trophy.calls?.revenue_generated)}</Badge>
                  </div>
                  <div className="mt-2 text-xs text-muted-foreground">
                    {new Date(trophy.created_at).toLocaleDateString()}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {(trophy.tags ?? []).map((tag) => (
                      <Badge key={tag} variant="muted">{tag}</Badge>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </motion.button>
          ))}
        </div>
      )}

      {/* Replay modal */}
      {selected ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setSelected(null)}
        >
          <div
            className="w-full max-w-4xl rounded-lg border border-white/10 bg-[#151925] p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between">
              <div>
                <div className="font-bold text-lg">{selected.title}</div>
                <div className="mt-1 text-sm text-muted-foreground">{selected.description}</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {(selected.tags ?? []).map((tag) => (
                    <Badge key={tag} variant="muted">{tag}</Badge>
                  ))}
                </div>
              </div>
              <button onClick={() => setSelected(null)} className="text-muted-foreground hover:text-white">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex aspect-video items-center justify-center rounded-md bg-black">
              {selected.call_recording_url ? (
                <iframe
                  src={selected.call_recording_url}
                  className="h-full w-full rounded-md"
                  allow="autoplay; fullscreen; picture-in-picture"
                />
              ) : (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Play className="h-5 w-5" /> No recording URL
                </div>
              )}
            </div>
            <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
              <span>{selected.reps?.name ?? "Unknown rep"} · {selected.calls?.product_offered ?? "—"}</span>
              <Badge variant="gold">{currency(selected.calls?.revenue_generated)}</Badge>
            </div>
          </div>
        </div>
      ) : null}

      {/* Add Trophy modal */}
      {showAddForm ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setShowAddForm(false)}
        >
          <div
            className="w-full max-w-xl rounded-lg border border-command-gold/30 bg-[#151925] p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <TrophyIcon className="h-5 w-5 text-command-gold" />
                <span className="font-bold text-lg">Add to Trophy Room</span>
              </div>
              <button onClick={() => setShowAddForm(false)} className="text-muted-foreground hover:text-white">
                <X className="h-5 w-5" />
              </button>
            </div>
            <form ref={formRef} onSubmit={handleAdd} className="space-y-4">
              <div className="space-y-2">
                <Label>Title *</Label>
                <Input name="title" placeholder="e.g. The $10k closer call" required />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Rep</Label>
                  <Select name="rep_id">
                    <SelectTrigger><SelectValue placeholder="Select rep" /></SelectTrigger>
                    <SelectContent>
                      {reps.map((r) => (
                        <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Closed Call</Label>
                  <Select name="call_id">
                    <SelectTrigger><SelectValue placeholder="Link a call (optional)" /></SelectTrigger>
                    <SelectContent>
                      {calls.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.reps?.name ?? "?"} · {c.product_offered ?? "—"} · {new Date(c.call_date).toLocaleDateString()}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Description</Label>
                <Textarea name="description" placeholder="What made this call special?" />
              </div>
              <div className="space-y-2">
                <Label>Recording URL</Label>
                <Input name="call_recording_url" placeholder="https://loom.com/share/... or direct MP4" />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Thumbnail URL</Label>
                  <Input name="thumbnail_url" placeholder="https://..." />
                </div>
                <div className="space-y-2">
                  <Label>Tags</Label>
                  <Input name="tags" placeholder="objection handle, opener, close" />
                </div>
              </div>
              <div className="flex gap-3 pt-2">
                <Button type="button" variant="ghost" onClick={() => setShowAddForm(false)} className="flex-1">
                  Cancel
                </Button>
                <Button type="submit" variant="gold" disabled={addLoading} className="flex-1">
                  <TrophyIcon className="h-4 w-4" />
                  {addLoading ? "Adding..." : "Add to Trophy Room"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
