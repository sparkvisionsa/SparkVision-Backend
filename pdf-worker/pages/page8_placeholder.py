from __future__ import annotations

from pages._divider_base import render_divider


def render(data: dict) -> str:
    return render_divider(
        page_number=8,
        chapter_number="CHAPTER 02",
        heading_ar="تفاصيل العقار",
        heading_en="Property Details",
        subtext="الخصائص والمواصفات التفصيلية للعقار موضع التقييم",
        wm_number="٢",
    )
