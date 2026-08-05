#!/usr/bin/env python3
"""One-off migration: split the merged 'Classical Studies' program into the two
separate majors the catalog actually publishes with h3 sub-headings.

  * Classics: Archaeology and History   (major + minor)
  * Classics: Language and Literature   (major only)

Reuses the already-scraped requirement text + parsed requirement objects and
shares the existing course list. No network / re-scrape required.
"""

import json
import os

ROOT = os.path.dirname(os.path.abspath(__file__))

DESCRIPTIONS = {
    "classicsarchaeologyandhistory": (
        "This major is designed for students whose primary interests are in archaeological, "
        "historical, and/ or art historical studies of the ancient world. In courses on archaeology "
        "and art, students will have more time to become familiar with the available archaeological "
        "evidence and notable architectural and artistic remains of the Ancient Mediterranean world; "
        "they will also learn how these are procured, preserved, and used to understand ancient "
        "culture. In history courses, students will get more grounding in ancient historical texts and "
        "in current scholarly discussions of ancient history, and they will study the methods and aims "
        "of both modern and ancient historians."
    ),
    "classicslanguageandliterature": (
        "Classics is the study of the cultures and cultural values of ancient Greece and Rome. A "
        "foundation for that study is learning to read and analyze ancient texts in the original "
        "languages. The \u201cLanguage and Literature\u201d major, therefore, employs language study "
        "to hone a student\u2019s ability to translate texts faithfully and to develop crucial "
        "analytic skills. It is meant for those students who will spend most of their time studying "
        "ancient texts in Greek and Latin. In some cases, this means students interested in "
        "literature, philosophy, or early Christianity. In others, this will mean students with a "
        "broad range of interests that includes further study in the languages. Thus, this major is "
        "designed to help students to become competent at learning Greek and/or Latin, as students in "
        "Classical Studies have always done; on the other hand, it is designed flexibly in order to "
        "accommodate this wide range of possible student interests. Options also exist for those "
        "students wishing only to minor in Greek or in Latin (please refer to the portions of the "
        "catalog devoted to course-offerings in those languages, below)."
    ),
}


def main():
    majors_path = os.path.join(ROOT, "majors.json")
    with open(majors_path, encoding="utf-8") as f:
        data = json.load(f)

    old = [p for p in data["programs"] if p["id"] == "classicalstudies"]
    if not old:
        print("No classicalstudies program found; nothing to do.")
        return
    old = old[0]
    reqs = old["requirements"]
    assert set(reqs.keys()) == {"major", "minor", "major_2"}, reqs.keys()

    base = {k: v for k, v in old.items() if k not in ("id", "name", "type", "requirements", "description")}

    arch = dict(base)
    arch.update(
        {
            "id": "classicsarchaeologyandhistory",
            "name": "Classics: Archaeology and History",
            "type": ["major", "minor"],
            "description": DESCRIPTIONS["classicsarchaeologyandhistory"],
            "requirements": {"major": reqs["major"], "minor": reqs["minor"]},
        }
    )
    lit = dict(base)
    lit.update(
        {
            "id": "classicslanguageandliterature",
            "name": "Classics: Language and Literature",
            "type": ["major"],
            "description": DESCRIPTIONS["classicslanguageandliterature"],
            "requirements": {"major": reqs["major_2"]},
        }
    )

    idx = data["programs"].index(old)
    data["programs"] = data["programs"][:idx] + [arch, lit] + data["programs"][idx + 1 :]
    data["total_programs"] = len(data["programs"])

    with open(majors_path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

    # --- requirements_parsed.json ---
    parsed_path = os.path.join(ROOT, "requirements_parsed.json")
    with open(parsed_path, encoding="utf-8") as f:
        pdata = json.load(f)

    bed = [p for p in pdata["programs"] if p["id"] == "classicalstudies"]
    if not bed:
        print("No classicalstudies entry in requirements_parsed.json; skipping parsed split.")
        return
    bed = bed[0]
    pbreq = bed["requirements"]
    assert len(pbreq) == 3

    parch = {k: v for k, v in bed.items() if k != "requirements"}
    parch.update(
        {
            "id": "classicsarchaeologyandhistory",
            "requirements": [pbreq[0], pbreq[1]],
        }
    )
    plit = {k: v for k, v in bed.items() if k != "requirements"}
    plit.update(
        {
            "id": "classicslanguageandliterature",
            "requirements": [pbreq[2]],
        }
    )

    pidx = pdata["programs"].index(bed)
    pdata["programs"] = pdata["programs"][:pidx] + [parch, plit] + pdata["programs"][pidx + 1 :]

    with open(parsed_path, "w", encoding="utf-8") as f:
        json.dump(pdata, f, indent=2, ensure_ascii=False)

    print(
        f"majors programs: {data['total_programs']}; classics -> archaeology(2 reqs) + language&literature(1 req)"
    )


if __name__ == "__main__":
    main()
