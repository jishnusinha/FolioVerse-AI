"""Generates the synthetic DEMO documents in ``datasets/synthetic/docs``.

All content is fictional. Output is byte-for-byte reproducible (fixed metadata, ``invariant=1``),
so the committed files only change when this script changes.

    python -m uv run --package folioverse-ai python datasets/synthetic/make_docs.py
"""

from pathlib import Path

from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas

OUT = Path(__file__).parent / "docs"

ATLAS_BRIEF = [
    (
        "Project Atlas Brief",
        [
            ("Summary", [
                "This brief is a fictional DEMO document prepared for FolioVerse tests.",
                "Under the base scenario, the market for assisted research tools grows at a compound",
                "annual rate of 14.2% between 2026 and 2030.",
                "Regulated industries lead demand because they must document how conclusions were reached.",
            ]),
            ("Upside scenario", [
                "The upside case reaches 19% annual growth if enterprise procurement shortens",
                "to under six months.",
                "Analysts describe the upside case as plausible but not probable.",
            ]),
        ],
    ),
    (
        "Risks",
        [
            ("Pricing pressure", [
                "Bundled office suites are the main pricing risk for standalone research tools.",
                "Vendors that rely on per-seat pricing face the strongest discount pressure.",
            ]),
            ("Procurement", [
                "Growth above 12% per year is unlikely while procurement cycles exceed nine months.",
                "Data-residency reviews add roughly eight weeks to public-sector deals.",
            ]),
        ],
    ),
    (
        "Method and regions",
        [
            ("Survey", [
                "The survey covered 412 organisations across three regions in the spring of 2026.",
                "Responses were weighted by organisation size and sector.",
            ]),
            ("Regional outlook", [
                "EMEA adoption trails North America by about two years.",
                "APAC shows the fastest growth among mid-sized firms, led by logistics companies.",
            ]),
        ],
    ),
]


def atlas_brief_pdf() -> bytes:
    path = OUT / "atlas-brief.pdf"
    c = canvas.Canvas(str(path), pagesize=A4, invariant=1)
    c.setTitle("Project Atlas Brief (DEMO)")
    c.setAuthor("FolioVerse synthetic data")
    for title, sections in ATLAS_BRIEF:
        y = 780
        c.setFont("Helvetica-Bold", 20)
        c.drawString(72, y, title)
        y -= 40
        for heading, lines in sections:
            c.setFont("Helvetica-Bold", 13)
            c.drawString(72, y, heading)
            y -= 22
            c.setFont("Helvetica", 11)
            for ln in lines:
                c.drawString(72, y, ln)
                y -= 16
            y -= 14
        c.setFont("Helvetica", 8)
        c.drawString(72, 40, "Fictional DEMO content - FolioVerse synthetic dataset")
        c.showPage()
    c.save()
    return path.read_bytes()


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    data = atlas_brief_pdf()
    print(f"atlas-brief.pdf {len(data)} bytes")
