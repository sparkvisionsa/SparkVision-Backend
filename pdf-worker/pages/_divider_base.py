from __future__ import annotations


def render_divider(
    page_number: int,
    chapter_number: str,
    heading_ar: str,
    heading_en: str,
    subtext: str,
    wm_number: str,
) -> str:
    return f"""
<div class="section-divider">
    <div class="sd-bg-gradient"></div>
    <div class="sd-dots"></div>
    <div class="sd-left-strip"></div>
    <div class="sd-accent-bar"></div>
    <div class="sd-watermark-number">{wm_number}</div>
    <div class="sd-diamond" style="left:14mm;top:50%;transform:translateY(-50%) rotate(45deg);">
        <div class="sd-diamond-inner"></div>
        <div class="sd-diamond-dot"></div>
    </div>
    <div class="sd-header">
        <div class="sd-page-badge">PAGE {page_number:02d}</div>
        <div class="sd-brand">
            <div class="sd-brand-text">
                <div class="sd-brand-ar">تقدير</div>
                <div class="sd-brand-en">Taqdeer</div>
            </div>
            <div class="sd-brand-mark"></div>
        </div>
    </div>
    <div class="sd-rule" style="right:28mm;left:35mm;top:calc(50% - 30mm);"></div>
    <div class="sd-rule" style="right:28mm;left:45mm;top:calc(50% + 28mm);"></div>
    <div class="sd-content">
        <div class="sd-chapter-label">{chapter_number}</div>
        <div class="sd-chapter-divider"></div>
        <div class="sd-heading">{heading_ar}</div>
        <div class="sd-heading-en">{heading_en}</div>
        <div class="sd-subtext">{subtext}</div>
    </div>
    <div class="sd-footer">
        <span>taqdeer.sa</span>
        <span>info@taqdeer.sa</span>
        <span>920000694</span>
    </div>
</div>
"""
