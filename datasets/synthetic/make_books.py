"""Generates the synthetic DEMO EPUB in ``datasets/synthetic/books``.

"Orbit of Small Lanterns" is fictional and written for FolioVerse tests. Chapter 4 holds a reveal
(who keeps the lanterns) that a spoiler-guarded explanation in earlier chapters must never surface.
ebooklib stamps the modification time, so regenerated files differ only in that timestamp.

    python -m uv run --package folioverse-ai python datasets/synthetic/make_books.py
"""

from html import escape
from pathlib import Path

from ebooklib import epub

OUT = Path(__file__).parent / "books"
SPOILER = "The keeper of the lanterns was Ilse's mother, Rhea Varga, who had never left the station."

CHAPTERS = [
    (
        "Chapter 1 — The Halcyon Ring",
        [
            "Ilse Varga woke to the hum of the Halcyon Ring turning beneath her, the station's slow orbit "
            "carrying the archive decks out of the planet's shadow and into thin gold light.",
            "Every evening someone lit the small lanterns along the outer corridor. Nobody on the duty roster "
            "admitted to doing it, and the lanterns burned with a pale albedo that no supply crate explained.",
            "Ilse had come to the ring to catalogue its library: eleven thousand paper books, carried up a "
            "century ago by settlers who did not trust anything that needed a power supply to be read.",
            "Her first morning, she found a lantern on her own desk, still warm, set beside a copy of "
            "a star atlas open to the page that showed the ring's perihelion.",
            "She asked the quartermaster about it. He shrugged and said the lanterns were older than the "
            "roster, and that it was bad luck to ask who tended them.",
        ],
    ),
    (
        "Chapter 2 — The Archivist",
        [
            "Teodor Lusk had kept the archive for thirty years. He spoke to the books as if they were patients, "
            "and he wrote his notes in a cipher of his own invention that he called marginalia.",
            "He showed Ilse the oldest shelf, where the settlers' journals were kept in airtight sleeves, and "
            "explained that the ring passed perihelion every ninety-one days, when the light grew harsh enough "
            "to fade ink.",
            "On those days the archive was sealed. Teodor said the lanterns were brighter during perihelion, "
            "as if someone wanted the corridor to stay visible while the windows were shuttered.",
            "Ilse copied one of his marginalia into her own notebook: a lantern drawn inside a circle, and "
            "beneath it the word 'keeper'.",
        ],
    ),
    (
        "Chapter 3 — A Lantern Fails",
        [
            "On the night before perihelion, the lantern outside the archive guttered and went dark. Ilse waited "
            "in the corridor with her notebook and a thermos, determined to see who would come to relight it.",
            "Nobody came for hours. Then she heard footsteps that stopped short of the bend, and a voice humming "
            "a lullaby she had not heard since she was a child on the planet below.",
            "When she turned the corner the lantern was burning again, and the corridor was empty except for a "
            "folded slip of paper with the same circle-and-lantern mark Teodor had drawn.",
            "She did not sleep. She sat with the slip of paper and the star atlas, trying to remember where she "
            "had heard the lullaby, and who had sung it.",
        ],
    ),
    (
        "Chapter 4 — Perihelion",
        [
            "At perihelion the archive was sealed, and Ilse followed the brightest lanterns down to the lowest "
            "deck, a maintenance level that the station plans marked as decommissioned.",
            SPOILER,
            "Rhea had stayed behind when the last shuttle left, tending the lanterns so the archive would never "
            "go dark, and writing to her daughter in letters she never sent.",
            "Ilse sat with her mother among the shelves until the light softened again, and together they lit "
            "the lanterns for the evening.",
        ],
    ),
]


def build() -> bytes:
    book = epub.EpubBook()
    book.set_identifier("urn:isbn:9780000000002")
    book.set_title("Orbit of Small Lanterns")
    book.set_language("en")
    book.add_author("Anaïs Verhoeven")
    book.add_metadata("DC", "publisher", "FolioVerse Synthetic Press (DEMO)")
    book.add_metadata("DC", "date", "2024-03-01")
    book.add_metadata("DC", "subject", "Science fiction")
    book.add_metadata("DC", "subject", "Family")
    book.add_metadata(
        "DC",
        "description",
        "A fictional DEMO novel: an archivist on an orbital station searches for whoever lights its lanterns.",
    )
    chapters = []
    for i, (title, paras) in enumerate(CHAPTERS, start=1):
        body = f"<h1>{escape(title)}</h1>" + "".join(f"<p>{escape(p)}</p>" for p in paras)
        ch = epub.EpubHtml(title=title, file_name=f"chapter-{i}.xhtml", lang="en", content=body)
        book.add_item(ch)
        chapters.append(ch)
    book.toc = tuple(chapters)
    book.spine = chapters
    book.add_item(epub.EpubNcx())
    book.add_item(epub.EpubNav())
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / "small-lanterns.epub"
    epub.write_epub(str(path), book)
    return path.read_bytes()


if __name__ == "__main__":
    data = build()
    print(f"small-lanterns.epub {len(data)} bytes")
