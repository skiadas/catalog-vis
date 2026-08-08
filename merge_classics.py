#!/usr/bin/env python3
"""One-off migration: merge the two split Classics majors back into a single
department card that exposes both majors.

  * Classics: Archaeology and History   -> requirement key `major`
  * Classics: Language and Literature   -> requirement key `major_2`
  * Minor                               -> requirement key `minor`

Reverses migrate_classics.py (which is now superseded and removed). The merged
program keeps id/name/prefix/base fields from the split programs and unions
their requirement text + parsed requirement objects. No network / re-scrape.
"""

import json
import os

ROOT = os.path.dirname(os.path.abspath(__file__))

IDS = ["classicsarchaeologyandhistory", "classicslanguageandliterature"]


def main():
    majors_path = os.path.join(ROOT, "majors.json")
    with open(majors_path, encoding="utf-8") as f:
        data = json.load(f)

    parts = [p for p in data["programs"] if p["id"] in IDS]
    if len(parts) != 2:
        print(f"Expected both split programs {IDS}; found {len(parts)}; nothing to do.")
        return
    arch = next(p for p in parts if p["id"] == "classicsarchaeologyandhistory")
    lit = next(p for p in parts if p["id"] == "classicslanguageandliterature")
    assert set(arch["requirements"].keys()) == {"major", "minor"}, arch["requirements"].keys()
    assert set(lit["requirements"].keys()) == {"major"}, lit["requirements"].keys()

    base = {k: v for k, v in arch.items() if k not in ("id", "name", "type", "requirements", "description")}

    merged = dict(base)
    merged.update(
        {
            "id": "classicalstudies",
            "name": "Classical Studies",
            "type": ["major", "minor"],
            "description": arch["description"],
            "requirements": {
                "major": arch["requirements"]["major"],
                "major_2": lit["requirements"]["major"],
                "minor": arch["requirements"]["minor"],
            },
        }
    )

    # Remove both original programs and insert the merged one, regardless of
    # which appears first in the list (a naive `[:idx] + [merged] + [end+1:]`
    # duplicates one of them when their order is reversed).
    first = data["programs"].index(arch)
    second = data["programs"].index(lit)
    before = min(first, second)
    after = max(first, second)
    data["programs"] = data["programs"][:before] + [merged] + data["programs"][after + 1 :]
    data["total_programs"] = len(data["programs"])

    with open(majors_path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

    # --- requirements_parsed.json ---
    parsed_path = os.path.join(ROOT, "requirements_parsed.json")
    with open(parsed_path, encoding="utf-8") as f:
        pdata = json.load(f)

    parts = [p for p in pdata["programs"] if p["id"] in IDS]
    if len(parts) != 2:
        print(f"Expected both split parsed programs {IDS}; found {len(parts)}; skipping parsed merge.")
        return
    parch = next(p for p in parts if p["id"] == "classicsarchaeologyandhistory")
    plit = next(p for p in parts if p["id"] == "classicslanguageandliterature")

    # Order must match the majors.json requirement keys: major, major_2, minor.
    merged_reqs = []
    for r in parch["requirements"]:
        if r["label"] != "Minor":
            r = dict(r)
            r["label"] = "Classics: Archaeology and History"
            merged_reqs.append(r)
    for r in plit["requirements"]:
        r = dict(r)
        r["label"] = "Classics: Language and Literature"
        merged_reqs.append(r)
    for r in parch["requirements"]:
        if r["label"] == "Minor":
            merged_reqs.append(r)

    pmerged = {k: v for k, v in parch.items() if k != "requirements"}
    pmerged.update(
        {
            "id": "classicalstudies",
            "requirements": merged_reqs,
        }
    )

    pidx = pdata["programs"].index(parch)
    pend = pdata["programs"].index(plit)
    pdata["programs"] = pdata["programs"][:pidx] + [pmerged] + pdata["programs"][pend + 1 :]

    with open(parsed_path, "w", encoding="utf-8") as f:
        json.dump(pdata, f, indent=2, ensure_ascii=False)

    print(
        f"majors programs: {data['total_programs']}; merged to {merged['name']} "
        f"(keys {list(merged['requirements'])})"
    )
    print("parsed reqs:", [r["label"] for r in pmerged["requirements"]])


if __name__ == "__main__":
    main()
