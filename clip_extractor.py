"""
clip_extractor.py — Call Recording → Social Clip Pipeline
===========================================================

Scans a directory for audio/video call recordings, transcribes them with
OpenAI Whisper (local), scores segments for social-media value, extracts
the top clips via ffmpeg, and writes a summary JSON + human-readable report.

USAGE
-----
  # Scan default ~/Downloads directory:
  python clip_extractor.py

  # Scan a custom directory:
  python clip_extractor.py --input /path/to/recordings

  # Control output and clip count:
  python clip_extractor.py --input ~/recordings --output ~/clips --top 5

  # Use Claude API for smarter scoring (requires ANTHROPIC_API_KEY env var):
  python clip_extractor.py --use-claude

  # Tune clip length:
  python clip_extractor.py --min-duration 20 --max-duration 120

  # Use a specific Whisper model (tiny/base/small/medium/large):
  python clip_extractor.py --whisper-model medium

  # Force re-transcribe (ignore cache):
  python clip_extractor.py --no-cache

FULL OPTIONS
  --input DIR          Directory to scan (default: ~/Downloads)
  --output DIR         Where to write clips (default: ~/Downloads/social_clips)
  --top N              Clips to extract per recording (default: 3)
  --min-duration SECS  Minimum clip length in seconds (default: 30)
  --max-duration SECS  Maximum clip length in seconds (default: 90)
  --whisper-model NAME Whisper model size (default: base)
  --use-claude         Use Claude API to score/caption clips
  --no-cache           Re-transcribe even if a cached transcript exists
  --dry-run            Score and rank clips but skip ffmpeg extraction
  --upload-drive       Upload extracted clips to a new Google Drive folder
  --drive-creds JSON   Path to OAuth2 Desktop credentials JSON (default: ~/credentials.json)

GOOGLE DRIVE SETUP (one-time)
  1. Go to console.cloud.google.com → APIs & Services → Enable "Google Drive API"
  2. APIs & Services → Credentials → Create Credentials → OAuth client ID
     → Application type: Desktop app → Download JSON
  3. Save the downloaded file as ~/credentials.json  (or pass --drive-creds PATH)
  4. First run with --upload-drive opens your browser for Google sign-in.
     After approving, a token is saved to ~/.config/clip_extractor/gdrive_token.json
     so future runs are fully automatic.

DEPENDENCIES
  See requirements.txt. ffmpeg must be installed and on PATH.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import re
import subprocess
import sys
import textwrap
import time
from dataclasses import dataclass, field, asdict
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

# ─── optional heavy imports (checked at runtime) ─────────────────────────────
try:
    import whisper  # openai-whisper
    WHISPER_AVAILABLE = True
except ImportError:
    WHISPER_AVAILABLE = False

try:
    import anthropic  # anthropic SDK
    ANTHROPIC_AVAILABLE = True
except ImportError:
    ANTHROPIC_AVAILABLE = False

try:
    from google.oauth2.credentials import Credentials
    from google.auth.transport.requests import Request
    from google_auth_oauthlib.flow import InstalledAppFlow
    from googleapiclient.discovery import build as gdrive_build
    from googleapiclient.http import MediaFileUpload
    GDRIVE_AVAILABLE = True
except ImportError:
    GDRIVE_AVAILABLE = False

# ─── constants ────────────────────────────────────────────────────────────────
SUPPORTED_EXTENSIONS = {".mp4", ".mp3", ".m4a", ".wav", ".mkv", ".mov"}
CACHE_DIR_NAME = ".clip_cache"
CLIPS_DIR_NAME = "social_clips"
SUMMARY_FILENAME = "clips_summary.json"

# Filler words that dilute content density
FILLER_WORDS = {
    "um", "uh", "like", "you know", "basically", "literally", "actually",
    "so", "right", "okay", "just", "kind of", "sort of", "i mean",
    "you see", "well", "anyway", "honestly",
}

# High-signal words that boost clip scores
VALUE_WORDS = {
    "because", "therefore", "result", "solution", "problem", "key",
    "important", "critical", "insight", "strategy", "exactly", "never",
    "always", "mistake", "lesson", "tip", "framework", "principle",
    "data", "proof", "evidence", "discovered", "realized", "billion",
    "million", "percent", "growth", "revenue", "customer", "revenue",
    "convert", "close", "deal", "pipeline", "metric", "roi",
}

TARGET_LUFS = -14  # standard for social media platforms


# ─── data structures ──────────────────────────────────────────────────────────

@dataclass
class WordToken:
    word: str
    start: float  # seconds
    end: float    # seconds

    @property
    def duration(self) -> float:
        return self.end - self.start


@dataclass
class Segment:
    """A scored candidate clip window."""
    start: float
    end: float
    text: str
    score: float = 0.0
    caption: str = ""

    @property
    def duration(self) -> float:
        return self.end - self.start

    def start_ts(self) -> str:
        return _format_ts(self.start)

    def end_ts(self) -> str:
        return _format_ts(self.end)


@dataclass
class ClipResult:
    """Final output record for one extracted clip."""
    source_file: str
    rank: int
    start: float
    end: float
    duration: float
    transcript_excerpt: str
    suggested_caption: str
    output_file: str
    score: float
    drive_file_id: str = ""   # populated after Google Drive upload
    drive_link: str = ""      # shareable "anyone with link" view URL


# ─── utilities ────────────────────────────────────────────────────────────────

def _format_ts(seconds: float) -> str:
    """Convert float seconds to HH:MM:SS.mmm string."""
    td = timedelta(seconds=seconds)
    total_s = int(td.total_seconds())
    ms = int((td.total_seconds() - total_s) * 1000)
    h, rem = divmod(total_s, 3600)
    m, s = divmod(rem, 60)
    return f"{h:02d}:{m:02d}:{s:02d}.{ms:03d}"


def _safe_filename(name: str) -> str:
    """Strip characters that are problematic in filenames."""
    return re.sub(r'[^\w\-_.]', '_', name)


def _file_hash(path: Path) -> str:
    """MD5 of first 2 MB + file size — fast identity check."""
    h = hashlib.md5()
    h.update(str(path.stat().st_size).encode())
    with open(path, "rb") as f:
        h.update(f.read(2 * 1024 * 1024))
    return h.hexdigest()


def _check_ffmpeg() -> None:
    """Die with a helpful message if ffmpeg is not on PATH."""
    result = subprocess.run(
        ["ffmpeg", "-version"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    if result.returncode != 0:
        sys.exit(
            "ERROR: ffmpeg not found. Install it and ensure it is on PATH.\n"
            "  macOS:   brew install ffmpeg\n"
            "  Ubuntu:  sudo apt install ffmpeg\n"
            "  Windows: https://ffmpeg.org/download.html"
        )


def _print_header(text: str) -> None:
    width = 72
    print("\n" + "─" * width)
    print(f"  {text}")
    print("─" * width)


# ─── 1. FILE DISCOVERY ────────────────────────────────────────────────────────

def discover_recordings(root: Path) -> list[Path]:
    """
    Recursively find all supported audio/video files under `root`.
    Skips the social_clips output directory to avoid re-processing outputs.
    """
    found: list[Path] = []
    skip_dirs = {CLIPS_DIR_NAME, CACHE_DIR_NAME}

    for dirpath, dirnames, filenames in os.walk(root):
        # Prune directories we should not descend into
        dirnames[:] = [d for d in dirnames if d not in skip_dirs]
        for fname in filenames:
            if Path(fname).suffix.lower() in SUPPORTED_EXTENSIONS:
                found.append(Path(dirpath) / fname)

    # Sort by modification time, newest first — most relevant recordings first
    found.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    return found


# ─── 2. TRANSCRIPTION ─────────────────────────────────────────────────────────

def _cache_path(media_file: Path, cache_dir: Path) -> Path:
    """Deterministic cache file path based on file hash."""
    fhash = _file_hash(media_file)
    return cache_dir / f"{fhash}.json"


def transcribe_file(
    media_file: Path,
    cache_dir: Path,
    model_name: str = "base",
    use_cache: bool = True,
) -> list[WordToken]:
    """
    Transcribe `media_file` using Whisper with word-level timestamps.
    Returns a flat list of WordToken objects.

    Caches the result to avoid re-processing on subsequent runs.
    """
    if not WHISPER_AVAILABLE:
        raise RuntimeError(
            "openai-whisper is not installed. Run: pip install openai-whisper"
        )

    cache_file = _cache_path(media_file, cache_dir)
    cache_dir.mkdir(parents=True, exist_ok=True)

    # ── cache hit ──
    if use_cache and cache_file.exists():
        print(f"    [cache] Loading transcript: {cache_file.name}")
        raw = json.loads(cache_file.read_text())
        return [WordToken(**w) for w in raw]

    # ── transcribe ──
    print(f"    [whisper:{model_name}] Transcribing {media_file.name} …")
    model = whisper.load_model(model_name)

    # word_timestamps=True gives per-word start/end times
    result = model.transcribe(
        str(media_file),
        word_timestamps=True,
        verbose=False,
    )

    tokens: list[WordToken] = []
    for seg in result.get("segments", []):
        for w in seg.get("words", []):
            word = w.get("word", "").strip()
            if word:
                tokens.append(
                    WordToken(
                        word=word,
                        start=float(w["start"]),
                        end=float(w["end"]),
                    )
                )

    # ── write cache ──
    cache_file.write_text(json.dumps([asdict(t) for t in tokens], indent=2))
    print(f"    [cache] Saved transcript → {cache_file.name}")
    return tokens


# ─── 3. VALUE-BASED CLIP DETECTION ───────────────────────────────────────────

def _words_to_text(tokens: list[WordToken]) -> str:
    return " ".join(t.word for t in tokens)


def _count_fillers(tokens: list[WordToken]) -> int:
    text = _words_to_text(tokens).lower()
    return sum(text.count(f) for f in FILLER_WORDS)


def _count_value_words(tokens: list[WordToken]) -> int:
    text = _words_to_text(tokens).lower()
    return sum(text.count(v) for v in VALUE_WORDS)


def _sentence_density(tokens: list[WordToken]) -> float:
    """
    Words-per-sentence ratio as a proxy for information density.
    More words per sentence (up to ~25) → higher density.
    """
    text = _words_to_text(tokens)
    sentences = re.split(r"[.!?]+", text)
    sentences = [s.strip() for s in sentences if s.strip()]
    if not sentences:
        return 0.0
    avg_words = len(tokens) / len(sentences)
    # Sweet spot: ~15-25 words/sentence.  Penalise extremes.
    return 1.0 - abs(avg_words - 20) / 40


def _crosstalk_penalty(tokens: list[WordToken]) -> float:
    """
    Detect rapid speaker switches by looking for very short word intervals.
    Many gaps < 0.3 s between words often signals interruptions or crosstalk.
    Returns a penalty in [0, 1] where 0 = lots of crosstalk.
    """
    if len(tokens) < 2:
        return 1.0
    gaps = [
        tokens[i + 1].start - tokens[i].end
        for i in range(len(tokens) - 1)
    ]
    short_gaps = sum(1 for g in gaps if 0 < g < 0.3)
    ratio = short_gaps / len(gaps)
    return 1.0 - min(ratio * 2, 1.0)  # scale so 50%+ short-gaps → 0


def _standalone_quality(tokens: list[WordToken]) -> float:
    """
    Reward segments that start with a complete sentence (capital letter,
    no dangling connector) and end with sentence-final punctuation.
    """
    if not tokens:
        return 0.0
    text = _words_to_text(tokens).strip()

    # Check clean start — first word should be capitalised and not a connector
    connectors = {"and", "but", "so", "or", "because", "however", "also"}
    first_word = tokens[0].word.lstrip().lower().rstrip(".,!?")
    if first_word in connectors:
        return 0.3  # partial penalty

    # Check clean ending
    ends_cleanly = text[-1] in ".!?"
    return 1.0 if ends_cleanly else 0.6


def score_segment_heuristic(tokens: list[WordToken]) -> float:
    """
    Combine multiple heuristic signals into a [0, 1] score.
    Higher → better candidate for a social clip.
    """
    if not tokens:
        return 0.0

    n = len(tokens)
    duration = tokens[-1].end - tokens[0].start
    if duration <= 0:
        return 0.0

    # Words-per-second: 2–3 wps is natural spoken density
    wps = n / duration
    wps_score = 1.0 - abs(wps - 2.5) / 3.0
    wps_score = max(0.0, min(1.0, wps_score))

    # Filler-word penalty
    filler_count = _count_fillers(tokens)
    filler_ratio = filler_count / max(n, 1)
    filler_score = max(0.0, 1.0 - filler_ratio * 3)

    # Value-word bonus
    value_count = _count_value_words(tokens)
    value_score = min(1.0, value_count / max(n / 10, 1))

    density_score = _sentence_density(tokens)
    crosstalk_score = _crosstalk_penalty(tokens)
    standalone_score = _standalone_quality(tokens)

    # Weighted combination — tweak weights to taste
    score = (
        0.20 * wps_score
        + 0.20 * filler_score
        + 0.20 * value_score
        + 0.15 * density_score
        + 0.15 * crosstalk_score
        + 0.10 * standalone_score
    )
    return round(score, 4)


def _find_sentence_boundary(
    tokens: list[WordToken],
    target_idx: int,
    direction: str = "forward",
    window: int = 15,
) -> int:
    """
    Snap `target_idx` to the nearest sentence boundary (punctuation) within
    `window` tokens in the given `direction` ('forward' or 'backward').
    Returns the adjusted index, or original if no boundary found.
    """
    punct = re.compile(r"[.!?]$")

    if direction == "forward":
        for i in range(target_idx, min(target_idx + window, len(tokens))):
            if punct.search(tokens[i].word):
                return i + 1  # include the punctuated word, then stop
    else:  # backward
        for i in range(target_idx, max(target_idx - window, -1), -1):
            if punct.search(tokens[i].word):
                return i + 1  # start AFTER the previous sentence end

    return target_idx


def build_candidate_segments(
    tokens: list[WordToken],
    min_dur: float,
    max_dur: float,
    stride_secs: float = 5.0,
) -> list[Segment]:
    """
    Slide a window across `tokens` to produce overlapping candidate segments.

    Strategy:
      - Step through the token list in `stride_secs` increments.
      - For each anchor, expand until we reach a segment in [min_dur, max_dur].
      - Snap both boundaries to sentence-final punctuation.
    """
    if not tokens:
        return []

    total_dur = tokens[-1].end - tokens[0].start
    if total_dur < min_dur:
        # File too short — treat the whole thing as one candidate
        text = _words_to_text(tokens)
        return [Segment(start=tokens[0].start, end=tokens[-1].end, text=text)]

    candidates: list[Segment] = []
    i = 0

    while i < len(tokens):
        anchor_time = tokens[i].start
        # Find end index so that duration >= min_dur
        j = i
        while j < len(tokens) and (tokens[j].end - anchor_time) < min_dur:
            j += 1

        if j >= len(tokens):
            break  # not enough tokens left for a full segment

        # Snap start backward to sentence boundary
        start_idx = _find_sentence_boundary(tokens, i, direction="backward")
        # Snap end forward to sentence boundary within max_dur
        end_idx = _find_sentence_boundary(tokens, j, direction="forward")

        # Clamp end so we don't exceed max_dur
        while (
            end_idx > start_idx
            and tokens[min(end_idx - 1, len(tokens) - 1)].end
            - tokens[start_idx].start
            > max_dur
        ):
            end_idx -= 1

        seg_tokens = tokens[start_idx:end_idx]
        if seg_tokens:
            seg_start = seg_tokens[0].start
            seg_end = seg_tokens[-1].end
            dur = seg_end - seg_start
            if min_dur <= dur <= max_dur + 10:  # slight tolerance on upper bound
                text = _words_to_text(seg_tokens)
                candidates.append(
                    Segment(start=seg_start, end=seg_end, text=text)
                )

        # Advance anchor by stride
        stride_tokens = max(1, int(stride_secs * len(tokens) / max(total_dur, 1)))
        i += stride_tokens

    return candidates


def _deduplicate_segments(segments: list[Segment], overlap_thresh: float = 0.5) -> list[Segment]:
    """
    Remove segments that heavily overlap with a higher-scored segment.
    Keeps the N best non-overlapping (or minimally-overlapping) clips.
    """
    segments = sorted(segments, key=lambda s: s.score, reverse=True)
    kept: list[Segment] = []

    for cand in segments:
        overlapping = False
        for k in kept:
            # Intersection-over-union style overlap check
            overlap_start = max(cand.start, k.start)
            overlap_end = min(cand.end, k.end)
            if overlap_end > overlap_start:
                overlap_dur = overlap_end - overlap_start
                min_dur = min(cand.duration, k.duration)
                if overlap_dur / min_dur > overlap_thresh:
                    overlapping = True
                    break
        if not overlapping:
            kept.append(cand)

    return kept


def score_with_claude(
    segments: list[Segment],
    source_name: str,
    api_key: str,
) -> list[Segment]:
    """
    Send top heuristic candidates to Claude for refined scoring and caption
    generation.  Updates segment.score and segment.caption in-place.

    Sends candidates in a single batched API call to minimise latency/cost.
    Falls back gracefully if the API call fails.
    """
    if not ANTHROPIC_AVAILABLE:
        print("    [claude] anthropic SDK not installed — skipping LLM scoring.")
        return segments

    client = anthropic.Anthropic(api_key=api_key)

    # Build a compact JSON payload so we stay within token limits
    payload = []
    for idx, seg in enumerate(segments):
        # Truncate very long transcripts to ~300 words for API efficiency
        words = seg.text.split()
        excerpt = " ".join(words[:300]) + ("…" if len(words) > 300 else "")
        payload.append(
            {
                "id": idx,
                "duration_secs": round(seg.duration, 1),
                "text": excerpt,
                "heuristic_score": seg.score,
            }
        )

    prompt = f"""You are evaluating transcript segments from a call recording called "{source_name}" for use as standalone social media video clips.

For each segment, assess:
1. Would this work as a self-contained, valuable social clip (0-10)?
2. Is the insight quotable and clear without context (0-10)?
3. Is the energy/conviction high (0-10)?

Combine into a final score 0-100.

Also write a punchy 1-2 sentence caption for each segment that would work on LinkedIn/Twitter.

Return ONLY valid JSON array, one object per segment, with keys:
  id, final_score, caption

Segments:
{json.dumps(payload, indent=2)}"""

    try:
        response = client.messages.create(
            model="claude-opus-4-6",
            max_tokens=2048,
            messages=[{"role": "user", "content": prompt}],
        )
        raw = response.content[0].text.strip()

        # Extract JSON array even if model wraps it in markdown
        json_match = re.search(r"\[.*\]", raw, re.DOTALL)
        if not json_match:
            raise ValueError("No JSON array found in Claude response")

        results = json.loads(json_match.group())
        for item in results:
            idx = item["id"]
            if 0 <= idx < len(segments):
                # Blend heuristic (30%) + LLM (70%) for final score
                llm_norm = float(item["final_score"]) / 100.0
                segments[idx].score = round(
                    0.30 * segments[idx].score + 0.70 * llm_norm, 4
                )
                segments[idx].caption = item.get("caption", "")

        print(f"    [claude] Scored {len(results)} segments via API.")

    except Exception as exc:
        print(f"    [claude] API call failed ({exc}); keeping heuristic scores.")

    return segments


def detect_clips(
    tokens: list[WordToken],
    min_dur: float,
    max_dur: float,
    top_n: int,
    use_claude: bool,
    source_name: str,
    api_key: Optional[str],
) -> list[Segment]:
    """
    Full pipeline: build candidates → score → optionally refine with Claude
    → deduplicate → return top_n.
    """
    print(f"    Building candidate segments (min={min_dur}s, max={max_dur}s)…")
    candidates = build_candidate_segments(tokens, min_dur, max_dur)
    print(f"    Found {len(candidates)} candidates.")

    if not candidates:
        return []

    # Heuristic scoring
    for seg in candidates:
        seg_tokens = [
            t for t in tokens if t.start >= seg.start and t.end <= seg.end + 0.1
        ]
        seg.score = score_segment_heuristic(seg_tokens)

    # Sort, keep top 10× top_n for LLM pass (limits API cost)
    candidates.sort(key=lambda s: s.score, reverse=True)
    pre_llm = candidates[: top_n * 10]

    # Optional Claude refinement
    if use_claude and api_key:
        print("    Sending top candidates to Claude for LLM scoring…")
        pre_llm = score_with_claude(pre_llm, source_name, api_key)
        pre_llm.sort(key=lambda s: s.score, reverse=True)

    # Deduplicate overlapping windows and take top_n
    unique = _deduplicate_segments(pre_llm)
    return unique[:top_n]


# ─── 4. CLIP EXTRACTION ───────────────────────────────────────────────────────

def _sanitize_start_label(start: float) -> str:
    """e.g. 75.3 → '1m15s'"""
    mins = int(start) // 60
    secs = int(start) % 60
    return f"{mins}m{secs:02d}s"


def extract_clip(
    source: Path,
    seg: Segment,
    rank: int,
    output_dir: Path,
    dry_run: bool = False,
) -> Optional[Path]:
    """
    Extract a clip using ffmpeg.

    Audio is:
      - Mixed down to stereo
      - Normalised to TARGET_LUFS (-14 LUFS) using the loudnorm filter
      - Encoded as AAC 192k

    Video is re-encoded with libx264 (fast preset, CRF 23) so the output
    is universally compatible with social platforms.

    Uses two-pass loudnorm: first pass measures the file, second pass applies
    the measured parameters — this gives more accurate LUFS targeting than
    single-pass.
    """
    stem = _safe_filename(source.stem)
    start_label = _sanitize_start_label(seg.start)
    out_name = f"{stem}_clip_{rank}_{start_label}.mp4"
    out_path = output_dir / out_name

    if dry_run:
        print(f"      [dry-run] Would extract → {out_path.name}")
        return out_path

    output_dir.mkdir(parents=True, exist_ok=True)

    duration = seg.end - seg.start

    # ── Pass 1: measure loudness ──────────────────────────────────────────────
    # loudnorm in print mode outputs a JSON block we parse to drive pass 2.
    measure_cmd = [
        "ffmpeg", "-y",
        "-ss", str(seg.start),
        "-t", str(duration),
        "-i", str(source),
        "-af", f"loudnorm=I={TARGET_LUFS}:TP=-1.5:LRA=11:print_format=json",
        "-f", "null", "-",
    ]

    loudnorm_params = {}
    try:
        proc = subprocess.run(
            measure_cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=300,
        )
        # ffmpeg writes loudnorm JSON to stderr
        stderr_text = proc.stderr.decode("utf-8", errors="replace")
        json_match = re.search(r"\{[^{}]+\}", stderr_text, re.DOTALL)
        if json_match:
            loudnorm_params = json.loads(json_match.group())
    except Exception as exc:
        print(f"      [warn] Loudnorm measure failed ({exc}); using single-pass.")

    # ── Pass 2: encode with measured parameters ───────────────────────────────
    if loudnorm_params:
        il = loudnorm_params.get("input_i", "-23")
        lra = loudnorm_params.get("input_lra", "7")
        tp = loudnorm_params.get("input_tp", "-2")
        offset = loudnorm_params.get("target_offset", "0")
        af = (
            f"loudnorm=I={TARGET_LUFS}:TP=-1.5:LRA=11:"
            f"measured_I={il}:measured_LRA={lra}:"
            f"measured_TP={tp}:measured_thresh={loudnorm_params.get('input_thresh', '-33')}:"
            f"offset={offset}:linear=true:print_format=none"
        )
    else:
        # Fallback: single-pass loudnorm
        af = f"loudnorm=I={TARGET_LUFS}:TP=-1.5:LRA=11:print_format=none"

    encode_cmd = [
        "ffmpeg", "-y",
        "-ss", str(seg.start),
        "-t", str(duration),
        "-i", str(source),
        "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",  # ensure even dimensions
        "-c:v", "libx264",
        "-preset", "fast",
        "-crf", "23",
        "-c:a", "aac",
        "-b:a", "192k",
        "-ac", "2",          # stereo
        "-af", af,
        "-movflags", "+faststart",  # optimise for web streaming
        str(out_path),
    ]

    try:
        result = subprocess.run(
            encode_cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=600,
        )
        if result.returncode != 0:
            err = result.stderr.decode("utf-8", errors="replace")[-500:]
            print(f"      [error] ffmpeg failed for {out_name}:\n{err}")
            return None
        print(f"      Extracted → {out_name}")
        return out_path

    except subprocess.TimeoutExpired:
        print(f"      [error] ffmpeg timed out for {out_name}")
        return None
    except Exception as exc:
        print(f"      [error] Unexpected error during extraction: {exc}")
        return None


# ─── 5. OUTPUT & SUMMARY ──────────────────────────────────────────────────────

def _generate_fallback_caption(seg: Segment) -> str:
    """
    Simple heuristic caption when Claude is not available.
    Takes the first ~20 words and wraps them as a quote.
    """
    words = seg.text.split()[:20]
    excerpt = " ".join(words)
    if len(words) == 20:
        excerpt += "…"
    return f'"{excerpt}"'


def write_summary(clips: list[ClipResult], output_dir: Path) -> Path:
    """Write clips_summary.json to output_dir."""
    summary_path = output_dir / SUMMARY_FILENAME
    data = {
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "total_clips": len(clips),
        "clips": [asdict(c) for c in clips],  # type: ignore[call-overload]
    }
    summary_path.write_text(json.dumps(data, indent=2))
    return summary_path


def print_summary(
    clips: list[ClipResult],
    summary_path: Path,
    drive_folder_link: Optional[str] = None,
) -> None:
    """Print a human-readable report to stdout."""
    _print_header(f"EXTRACTION COMPLETE — {len(clips)} clips produced")

    if drive_folder_link:
        print(f"\n  Google Drive folder: {drive_folder_link}")

    by_source: dict[str, list[ClipResult]] = {}
    for c in clips:
        by_source.setdefault(c.source_file, []).append(c)

    for source, source_clips in by_source.items():
        print(f"\n  Source: {Path(source).name}")
        for c in source_clips:
            print(f"\n    Clip #{c.rank}  |  {_format_ts(c.start)} → {_format_ts(c.end)}"
                  f"  ({c.duration:.1f}s)  score={c.score:.3f}")
            excerpt = textwrap.fill(c.transcript_excerpt[:200], width=68,
                                    initial_indent="      ", subsequent_indent="      ")
            print(excerpt)
            if c.suggested_caption:
                caption = textwrap.fill(
                    f"Caption: {c.suggested_caption}", width=68,
                    initial_indent="      ", subsequent_indent="             "
                )
                print(caption)
            print(f"      → {Path(c.output_file).name}")
            if c.drive_link:
                print(f"      Drive: {c.drive_link}")

    print(f"\n  Summary JSON: {summary_path}\n")


# ─── 6. GOOGLE DRIVE UPLOAD ──────────────────────────────────────────────────

# Drive API scope — drive.file lets us create/read only files the app creates,
# without requesting full Drive access.  This is the least-privilege choice.
_DRIVE_SCOPES = ["https://www.googleapis.com/auth/drive.file"]

# Where we persist the OAuth token between runs so the user only has to
# authenticate in their browser once.
_TOKEN_PATH = Path.home() / ".config" / "clip_extractor" / "gdrive_token.json"


def _get_drive_credentials(creds_file: Path) -> "Credentials":
    """
    Load existing OAuth2 token or run the browser-based consent flow.

    First run:  opens a browser tab for Google OAuth consent, then saves
                the resulting token to _TOKEN_PATH for future runs.
    Later runs: silently refreshes the token if it has expired.

    `creds_file` must be the OAuth 2.0 Client ID JSON downloaded from
    Google Cloud Console (APIs & Services → Credentials → Desktop app).
    """
    creds = None

    if _TOKEN_PATH.exists():
        creds = Credentials.from_authorized_user_file(str(_TOKEN_PATH), _DRIVE_SCOPES)

    # Refresh or run the full browser flow if needed
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            if not creds_file.exists():
                raise FileNotFoundError(
                    f"Google credentials file not found: {creds_file}\n"
                    "  Download it from: Google Cloud Console → APIs & Services\n"
                    "  → Credentials → Create Credentials → OAuth client ID\n"
                    "  → Application type: Desktop app → Download JSON"
                )
            flow = InstalledAppFlow.from_client_secrets_file(
                str(creds_file), _DRIVE_SCOPES
            )
            # run_local_server opens the user's browser; port=0 picks a free port
            creds = flow.run_local_server(port=0)

        # Persist token so future runs skip the browser step
        _TOKEN_PATH.parent.mkdir(parents=True, exist_ok=True)
        _TOKEN_PATH.write_text(creds.to_json())

    return creds


def _create_drive_folder(service, folder_name: str) -> str:
    """
    Create a new folder in the root of the user's Drive and return its ID.
    If a folder with the exact same name already exists (from a prior run
    on the same day) we reuse it rather than creating a duplicate.
    """
    # Check for existing folder with same name to avoid run-on-run duplicates
    query = (
        f"name='{folder_name}' and mimeType='application/vnd.google-apps.folder'"
        " and trashed=false"
    )
    existing = (
        service.files()
        .list(q=query, spaces="drive", fields="files(id,name)")
        .execute()
    )
    if existing.get("files"):
        folder_id = existing["files"][0]["id"]
        print(f"    [drive] Reusing existing folder: '{folder_name}' (id={folder_id})")
        return folder_id

    metadata = {
        "name": folder_name,
        "mimeType": "application/vnd.google-apps.folder",
    }
    folder = service.files().create(body=metadata, fields="id").execute()
    folder_id = folder["id"]
    print(f"    [drive] Created folder: '{folder_name}' (id={folder_id})")
    return folder_id


def _share_item_public(service, file_id: str) -> None:
    """Set 'anyone with the link can view' permission on a Drive file/folder."""
    service.permissions().create(
        fileId=file_id,
        body={"type": "anyone", "role": "reader"},
        fields="id",
    ).execute()


def _drive_view_link(file_id: str) -> str:
    return f"https://drive.google.com/file/d/{file_id}/view?usp=sharing"


def _drive_folder_link(folder_id: str) -> str:
    return f"https://drive.google.com/drive/folders/{folder_id}?usp=sharing"


def upload_clips_to_drive(
    clips: list["ClipResult"],
    creds_file: Path,
    folder_name: str,
) -> tuple[list["ClipResult"], str]:
    """
    Upload all extracted clips to a new (or same-day existing) Google Drive
    folder.  Updates each ClipResult's drive_file_id and drive_link in-place.

    Returns (updated_clips, folder_share_link).
    """
    if not GDRIVE_AVAILABLE:
        raise RuntimeError(
            "Google Drive libraries not installed.\n"
            "  pip install google-api-python-client google-auth-httplib2 "
            "google-auth-oauthlib"
        )

    _print_header("Uploading clips to Google Drive")

    print("  Authenticating with Google Drive…")
    creds = _get_drive_credentials(creds_file)
    service = gdrive_build("drive", "v3", credentials=creds)

    # Create (or reuse) a timestamped folder so each batch is organised
    folder_id = _create_drive_folder(service, folder_name)

    # Make the folder itself shareable so recipients can browse all clips
    _share_item_public(service, folder_id)
    folder_link = _drive_folder_link(folder_id)
    print(f"    [drive] Folder link: {folder_link}")

    for clip in clips:
        clip_path = Path(clip.output_file)
        if not clip_path.exists():
            print(f"    [warn] File not found, skipping upload: {clip_path.name}")
            continue

        size_mb = clip_path.stat().st_size / (1024 * 1024)
        print(f"    Uploading {clip_path.name}  ({size_mb:.1f} MB)…", end="", flush=True)

        file_metadata = {
            "name": clip_path.name,
            "parents": [folder_id],
        }
        media = MediaFileUpload(
            str(clip_path),
            mimetype="video/mp4",
            # resumable=True enables chunked upload — essential for large files.
            # The Drive client library handles retries automatically.
            resumable=True,
            chunksize=8 * 1024 * 1024,  # 8 MB chunks
        )

        try:
            uploaded = (
                service.files()
                .create(body=file_metadata, media_body=media, fields="id")
                .execute()
            )
            file_id = uploaded["id"]

            # Make each clip individually shareable (direct link for posting)
            _share_item_public(service, file_id)

            clip.drive_file_id = file_id
            clip.drive_link = _drive_view_link(file_id)
            print(f" done  →  {clip.drive_link}")

        except Exception as exc:
            print(f" FAILED ({exc})")

    return clips, folder_link


# ─── MAIN PIPELINE ────────────────────────────────────────────────────────────

def process_recording(
    media_file: Path,
    args: argparse.Namespace,
    output_dir: Path,
    cache_dir: Path,
    api_key: Optional[str],
) -> list[ClipResult]:
    """
    Run the full pipeline for one recording file.
    Returns a (possibly empty) list of ClipResult objects.
    """
    print(f"\n  Processing: {media_file.name}")

    # ── Transcribe ────────────────────────────────────────────────────────────
    try:
        tokens = transcribe_file(
            media_file,
            cache_dir,
            model_name=args.whisper_model,
            use_cache=not args.no_cache,
        )
    except Exception as exc:
        print(f"    [error] Transcription failed: {exc}")
        return []

    if not tokens:
        print("    [warn] Empty transcript — skipping.")
        return []

    total_dur = tokens[-1].end - tokens[0].start
    print(f"    Duration: {total_dur:.1f}s  |  Words: {len(tokens)}")

    # ── Detect clips ──────────────────────────────────────────────────────────
    top_segments = detect_clips(
        tokens,
        min_dur=args.min_duration,
        max_dur=args.max_duration,
        top_n=args.top,
        use_claude=args.use_claude,
        source_name=media_file.stem,
        api_key=api_key,
    )

    if not top_segments:
        print("    [warn] No suitable segments found.")
        return []

    print(f"    Selected {len(top_segments)} clip(s).")

    # ── Extract clips ─────────────────────────────────────────────────────────
    results: list[ClipResult] = []
    for rank, seg in enumerate(top_segments, start=1):
        # Generate caption if Claude didn't
        if not seg.caption:
            seg.caption = _generate_fallback_caption(seg)

        out_path = extract_clip(
            source=media_file,
            seg=seg,
            rank=rank,
            output_dir=output_dir,
            dry_run=args.dry_run,
        )
        if out_path is None:
            continue

        results.append(
            ClipResult(
                source_file=str(media_file),
                rank=rank,
                start=round(seg.start, 3),
                end=round(seg.end, 3),
                duration=round(seg.duration, 3),
                transcript_excerpt=seg.text[:500],
                suggested_caption=seg.caption,
                output_file=str(out_path),
                score=seg.score,
            )
        )

    return results


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Extract high-value social clips from call recordings.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument(
        "--input", "-i",
        type=Path,
        default=Path.home() / "Downloads",
        metavar="DIR",
        help="Directory to scan for recordings (default: ~/Downloads)",
    )
    parser.add_argument(
        "--output", "-o",
        type=Path,
        default=None,
        metavar="DIR",
        help="Output directory for clips (default: <input>/social_clips)",
    )
    parser.add_argument(
        "--top", "-n",
        type=int,
        default=3,
        metavar="N",
        help="Number of clips to extract per recording (default: 3)",
    )
    parser.add_argument(
        "--min-duration",
        type=float,
        default=30.0,
        metavar="SECS",
        help="Minimum clip duration in seconds (default: 30)",
    )
    parser.add_argument(
        "--max-duration",
        type=float,
        default=90.0,
        metavar="SECS",
        help="Maximum clip duration in seconds (default: 90)",
    )
    parser.add_argument(
        "--whisper-model",
        default="base",
        choices=["tiny", "base", "small", "medium", "large"],
        metavar="MODEL",
        help="Whisper model size (default: base). Larger = slower + more accurate.",
    )
    parser.add_argument(
        "--use-claude",
        action="store_true",
        help="Use Claude API to score and generate captions (needs ANTHROPIC_API_KEY)",
    )
    parser.add_argument(
        "--no-cache",
        action="store_true",
        help="Re-transcribe files even if a cached transcript exists",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Score and rank clips but skip ffmpeg extraction",
    )
    parser.add_argument(
        "--upload-drive",
        action="store_true",
        help="Upload extracted clips to a new Google Drive folder",
    )
    parser.add_argument(
        "--drive-creds",
        type=Path,
        default=Path.home() / "credentials.json",
        metavar="JSON",
        help=(
            "Path to Google OAuth2 Desktop client credentials JSON "
            "(default: ~/credentials.json). Download from Google Cloud Console."
        ),
    )
    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()

    # ── Validate input dir ────────────────────────────────────────────────────
    input_dir: Path = args.input.expanduser().resolve()
    if not input_dir.is_dir():
        sys.exit(f"ERROR: Input directory not found: {input_dir}")

    # ── Set up output dir ─────────────────────────────────────────────────────
    if args.output:
        output_dir: Path = args.output.expanduser().resolve()
    else:
        output_dir = input_dir / CLIPS_DIR_NAME
    output_dir.mkdir(parents=True, exist_ok=True)

    # ── Cache dir lives inside output dir ─────────────────────────────────────
    cache_dir = output_dir / CACHE_DIR_NAME

    # ── Dependency checks ─────────────────────────────────────────────────────
    if not args.dry_run:
        _check_ffmpeg()
    if not WHISPER_AVAILABLE:
        sys.exit(
            "ERROR: openai-whisper is not installed.\n"
            "  pip install openai-whisper"
        )

    # ── Claude API key ────────────────────────────────────────────────────────
    api_key: Optional[str] = None
    if args.use_claude:
        api_key = os.environ.get("ANTHROPIC_API_KEY")
        if not api_key:
            print(
                "WARNING: --use-claude specified but ANTHROPIC_API_KEY is not set.\n"
                "         Falling back to heuristic-only scoring."
            )
            args.use_claude = False
        elif not ANTHROPIC_AVAILABLE:
            print(
                "WARNING: --use-claude specified but 'anthropic' package is not installed.\n"
                "         pip install anthropic\n"
                "         Falling back to heuristic-only scoring."
            )
            args.use_claude = False

    # ── Discover recordings ───────────────────────────────────────────────────
    _print_header(f"Scanning {input_dir}")
    recordings = discover_recordings(input_dir)

    if not recordings:
        print("  No supported recordings found. Exiting.")
        return

    print(f"  Found {len(recordings)} recording(s):\n")
    for r in recordings:
        size_mb = r.stat().st_size / (1024 * 1024)
        print(f"    {r.name}  ({size_mb:.1f} MB)")

    # ── Process each recording ────────────────────────────────────────────────
    _print_header("Processing recordings")
    all_clips: list[ClipResult] = []

    for media_file in recordings:
        try:
            clips = process_recording(
                media_file=media_file,
                args=args,
                output_dir=output_dir,
                cache_dir=cache_dir,
                api_key=api_key,
            )
            all_clips.extend(clips)
        except KeyboardInterrupt:
            print("\n  Interrupted by user.")
            break
        except Exception as exc:
            print(f"  [error] Failed to process {media_file.name}: {exc}")
            continue

    # ── Google Drive upload ───────────────────────────────────────────────────
    folder_link: Optional[str] = None
    if all_clips and args.upload_drive and not args.dry_run:
        if not GDRIVE_AVAILABLE:
            print(
                "\nWARNING: --upload-drive requires Google Drive libraries:\n"
                "  pip install google-api-python-client google-auth-httplib2 "
                "google-auth-oauthlib\n"
                "  Skipping upload."
            )
        else:
            creds_file: Path = args.drive_creds.expanduser().resolve()
            # Folder name: "Social Clips - YYYY-MM-DD" so each day's batch is grouped
            folder_name = f"Social Clips - {datetime.utcnow().strftime('%Y-%m-%d')}"
            try:
                all_clips, folder_link = upload_clips_to_drive(
                    all_clips, creds_file, folder_name
                )
            except Exception as exc:
                print(f"\n  [error] Google Drive upload failed: {exc}")

    # ── Write summary ─────────────────────────────────────────────────────────
    if all_clips:
        summary_path = write_summary(all_clips, output_dir)
        print_summary(all_clips, summary_path, folder_link)
    else:
        print("\n  No clips were produced.")


if __name__ == "__main__":
    main()
