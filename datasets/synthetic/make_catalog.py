"""Generates the synthetic DEMO discovery catalog and the recommendation holdout.

Every title, creator and description is invented for FolioVerse; nothing describes a real work.
Output is deterministic for a given seed:

    datasets/synthetic/catalog/catalog.jsonl        books and films (``isDemo: true``)
    datasets/synthetic/catalog/manifest.json
    datasets/evaluation/rec-holdout/train.jsonl     implicit interactions of synthetic users
    datasets/evaluation/rec-holdout/test.jsonl      each user's most recent 20 % (offline evaluation)
    datasets/evaluation/rec-holdout/manifest.json

    python -m uv run --package folioverse-ml python datasets/synthetic/make_catalog.py
"""

import hashlib
import json
import math
import random
import uuid
from pathlib import Path

SEED = 7
BOOKS = 330
FILMS = 200
USERS = 300
NAMESPACE = uuid.UUID("6f1c2a52-3a1e-4f43-9a51-7d0c5e2b9f10")
ROOT = Path(__file__).resolve().parent
CATALOG_DIR = ROOT / "catalog"
HOLDOUT_DIR = ROOT.parent / "evaluation" / "rec-holdout"

GENRES = ["Sci-fi", "Literary", "Mystery", "Fantasy", "Historical", "Thriller", "Romance", "Horror"]
MOODS = ["Atmospheric", "Melancholic", "Hopeful", "Tense", "Whimsical", "Dark", "Warm", "Cerebral"]

GENRE_WORDS = {
    "Sci-fi": "science fiction",
    "Literary": "literary fiction",
    "Mystery": "mystery",
    "Fantasy": "fantasy",
    "Historical": "historical fiction",
    "Thriller": "thriller",
    "Romance": "romance",
    "Horror": "horror",
}
MOOD_WORDS = {
    "Atmospheric": ("told in slow, immersive detail", ["Quiet", "Pale", "Distant", "Lantern"]),
    "Melancholic": ("carrying a quiet ache", ["Last", "Fading", "Grey", "Winter"]),
    "Hopeful": ("that ends in hard-won hope", ["Bright", "Morning", "Open", "Rising"]),
    "Tense": ("with tension that never lets up", ["Broken", "Cold", "Burning", "Sharp"]),
    "Whimsical": ("full of playful invention", ["Curious", "Paper", "Clockwork", "Painted"]),
    "Dark": ("unflinching and dark", ["Hollow", "Black", "Drowned", "Bitter"]),
    "Warm": ("generous and warm-hearted", ["Golden", "Kind", "Small", "Summer"]),
    "Cerebral": ("built around puzzles of mind and meaning", ["Infinite", "Recursive", "Hidden", "Silent"]),
}

# theme -> (genres it suits, moods it suits, description phrases, title nouns)
THEMES: dict[str, tuple[list[str], list[str], list[str], list[str]]] = {
    "isolation": (
        ["Sci-fi", "Literary", "Horror"],
        ["Atmospheric", "Melancholic"],
        ["a keeper alone at the edge of a quiet outpost", "long months without another voice"],
        ["Outpost", "Solitude", "Keeper"],
    ),
    "signals": (
        ["Sci-fi", "Thriller"],
        ["Atmospheric", "Cerebral"],
        ["a faint signal repeating from deep space", "radio operators decoding a message no one sent"],
        ["Array", "Frequency", "Signal"],
    ),
    "memory": (
        ["Literary", "Sci-fi"],
        ["Melancholic", "Cerebral"],
        ["memories that do not belong to the one who holds them", "an archive of remembered days"],
        ["Afterimage", "Echo", "Remembrance"],
    ),
    "archives": (
        ["Literary", "Mystery", "Sci-fi"],
        ["Atmospheric", "Cerebral"],
        ["librarians cataloguing what survived", "a forgotten archive beneath the city"],
        ["Archive", "Ledger", "Catalogue"],
    ),
    "family": (
        ["Literary", "Romance", "Historical"],
        ["Warm", "Melancholic"],
        ["estranged siblings returning to the family home", "a secret passed down three generations"],
        ["Inheritance", "Household", "Daughters"],
    ),
    "grief": (
        ["Literary", "Horror"],
        ["Melancholic", "Dark"],
        ["a widow learning to live in an empty house", "mourning that changes shape over a year"],
        ["Mourning", "Absence", "Elegy"],
    ),
    "the sea": (
        ["Fantasy", "Literary", "Thriller"],
        ["Atmospheric", "Melancholic"],
        ["a lighthouse above a restless sea", "fishing crews caught by a storm"],
        ["Tide", "Harbour", "Lighthouse"],
    ),
    "climate": (
        ["Sci-fi", "Literary"],
        ["Hopeful", "Melancholic"],
        ["a city rebuilding after the floods", "farmers adapting to a warming world"],
        ["Flood", "Drought", "Weather"],
    ),
    "artificial minds": (
        ["Sci-fi", "Thriller"],
        ["Cerebral", "Tense"],
        ["a machine that begins to doubt its makers", "an assistant that learns to lie kindly"],
        ["Engine", "Automaton", "Machine"],
    ),
    "exploration": (
        ["Sci-fi", "Historical", "Fantasy"],
        ["Hopeful", "Atmospheric"],
        ["an expedition beyond the mapped world", "surveyors charting an unknown coast"],
        ["Expedition", "Cartographer", "Frontier"],
    ),
    "war": (
        ["Historical", "Thriller"],
        ["Dark", "Tense"],
        ["a soldier carrying letters home", "a city under a long siege"],
        ["Siege", "Trench", "Armistice"],
    ),
    "exile": (
        ["Literary", "Historical", "Fantasy"],
        ["Melancholic", "Hopeful"],
        ["an heir stripped of her name", "refugees making a home far from the border"],
        ["Exile", "Border", "Wanderer"],
    ),
    "heists": (
        ["Thriller", "Mystery"],
        ["Tense", "Whimsical"],
        ["a crew planning one last impossible theft", "a vault no one has opened in a century"],
        ["Vault", "Heist", "Forger"],
    ),
    "small towns": (
        ["Mystery", "Horror", "Romance", "Literary"],
        ["Warm", "Dark"],
        ["a small town where everyone keeps a secret", "a festival that returns every summer"],
        ["Parish", "Crossroads", "Township"],
    ),
    "detectives": (
        ["Mystery", "Thriller"],
        ["Tense", "Cerebral"],
        ["a tired inspector reopening a cold case", "an amateur sleuth with a stubborn streak"],
        ["Inspector", "Alibi", "Witness"],
    ),
    "magic with a cost": (
        ["Fantasy"],
        ["Dark", "Cerebral"],
        ["magic that is paid for in memory", "spells bound by strict, cruel rules"],
        ["Spell", "Grimoire", "Sigil"],
    ),
    "mythic creatures": (
        ["Fantasy", "Horror"],
        ["Whimsical", "Dark"],
        ["a dragon sleeping beneath the mountain", "creatures from the old songs walking again"],
        ["Dragon", "Wyrm", "Beast"],
    ),
    "court intrigue": (
        ["Fantasy", "Historical"],
        ["Tense", "Cerebral"],
        ["rival houses scheming for the throne", "a spy hidden among the queen's ladies"],
        ["Crown", "Throne", "Court"],
    ),
    "first love": (
        ["Romance", "Literary"],
        ["Warm", "Hopeful"],
        ["two students falling for each other one summer", "a first love remembered decades later"],
        ["Summer", "Promise", "Letters"],
    ),
    "second chances": (
        ["Romance", "Literary"],
        ["Warm", "Hopeful"],
        ["former partners meeting again at a wedding", "a chef starting over in a new town"],
        ["Return", "Homecoming", "Reunion"],
    ),
    "haunted houses": (
        ["Horror"],
        ["Dark", "Atmospheric"],
        ["a house that rearranges its rooms at night", "voices in the walls of an old manor"],
        ["Manor", "Attic", "Haunting"],
    ),
    "folklore": (
        ["Horror", "Fantasy"],
        ["Atmospheric", "Whimsical"],
        ["village legends that turn out to be true", "a bargain struck with the forest"],
        ["Hollow", "Woods", "Legend"],
    ),
    "time travel": (
        ["Sci-fi", "Romance"],
        ["Cerebral", "Melancholic"],
        ["a traveller stuck repeating the same day", "lovers separated by a century"],
        ["Paradox", "Loop", "Hourglass"],
    ),
    "dystopia": (
        ["Sci-fi", "Thriller"],
        ["Dark", "Tense"],
        ["a surveillance state that rations words", "rebels hiding in a walled city"],
        ["Ministry", "Wall", "Republic"],
    ),
    "cities": (
        ["Literary", "Mystery"],
        ["Atmospheric", "Melancholic"],
        ["night walks through a sprawling city", "strangers whose lives cross on one street"],
        ["Avenue", "Metropolis", "District"],
    ),
    "work and class": (
        ["Literary", "Historical"],
        ["Melancholic", "Hopeful"],
        ["mill workers organising a strike", "a servant who outlives the family she served"],
        ["Mill", "Wages", "Foundry"],
    ),
    "faith": (
        ["Literary", "Historical"],
        ["Melancholic", "Cerebral"],
        ["a priest losing and finding belief", "pilgrims crossing a mountain pass"],
        ["Pilgrim", "Chapel", "Psalm"],
    ),
    "identity": (
        ["Literary", "Romance", "Sci-fi"],
        ["Cerebral", "Hopeful"],
        ["a clone meeting the person she was copied from", "a translator living between two languages"],
        ["Mirror", "Double", "Name"],
    ),
    "revolution": (
        ["Historical", "Sci-fi", "Fantasy"],
        ["Tense", "Hopeful"],
        ["students printing pamphlets against the regime", "a colony rising against its company"],
        ["Uprising", "Barricade", "Manifesto"],
    ),
    "survival": (
        ["Thriller", "Horror", "Sci-fi"],
        ["Tense", "Dark"],
        ["climbers trapped by an avalanche", "a crew stranded on a frozen moon"],
        ["Whiteout", "Shelter", "Rations"],
    ),
    "music": (
        ["Literary", "Romance"],
        ["Warm", "Melancholic"],
        ["a jazz pianist chasing one perfect night", "an orchestra rehearsing through a war"],
        ["Nocturne", "Requiem", "Chorus"],
    ),
    "journeys": (
        ["Literary", "Fantasy", "Historical"],
        ["Hopeful", "Atmospheric"],
        ["a train crossing a continent", "a long walk home across a broken country"],
        ["Railway", "Crossing", "Road"],
    ),
    "conspiracy": (
        ["Thriller", "Mystery"],
        ["Tense", "Cerebral"],
        ["a journalist pulling at a buried story", "files that should have been destroyed"],
        ["Cipher", "Dossier", "Protocol"],
    ),
    "science and discovery": (
        ["Historical", "Literary", "Sci-fi"],
        ["Cerebral", "Hopeful"],
        ["a naturalist cataloguing a vanishing island", "an astronomer who sees what others missed"],
        ["Observatory", "Specimen", "Equation"],
    ),
    "found family": (
        ["Fantasy", "Sci-fi", "Romance"],
        ["Warm", "Hopeful"],
        ["misfits crewing a battered ship together", "orphans building a household of their own"],
        ["Crew", "Company", "Kin"],
    ),
    "coming of age": (
        ["Literary", "Fantasy", "Romance"],
        ["Hopeful", "Melancholic"],
        ["a girl's last summer before leaving home", "an apprentice outgrowing her master"],
        ["Apprentice", "Threshold", "Youth"],
    ),
    "space stations": (
        ["Sci-fi"],
        ["Atmospheric", "Tense"],
        ["life aboard a ring station in slow orbit", "maintenance crews in the dark between stars"],
        ["Station", "Orbit", "Ring"],
    ),
    "deserts": (
        ["Fantasy", "Sci-fi", "Historical"],
        ["Atmospheric", "Tense"],
        ["caravans crossing a salt desert", "a city of glass in the sand"],
        ["Dune", "Oasis", "Caravan"],
    ),
    "islands": (
        ["Mystery", "Literary", "Horror"],
        ["Atmospheric", "Dark"],
        ["guests cut off on a stormy island", "a remote island with a single doctor"],
        ["Island", "Reef", "Causeway"],
    ),
    "letters": (
        ["Literary", "Romance", "Historical"],
        ["Warm", "Melancholic"],
        ["a love story told in letters", "a postmistress reading what she should not"],
        ["Correspondence", "Postmark", "Envelope"],
    ),
}

FIRST = "Ada Adeyemi Anaïs Arjun Beatrix Cato Dalia Elio Esme Farid Greta Hollis Ines Ivo Jun Kasia Leon Lior Maren Mateo Nadia Noor Odile Omar Petra Quill Rafael Rosa Saoirse Soren Tamsin Teodor Una Valen Wren Xiadani Yusuf Zora Bram Celeste".split()
LAST = "Abara Ashgrove Bellamy Calloway Castellan Dunmore Eriksen Fairweather Galloway Hale Halvorsen Ibarra Jansen Kestrel Lindqvist Marchetti Moreau Nakamura Novak Okonjo Orsini Pell Quintero Ravel Sato Sorensen Thorne Underwood Valdez Varga Verhoeven Whitlock Yilmaz Zeller Achebe Brandt Carrow Delacroix Esteban Fennimore".split()
LINKS = ["of the", "for the", "beneath the", "after the", "beyond the"]


def _id(slug: str) -> str:
    return str(uuid.uuid5(NAMESPACE, slug))


def _pick_themes(rng: random.Random, genre: str, n: int) -> list[str]:
    pool = [t for t, (g, *_rest) in THEMES.items() if genre in g]
    others = [t for t in THEMES if t not in pool]
    picked = rng.sample(pool, min(len(pool), max(1, n - 1)))
    while len(picked) < n:
        t = rng.choice(pool if rng.random() < 0.6 else others)
        if t not in picked:
            picked.append(t)
    return picked


def _title(rng: random.Random, themes: list[str], mood: str, used: set[str]) -> str:
    adj = MOOD_WORDS[mood][1]
    nouns = THEMES[themes[0]][3]
    second = THEMES[themes[1 % len(themes)]][3]
    for _ in range(50):
        pattern = rng.randrange(5)
        if pattern == 0:
            t = f"The {rng.choice(adj)} {rng.choice(nouns)}"
        elif pattern == 1:
            t = f"{rng.choice(nouns)} {rng.choice(LINKS)} {rng.choice(second)}"
        elif pattern == 2:
            noun = rng.choice(nouns)
            t = f"{'An' if noun[0] in 'AEIOU' else 'A'} {noun} for {rng.choice(FIRST)}"
        elif pattern == 3:
            t = f"{rng.choice(adj)} {rng.choice(second)}"
        else:
            t = f"The {rng.choice(nouns)}'s {rng.choice(second)}"
        if t not in used:
            used.add(t)
            return t
    t = f"The {rng.choice(adj)} {rng.choice(nouns)} {len(used)}"
    used.add(t)
    return t


def _description(
    rng: random.Random, kind: str, genres: list[str], moods: list[str], themes: list[str]
) -> str:
    noun = "A novel" if kind == "BOOK" else "A film"
    a = rng.choice(THEMES[themes[0]][2])
    b = rng.choice(THEMES[themes[1]][2]) if len(themes) > 1 else ""
    rest = [rng.choice(THEMES[t][2]) for t in themes[2:]]
    genre = " and ".join(GENRE_WORDS[g] for g in genres)
    mood = MOOD_WORDS[moods[0]][0]
    s1 = f"{noun} about {a}" + (f" and {b}" if b else "") + "."
    s2 = f"{genre[0].upper()}{genre[1:]} {mood}" + (f", with {' and '.join(rest)}" if rest else "") + "."
    return f"{s1} {s2}"


class Creators:
    def __init__(self, rng: random.Random, n: int):
        names = set()
        while len(names) < n:
            names.add(f"{rng.choice(FIRST)} {rng.choice(LAST)}")
        self.people = [
            {"name": name, "genre": rng.choice(GENRES), "themes": None, "count": 0} for name in sorted(names)
        ]
        for p in self.people:
            p["themes"] = _pick_themes(rng, p["genre"], 3)

    def choose(self, rng: random.Random) -> dict:
        # Prolific creators are reused, so some have several works (exercises the per-creator diversity cap).
        weights = [1.0 / (1 + p["count"]) if p["count"] < 4 else 0.0 for p in self.people]
        p = rng.choices(self.people, weights=weights)[0]
        p["count"] += 1
        return p


def make_items(rng: random.Random) -> list[dict]:
    items: list[dict] = []
    used: set[str] = set()
    authors = Creators(rng, 150)
    directors = Creators(rng, 110)

    def build(kind: str, n: int, people: Creators, prefix: str):
        series_left: list[tuple[str, dict, int]] = []
        for i in range(1, n + 1):
            slug = f"{prefix}{i:04d}"
            if series_left and rng.random() < 0.35:
                franchise, person, left = series_left.pop(0)
                if left > 1:
                    series_left.append((franchise, person, left - 1))
                genre = person["genre"]
                themes = list(person["themes"])
                rng.shuffle(themes)
            else:
                person = people.choose(rng)
                franchise = None
                genre = person["genre"] if rng.random() < 0.75 else rng.choice(GENRES)
                themes = list(person["themes"][:2]) + _pick_themes(rng, genre, 2)
                themes = list(dict.fromkeys(themes))[: rng.choice([3, 3, 4, 5])]
            genres = [genre] + ([rng.choice([g for g in GENRES if g != genre])] if rng.random() < 0.3 else [])
            suited = [m for t in themes for m in THEMES[t][1]]
            moods = list(
                dict.fromkeys([rng.choice(suited)] + ([rng.choice(MOODS)] if rng.random() < 0.4 else []))
            )
            title = _title(rng, themes, moods[0], used)
            if franchise is None and rng.random() < 0.06:
                franchise = f"The {title.split()[-1].rstrip('s')} Cycle"
                series_left.append(
                    (
                        franchise,
                        {"name": person["name"], "genre": genre, "themes": themes},
                        rng.choice([1, 2, 3]),
                    )
                )
            weights = [round(1.0 - 0.15 * k, 2) for k in range(len(themes))]
            popularity = int(math.exp(rng.gauss(4.2, 1.1)))
            quality = round(
                min(4.9, max(2.5, rng.gauss(3.75, 0.38) + 0.05 * math.log1p(popularity) - 0.2)), 2
            )
            items.append(
                {
                    "id": _id(slug),
                    "slug": slug,
                    "kind": kind,
                    "title": title,
                    "creators": [person["name"]],
                    "year": rng.randint(1952, 2025),
                    "genres": genres,
                    "moods": moods,
                    "themes": [{"name": t, "weight": w} for t, w in zip(themes, weights, strict=True)],
                    "description": _description(rng, kind, genres, moods, themes),
                    "franchise": franchise,
                    "length": rng.randint(180, 720) if kind == "BOOK" else rng.randint(82, 171),
                    "quality": quality,
                    "popularity": popularity,
                    "coverTone": rng.randint(1, 6),
                    "isDemo": True,
                }
            )

    build("BOOK", BOOKS, authors, "b")
    books = list(items)
    build("FILM", FILMS, directors, "f")
    # A few films adapt books: same title and themes, shared franchise, so related-across-media is real.
    for film, book in zip(items[BOOKS : BOOKS + 24], rng.sample(books, 24), strict=True):
        film.update(
            title=book["title"],
            themes=book["themes"],
            genres=book["genres"],
            moods=book["moods"],
            franchise=book["franchise"] or book["title"],
            description=_description(
                rng, "FILM", book["genres"], book["moods"], [t["name"] for t in book["themes"]]
            )
            + f" Adapted from the novel by {book['creators'][0]}.",
        )
        book["franchise"] = film["franchise"]
    return items


def make_users(rng: random.Random, items: list[dict]) -> tuple[list[dict], list[dict]]:
    """Synthetic users with 1–2 taste clusters; implicit positives sampled by affinity and popularity."""
    train: list[dict] = []
    test: list[dict] = []
    for u in range(1, USERS + 1):
        user = f"u{u:04d}"
        clusters = []
        for _ in range(rng.choice([1, 1, 2])):
            g = rng.choice(GENRES)
            clusters.append((g, set(_pick_themes(rng, g, rng.choice([2, 3, 4]))), rng.choice(MOODS)))
        kind_pref = rng.choices(["BOOK", "FILM", None], weights=[0.35, 0.2, 0.45])[0]
        scored = []
        for it in items:
            names = {t["name"] for t in it["themes"]}
            aff = max(
                1.6 * len(names & th)
                + (1.0 if g in it["genres"] else 0.0)
                + (0.5 if m in it["moods"] else 0.0)
                for g, th, m in clusters
            )
            if kind_pref and it["kind"] != kind_pref:
                aff -= 1.2
            aff += 0.25 * math.log1p(it["popularity"]) + rng.gauss(0, 0.6)
            scored.append((aff, it["slug"]))
        scored.sort(reverse=True)
        n = rng.randint(10, 36)
        pool = scored[: n * 3]
        picked = rng.sample(pool, n)
        rows = [
            {"user": user, "item": slug, "ts": ts, "w": rng.choice([1.0, 1.0, 0.6])}
            for ts, (_, slug) in enumerate(sorted(picked, key=lambda _x: rng.random()), start=1)
        ]
        cut = len(rows) - max(2, round(len(rows) * 0.2))
        train.extend(rows[:cut])
        test.extend(rows[cut:])
    return train, test


def _write_jsonl(path: Path, rows: list[dict]) -> str:
    path.parent.mkdir(parents=True, exist_ok=True)
    data = "".join(json.dumps(r, ensure_ascii=False, separators=(",", ":")) + "\n" for r in rows)
    path.write_text(data, encoding="utf-8", newline="\n")
    return hashlib.sha256(data.encode()).hexdigest()


def _write_json(path: Path, obj: dict) -> None:
    path.write_text(json.dumps(obj, indent=2, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")


def main() -> None:
    rng = random.Random(SEED)
    items = make_items(rng)
    train, test = make_users(rng, items)
    cat_sha = _write_jsonl(CATALOG_DIR / "catalog.jsonl", items)
    train_sha = _write_jsonl(HOLDOUT_DIR / "train.jsonl", train)
    test_sha = _write_jsonl(HOLDOUT_DIR / "test.jsonl", test)
    _write_json(
        CATALOG_DIR / "manifest.json",
        {
            "name": "folioverse-demo-catalog",
            "isDemo": True,
            "note": "Synthetic titles, creators and descriptions generated by make_catalog.py. Not real works.",
            "seed": SEED,
            "items": len(items),
            "books": sum(1 for i in items if i["kind"] == "BOOK"),
            "films": sum(1 for i in items if i["kind"] == "FILM"),
            "genres": GENRES,
            "moods": MOODS,
            "themes": list(THEMES),
            "sha256": cat_sha,
        },
    )
    _write_json(
        HOLDOUT_DIR / "manifest.json",
        {
            "name": "rec-holdout",
            "isDemo": True,
            "note": "Implicit positives of synthetic users; test holds each user's most recent 20 % (min 2).",
            "seed": SEED,
            "users": USERS,
            "train": len(train),
            "test": len(test),
            "catalogSha256": cat_sha,
            "trainSha256": train_sha,
            "testSha256": test_sha,
        },
    )
    print(f"catalog: {len(items)} items; holdout: {len(train)} train / {len(test)} test interactions")


if __name__ == "__main__":
    main()
