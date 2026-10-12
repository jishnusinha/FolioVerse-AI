"""Catalog and interaction records (JSON Lines produced by datasets/synthetic/make_catalog.py)."""

import hashlib
import json
from dataclasses import dataclass, field
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_CATALOG = REPO_ROOT / "datasets" / "synthetic" / "catalog" / "catalog.jsonl"
DEFAULT_HOLDOUT = REPO_ROOT / "datasets" / "evaluation" / "rec-holdout"


@dataclass(frozen=True)
class Item:
    id: str
    slug: str
    kind: str
    title: str
    creators: tuple[str, ...]
    year: int | None
    genres: tuple[str, ...]
    moods: tuple[str, ...]
    themes: dict[str, float]
    description: str
    franchise: str | None
    quality: float
    popularity: int
    is_demo: bool = True

    @classmethod
    def from_json(cls, d: dict) -> "Item":
        themes = d.get("themes") or []
        return cls(
            id=d["id"],
            slug=d.get("slug") or d["id"],
            kind=d["kind"],
            title=d["title"],
            creators=tuple(d.get("creators") or ()),
            year=d.get("year"),
            genres=tuple(d.get("genres") or ()),
            moods=tuple(d.get("moods") or ()),
            themes={t["name"]: float(t.get("weight", 1.0)) for t in themes}
            if themes and isinstance(themes[0], dict)
            else {t: 1.0 for t in themes},
            description=d.get("description") or "",
            franchise=d.get("franchise"),
            quality=float(d.get("quality") or 0.0),
            popularity=int(d.get("popularity") or 0),
            is_demo=bool(d.get("isDemo", True)),
        )

    def to_json(self) -> dict:
        return {
            "id": self.id,
            "slug": self.slug,
            "kind": self.kind,
            "title": self.title,
            "creators": list(self.creators),
            "year": self.year,
            "genres": list(self.genres),
            "moods": list(self.moods),
            "themes": [{"name": k, "weight": v} for k, v in self.themes.items()],
            "description": self.description,
            "franchise": self.franchise,
            "quality": self.quality,
            "popularity": self.popularity,
            "isDemo": self.is_demo,
        }

    @property
    def text(self) -> str:
        """Text used by the content features: description, theme, genre and mood words (not the creator)."""
        return " ".join([self.title, self.description, *self.themes, *self.genres, *self.moods])


@dataclass(frozen=True)
class Interaction:
    user: str
    item: str
    ts: int = 0
    weight: float = 1.0


@dataclass
class Holdout:
    train: list[Interaction] = field(default_factory=list)
    test: list[Interaction] = field(default_factory=list)


def _jsonl(path: Path) -> list[dict]:
    with open(path, encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def load_catalog(path: Path | str = DEFAULT_CATALOG) -> list[Item]:
    return [Item.from_json(d) for d in _jsonl(Path(path))]


def load_interactions(path: Path | str) -> list[Interaction]:
    return [
        Interaction(d["user"], d["item"], int(d.get("ts", 0)), float(d.get("w", 1.0)))
        for d in _jsonl(Path(path))
    ]


def load_holdout(directory: Path | str = DEFAULT_HOLDOUT) -> Holdout:
    d = Path(directory)
    return Holdout(load_interactions(d / "train.jsonl"), load_interactions(d / "test.jsonl"))


def sha256_file(path: Path | str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 16), b""):
            h.update(block)
    return h.hexdigest()
