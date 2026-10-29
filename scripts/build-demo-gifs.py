#!/usr/bin/env python3
"""Encode real UI screenshots into compact GIFs (requires Pillow).

Usage: python scripts/build-demo-gifs.py path/to/manifest.json

Manifest paths are relative to the manifest file. Example:
{
  "width": 1120,
  "outputs": [{
    "output": "../../docs/demo/schema-exploration.gif",
    "frames": [{"path": "schema-01.png", "duration": 1800}]
  }]
}

Durations are milliseconds. Frames are resized proportionally, without cropping,
overlays, or generated UI. Exact duplicate frames are combined by the encoder.
"""

import argparse
import io
import json
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageOps


def load_frames(base, specs):
    frames, durations = [], []
    for spec in specs:
        path = (base / spec["path"]).resolve()
        with Image.open(path) as source:
            source = ImageOps.exif_transpose(source).convert("RGBA")
            background = Image.new("RGBA", source.size, "white")
            background.alpha_composite(source)
            frame = background.convert("RGB")
        if frames and frame.size != frames[0].size:
            raise ValueError(f"All frames must share a viewport size: {path}")
        duration = int(spec.get("duration", 1400))
        if duration < 20:
            raise ValueError(f"Frame duration must be at least 20 ms: {path}")
        frames.append(frame)
        # GIF stores delay in hundredths of a second.
        durations.append(round(duration / 10) * 10)
    if not frames:
        raise ValueError("A recording must contain at least one frame")
    return frames, durations


def encode(frames, durations, width, colors):
    target_width = min(width, frames[0].width)
    target_height = round(frames[0].height * target_width / frames[0].width)
    scaled = [frame.resize((target_width, target_height), Image.Resampling.LANCZOS) for frame in frames]

    # One palette for the entire clip avoids color flicker between screenshots.
    sample_width = min(320, target_width)
    sample_height = max(1, round(target_height * sample_width / target_width))
    sample = Image.new("RGB", (sample_width, sample_height * len(scaled)), "white")
    for index, frame in enumerate(scaled):
        sample.paste(frame.resize((sample_width, sample_height)), (0, index * sample_height))
    # Mostly white screenshots can starve a median-cut palette of rare brand and
    # chart colors. Reserve a quarter of the palette for saturated UI pixels.
    accents = [pixel for pixel in sample.get_flattened_data() if max(pixel) - min(pixel) > 35]
    accent_count = colors // 4 if accents else 0
    common_count = colors - accent_count
    common = sample.quantize(colors=common_count, method=Image.Quantize.MEDIANCUT)
    palette_data = common.getpalette()[:common_count * 3]
    if accents:
        accent_sample = Image.new("RGB", (len(accents), 1))
        accent_sample.putdata(accents)
        accent_palette = accent_sample.quantize(colors=accent_count, method=Image.Quantize.MEDIANCUT)
        palette_data += accent_palette.getpalette()[:accent_count * 3]
    palette = Image.new("P", (1, 1))
    palette.putpalette(palette_data)
    indexed = [frame.quantize(palette=palette, dither=Image.Dither.NONE) for frame in scaled]

    stream = io.BytesIO()
    indexed[0].save(
        stream, format="GIF", save_all=True, append_images=indexed[1:],
        # Keep the shared palette unchanged; bounding-box deltas still compress
        # unchanged parts of the screen without remapping colors per frame.
        duration=durations, loop=0, optimize=False, disposal=1,
    )
    return stream.getvalue(), indexed


def save_contact_sheet(path, frames, durations):
    columns = min(4, len(frames))
    thumb_width = 280
    thumb_height = round(frames[0].height * thumb_width / frames[0].width)
    cell_height = thumb_height + 24
    sheet = Image.new("RGB", (columns * thumb_width, ((len(frames) + columns - 1) // columns) * cell_height), "#e7e5e4")
    draw = ImageDraw.Draw(sheet)
    for index, (frame, duration) in enumerate(zip(frames, durations)):
        x, y = (index % columns) * thumb_width, (index // columns) * cell_height
        sheet.paste(frame.resize((thumb_width, thumb_height), Image.Resampling.LANCZOS), (x, y))
        draw.text((x + 8, y + thumb_height + 5), f"{index + 1:02d} | {duration / 1000:.2f}s", fill="#292524")
    path.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(path)


def build_clip(base, clip, default_width, max_bytes):
    frames, durations = load_frames(base, clip["frames"])
    width = int(clip.get("width", default_width))
    if width < 320:
        raise ValueError("Recording width must be at least 320 pixels")

    # Try reducing palette before reducing resolution, preserving readable UI text.
    candidates = [(width, 256), (width, 192), (width, 128), (round(width * 0.9), 128), (round(width * 0.8), 128)]
    for target_width, colors in candidates:
        data, indexed = encode(frames, durations, target_width, colors)
        if len(data) <= max_bytes:
            break
    else:
        raise ValueError(f"GIF exceeds {max_bytes / 1024**2:.1f} MiB; shorten the recording or remove redundant captures")

    # Decode the completed animation before saving; timing survives deduplication.
    with Image.open(io.BytesIO(data)) as verification:
        decoded_duration = 0
        source_duration, source_index = 0, 0
        for index in range(verification.n_frames):
            verification.seek(index)
            verification.load()
            decoded_duration += verification.info.get("duration", 0)
            decoded = verification.convert("RGB")
            while source_index < len(indexed) and source_duration < decoded_duration:
                if ImageChops.difference(decoded, indexed[source_index].convert("RGB")).getbbox():
                    raise ValueError("Encoded GIF contains a palette or disposal artifact")
                source_duration += durations[source_index]
                source_index += 1
            if source_duration != decoded_duration:
                raise ValueError("Encoded GIF frame boundaries do not match the source timing")
        if decoded_duration != sum(durations):
            raise ValueError("Encoded GIF timing does not match the source manifest")
        result = {
            "output": clip["output"], "width": verification.width,
            "height": verification.height, "frames": verification.n_frames,
            "duration_ms": decoded_duration, "bytes": len(data), "palette_colors": colors,
        }

    output = (base / clip["output"]).resolve()
    if output.suffix.lower() != ".gif":
        raise ValueError("Output must use a .gif extension")
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(data)
    if clip.get("contact_sheet"):
        save_contact_sheet((base / clip["contact_sheet"]).resolve(), frames, durations)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("manifest", type=Path)
    parser.add_argument("--max-mb", type=float, default=6, help="Maximum output size per clip in MiB (default: 6)")
    args = parser.parse_args()
    if args.max_mb <= 0:
        parser.error("--max-mb must be positive")
    manifest = args.manifest.resolve()
    settings = json.loads(manifest.read_text(encoding="utf-8-sig"))
    outputs = settings.get("outputs", [])
    if not outputs:
        parser.error("Manifest must contain a nonempty outputs array")
    for clip in outputs:
        print(json.dumps(build_clip(manifest.parent, clip, int(settings.get("width", 1120)), int(args.max_mb * 1024**2)), ensure_ascii=False))


if __name__ == "__main__":
    main()
