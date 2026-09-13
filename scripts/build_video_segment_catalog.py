#!/usr/bin/env python3
"""Build the production recording-section catalog from reviewed curriculum notes.

The alumni manifest and Lance curriculum documents already contain transcript-
reviewed teaching ranges. This script converts those ranges to structured data,
snaps their edges to real caption cues, and gives single-topic videos one exact
first-spoken-cue to final-spoken-cue range.
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from urllib.parse import parse_qs, urlparse


TIME = r"(?:\d+:)?\d{1,2}:\d{2}"
RANGE = re.compile(rf"({TIME})\s*[–-]\s*({TIME})")
VIMEO_DURATIONS = {"841388530": 328, "841390794": 529, "841396051": 372}


def seconds(value: str) -> int:
    parts = [int(part) for part in value.split(":")]
    if len(parts) == 2:
        return parts[0] * 60 + parts[1]
    if len(parts) == 3:
        return parts[0] * 3600 + parts[1] * 60 + parts[2]
    raise ValueError(f"Unsupported timestamp: {value}")


def source_id(url: str | None) -> str:
    if not url:
        return ""
    parsed = urlparse(url)
    host = parsed.netloc.lower()
    if "youtu" in host:
        if "youtu.be" in host:
            return parsed.path.strip("/").split("/")[0]
        return parse_qs(parsed.query).get("v", [""])[0] or parsed.path.strip("/").split("/")[-1]
    if "vimeo" in host:
        return next((part for part in parsed.path.split("/") if part.isdigit()), "")
    return ""


def load_cues(captions_dir: Path, video_id: str) -> list[tuple[float, float]]:
    candidates = [captions_dir / f"{video_id}.en-orig.json3", captions_dir / f"{video_id}.en.json3"]
    path = next((candidate for candidate in candidates if candidate.exists()), None)
    if not path:
        return []
    data = json.loads(path.read_text())
    cues: list[tuple[float, float]] = []
    for event in data.get("events", []):
        text = "".join(segment.get("utf8", "") for segment in event.get("segs", [])).strip()
        if not text or "music" in text.lower() and len(text) < 12:
            continue
        start = float(event.get("tStartMs", 0)) / 1000
        duration = float(event.get("dDurationMs", 0)) / 1000
        cues.append((start, start + max(duration, 0.1)))
    return cues


def duration_for(captions_dir: Path, video_id: str, cues: list[tuple[float, float]]) -> int:
    info = captions_dir / f"{video_id}.info.json"
    if info.exists():
        duration = json.loads(info.read_text()).get("duration")
        if duration:
            return max(1, round(float(duration)))
    if video_id in VIMEO_DURATIONS:
        return VIMEO_DURATIONS[video_id]
    return max(1, round(cues[-1][1])) if cues else 1


def snap_start(value: int, cues: list[tuple[float, float]]) -> int:
    if not cues:
        return value
    nearby = [cue[0] for cue in cues if abs(cue[0] - value) <= 20]
    return max(0, round(min(nearby, key=lambda cue: abs(cue - value)))) if nearby else value


def snap_end(value: int, cues: list[tuple[float, float]], duration: int) -> int:
    if not cues:
        return min(value, duration)
    nearby = [cue[1] for cue in cues if abs(cue[1] - value) <= 20]
    snapped = round(min(nearby, key=lambda cue: abs(cue - value))) if nearby else value
    return min(duration, max(1, snapped))


def parse_alumni(path: Path) -> dict[int, list[dict]]:
    output: dict[int, list[dict]] = {}
    for chunk in re.split(r"(?m)^### ", path.read_text())[1:]:
        production = re.search(r"\*\*Production:\*\* \[lesson (\d+)\]", chunk)
        viewing = re.search(r"\*\*Recommended viewing\*\*\n\n(.*?)(?:\n\n\*\*|\n\n###|\Z)", chunk, re.S)
        if not production or not viewing:
            continue
        ranges = []
        for line in viewing.group(1).splitlines():
            match = re.match(rf"- ({TIME})\s*[–-]\s*({TIME}):\s*(.+)", line.strip())
            if match:
                ranges.append({"label": match.group(3).strip(), "start_seconds": seconds(match.group(1)), "end_seconds": seconds(match.group(2)), "required": False})
        if ranges:
            output[int(production.group(1))] = ranges
    return output


def parse_lance(paths: list[Path]) -> dict[str, list[dict]]:
    output: dict[str, list[dict]] = {}
    for path in paths:
        for chunk in re.split(r"(?m)^### Day \d+ — ", path.read_text())[1:]:
            heading = chunk.splitlines()[0].strip()
            match = re.match(r"(Required|Optional):\s*(.+)", heading)
            recording = re.search(r"\*\*Recording:\*\* \[[^]]+\]\((https?://[^)]+)\),\s*([^\n]+)", chunk)
            if not match or not recording or recording.group(2).startswith("no additional"):
                continue
            required = match.group(1) == "Required"
            title = match.group(2).strip()
            found = RANGE.findall(recording.group(2))
            ranges = []
            for index, (start, end) in enumerate(found):
                label = title if len(found) == 1 else f"{title} · Part {index + 1}"
                ranges.append({"label": label, "start_seconds": seconds(start), "end_seconds": seconds(end), "required": required})
            if ranges:
                output[title.lower()] = ranges
    return output


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--inventory", type=Path, required=True)
    parser.add_argument("--alumni-manifest", type=Path, required=True)
    parser.add_argument("--lance", type=Path, action="append", default=[])
    parser.add_argument("--captions-dir", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    inventory = json.loads(args.inventory.read_text())
    alumni = parse_alumni(args.alumni_manifest)
    lance = parse_lance(args.lance)
    catalog = []
    for block in inventory:
        video_id = source_id(block.get("video_url"))
        cues = load_cues(args.captions_dir, video_id)
        duration = duration_for(args.captions_dir, video_id, cues)
        ranges = alumni.get(int(block["lesson_id"])) if int(block["curriculum_id"]) == 2 else lance.get(block["lesson"].lower())
        if ranges:
            segments = []
            for raw in ranges:
                start = snap_start(raw["start_seconds"], cues)
                end = snap_end(raw["end_seconds"], cues, duration)
                if end <= start:
                    end = min(duration, start + 1)
                segments.append({**raw, "start_seconds": start, "end_seconds": end})
            review_method = "transcript_range_caption_boundary"
        else:
            start = round(cues[0][0]) if cues else 0
            end = min(duration, round(cues[-1][1])) if cues else duration
            segments = [{"label": block["lesson"], "start_seconds": start, "end_seconds": max(start + 1, end), "required": bool(block["lesson_required"]) if int(block["curriculum_id"]) == 1 else False}]
            review_method = "single_topic_caption_bounds" if cues else "source_duration"
        catalog.append({
            "curriculum_id": int(block["curriculum_id"]),
            "lesson_id": int(block["lesson_id"]),
            "lesson_title": block["lesson"],
            "content_block_id": int(block["block_id"]),
            "source_id": video_id,
            "review_method": review_method,
            "video_segments": segments,
        })

    block_ids = [entry["content_block_id"] for entry in catalog]
    if len(catalog) != len(inventory) or len(block_ids) != len(set(block_ids)):
        raise SystemExit("Catalog does not map every video block exactly once")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(catalog, indent=2) + "\n")
    print(f"Wrote {len(catalog)} recording blocks and {sum(len(item['video_segments']) for item in catalog)} sections")


if __name__ == "__main__":
    main()
