#!/usr/bin/env python3
"""Smoke test: minimal docx with inline + spanning bookmarks."""
import base64
import io
import json
import zipfile
from lxml import etree
from merge_docx import (
    ASSET_IMAGE_GAP_DXA,
    EMU_PER_INCH,
    IMAGE_PAGE_TITLE,
    IMAGES_PER_ROW,
    VALUATION_IMAGE_PAGE_WIDTH_RATIO,
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
    valuation_date = "١١ يناير ٢٠٢٦"
    inspection_date = "١٢ يناير ٢٠٢٦"
    payload = {
        "templateBase64": base64.b64encode(make_template()).decode("ascii"),
        "textValues": {
            "clientName": "شركة الاختبار",
            "agreementDate": "١٠ يناير ٢٠٢٦",
            "reportIssueDate": "١ يناير ٢٠٢٦",
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
    assert "١ يناير ٢٠٢٦" in text, "date bookmark not filled"
    assert "١٠ يناير ٢٠٢٦" in text, "compound agreement/date bookmark not filled"
    assert "١١ يناير ٢٠٢٦" in text, "valuation date alias bookmark not filled"
    assert "١٢ يناير ٢٠٢٦" in text, "inspection date alias bookmark not filled"
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
    def has_tajawal_run(expected_text: str) -> bool:
        for run in root.iter(w("r")):
            run_text = "".join(t.text or "" for t in run.iter(w("t")))
            if run_text != expected_text:
                continue
            rpr = run.find(w("rPr"))
            fonts = rpr.find(w("rFonts")) if rpr is not None else None
            if fonts is not None and fonts.get(f"{{{W_NS}}}cs") == "Tajawal":
                return True
        return False

    assert has_tajawal_run("تقرير اختبار مباشر"), "cover title should use Tajawal"
    assert has_tajawal_run("شركة الاختبار"), "cover client should use Tajawal"
    assert f"على أساس {valuation_basis} في تاريخ التقييم" in plain_text, "contextual valuation basis was not filled"
    assert any(
        valuation_date in line and line.strip().startswith("تاريخ التقييم")
        for line in plain_text.splitlines()
    ), "contextual valuation date line was not filled"
    assert f"بتاريخ {inspection_date} م." in plain_text, "inspection date label fallback was not filled"
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
    expected_valuation_width = int(11906 * 635 * VALUATION_IMAGE_PAGE_WIDTH_RATIO)
    assert valuation_width <= expected_valuation_width + 1, "valuation images should fit within 90% page width"
    assert valuation_width >= expected_valuation_width - 1, "valuation images should use 90% page width"
    valuation_indents = []
    for para in root.iter(w("p")):
        if any(int(node.get("cx") or "0") == valuation_width for node in para.iter(wp("extent"))):
            ppr = para.find(w("pPr"))
            ind = ppr.find(w("ind")) if ppr is not None else None
            if ind is not None:
                valuation_indents.append(ind)
    assert valuation_indents, "valuation image paragraph should have RTL indentation"
    assert any(ind.get(f"{{{W_NS}}}right") == "-1770" for ind in valuation_indents), "valuation image should compensate the active section right margin"
    assert any(ind.get(f"{{{W_NS}}}left") == "-607" for ind in valuation_indents), "valuation image should keep a wider left-side margin without cropping"
    titles = [node.text for node in root.iter(w("t")) if node.text == IMAGE_PAGE_TITLE]
    assert len(titles) == 2, "asset photo annex title should repeat for every asset image page"
    tables = list(root.iter(w("tbl")))
    assert len(tables) == 2, "expected two asset image table pages only"
    for table in tables:
        spacing = table.find(w("tblPr")).find(w("tblCellSpacing"))
        assert spacing is not None, "asset image table should define cell spacing"
        assert spacing.get(f"{{{W_NS}}}w") == str(ASSET_IMAGE_GAP_DXA), "asset image gap should be 1px"
        for row in table.iter(w("tr")):
            assert len(list(row.iter(w("tc")))) == IMAGES_PER_ROW, "every image row must have three cells"
    print("OK: merge smoke test passed")


if __name__ == "__main__":
    main()
