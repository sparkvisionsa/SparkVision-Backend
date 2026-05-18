from __future__ import annotations


def render(data: dict) -> str:
    tx = data.get("tx", {})
    ev = data.get("ev", {})
    label_maps = data.get("labelMaps", {})

    # ── Dynamic fields from DB ─────────────────────────────────────────────────
    report_number = tx.get("assignmentNumber") or "—"
    valuation_date = ev.get("evalDate") or "—"
    client_name = ev.get("clientName") or "—"
    city_name = ev.get("cityName") or ""
    neighborhood = ev.get("neighborhoodName") or ""

    # Resolve property type label from labelMaps
    property_type_id = ev.get("propertyTypeId") or tx.get("propertyTypeId") or ""
    property_type_label = (
        label_maps.get("propertyTypes", {}).get(property_type_id, "")
        if property_type_id
        else ""
    )

    # Build property description from available parts
    location_parts = [p for p in [neighborhood, city_name] if p]
    location_str = "، ".join(location_parts)  # e.g. "حي الزلفي، الزلفي"
    if property_type_label and location_str:
        property_desc = f"تقييم {property_type_label} في {location_str}"
    elif property_type_label:
        property_desc = f"تقييم {property_type_label}"
    elif location_str:
        property_desc = f"تقييم عقار في {location_str}"
    else:
        property_desc = "تقييم عقاري"

    # ── Static / not-yet-integrated fields ────────────────────────────────────
    # TODO: pull from Company model once integrated
    activities_label = "الأنشطة العقارية"  # static — comes from client/company profile

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
            <span class="value">{activities_label}</span>
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
