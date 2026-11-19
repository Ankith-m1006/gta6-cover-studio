"""Scales an image down to fit inside max_w x max_h (never up) and saves it as a JPEG of at most 256 KiB.

python tools/fit_image.py <src> <dest.jpg> <max_w> <max_h>

Lanczos resampling, then the highest JPEG quality that keeps the file under the screenshot gate's 256 KiB.
"""
import io
import sys

from PIL import Image

LIMIT = 256 * 1024 - 2048


def main() -> None:
    src, dest, max_w, max_h = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4])
    img = Image.open(src).convert("RGB")
    scale = min(1.0, max_w / img.width, max_h / img.height)
    if scale < 1:
        img = img.resize((round(img.width * scale), round(img.height * scale)), Image.LANCZOS)
    for quality in range(94, 40, -3):
        buf = io.BytesIO()
        img.save(buf, "JPEG", quality=quality, optimize=True, subsampling=0 if quality >= 88 else 2)
        if buf.tell() <= LIMIT:
            break
    with open(dest, "wb") as f:
        f.write(buf.getvalue())
    print(f"{dest}: {img.width}x{img.height}, quality {quality}, {buf.tell() // 1024} KiB")


if __name__ == "__main__":
    main()
