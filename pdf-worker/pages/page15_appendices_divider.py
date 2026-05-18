from __future__ import annotations

from pages._divider_base import render_divider


def render(data: dict) -> str:
    return render_divider(
        page_number=15,
        chapter_number="CHAPTER 05",
        heading_ar="الملحقات",
        heading_en="Appendices",
        subtext="المستندات والوثائق الداعمة للتقرير",
        wm_number="٥",
    )
