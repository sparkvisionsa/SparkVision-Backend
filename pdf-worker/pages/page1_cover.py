def render(data: dict) -> str:
    tx = data.get("tx", {})
    ev = data.get("ev", {})

    report_number = tx.get("assignmentNumber") or "6299"
    valuation_date = ev.get("evalDate") or "2025-12-15"

    client_name = "شركة نجوم السلام للاستثمار والتطوير العقاري (شركة شخص واحد ذ.م.م)"
    city_name = ev.get("cityName") or "الرياض"

    property_desc = f"تقييم مجمع تجاري في مدينة {city_name}"

    return f"""
<div class="cover-page">

    <!-- Background Layers -->
    <div class="bg-gradient"></div>
    <div class="bg-overlay"></div>

    <!-- Decorative curves -->
    <div class="curve curve-1"></div>
    <div class="curve curve-2"></div>

    <!-- Header -->
    <div class="cover-header">
        <div class="brand">
            <div class="brand-icon"></div>

            <div class="brand-text">
                <div class="brand-ar">تقدير</div>
                <div class="brand-en">Taqdeer</div>
            </div>
        </div>
    </div>

    <!-- Hero Card -->
    <div class="hero-card">
        <div class="hero-overlay"></div>

        <div class="hero-grid"></div>
    </div>

    <!-- Floating Info Panel -->
    <div class="content-panel">

        <h1>تقرير تقييم عقاري</h1>

        <div class="content-item">
            <span class="label">العميل:</span>
            <span class="value">{client_name}</span>
        </div>

        <div class="content-item">
            <span class="label">الأنشطة:</span>
            <span class="value">الأنشطة العقارية</span>
        </div>

        <div class="content-item">
            <span class="label">الموضوع:</span>
            <span class="value">{property_desc}</span>
        </div>

        <div class="meta-row">

            <div class="meta-box">
                <div class="meta-label">رقم التقرير</div>
                <div class="meta-value">{report_number}</div>
            </div>

            <div class="meta-box">
                <div class="meta-label">تاريخ التقييم</div>
                <div class="meta-value">{valuation_date}</div>
            </div>

        </div>

    </div>

    <!-- Footer -->
    <div class="cover-footer">
        <span>920000694</span>
        <span>info@taqdeer.sa</span>
        <span>taqdeer.sa</span>
    </div>

</div>
"""
