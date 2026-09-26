"""Render original dialogue as reproducible OCR fixtures; no manga artwork or network needed."""
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
DIRECTORY = ROOT / "benchmarks" / "casual-japanese"
FONT = Path("C:/Windows/Fonts/YuGothR.ttc")


def vertical(draw, text, center, top, size, ruby):
    font = ImageFont.truetype(str(FONT), size)
    small = ImageFont.truetype(str(FONT), 12)
    columns = [text[i:i + 12] for i in range(0, len(text), 12)]
    advance = size + 5
    gap = size + 22
    start = center + (len(columns) - 1) * gap / 2
    for col, column in enumerate(columns):
        x = start - col * gap
        for row, char in enumerate(column):
            y = top + row * advance
            if char in "、。":
                draw.text((x + size / 2, y - size / 2), char, font=font, fill=18)
            elif char == "…":
                for offset in [7, 15, 23]:
                    draw.ellipse((x + 13, y + offset, x + 15, y + offset + 2), fill=18)
            else:
                draw.text((x, y), char, font=font, fill=18)
            if char in ruby:
                for r, kana in enumerate(ruby[char]):
                    draw.text((x + size + 3, y + r * 14), kana, font=small, fill=18)


def render(case):
    canvas = Image.new("L", (760, 560), 239)
    draw = ImageDraw.Draw(canvas)
    # A simple panel and quiet screen-tone outside the white speech balloons.
    for y in range(6, 560, 9):
        for x in range(6 + (y % 2) * 4, 760, 9):
            draw.point((x, y), fill=192)
    draw.rectangle((5, 5, 754, 554), outline=28, width=3)
    lines = case["japanese"].split("\n")
    size = case.get("font_size", 28)
    if case["layout"] == "vertical":
        for line, cx in zip(lines, [566, 190]):
            draw.ellipse((cx - 165, 20, cx + 165, 535), fill=255, outline=28, width=2)
            vertical(draw, line, cx - size / 2, 58, size, case.get("ruby", {}))
    else:
        font = ImageFont.truetype(str(FONT), size)
        for line, y in zip(lines, [45, 302]):
            draw.rounded_rectangle((28, y, 732, y + 202), radius=72, fill=255, outline=28, width=2)
            for n, start in enumerate(range(0, len(line), 20)):
                draw.text((83, y + 46 + n * 45), line[start:start + 20], font=font, fill=18)
    target = DIRECTORY / case["image"]
    target.parent.mkdir(parents=True, exist_ok=True)
    canvas.convert("RGB").save(target)
    return canvas


def main():
    cases = json.loads((DIRECTORY / "cases.json").read_text(encoding="utf-8"))
    sheet = Image.new("RGB", (760 * 2, 600 * 4), "white")
    for i, case in enumerate(cases):
        canvas = render(case)
        x, y = (i % 2) * 760, (i // 2) * 600
        sheet.paste(canvas, (x, y + 32))
        ImageDraw.Draw(sheet).text((x + 10, y + 8), case["id"], fill="black")
    sheet.save(DIRECTORY / "contact-sheet.png")
    print(f"Rendered {len(cases)} original dialogue crops in {DIRECTORY}")


if __name__ == "__main__":
    main()
