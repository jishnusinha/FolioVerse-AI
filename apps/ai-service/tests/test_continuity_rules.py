from folioverse_ai.graphs.writer import detect_conflicts

CANON = [{"id": "c1", "name": "Mara", "facts": {"eye color": "green", "age": "34"}}]


def found(text: str) -> list[tuple[str, str]]:
    return [(i["fact"], i["found"]) for i in detect_conflicts(text, CANON)]


def test_colour_conflict_and_consistent_sentence():
    assert found("Mara looked up, her blue eyes narrowing.") == [("eye color", "blue")]
    assert found("Mara's green eyes narrowed.") == []
    assert found("Mara's blue eyes narrowed.") == [("eye color", "blue")]


def test_trait_of_another_character_is_not_a_conflict():
    assert found("Mara stared at Jonas's blue eyes.") == []
    assert found("Mara stared at Jonas\u2019s blue eyes.") == []


def test_age_phrased_without_the_word_age():
    assert found("Mara was 35 years old that spring.") == [("age", "35")]
    assert found("Mara, aged twelve, ran ahead.") == [("age", "twelve")]
    assert found("Mara was 34 years old that spring.") == []
