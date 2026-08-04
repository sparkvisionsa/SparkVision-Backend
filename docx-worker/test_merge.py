#!/usr/bin/env python3
"""Regression tests for visible-variable Word merging and section-based images."""

import base64
import io
import json
import os
import re
import zipfile

from lxml import etree

import merge_docx as worker
from merge_docx import (
    ASSET_IMAGE_GAP_DXA,
    ASSET_IMAGE_MAX_SQUARE_PX,
    EMU_PER_INCH,
    IMAGE_CONTENT_WIDTH_RATIO,
    IMAGES_PER_PAGE,
    IMAGES_PER_ROW,
    PLACEHOLDER_FIELDS,
    apply_visible_variable_values,
    collect_template_placeholder_names,
    merge_package,
    stretch_to_fill_canvas_jpeg_bytes,
    validate_part_xml,
)

W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
WP_NS = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
WP14_NS = "http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing"
A_NS = "http://schemas.openxmlformats.org/drawingml/2006/main"
PACKAGE_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"

PNG_1X1 = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII="
)

CONTENT_TYPES = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>"""

PACKAGE_RELS = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>"""

EMPTY_DOCUMENT_RELS = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>"""


def make_solid_jpeg(
    width: int,
    height: int,
    color: tuple[int, int, int] = (20, 120, 200),
) -> bytes:
    from PIL import Image

    img = Image.new("RGB", (width, height), color)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=95)
    return buf.getvalue()


def make_minimal_docx(document_xml: str) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr(
            zipfile.ZipInfo("mimetype"),
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            compress_type=zipfile.ZIP_STORED,
        )
        z.writestr("[Content_Types].xml", CONTENT_TYPES)
        z.writestr("_rels/.rels", PACKAGE_RELS)
        z.writestr("word/document.xml", document_xml)
        z.writestr("word/_rels/document.xml.rels", EMPTY_DOCUMENT_RELS)
    return buf.getvalue()


def merge_with_captured_stats(payload: dict) -> tuple[bytes, dict]:
    messages: list[str] = []
    original_log = worker.log
    worker.log = messages.append
    try:
        output = merge_package(payload)
    finally:
        worker.log = original_log
    assert output is not None
    json_messages = [
        json.loads(message)
        for message in messages
        if message.startswith("{") and message.endswith("}")
    ]
    assert json_messages, f"merge stats were not logged: {messages}"
    return output, json_messages[-1]


def visible_text(root: etree._Element) -> str:
    w = lambda tag: f"{{{W_NS}}}{tag}"
    return "\n".join(
        "".join(node.text or "" for node in para.iter(w("t")))
        for para in root.iter(w("p"))
    )


def runs_with_text(root: etree._Element, expected: str) -> list[etree._Element]:
    w = lambda tag: f"{{{W_NS}}}{tag}"
    return [
        run
        for run in root.iter(w("r"))
        if "".join(node.text or "" for node in run.iter(w("t"))) == expected
    ]


def canonical_xml(xml_bytes: bytes) -> bytes:
    return etree.tostring(etree.fromstring(xml_bytes), method="c14n")


def element_c14n(element: etree._Element | None) -> bytes | None:
    if element is None:
        return None
    return etree.tostring(element, method="c14n", exclusive=True)


def make_transparent_signature_png(
    width: int = 260,
    height: int = 100,
    color: tuple[int, int, int, int] = (25, 85, 200, 255),
) -> bytes:
    from PIL import Image, ImageDraw

    image = Image.new("RGBA", (width, height), (255, 255, 255, 0))
    draw = ImageDraw.Draw(image)
    draw.line(
        [(10, height - 18), (width // 3, 15), (width // 2, height - 30), (width - 8, 25)],
        fill=color,
        width=max(2, height // 18),
    )
    output = io.BytesIO()
    image.save(output, format="PNG")
    return output.getvalue()


def make_opaque_signature_with_large_white_margins() -> bytes:
    from PIL import Image, ImageDraw

    image = Image.new("RGB", (1200, 700), (255, 255, 255))
    draw = ImageDraw.Draw(image)
    draw.line(
        [(430, 385), (515, 300), (610, 390), (760, 305)],
        fill=(15, 55, 160),
        width=18,
    )
    output = io.BytesIO()
    image.save(output, format="JPEG", quality=90)
    return output.getvalue()


def test_report_signature_removes_opaque_white_margins() -> None:
    from PIL import Image, ImageChops

    prepared = worker.prepare_report_signature_png(
        make_opaque_signature_with_large_white_margins()
    )
    assert prepared is not None

    with Image.open(io.BytesIO(prepared)) as signature:
        assert signature.size == worker.REPORT_SIGNATURE_CANVAS_SIZE
        assert signature.mode == "RGBA"
        rgb = signature.convert("RGB")
        difference = ImageChops.difference(
            rgb,
            Image.new("RGB", signature.size, (255, 255, 255)),
        )
        red, green, blue = difference.split()
        ink_bounds = ImageChops.lighter(red, ImageChops.lighter(green, blue)).point(
            lambda value: 255
            if value > worker.REPORT_SIGNATURE_WHITE_THRESHOLD
            else 0
        ).getbbox()
        assert ink_bounds is not None
        left, top, right, bottom = ink_bounds
        canvas_width, canvas_height = signature.size
        # بعد إزالة الهوامش البيضاء يجب أن يملأ أثر التوقيع معظم عرض اللوحة،
        # بدلاً من بقائه صغيراً في المنتصف كما في الصورة الأصلية.
        assert right - left >= int(canvas_width * 0.9)
        assert left <= int(canvas_width * 0.05)
        assert canvas_width - right <= int(canvas_width * 0.05)


def test_redundant_blank_page_breaks_are_removed() -> None:
    document_xml = f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="{W_NS}"><w:body>
  <w:p><w:r><w:t>محتوى</w:t></w:r></w:p>
  <w:p><w:r><w:br w:type="page"/></w:r></w:p>
  <w:p/>
  <w:p><w:r><w:br w:type="page"/></w:r></w:p>
  <w:p><w:r><w:t>محتوى تالٍ</w:t></w:r></w:p>
  <w:p><w:r><w:br w:type="page"/></w:r></w:p>
  <w:sectPr/>
</w:body></w:document>""".encode("utf-8")
    cleaned, removed = worker.cleanup_redundant_page_breaks(document_xml)
    assert removed == 2
    root = etree.fromstring(cleaned)
    assert len(list(root.iter(f"{{{W_NS}}}br"))) == 1


def toc_paragraphs(xml_bytes: bytes) -> list[bytes]:
    root = etree.fromstring(xml_bytes)
    w = lambda tag: f"{{{W_NS}}}{tag}"
    paragraphs: list[bytes] = []
    for para in root.iter(w("p")):
        instructions = "".join(
            node.text or "" for node in para.iter(w("instrText"))
        )
        if not re.search(r"\b(?:TOC|PAGEREF)\b", instructions, re.I):
            continue
        paragraphs.append(etree.tostring(para, method="c14n"))
    return paragraphs


def variable_source_rpr(
    root: etree._Element,
    variable_name: str,
) -> etree._Element | None:
    w = lambda tag: f"{{{W_NS}}}{tag}"
    for para in root.iter(w("p")):
        if worker.paragraph_has_nested_story(para):
            continue
        nodes, full_text = worker.text_nodes_with_offsets(para)
        for match in worker.VISIBLE_VARIABLE_RE.finditer(full_text):
            if worker.visible_variable_name(match) != variable_name:
                continue
            target_node = worker.select_visible_variable_text_node(nodes, match)
            target_run = worker.text_node_run(target_node) if target_node is not None else None
            return target_run.find(w("rPr")) if target_run is not None else None
    return None


def with_report_body_font(element: etree._Element | None) -> bytes | None:
    """Canonical XML after rewriting Cocon fonts to Tajawal (as merge does)."""
    if element is None:
        return None
    clone = etree.fromstring(etree.tostring(element))
    for rfonts in clone.iter(f"{{{W_NS}}}rFonts"):
        worker._rewrite_rfonts_element(rfonts, worker.REPORT_BODY_FONT)
    return etree.tostring(clone, method="c14n")


def test_stretch_fills_uniform_canvas_without_crop_or_pad() -> None:
    from PIL import Image

    wide = make_solid_jpeg(800, 200, (10, 200, 40))
    cell = int(2.0 * EMU_PER_INCH)
    out = stretch_to_fill_canvas_jpeg_bytes(wide, cell, cell, max_side_px=400)
    canvas = Image.open(io.BytesIO(out)).convert("RGB")
    assert canvas.size == (400, 400)
    for xy in ((2, 2), (200, 200), (397, 397), (2, 397), (397, 2)):
        pixel = canvas.getpixel(xy)
        assert pixel[1] > 150 and pixel[0] < 80
    assert ASSET_IMAGE_MAX_SQUARE_PX >= 600


def test_docx_safe_baseline_jpeg_passthrough_skips_reencode() -> None:
    """صور Nest الجاهزة (مقاس اللوحة + JPEG أساسي) تُمرَّر دون إعادة ترميز."""
    from PIL import Image

    cell = int(2.0 * EMU_PER_INCH)
    canvas_w, canvas_h = worker._canvas_pixel_size_for_cell(cell, cell, 400)
    buf = io.BytesIO()
    Image.new("RGB", (canvas_w, canvas_h), (12, 180, 40)).save(
        buf, format="JPEG", quality=90, optimize=False, progressive=False, subsampling=0
    )
    source = buf.getvalue()
    assert worker.jpeg_is_docx_safe_baseline(source)
    out = stretch_to_fill_canvas_jpeg_bytes(source, cell, cell, max_side_px=400)
    assert out is source or out == source

    prepared, width, height = worker.prepare_valuation_image_bytes(source)
    assert prepared is source or prepared == source
    assert (width, height) == (canvas_w, canvas_h)

    # A square JPEG prepared by Nest does not need to match Pillow's target pixel
    # count: Word performs the final visual scaling inside the fixed square cell.
    smaller = make_solid_jpeg(320, 320, (20, 120, 210))
    assert worker.jpeg_is_docx_safe_baseline(smaller)
    smaller_out = stretch_to_fill_canvas_jpeg_bytes(
        smaller, cell, cell, max_side_px=400
    )
    assert smaller_out is smaller or smaller_out == smaller


def test_visible_syntaxes_split_runs_and_rpr() -> None:
    xml = f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="{W_NS}">
  <w:body>
    <w:p>
      <w:r><w:fldChar w:fldCharType="begin"/></w:r>
      <w:r><w:instrText> MERGEFIELD العميل </w:instrText></w:r>
      <w:r><w:fldChar w:fldCharType="separate"/></w:r>
      <w:r>
        <w:rPr><w:rFonts w:cs="DelimiterFont"/><w:sz w:val="16"/></w:rPr>
        <w:t>«</w:t>
      </w:r>
      <w:r>
        <w:rPr><w:rFonts w:cs="TitleVariableFont"/><w:sz w:val="56"/></w:rPr>
        <w:t>عنوان_التقرير</w:t>
      </w:r>
      <w:r>
        <w:rPr><w:rFonts w:cs="DelimiterFont"/><w:sz w:val="16"/></w:rPr>
        <w:t>»</w:t>
      </w:r>
      <w:r><w:fldChar w:fldCharType="end"/></w:r>
    </w:p>
    <w:p>
      <w:r><w:rPr><w:rFonts w:cs="DelimiterFont"/></w:rPr><w:t>&lt;&lt;</w:t></w:r>
      <w:r><w:rPr><w:rFonts w:cs="ShortNameFont"/><w:sz w:val="20"/></w:rPr><w:t>ال</w:t></w:r>
      <w:r><w:rPr><w:rFonts w:cs="ClientVariableFont"/><w:sz w:val="32"/></w:rPr><w:t>عميل</w:t></w:r>
      <w:r><w:rPr><w:rFonts w:cs="DelimiterFont"/></w:rPr><w:t>&gt;&gt;</w:t></w:r>
    </w:p>
    <w:p><w:r><w:t>&lt;&lt;اسلوب_التقييم&gt;&gt;</w:t></w:r></w:p>
    <w:p><w:r><w:t>«الأصل*المعنية*الأصل*محل*التقييم»</w:t></w:r></w:p>
    <w:p><w:r><w:t>«أساس*القيمة*المستخدم»</w:t></w:r></w:p>
    <w:p>
      <w:r><w:fldChar w:fldCharType="begin"/></w:r>
      <w:r><w:instrText> MERGEFIELD عنوان_التقرير </w:instrText></w:r>
      <w:r><w:fldChar w:fldCharType="separate"/></w:r>
      <w:r><w:t>نص ثابت بلا متغير مرئي</w:t></w:r>
      <w:r><w:fldChar w:fldCharType="end"/></w:r>
    </w:p>
    <w:p>
      <w:bookmarkStart w:id="7" w:name="العميل"/>
      <w:r><w:t>قيمة الإشارة القديمة يجب أن تبقى</w:t></w:r>
      <w:bookmarkEnd w:id="7"/>
    </w:p>
  </w:body>
</w:document>""".encode("utf-8")

    assert collect_template_placeholder_names(xml) == [
        "عنوان_التقرير",
        "العميل",
        "اسلوب_التقييم",
        "الأصل*المعنية*الأصل*محل*التقييم",
        "أساس*القيمة*المستخدم",
    ]
    output, found, filled = apply_visible_variable_values(
        xml,
        {
            "reportTitle": "TITLE-VALUE",
            "clientName": "CLIENT-VALUE",
            "valuationMethod": "METHOD-VALUE",
            "assetSubjectDescription": "ASSET-SUBJECT-VALUE",
            "valuationBasisDefinition": "BASIS-DEFINITION-VALUE",
        },
    )
    assert found == 5
    assert filled == 5
    root = etree.fromstring(output)
    text = visible_text(root)
    assert "TITLE-VALUE" in text
    assert "CLIENT-VALUE" in text
    assert "METHOD-VALUE" in text
    assert "ASSET-SUBJECT-VALUE" in text
    assert "BASIS-DEFINITION-VALUE" in text
    assert "نص ثابت بلا متغير مرئي" in text
    assert "قيمة الإشارة القديمة يجب أن تبقى" in text
    assert "«" not in text and "»" not in text
    assert "<<" not in text and ">>" not in text
    assert "MERGEFIELD" not in "".join(
        node.text or ""
        for node in root.iter(f"{{{W_NS}}}instrText")
    )

    title_run = runs_with_text(root, "TITLE-VALUE")[0]
    title_rpr = title_run.find(f"{{{W_NS}}}rPr")
    assert title_rpr is not None
    assert title_rpr.find(f"{{{W_NS}}}rFonts").get(f"{{{W_NS}}}cs") == "TitleVariableFont"
    assert title_rpr.find(f"{{{W_NS}}}sz").get(f"{{{W_NS}}}val") == "56"

    client_run = runs_with_text(root, "CLIENT-VALUE")[0]
    client_rpr = client_run.find(f"{{{W_NS}}}rPr")
    assert client_rpr is not None
    assert client_rpr.find(f"{{{W_NS}}}rFonts").get(f"{{{W_NS}}}cs") == "ClientVariableFont"
    assert client_rpr.find(f"{{{W_NS}}}sz").get(f"{{{W_NS}}}val") == "32"

    bookmark_only = f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="{W_NS}"><w:body><w:p>
  <w:bookmarkStart w:id="1" w:name="العميل"/>
  <w:r><w:t>OLD-BOOKMARK-TEXT</w:t></w:r>
  <w:bookmarkEnd w:id="1"/>
</w:p></w:body></w:document>""".encode("utf-8")
    compatibility_output, compatibility_found, compatibility_filled = apply_visible_variable_values(
        bookmark_only,
        {"clientName": "MUST-NOT-BE-USED-EITHER"},
    )
    assert compatibility_found == 0
    assert compatibility_filled == 0
    assert b"OLD-BOOKMARK-TEXT" in compatibility_output
    assert b"MUST-NOT-BE-USED" not in compatibility_output


def actual_template_values() -> dict[str, str]:
    return {
        "reportTitle": "تقرير اختبار المتغيرات المرئية",
        "reportReference": "REF-2026-77",
        "clientName": "شركة العميل التجريبية",
        "clientActivity": "تجارة المعدات",
        "clientRepresentativeName": "ممثل تجريبي",
        "clientRepresentativeRole": "المدير العام",
        "intendedUsers": "العميل ومركز الإسناد",
        "valuationPurpose": "البيع",
        "valuationBasis": "قيمة التصفية",
        "valuationBasisDefinition": "تعريف أساس القيمة التجريبي",
        "valuePremiseDefinition": "تعريف فرضية القيمة التجريبي",
        "agreementDate": "01/07/2026",
        "inspectionDate": "02/07/2026",
        "valuationDate": "03/07/2026",
        "reportIssueDate": "04/07/2026",
        "assetSingularPlural": "أصل/أصول",
        "assetSubjectDescription": "آلات ومعدات وأجهزة متنوعة",
        "inspectionLocation": "الرياض",
        "inspectionMapUrl": "https://maps.example.test/site",
        "finalValueOpinion": (
            "(284,190 ر.س)"
            "مائتان وأربعة وسبعون ألفا ومائة وتسعون ريالا سعوديا لا غير"
        ),
    }


def test_actual_template_variables_mail_merge_cleanup_and_images() -> None:
    template_path = os.path.abspath(
        os.path.join(os.path.dirname(__file__), "..", "assets", "تقرير تقييم.docx")
    )
    assert os.path.isfile(template_path)
    with zipfile.ZipFile(template_path, "r") as template_zip:
        template_document_xml = template_zip.read("word/document.xml")
        template_settings_xml = template_zip.read("word/settings.xml")
        template_preserved_parts = {}
        template_names: list[str] = []
        for part_name in template_zip.namelist():
            if re.match(
                r"^word/(document|header\d+|footer\d+)\.xml$",
                part_name,
                re.I,
            ):
                for name in collect_template_placeholder_names(
                    template_zip.read(part_name)
                ):
                    if name not in template_names:
                        template_names.append(name)
    assert len(template_names) == 20
    assert set(template_names) <= set(PLACEHOLDER_FIELDS)

    values = actual_template_values()
    image_b64 = base64.b64encode(PNG_1X1).decode("ascii")
    output, stats = merge_with_captured_stats(
        {
            "templatePath": template_path,
            "textValues": values,
            "textByBookmarkName": {
                "العميل": "قيمة bookmark يجب تجاهلها",
            },
            "reportPreparers": [
                {
                    "userId": "integrated-manager",
                    "name": "مدير دمج الصور والمعدّين",
                    "jobTitle": "مقيم آلات ومعدات",
                    "membershipNo": "4210077777",
                    "reportRole": "المراجعة والاعتماد",
                    "signatureImageDataUrl": f"data:image/png;base64,{image_b64}",
                }
            ],
            "assetImagesBase64": [image_b64] * 9,
            "valuationImagesBase64": [image_b64] * 5,
            "clientImagesBase64": [image_b64] * 5,
            "imageLayout": {
                "imagesPerRow": 2,
                "imagesPerPage": 4,
                "clientImagesPerRow": 2,
                "clientImagesPerPage": 4,
                "imageQuality": 95,
            },
        }
    )
    assert set(stats["variablesFound"]) == set(template_names)
    assert stats["variablesOccurrencesFound"] == 63
    assert stats["variablesFilled"] == 63
    assert stats["assetImagesInserted"] == 9
    assert stats["valuationImagesInserted"] == 5
    assert stats["clientImagesInserted"] == 5
    assert stats["reportPreparerTableFound"] == 1
    assert stats["reportPreparerRowsRemoved"] == 3
    assert stats["reportPreparersInserted"] == 1
    assert stats["reportSignaturesInserted"] == 1
    assert stats["headerWrapsNormalized"] > 0
    assert "fontRunsNormalized" not in stats
    assert "legacyFontReferencesNormalized" not in stats
    assert "bookmarksFound" not in stats
    assert "textFilled" not in stats

    with zipfile.ZipFile(io.BytesIO(output), "r") as z:
        names = set(z.namelist())
        doc_xml = z.read("word/document.xml")
        settings_xml = z.read("word/settings.xml")
        settings_rels = (
            z.read("word/_rels/settings.xml.rels")
            if "word/_rels/settings.xml.rels" in names
            else b""
        )
        content_types = z.read("[Content_Types].xml")
        xml_parts = {
            name: z.read(name)
            for name in names
            if name.lower().endswith(".xml")
        }
        output_preserved_parts = {
            part_name: canonical_xml(z.read(part_name))
            for part_name in template_preserved_parts
        }

    validate_part_xml(doc_xml, "word/document.xml")
    root = etree.fromstring(doc_xml)
    w = lambda tag: f"{{{W_NS}}}{tag}"
    body = root.find(".//" + w("body"))
    assert body is not None
    text = visible_text(root)
    for variable_name in template_names:
        assert f"«{variable_name}»" not in text
        assert f"<<{variable_name}>>" not in text
    for expected in values.values():
        assert expected in text, f"merged value missing: {expected}"
    assert "قيمة bookmark يجب تجاهلها" not in text
    assert "مدير دمج الصور والمعدّين" in text
    assert "MERGEFIELD" not in "".join(
        node.text or "" for node in root.iter(w("instrText"))
    )
    integrated_preparer_table = worker.find_report_preparer_table(root)
    assert integrated_preparer_table is not None
    assert len(integrated_preparer_table.findall(w("tr"))) == 2
    assert len(list(integrated_preparer_table.iter(w("drawing")))) == 1

    settings_root = etree.fromstring(settings_xml)
    assert settings_root.find(".//" + w("mailMerge")) is None
    update_fields = settings_root.find(".//" + w("updateFields"))
    template_settings_root = etree.fromstring(template_settings_xml)
    template_update_fields = template_settings_root.find(
        ".//" + w("updateFields")
    )
    assert template_update_fields is None
    assert update_fields is None, "لا يجوز تشغيل تحديث الفهرس تلقائياً عند فتح التقرير"
    assert b"Projects.xlsx" not in settings_rels
    assert b"recipientData" not in settings_rels
    assert "word/recipientData.xml" not in names
    assert b"/word/recipientData.xml" not in content_types

    title_runs = runs_with_text(root, values["reportTitle"])
    assert title_runs
    template_root = etree.fromstring(template_document_xml)
    template_title_rpr = variable_source_rpr(template_root, "عنوان_التقرير")
    assert template_title_rpr is not None
    expected_title_rpr = with_report_body_font(template_title_rpr)
    assert any(
        (
            (rpr := run.find(w("rPr"))) is not None
            and etree.tostring(rpr, method="c14n") == expected_title_rpr
        )
        for run in title_runs
    ), "يجب أن يحتفظ النص المدمج بتنسيق المتغير مع تحويل خط الجسم إلى Tajawal"

    final_value_rpr = variable_source_rpr(
        template_root,
        "رأي_القيمة_رقما_وكتابتا",
    )
    assert final_value_rpr is not None
    expected_final_rpr = with_report_body_font(final_value_rpr)
    final_value_runs = runs_with_text(root, values["finalValueOpinion"])
    assert final_value_runs
    assert any(
        (
            (rpr := run.find(w("rPr"))) is not None
            and etree.tostring(rpr, method="c14n") == expected_final_rpr
        )
        for run in final_value_runs
    ), "تغيّر تنسيق رأي القيمة بشكل غير متوقع عند الدمج"

    assert output_preserved_parts == template_preserved_parts
    # body font = Tajawal؛ أسفل الغلاف يبقى Cocon
    body_fonts = {
        (rf.get(f"{{{W_NS}}}cs") or rf.get("cs") or "")
        for rf in root.iter(w("rFonts"))
    }
    assert "Tajawal" in body_fonts
    cover_footer_fonts: set[str] = set()
    for para in root.iter(w("p")):
        if not worker._paragraph_is_cover_footer(para):
            continue
        for rf in para.findall(f"./{w('pPr')}/{w('rPr')}/{w('rFonts')}"):
            cover_footer_fonts.add(rf.get(f"{{{W_NS}}}cs") or rf.get("cs") or "")
        for rf in para.findall(f"./{w('r')}/{w('rPr')}/{w('rFonts')}"):
            cover_footer_fonts.add(rf.get(f"{{{W_NS}}}cs") or rf.get("cs") or "")
    assert worker.REPORT_COVER_FOOTER_FONT in cover_footer_fonts
    font_table = etree.fromstring(xml_parts["word/fontTable.xml"])
    assert any(
        (font.get(f"{{{W_NS}}}name") or font.get("name")) == "Tajawal"
        for font in font_table.iter(w("font"))
    )
    assert toc_paragraphs(doc_xml) == toc_paragraphs(
        worker.apply_report_fonts_to_part(template_document_xml)
    ), (
        "تغيرت بنية أو محاذاة فقرات الفهرس أثناء الدمج"
    )

    forbidden_wrap_names = {
        "wrapTight",
        "wrapSquare",
        "wrapThrough",
        "wrapTopAndBottom",
    }
    for part_name, xml_bytes in xml_parts.items():
        if not re.match(r"^word/header\d+\.xml$", part_name, re.I):
            continue
        part_root = etree.fromstring(xml_bytes)
        for anchor in part_root.iter(f"{{{WP_NS}}}anchor"):
            assert not any(
                etree.QName(child).localname in forbidden_wrap_names
                for child in anchor
            ), f"بقي التفاف ضاغط داخل {part_name}"

    blocks = list(body)

    def block_text(block: etree._Element) -> str:
        return "".join(node.text or "" for node in block.iter(w("t"))).strip()

    def last_heading_index(prefix: str) -> int:
        matches = [
            idx
            for idx, block in enumerate(blocks)
            if block.tag == w("p") and block_text(block).startswith(prefix)
        ]
        assert matches, f"attachment heading missing: {prefix}"
        return matches[-1]

    annex1 = last_heading_index("مرفق 1:")
    annex2 = last_heading_index("مرفق 2:")
    annex3 = last_heading_index("مرفق 3:")
    annex4 = last_heading_index("مرفق 4:")
    assert annex1 < annex2 < annex3 < annex4

    valuation_drawings = sum(
        sum(1 for _ in block.iter(w("drawing")))
        for block in blocks[annex1 + 1 : annex2]
    )
    assert valuation_drawings == 5
    asset_tables = [
        block for block in blocks[annex2 + 1 : annex3] if block.tag == w("tbl")
    ]
    client_tables = [
        block for block in blocks[annex3 + 1 : annex4] if block.tag == w("tbl")
    ]
    assert len(asset_tables) == 3
    assert len(client_tables) == 2
    assert sum(
        1 for block in blocks if block_text(block).startswith("مرفق 3:")
    ) == 1
    assert IMAGES_PER_ROW == 4 and IMAGES_PER_PAGE == 20
    assert ASSET_IMAGE_GAP_DXA == 45

    page_width_twips = 11906
    expected_width = int(page_width_twips * 635 * IMAGE_CONTENT_WIDTH_RATIO)
    inserted_widths = [
        int(node.get("cx") or "0")
        for block in blocks[annex1 + 1 : annex2]
        for node in block.iter(f"{{{WP_NS}}}extent")
    ]
    assert inserted_widths
    assert max(abs(width - expected_width) for width in inserted_widths) <= 1


def test_actual_template_dynamic_report_preparers_without_annex_images() -> None:
    template_path = os.path.abspath(
        os.path.join(os.path.dirname(__file__), "..", "assets", "تقرير تقييم.docx")
    )
    signature_one = make_transparent_signature_png(280, 105)
    signature_two = make_transparent_signature_png(
        155,
        130,
        (80, 40, 170, 255),
    )
    signature_one_b64 = base64.b64encode(signature_one).decode("ascii")
    signature_two_b64 = base64.b64encode(signature_two).decode("ascii")
    preparers = [
        {
            "userId": "manager-1",
            "reportDisplayName": "مدير الشركة الديناميكي",
            "jobTitle": "مقيم أساسي زميل آلات ومعدات",
            "membershipNo": "4210099991",
            # الدور الافتراضي الأول يجب أن يُستكمل داخل العامل.
            "signatureImageDataUrl": f"data:image/png;base64,{signature_one_b64}",
            "phone": "050-SECRET-MUST-NOT-APPEAR",
        },
        {
            "id": "preparer-2",
            "name": "معد التقرير الديناميكي",
            # توافق اسم الحقل القديم من إعدادات الشركة.
            "roleLabel": "مقيم منتسب آلات ومعدات",
            "membershipNumber": "4210099992",
            "signatureBase64": signature_two_b64,
        },
        {
            "userId": "inspector-3",
            "displayName": "معاين التقرير الديناميكي",
            "jobTitle": "مقيم معاين",
            "membershipNo": "",
        },
    ]

    with zipfile.ZipFile(template_path, "r") as template_zip:
        template_document_xml = template_zip.read("word/document.xml")
        template_root = etree.fromstring(template_document_xml)
        template_table = worker.find_report_preparer_table(template_root)
        assert template_table is not None
        template_rows = template_table.findall(f"{{{W_NS}}}tr")
        assert len(template_rows) == 4
        prototype = template_rows[1]
        preserved_parts = {}

    output, stats = merge_with_captured_stats(
        {
            "templatePath": template_path,
            "textValues": actual_template_values(),
            "reportPreparers": preparers,
            # لا توجد أي صور ملاحق: يجب تنفيذ حقن المعدّين رغم ذلك.
        }
    )
    assert stats["reportPreparerTableFound"] == 1
    assert stats["reportPreparerRowsRemoved"] == 3
    assert stats["reportPreparersInserted"] == 3
    assert stats["reportSignaturesInserted"] == 2
    assert stats["assetImagesInserted"] == 0
    assert stats["valuationImagesInserted"] == 0
    assert stats["clientImagesInserted"] == 0

    worker.validate_docx_package(output)
    with zipfile.ZipFile(io.BytesIO(output), "r") as output_zip:
        names = set(output_zip.namelist())
        document_xml = output_zip.read("word/document.xml")
        document_root = etree.fromstring(document_xml)
        table = worker.find_report_preparer_table(document_root)
        assert table is not None
        rows = table.findall(f"{{{W_NS}}}tr")
        assert len(rows) == 4
        bookmark_names = {
            node.get(f"{{{W_NS}}}name")
            for node in document_root.iter(f"{{{W_NS}}}bookmarkStart")
        }
        assert "_Toc235735706" in bookmark_names
        assert "_Toc235735717" in bookmark_names

        settings_root = etree.fromstring(output_zip.read("word/settings.xml"))
        assert settings_root.find(f"{{{W_NS}}}doNotAutoCompressPictures") is not None

        # خصائص الجدول وصف الرأس تبقى كما في القالب، مع توسيع عمود التوقيع فقط.
        w = lambda tag: f"{{{W_NS}}}{tag}"
        assert element_c14n(table.find(w("tblPr"))) == element_c14n(
            template_table.find(w("tblPr"))
        )
        output_grid_cols = table.find(w("tblGrid")).findall(w("gridCol"))
        template_grid_cols = template_table.find(w("tblGrid")).findall(w("gridCol"))
        assert len(output_grid_cols) == len(template_grid_cols) == 3
        assert element_c14n(output_grid_cols[0]) == element_c14n(template_grid_cols[0])
        assert element_c14n(output_grid_cols[1]) == element_c14n(template_grid_cols[1])
        template_sig_col_w = int(
            template_grid_cols[2].get(f"{{{W_NS}}}w")
            or template_grid_cols[2].get("w")
            or "0"
        )
        output_sig_col_w = int(
            output_grid_cols[2].get(f"{{{W_NS}}}w")
            or output_grid_cols[2].get("w")
            or "0"
        )
        assert output_sig_col_w == max(
            1, int(round(template_sig_col_w * worker.REPORT_SIGNATURE_DISPLAY_SCALE))
        )
        # صف الرأس: الخلايا غير التوقيع كما هي (بعد تحويل Cocon→Tajawal)، وخلية التوقيع موسّعة.
        header_cells = rows[0].findall(w("tc"))
        template_header_cells = template_rows[0].findall(w("tc"))
        assert len(header_cells) == len(template_header_cells) == 3
        assert with_report_body_font(header_cells[0]) == with_report_body_font(
            template_header_cells[0]
        )
        assert with_report_body_font(header_cells[1]) == with_report_body_font(
            template_header_cells[1]
        )
        assert table.find(f"./{w('tblPr')}/{w('bidiVisual')}") is not None
        output_section_paragraph = table.getnext()
        template_section_paragraph = template_table.getnext()
        assert output_section_paragraph is not None
        assert template_section_paragraph is not None
        assert element_c14n(
            output_section_paragraph.find(f"./{w('pPr')}/{w('sectPr')}")
        ) == element_c14n(
            template_section_paragraph.find(f"./{w('pPr')}/{w('sectPr')}")
        )

        prototype_cells = prototype.findall(w("tc"))
        for row in rows[1:]:
            assert element_c14n(row.find(w("trPr"))) == element_c14n(
                prototype.find(w("trPr"))
            )
            cells = row.findall(w("tc"))
            assert len(cells) == 3
            for cell_index, (cell, prototype_cell) in enumerate(
                zip(cells, prototype_cells)
            ):
                if cell_index == 2:
                    # عمود التوقيع موسّع؛ بقية خصائص الخلية تبقى من القالب.
                    output_tc_w = cell.find(f"./{w('tcPr')}/{w('tcW')}")
                    prototype_tc_w = prototype_cell.find(f"./{w('tcPr')}/{w('tcW')}")
                    assert output_tc_w is not None and prototype_tc_w is not None
                    prototype_w = int(
                        prototype_tc_w.get(f"{{{W_NS}}}w")
                        or prototype_tc_w.get("w")
                        or "0"
                    )
                    output_w = int(
                        output_tc_w.get(f"{{{W_NS}}}w") or output_tc_w.get("w") or "0"
                    )
                    assert output_w == max(
                        1,
                        int(round(prototype_w * worker.REPORT_SIGNATURE_DISPLAY_SCALE)),
                    )
                else:
                    assert element_c14n(cell.find(w("tcPr"))) == element_c14n(
                        prototype_cell.find(w("tcPr"))
                    )
                paragraphs = cell.findall(w("p"))
                prototype_paragraphs = prototype_cell.findall(w("p"))
                assert len(paragraphs) == len(prototype_paragraphs)
                for paragraph, prototype_paragraph in zip(
                    paragraphs,
                    prototype_paragraphs,
                ):
                    assert with_report_body_font(
                        paragraph.find(w("pPr"))
                    ) == with_report_body_font(
                        prototype_paragraph.find(w("pPr"))
                    )
                    run_properties = [
                        with_report_body_font(run.find(w("rPr")))
                        for run in paragraph.findall(w("r"))
                    ]
                    prototype_run_properties = [
                        with_report_body_font(run.find(w("rPr")))
                        for run in prototype_paragraph.findall(w("r"))
                    ]
                    assert run_properties == prototype_run_properties

        expected_rows = [
            (
                [
                    "مدير الشركة الديناميكي",
                    "مقيم أساسي زميل آلات ومعدات",
                    "عضوية رقم: 4210099991",
                    "",
                ],
                "الإدارة التنفيذية وتعميد ومراجعة المخرجات النهائية",
                1,
            ),
            (
                [
                    "معد التقرير الديناميكي",
                    "مقيم منتسب آلات ومعدات",
                    "عضوية رقم: 4210099992",
                    "",
                ],
                "إعداد التقرير",
                1,
            ),
            (
                [
                    "معاين التقرير الديناميكي",
                    "مقيم معاين",
                    "",
                    "",
                ],
                "المعاينة",
                0,
            ),
        ]
        dynamic_relationship_ids: list[str] = []
        prototype_extent = prototype.find(f".//{{{WP_NS}}}extent")
        assert prototype_extent is not None
        expected_cx = str(
            max(1, int(round(int(prototype_extent.get("cx") or "0") * worker.REPORT_SIGNATURE_DISPLAY_SCALE)))
        )
        expected_cy = str(
            max(1, int(round(int(prototype_extent.get("cy") or "0") * worker.REPORT_SIGNATURE_DISPLAY_SCALE)))
        )
        for row, (identity_lines, report_role, drawing_count) in zip(
            rows[1:],
            expected_rows,
        ):
            cells = row.findall(w("tc"))
            assert [
                "".join(node.text or "" for node in paragraph.iter(w("t")))
                for paragraph in cells[0].findall(w("p"))
            ] == identity_lines
            assert "".join(
                node.text or "" for node in cells[1].iter(w("t"))
            ) == report_role
            drawings = list(cells[2].iter(w("drawing")))
            assert len(drawings) == drawing_count
            if drawings:
                anchor = drawings[0].find(f".//{{{WP_NS}}}anchor")
                assert anchor is not None
                assert anchor.get("layoutInCell") == "1"
                assert anchor.find(f"./{{{WP_NS}}}wrapNone") is not None
                extent = anchor.find(f"./{{{WP_NS}}}extent")
                assert extent is not None
                assert (extent.get("cx"), extent.get("cy")) == (
                    expected_cx,
                    expected_cy,
                )
                blip = drawings[0].find(f".//{{{A_NS}}}blip")
                assert blip is not None
                dynamic_relationship_ids.append(blip.get(f"{{{R_NS}}}embed") or "")

        assert len(dynamic_relationship_ids) == len(set(dynamic_relationship_ids)) == 2
        document_drawing_ids = [
            element.get("id")
            for element in document_root.iter()
            if etree.QName(element).localname == "docPr" and element.get("id")
        ]
        assert len(document_drawing_ids) == len(set(document_drawing_ids))
        anchor_ids = [
            anchor.get(f"{{{WP14_NS}}}anchorId")
            for anchor in document_root.iter(f"{{{WP_NS}}}anchor")
            if anchor.get(f"{{{WP14_NS}}}anchorId")
        ]
        edit_ids = [
            anchor.get(f"{{{WP14_NS}}}editId")
            for anchor in document_root.iter(f"{{{WP_NS}}}anchor")
            if anchor.get(f"{{{WP14_NS}}}editId")
        ]
        assert len(anchor_ids) == len(set(anchor_ids))
        assert len(edit_ids) == len(set(edit_ids))
        relationships_root = etree.fromstring(
            output_zip.read("word/_rels/document.xml.rels")
        )
        relationships = {
            node.get("Id"): node
            for node in relationships_root
            if etree.QName(node).localname == "Relationship"
        }
        assert not {"rId11", "rId12", "rId13"} & set(relationships)
        from PIL import Image

        for relationship_id in dynamic_relationship_ids:
            relationship = relationships.get(relationship_id)
            assert relationship is not None
            assert relationship.get("Type", "").endswith("/image")
            target = relationship.get("Target") or ""
            package_name = f"word/{target}"
            assert package_name in names
            signature = Image.open(io.BytesIO(output_zip.read(package_name)))
            assert signature.format == "PNG"
            assert signature.mode == "RGBA"
            assert signature.size == worker.REPORT_SIGNATURE_CANVAS_SIZE

        output_preserved_parts = {
            name: canonical_xml(output_zip.read(name))
            for name in preserved_parts
        }

    text = visible_text(document_root)
    for static_value in (
        "فالح مفلح الشهراني",
        "فيصل عايض الرويلي",
        "ناصر عبد الله البصيص",
    ):
        assert static_value not in text
    assert "050-SECRET-MUST-NOT-APPEAR" not in text
    assert output_preserved_parts == preserved_parts
    assert toc_paragraphs(document_xml) == toc_paragraphs(
        worker.apply_report_fonts_to_part(template_document_xml)
    )

    # وجود المفتاح مع قائمة فارغة يحذف كل الصفوف الثابتة ولا يعيدها.
    empty_output, empty_stats = merge_with_captured_stats(
        {
            "templatePath": template_path,
            "textValues": actual_template_values(),
            "reportPreparers": [],
        }
    )
    assert empty_stats["reportPreparerRowsRemoved"] == 3
    assert empty_stats["reportPreparersInserted"] == 0
    with zipfile.ZipFile(io.BytesIO(empty_output), "r") as empty_zip:
        empty_root = etree.fromstring(empty_zip.read("word/document.xml"))
        empty_table = worker.find_report_preparer_table(empty_root)
        assert empty_table is not None
        assert len(empty_table.findall(f"{{{W_NS}}}tr")) == 1
        empty_text = visible_text(empty_root)
        assert "فالح مفلح الشهراني" not in empty_text

    # عدد أكبر من الصفوف يُنشأ ديناميكياً من نفس prototype بلا صور ملاحق.
    many_preparers = [
        {
            "userId": f"user-{index}",
            "name": f"معد ديناميكي {index}",
            "jobTitle": "مقيم آلات ومعدات",
            "membershipNo": f"4210088{index:03d}",
            "reportRole": f"دور المعد رقم {index}",
        }
        for index in range(1, 8)
    ]
    many_output, many_stats = merge_with_captured_stats(
        {
            "templatePath": template_path,
            "textValues": actual_template_values(),
            "reportPreparers": many_preparers,
        }
    )
    assert many_stats["reportPreparersInserted"] == 7
    assert many_stats["reportSignaturesInserted"] == 0
    with zipfile.ZipFile(io.BytesIO(many_output), "r") as many_zip:
        many_root = etree.fromstring(many_zip.read("word/document.xml"))
        many_table = worker.find_report_preparer_table(many_root)
        assert many_table is not None
        assert len(many_table.findall(f"{{{W_NS}}}tr")) == 8
        assert "معد ديناميكي 7" in visible_text(many_root)


def test_legacy_bookmarks_do_not_drive_text_or_images() -> None:
    document_xml = f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="{W_NS}" xmlns:r="{R_NS}">
  <w:body>
    <w:p>
      <w:bookmarkStart w:id="1" w:name="العميل"/>
      <w:r><w:t>OLD-CLIENT-BOOKMARK</w:t></w:r>
      <w:bookmarkEnd w:id="1"/>
    </w:p>
    <w:p><w:bookmarkStart w:id="2" w:name="صورحسابات"/><w:bookmarkEnd w:id="2"/></w:p>
    <w:p><w:bookmarkStart w:id="3" w:name="صوراصول"/><w:bookmarkEnd w:id="3"/></w:p>
    <w:p><w:bookmarkStart w:id="4" w:name="مستنداتعميل"/><w:bookmarkEnd w:id="4"/></w:p>
    <w:sectPr>
      <w:pgSz w:w="11906" w:h="16838"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/>
    </w:sectPr>
  </w:body>
</w:document>"""
    template = make_minimal_docx(document_xml)
    image_b64 = base64.b64encode(PNG_1X1).decode("ascii")
    output, stats = merge_with_captured_stats(
        {
            "templateBase64": base64.b64encode(template).decode("ascii"),
            "textValues": {"clientName": "NEW-CLIENT-MUST-NOT-APPEAR"},
            "textByBookmarkName": {"العميل": "BOOKMARK-MUST-NOT-APPEAR"},
            "assetImagesBase64": [image_b64],
            "valuationImagesBase64": [image_b64],
            "clientImagesBase64": [image_b64],
        }
    )
    assert stats["variablesFound"] == []
    assert stats["variablesOccurrencesFound"] == 0
    assert stats["variablesFilled"] == 0
    assert stats["assetImagesInserted"] == 0
    assert stats["valuationImagesInserted"] == 0
    assert stats["clientImagesInserted"] == 0
    assert "bookmarksFound" not in stats

    with zipfile.ZipFile(io.BytesIO(output), "r") as z:
        root = etree.fromstring(z.read("word/document.xml"))
        media = [name for name in z.namelist() if name.startswith("word/media/")]
    text = visible_text(root)
    assert "OLD-CLIENT-BOOKMARK" in text
    assert "NEW-CLIENT-MUST-NOT-APPEAR" not in text
    assert "BOOKMARK-MUST-NOT-APPEAR" not in text
    assert not media
    assert not list(root.iter(f"{{{W_NS}}}drawing"))


def test_toc_keeps_template_font_direction_and_styles() -> None:
    document_xml = f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="{W_NS}"><w:body>
  <w:p>
    <w:pPr><w:pStyle w:val="10"/><w:bidi/><w:tabs><w:tab w:val="right" w:pos="9000"/></w:tabs><w:jc w:val="right"/></w:pPr>
    <w:r><w:rPr><w:rFonts w:ascii="CoconNextArabic-Light" w:hAnsi="CoconNextArabic-Light" w:cs="CoconNextArabic-Light"/><w:rtl/></w:rPr><w:t>8.0\t«أصلأصول» محل التقييم\t</w:t></w:r>
    <w:r><w:fldChar w:fldCharType="begin"/></w:r>
    <w:r><w:instrText>PAGEREF _Toc123 \\h</w:instrText></w:r>
    <w:r><w:fldChar w:fldCharType="separate"/></w:r>
    <w:r><w:rPr><w:rFonts w:cs="CoconNextArabic-Light"/><w:rtl/></w:rPr><w:t>3</w:t></w:r>
    <w:r><w:fldChar w:fldCharType="end"/></w:r>
  </w:p>
  <w:sectPr/>
</w:body></w:document>""".encode("utf-8")
    original = etree.fromstring(document_xml)
    original_para = next(original.iter(f"{{{W_NS}}}p"))
    original_ppr = etree.tostring(
        original_para.find(f"{{{W_NS}}}pPr"), method="c14n"
    )
    original_rprs = [
        etree.tostring(node, method="c14n")
        for node in original_para.iter(f"{{{W_NS}}}rPr")
    ]

    font_safe = worker.apply_report_fonts_to_part(document_xml)
    merged, found, filled = worker.apply_visible_variable_values(
        font_safe, {"assetSingularPlural": "الأصول"}
    )
    result = etree.fromstring(merged)
    result_para = next(result.iter(f"{{{W_NS}}}p"))
    assert found == 1 and filled == 1
    assert "8.0\tالأصول محل التقييم\t3" == visible_text(result_para)
    assert etree.tostring(result_para.find(f"{{{W_NS}}}pPr"), method="c14n") == original_ppr
    assert [
        etree.tostring(node, method="c14n")
        for node in result_para.iter(f"{{{W_NS}}}rPr")
    ] == original_rprs

    styles_xml = f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="{W_NS}">
  <w:style w:type="paragraph" w:styleId="10"><w:name w:val="toc 1"/><w:rPr><w:rFonts w:cs="CoconNextArabic-Light"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Body"><w:name w:val="Body"/><w:rPr><w:rFonts w:cs="CoconNextArabic-Light"/></w:rPr></w:style>
</w:styles>""".encode("utf-8")
    styles = etree.fromstring(worker.apply_tajawal_to_styles(styles_xml))
    style_rows = list(styles.iter(f"{{{W_NS}}}style"))
    toc_font = next(style_rows[0].iter(f"{{{W_NS}}}rFonts")).get(f"{{{W_NS}}}cs")
    body_font = next(style_rows[1].iter(f"{{{W_NS}}}rFonts")).get(f"{{{W_NS}}}cs")
    assert toc_font == "CoconNextArabic-Light"
    assert body_font == "Tajawal"


def main() -> None:
    test_stretch_fills_uniform_canvas_without_crop_or_pad()
    print("OK: image canvas regression")
    test_report_signature_removes_opaque_white_margins()
    print("OK: report signature white margins are removed")
    test_redundant_blank_page_breaks_are_removed()
    print("OK: redundant blank page breaks are removed")
    test_docx_safe_baseline_jpeg_passthrough_skips_reencode()
    print("OK: baseline JPEG passthrough skips re-encode")
    test_visible_syntaxes_split_runs_and_rpr()
    print("OK: visible « » and << >> variables, split runs, rPr, no bookmark values")
    test_actual_template_variables_mail_merge_cleanup_and_images()
    print("OK: actual template variables, mail-merge cleanup, heading-based images")
    test_actual_template_dynamic_report_preparers_without_annex_images()
    print("OK: dynamic report preparers, signatures, preserved Word table formatting")
    test_legacy_bookmarks_do_not_drive_text_or_images()
    print("OK: legacy bookmarks do not drive text or image insertion")
    test_toc_keeps_template_font_direction_and_styles()
    print("OK: TOC keeps template font, direction, tabs, and styles")


if __name__ == "__main__":
    main()
