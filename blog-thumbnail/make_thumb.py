#!/usr/bin/env python3
"""굿디 클린 블로그 대표 이미지(썸네일) 만들기.

형식 (샘플 4장 기준):
  - 정사각형 1080x1080, 사진은 가운데 기준으로 잘라 맞춤
  - 위쪽(높이 12% 지점부터) 가로 전체에 검정 반투명 띠
  - 띠 안에 흰색 굵은 제목 1~3줄 (검정 테두리 + 그림자), 가운데 정렬
  - 제목 아래 작은 글씨 '굿디 클린'

사용 예:
  python3 make_thumb.py 사진.jpg "LG 워시타워/세탁기 건조기 이동" -o out.jpg
  python3 make_thumb.py 사진.jpg "LG 통돌이 세탁기/분해세척" --band-top 0.19
제목 줄바꿈은 '/' 로 구분합니다.
"""
import argparse
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps

HERE = Path(__file__).resolve().parent
TITLE_FONT = HERE / "fonts" / "Pretendard-ExtraBold.otf"
SUB_FONT = HERE / "fonts" / "Pretendard-Bold.otf"

# 모든 수치는 한 변 길이(S)에 대한 비율
BAND_ALPHA = 120          # 띠 불투명도 (0~255), 약 47%
TITLE_SIZE = 0.093        # 제목 글자 크기
TITLE_GAP = 0.114         # 제목 줄 간격 (중심-중심)
SUB_SIZE = 0.046          # '굿디 클린' 글자 크기
PAD_TOP = 0.102           # 띠 위끝 ~ 제목 첫 줄 중심
SUB_GAP = 0.128           # 제목 마지막 줄 중심 ~ 부제 중심
PAD_BOTTOM = 0.066        # 부제 중심 ~ 띠 아래끝
MAX_TEXT_W = 0.88         # 글자가 이 폭을 넘으면 자동으로 줄임


def square(img, size, crop_y=0.5):
    img = ImageOps.exif_transpose(img).convert("RGB")
    return ImageOps.fit(img, (size, size), Image.LANCZOS, centering=(0.5, crop_y))


def fit_font(path, size, lines, max_w):
    font = ImageFont.truetype(str(path), size)
    widest = max(font.getlength(t) for t in lines)
    if widest > max_w:
        font = ImageFont.truetype(str(path), int(size * max_w / widest))
    return font


def draw_text(base, text, font, cx, cy, stroke, shadow):
    """흰 글씨 + 검정 테두리 + 아래오른쪽 흐린 그림자."""
    sh = Image.new("RGBA", base.size, (0, 0, 0, 0))
    ImageDraw.Draw(sh).text((cx + shadow, cy + shadow), text, font=font, anchor="mm",
                            fill=(0, 0, 0, 170), stroke_width=stroke, stroke_fill=(0, 0, 0, 170))
    base.alpha_composite(sh.filter(ImageFilter.GaussianBlur(shadow * 0.8)))
    ImageDraw.Draw(base).text((cx, cy), text, font=font, anchor="mm", fill="white",
                              stroke_width=stroke, stroke_fill=(20, 20, 20))


def make(photo, title, out, subtitle="굿디 클린", band_top=0.12, size=1080, crop_y=0.5):
    S = size
    lines = [t.strip() for t in title.replace("\\n", "/").split("/") if t.strip()]
    img = square(Image.open(photo), S, crop_y).convert("RGBA")

    top = int(S * band_top)
    first = top + S * PAD_TOP
    sub_y = first + S * TITLE_GAP * (len(lines) - 1) + S * SUB_GAP
    bottom = int(sub_y + S * PAD_BOTTOM) if subtitle else int(first + S * TITLE_GAP * (len(lines) - 1) + S * 0.095)

    band = Image.new("RGBA", img.size, (0, 0, 0, 0))
    ImageDraw.Draw(band).rectangle([0, top, S, bottom], fill=(0, 0, 0, BAND_ALPHA))
    img.alpha_composite(band)

    tfont = fit_font(TITLE_FONT, int(S * TITLE_SIZE), lines, S * MAX_TEXT_W)
    for i, t in enumerate(lines):
        draw_text(img, t, tfont, S / 2, first + S * TITLE_GAP * i,
                  stroke=max(2, round(S * 0.0045)), shadow=max(2, round(S * 0.005)))
    if subtitle:
        sfont = fit_font(SUB_FONT, int(S * SUB_SIZE), [subtitle], S * MAX_TEXT_W)
        draw_text(img, subtitle, sfont, S / 2, sub_y,
                  stroke=max(1, round(S * 0.0028)), shadow=max(2, round(S * 0.004)))

    out = Path(out)
    out.parent.mkdir(parents=True, exist_ok=True)
    rgb = img.convert("RGB")
    if out.suffix.lower() in (".jpg", ".jpeg"):
        rgb.save(out, quality=92, subsampling=0)
    else:
        rgb.save(out)
    return out


def main():
    p = argparse.ArgumentParser(description="굿디 클린 블로그 썸네일 만들기")
    p.add_argument("photo", help="원본 사진")
    p.add_argument("title", help="제목, 줄바꿈은 '/' (예: 'LG 워시타워/세탁기 건조기 이동')")
    p.add_argument("-o", "--out", default="thumb.jpg", help="저장할 파일 (기본 thumb.jpg)")
    p.add_argument("--sub", default="굿디 클린", help="아래 작은 글씨 (기본 '굿디 클린', 빈 값이면 생략)")
    p.add_argument("--band-top", type=float, default=0.12,
                   help="띠 시작 높이 비율 (기본 0.12, 제품이 가려지면 0.05~0.5 사이로 조정)")
    p.add_argument("--crop-y", type=float, default=0.5,
                   help="세로 사진 자를 위치: 0=위쪽 살림, 0.5=가운데(기본), 1=아래쪽 살림")
    p.add_argument("--size", type=int, default=1080, help="한 변 픽셀 (기본 1080)")
    a = p.parse_args()
    print(make(a.photo, a.title, a.out, a.sub, a.band_top, a.size, a.crop_y))


if __name__ == "__main__":
    main()
