from __future__ import annotations

from pages._divider_base import render_divider


def render(data: dict) -> str:
    return render_divider(
        page_number=11,
        chapter_number="CHAPTER 03",
        heading_ar="أسلوب التقييم",
        heading_en="Valuation Methodology",
        subtext="المنهجية والأدوات المعتمدة في إعداد هذا التقرير",
        wm_number="١",
    )
