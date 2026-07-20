#!/usr/bin/env python3
"""Smoke test: minimal docx with inline + spanning bookmarks."""
import base64
import io
import json
import re
import zipfile
from lxml import etree
from merge_docx import (
    ASSET_IMAGE_GAP_DXA,
    EMU_PER_INCH,
    IMAGE_CONTENT_WIDTH_RATIO,
    IMAGE_HORIZONTAL_MARGIN_DXA,
    IMAGE_PAGE_TITLE,
    IMAGES_PER_PAGE,
    IMAGES_PER_ROW,
    merge_package,
    validate_part_xml,
)

W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
WP_NS = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
PIC_NS = "http://schemas.openxmlformats.org/drawingml/2006/picture"
A_NS = "http://schemas.openxmlformats.org/drawingml/2006/main"
PNG_1X1 = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII="
)


def mojibake(text: str) -> str:
    return text.encode("utf-8").decode("cp1252")

DOCUMENT_XML = f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="{W_NS}" xmlns:r="{R_NS}">
  <w:body>
    <w:p>
      <w:r><w:t>العميل: </w:t></w:r>
      <w:r>
        <w:bookmarkStart w:id="0" w:name="عميل"/>
        <w:bookmarkEnd w:id="0"/>
      </w:r>
    </w:p>
    <w:p>
      <w:r><w:bookmarkStart w:id="16" w:name="عميلغلاف"/></w:r>
      <w:r><w:t>old cover client</w:t></w:r>
      <w:r><w:bookmarkEnd w:id="16"/></w:r>
    </w:p>
    <w:p>
      <w:r>
        <w:rPr>
          <w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/>
          <w:sz w:val="22"/>
          <w:szCs w:val="22"/>
        </w:rPr>
        <w:t>تم إعداد التقرير بعنوان </w:t>
      </w:r>
      <w:bookmarkStart w:id="17" w:name="عنوانغ"/>
      <w:bookmarkEnd w:id="17"/>
      <w:r>
        <w:rPr>
          <w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/>
          <w:sz w:val="22"/>
          <w:szCs w:val="22"/>
        </w:rPr>
        <w:t> وفق المعايير المعتمدة.</w:t>
      </w:r>
    </w:p>
    <w:p>
      <w:r>
        <w:rPr>
          <w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/>
          <w:sz w:val="22"/>
          <w:szCs w:val="22"/>
        </w:rPr>
        <w:t>العنوان الأصلي: </w:t>
      </w:r>
      <w:bookmarkStart w:id="18" w:name="عنواناصل"/>
      <w:r>
        <w:rPr>
          <w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/>
          <w:sz w:val="22"/>
          <w:szCs w:val="22"/>
        </w:rPr>
        <w:t>old original title</w:t>
      </w:r>
      <w:bookmarkEnd w:id="18"/>
      <w:r>
        <w:rPr>
          <w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/>
          <w:sz w:val="22"/>
          <w:szCs w:val="22"/>
        </w:rPr>
        <w:t>.</w:t>
      </w:r>
    </w:p>
    <w:p>
      <w:r><w:bookmarkStart w:id="1" w:name="تاريخاصدار"/></w:r>
      <w:r><w:t>placeholder</w:t></w:r>
      <w:r><w:bookmarkEnd w:id="1"/></w:r>
    </w:p>
    <w:p>
      <w:r><w:bookmarkStart w:id="8" w:name="تاريخاتفاقتاريخاصدار"/></w:r>
      <w:r><w:t>old agreement date</w:t></w:r>
      <w:r><w:bookmarkEnd w:id="8"/></w:r>
    </w:p>
    <w:p>
      <w:r><w:bookmarkStart w:id="9" w:name="تاريخ_التقييم"/></w:r>
      <w:r><w:t>old valuation date</w:t></w:r>
      <w:r><w:bookmarkEnd w:id="9"/></w:r>
    </w:p>
    <w:p>
      <w:r><w:bookmarkStart w:id="10" w:name="تاريخالمعاينة"/></w:r>
      <w:r><w:t>old inspection date</w:t></w:r>
      <w:r><w:bookmarkEnd w:id="10"/></w:r>
    </w:p>
    <w:p>
      <w:r><w:t>على أساس  في تاريخ التقييم </w:t></w:r>
    </w:p>
    <w:p>
      <w:r><w:t>تاريخ التقييم   م.</w:t></w:r>
    </w:p>
    <w:p>
      <w:r><w:t>تمت المعاينة في مدينة </w:t></w:r>
      <w:bookmarkStart w:id="12" w:name="موقع"/>
      <w:bookmarkEnd w:id="12"/>
      <w:r><w:t>، بتاريخ  </w:t></w:r>
      <w:bookmarkStart w:id="13" w:name="تاريختقييمت"/>
      <w:bookmarkEnd w:id="13"/>
      <w:r><w:t> </w:t></w:r>
      <w:bookmarkStart w:id="14" w:name="تاريخمعاين"/>
      <w:bookmarkEnd w:id="14"/>
      <w:r><w:t> م.</w:t></w:r>
    </w:p>
    <w:p>
      <w:bookmarkStart w:id="2" w:name="قيمةنهائية"/>
      <w:r><w:t>old value</w:t></w:r>
      <w:bookmarkEnd w:id="2"/>
    </w:p>
    <w:p>
      <w:bookmarkStart w:id="11" w:name="قيمة"/>
      <w:r><w:t>old short value</w:t></w:r>
      <w:bookmarkEnd w:id="11"/>
    </w:p>
    <w:p>
      <w:hyperlink r:id="rId1">
        <w:r><w:bookmarkStart w:id="3" w:name="موقع"/></w:r>
        <w:r><w:t>old hyperlink text</w:t></w:r>
        <w:r><w:bookmarkEnd w:id="3"/></w:r>
      </w:hyperlink>
    </w:p>
    <w:p>
      <w:r>
        <w:drawing>
          <w:txbxContent>
            <w:p>
              <w:r><w:bookmarkStart w:id="5" w:name="الغرض"/></w:r>
              <w:r><w:t>old textbox purpose</w:t></w:r>
              <w:r><w:bookmarkEnd w:id="5"/></w:r>
            </w:p>
            <w:p>
              <w:bookmarkStart w:id="7" w:name="عنوان"/>
              <w:bookmarkEnd w:id="7"/>
            </w:p>
          </w:txbxContent>
        </w:drawing>
      </w:r>
    </w:p>
    <w:p><w:r><w:drawing/></w:r></w:p>
    <w:p>
      <w:bookmarkStart w:id="4" w:name="صوراصول"/>
      <w:bookmarkEnd w:id="4"/>
    </w:p>
    <w:p>
      <w:bookmarkStart w:id="6" w:name="صورحسابات"/>
      <w:bookmarkEnd w:id="6"/>
    </w:p>
    <w:p>
      <w:pPr>
        <w:sectPr>
          <w:pgSz w:w="11906" w:h="16838"/>
          <w:pgMar w:top="1440" w:right="2127" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/>
        </w:sectPr>
      </w:pPr>
    </w:p>
    <w:p>
      <w:r><w:t>بعد الأخذ في الاعتبار جميع البيانات ذات الصلة والمبادئ المنصوص عليها، فإننا نرى أن رأي قيمة التصفية ( </w:t></w:r>
      <w:r><w:t>ر.س. ) </w:t></w:r>
      <w:bookmarkStart w:id="15" w:name="قيمةاحرف"/>
      <w:r><w:t>old words</w:t></w:r>
      <w:bookmarkEnd w:id="15"/>
      <w:r><w:t> لا غير</w:t></w:r>
    </w:p>
    <w:sectPr/>
  </w:body>
</w:document>"""

CONTENT_TYPES = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>"""

RELS = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>"""

DOC_RELS = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.test" TargetMode="External"/>
</Relationships>"""


def make_template() -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr(zipfile.ZipInfo("mimetype"), "application/vnd.openxmlformats-officedocument.wordprocessingml.document", compress_type=zipfile.ZIP_STORED)
        z.writestr("[Content_Types].xml", CONTENT_TYPES)
        z.writestr("_rels/.rels", RELS)
        z.writestr("word/document.xml", DOCUMENT_XML)
        z.writestr("word/_rels/document.xml.rels", DOC_RELS)
    return buf.getvalue()


def main() -> None:
    image_b64 = base64.b64encode(PNG_1X1).decode("ascii")
    valuation_basis = "القيمة السوقية"
    valuation_date = "14/06/2026"
    inspection_date = "04/06/2026"
    payload = {
        "templateBase64": base64.b64encode(make_template()).decode("ascii"),
        "textValues": {
            "clientName": "شركة الاختبار",
            "agreementDate": "27/06/2026",
            "reportIssueDate": "08/06/2026",
            "valuationDate": valuation_date,
            "inspectionDate": inspection_date,
            "valuationBasis": valuation_basis,
            "finalValue": "١٢٣ ر.س",
            "finalValueAmount": "١٢٠٬٠٠٠",
            "finalValueWords": "مائة وعشرون ألف ريال سعودي",
            "inspectionLocation": "الرياض",
            "valuationPurpose": "غرض اختبار داخل مربع نص",
            "reportTitle": mojibake("تقرير اختبار مباشر"),
        },
        "textByBookmarkName": {},
        "assetImagesBase64": [image_b64 for _ in range(12)],
        "valuationImagesBase64": [image_b64 for _ in range(4)],
        "imageLayout": {"imagesPerRow": 2, "imagesPerPage": 5},
    }
    out = merge_package(payload)
    with zipfile.ZipFile(io.BytesIO(out), "r") as z:
        doc = z.read("word/document.xml")
        rels = z.read("word/_rels/document.xml.rels").decode("utf-8")
        content_types = z.read("[Content_Types].xml").decode("utf-8")
        names = set(z.namelist())
    validate_part_xml(doc, "word/document.xml")
    text = doc.decode("utf-8")
    assert "شركة الاختبار" in text, "client bookmark not filled"
    assert "08/06/2026" in text, "date bookmark not filled"
    assert "27/06/2026" in text, "compound agreement/date bookmark not filled"
    assert valuation_date in text, "valuation date alias bookmark not filled"
    assert inspection_date in text, "inspection date alias bookmark not filled"
    assert not re.search(r"\d{2}/\d{2}/\d{4}\s*م\.?", text), "numeric dates should not keep the Arabic Gregorian suffix"
    assert "١٢٣ ر.س" in text, "paragraph-level bookmark not filled"
    assert "الرياض" in text, "hyperlink-contained bookmark not filled"
    assert "غرض اختبار داخل مربع نص" in text, "textbox bookmark not filled"
    assert "تقرير اختبار مباشر" in text, "textbox paragraph-level bookmark not filled"
    assert "placeholder" not in text, "spanning placeholder was not removed"
    assert "old agreement date" not in text, "compound date placeholder was not removed"
    assert "old valuation date" not in text, "valuation date placeholder was not removed"
    assert "old inspection date" not in text, "inspection date placeholder was not removed"
    assert "old value" not in text, "paragraph-level placeholder was not removed"
    assert "old short value" not in text, "short final value placeholder was not removed"
    assert "old hyperlink text" not in text, "hyperlink placeholder was not removed"
    assert "old words" not in text, "final value words placeholder was not removed"
    assert "old cover client" not in text, "cover client placeholder was not removed"
    assert "مائة وعشرون ألف ريال سعودي" in text, "final value words bookmark not filled"
    assert "١٢٠٬٠٠٠" in text, "final value amount not inserted before currency in opinion paragraph"
    assert "رأي قيمة التصفية" in text, "value opinion paragraph missing"
    media_names = [name for name in names if name.startswith("word/media/")]
    assert len(media_names) >= 1, "image media part was not written"
    assert "relationships/image" in rels, "image relationship missing"
    assert "image/jpeg" in content_types, "image content type missing"
    assert "<w:r" in text and text.count("<w:r") >= 2
    root = etree.fromstring(doc)
    w = lambda tag: f"{{{W_NS}}}{tag}"
    a = lambda tag: f"{{{A_NS}}}{tag}"
    plain_text = "\n".join("".join(t.text or "" for t in p.iter(w("t"))) for p in root.iter(w("p")))
    def matching_runs(expected_text: str):
        return [
            run
            for run in root.iter(w("r"))
            if "".join(t.text or "" for t in run.iter(w("t"))) == expected_text
        ]

    def has_tajawal_run(expected_text: str) -> bool:
        for run in matching_runs(expected_text):
            rpr = run.find(w("rPr"))
            fonts = rpr.find(w("rFonts")) if rpr is not None else None
            if fonts is not None and fonts.get(f"{{{W_NS}}}cs") == "Tajawal":
                return True
        return False

    assert has_tajawal_run("تقرير اختبار مباشر"), "cover title should use Tajawal"
    assert has_tajawal_run("شركة الاختبار"), "cover client should use Tajawal"
    title_runs = matching_runs("تقرير اختبار مباشر")
    assert len(title_runs) >= 1, "report title should fill cover bookmark"
    # «عنوان» على الغلاف فقط يفرض Tajawal 14pt؛ «عنوانغ» يرث تنسيق الفقرة
    cover_title_runs = [
        run
        for run in title_runs
        if run.find(w("rPr")) is not None
        and run.find(w("rPr")).find(w("rFonts")) is not None
        and run.find(w("rPr")).find(w("rFonts")).get(f"{{{W_NS}}}cs") == "Tajawal"
        and run.find(w("rPr")).find(w("sz")) is not None
        and run.find(w("rPr")).find(w("sz")).get(f"{{{W_NS}}}val") == "28"
    ]
    assert len(cover_title_runs) >= 1, "cover عنوان should use Tajawal 14pt"
    for title_run in cover_title_runs:
        rpr = title_run.find(w("rPr"))
        assert rpr is not None and rpr.find(w("b")) is None, "cover title should not be bold"
        title_para = title_run
        while title_para is not None and title_para.tag != w("p"):
            title_para = title_para.getparent()
        assert title_para is not None, "cover title paragraph missing"
        title_ppr = title_para.find(w("pPr"))
        title_jc = title_ppr.find(w("jc")) if title_ppr is not None else None
        assert title_jc is not None and title_jc.get(f"{{{W_NS}}}val") == "center", "cover title must be centered"
        title_para_rpr = title_ppr.find(w("rPr")) if title_ppr is not None else None
        title_para_fonts = title_para_rpr.find(w("rFonts")) if title_para_rpr is not None else None
        assert title_para_fonts is not None and title_para_fonts.get(f"{{{W_NS}}}cs") == "Tajawal", "cover paragraph must enforce Tajawal"
        title_para_sz = title_para_rpr.find(w("sz")) if title_para_rpr is not None else None
        assert title_para_sz is not None and title_para_sz.get(f"{{{W_NS}}}val") == "28", "cover paragraph should be 14pt"
    # عنوانغ / عنواناصل داخل التقرير: يرثان ~11pt ونوع خط الفقرة المحيطة
    inline_body_runs = [
        run
        for run in title_runs
        if run.find(w("rPr")) is not None
        and run.find(w("rPr")).find(w("sz")) is not None
        and run.find(w("rPr")).find(w("sz")).get(f"{{{W_NS}}}val") == "22"
        and run.find(w("rPr")).find(w("rFonts")) is not None
        and run.find(w("rPr")).find(w("rFonts")).get(f"{{{W_NS}}}cs") == "Arial"
    ]
    assert len(inline_body_runs) >= 1, "عنوانغ should inherit surrounding 11pt Arial body style"
    for body_run in inline_body_runs:
        body_para = body_run
        while body_para is not None and body_para.tag != w("p"):
            body_para = body_para.getparent()
        body_ppr = body_para.find(w("pPr")) if body_para is not None else None
        body_jc = body_ppr.find(w("jc")) if body_ppr is not None else None
        assert body_jc is None or body_jc.get(f"{{{W_NS}}}val") != "center", (
            "inline title bookmarks must not force cover centering"
        )
    forced_cover_style_count = sum(
        1
        for run in title_runs
        if run.find(w("rPr")) is not None
        and run.find(w("rPr")).find(w("sz")) is not None
        and run.find(w("rPr")).find(w("sz")).get(f"{{{W_NS}}}val") == "28"
        and run.find(w("rPr")).find(w("rFonts")) is not None
        and run.find(w("rPr")).find(w("rFonts")).get(f"{{{W_NS}}}cs") == "Tajawal"
    )
    assert forced_cover_style_count == len(cover_title_runs), (
        "عنوانغ/عنواناصل must not receive forced cover 14pt Tajawal styling"
    )
    client_runs = matching_runs("شركة الاختبار")
    assert any(
        run.find(w("rPr")) is not None
        and run.find(w("rPr")).find(w("sz")) is not None
        and run.find(w("rPr")).find(w("sz")).get(f"{{{W_NS}}}val") == "40"
        for run in client_runs
    ), "cover client should be 20pt"
    assert f"على أساس {valuation_basis} في تاريخ التقييم" in plain_text, "contextual valuation basis was not filled"
    assert any(
        valuation_date in line and line.strip().startswith("تاريخ التقييم")
        for line in plain_text.splitlines()
    ), "contextual valuation date line was not filled"
    assert f"بتاريخ {inspection_date}" in plain_text, "inspection date label fallback was not filled"
    assert f"{valuation_date} {inspection_date}" not in plain_text, "adjacent date bookmarks should not duplicate dates"
    for ppr in root.iter(w("pPr")):
        tags = [child.tag for child in ppr]
        assert not (
            w("jc") in tags and w("bidi") in tags and tags.index(w("jc")) < tags.index(w("bidi"))
        ), "invalid Word paragraph property order"
    wp = lambda tag: f"{{{WP_NS}}}{tag}"
    pic = lambda tag: f"{{{PIC_NS}}}{tag}"
    doc_pr_ids = [el.get("id") for el in root.iter(wp("docPr")) if el.get("id")]
    assert len(doc_pr_ids) == len(set(doc_pr_ids)), "duplicate wp:docPr ids"
    blips = list(root.iter(a("blip")))
    assert len(blips) == 16, "unexpected number of inserted image blips"
    extents = [
        (int(node.get("cx") or "0"), int(node.get("cy") or "0"))
        for node in root.iter(wp("extent"))
    ]
    valuation_width = max(cx for cx, _cy in extents)
    page_width_twips = 11906
    expected_valuation_width = int(page_width_twips * 635 * IMAGE_CONTENT_WIDTH_RATIO)
    assert abs(valuation_width - expected_valuation_width) <= 1, "valuation image should use 95% of physical page width"
    valuation_indents = []
    for para in root.iter(w("p")):
        if any(int(node.get("cx") or "0") == valuation_width for node in para.iter(wp("extent"))):
            ppr = para.find(w("pPr"))
            ind = ppr.find(w("ind")) if ppr is not None else None
            if ind is not None:
                valuation_indents.append(ind)
    assert valuation_indents, "valuation image paragraph should have RTL indentation"
    physical_side_emu = (page_width_twips * 635 - expected_valuation_width) // 2
    expected_right_indent = str(round((physical_side_emu - 2127 * 635) / 635))
    expected_left_indent = str(round((physical_side_emu - 1440 * 635) / 635))
    assert all(ind.get(f"{{{W_NS}}}right") == expected_right_indent for ind in valuation_indents), "valuation image should override the section right margin"
    assert all(ind.get(f"{{{W_NS}}}left") == expected_left_indent for ind in valuation_indents), "valuation image should override the section left margin"
    titles = [node.text for node in root.iter(w("t")) if node.text == IMAGE_PAGE_TITLE]
    assert not titles, "asset pages should not insert a duplicate annex title"
    tables = list(root.iter(w("tbl")))
    assert len(tables) == 2, "two images per row should automatically use eight images per page"
    assert IMAGES_PER_ROW == 4 and IMAGES_PER_PAGE == 20, "Word image layout defaults changed unexpectedly"
    assert ASSET_IMAGE_GAP_DXA == 45, "asset image gap should be 3px"
    for table in tables:
        spacing = table.find(w("tblPr")).find(w("tblCellSpacing"))
        assert spacing is not None, "asset image table should define cell spacing"
        assert spacing.get(f"{{{W_NS}}}w") == str(ASSET_IMAGE_GAP_DXA), "asset image gap should be 3px"
        table_width = table.find(w("tblPr")).find(w("tblW"))
        assert table_width is not None
        assert abs(int(table_width.get(f"{{{W_NS}}}w") or "0") - round(page_width_twips * IMAGE_CONTENT_WIDTH_RATIO)) <= 2, "asset table should use 95% of physical page width"
        table_indent = table.find(w("tblPr")).find(w("tblInd"))
        assert table_indent is not None
        assert table_indent.get(f"{{{W_NS}}}w") == expected_left_indent, "asset table should be centered against the physical page"
        for row in table.iter(w("tr")):
            assert len(list(row.iter(w("tc")))) == 2, "custom row setting should produce two cells"
    print("OK: merge smoke test passed")


if __name__ == "__main__":
    main()
