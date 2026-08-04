import json
import random
import re

random.seed(42)

MWF_SLOTS = [
    ("MWF", "8:00-9:10"),
    ("MWF", "9:20-10:30"),
    ("MWF", "10:40-11:50"),
    ("MWF", "12:00-13:10"),
    ("MWF", "13:20-14:30"),
    ("MWF", "14:40-15:50"),
]
TR_SLOTS = [
    ("TR", "8:00-9:45"),
    ("TR", "10:00-11:45"),
    ("TR", "12:20-14:05"),
    ("TR", "14:15-16:00"),
]
SLOTS = MWF_SLOTS + TR_SLOTS

data = json.load(open("majors.json"))

# Build prefix -> faculty map from programs that declare a non-empty prefix.
prefix_faculty = {}
for p in data["programs"]:
    pf = p.get("course_prefix")
    if pf:
        fac = [re.sub(r"\.$", "", f).strip() for f in p.get("faculty", [])]
        fac = set(f for f in fac if f)
        if fac:
            prefix_faculty.setdefault(pf, set()).update(fac)

# Also fold in faculty from interdisciplinary programs whose courses carry these prefixes.
for p in data["programs"]:
    if p.get("course_prefix"):
        continue
    fac = set(re.sub(r"\.$", "", f).strip() for f in p.get("faculty", []))
    fac = {f for f in fac if f}
    for c in p.get("courses", []):
        pf = c["course_code"].split()[0]
        if fac:
            prefix_faculty.setdefault(pf, set()).update(fac)

prefix_faculty = {pf: sorted(fac) for pf, fac in prefix_faculty.items() if fac}

# Collect unique courses by code.
courses_by_code = {}
for p in data["programs"]:
    for c in p.get("courses", []):
        courses_by_code.setdefault(c["course_code"], c)

# Eligible = courses whose prefix has a faculty pool.
eligible = []
for code in courses_by_code:
    pf, num = code.split()
    if pf in prefix_faculty:
        eligible.append((pf, num))
random.shuffle(eligible)

# Sample ~30%.
sample_size = max(1, int(round(len(eligible) * 0.30)))
chosen = eligible[:sample_size]

# About half of the chosen 100-level courses get 2 sections.
hundred = [c for c in chosen if int(c[1]) < 200]
split_count = len(hundred) // 2
split_courses = set(random.sample(hundred, split_count)) if split_count else set()

# Build offerings and pick instructors (balance load so no instructor exceeds 10 slots).
offerings = []
instructor_of = {}
load = {}
for pf, num in chosen:
    choices = prefix_faculty[pf]
    inst = min(choices, key=lambda f: load.get(f, 0))
    load[inst] = load.get(inst, 0) + 1
    instructor_of[(pf, num)] = inst
    offerings.append((pf, num, "A"))
    if (pf, num) in split_courses:
        offerings.append((pf, num, "B"))
random.shuffle(offerings)

# Greedy slot assignment: no instructor double-booked in a slot,
# no two sections of the same course in the same slot.
slot_taken_by = {sk: set() for sk in SLOTS}          # instructors per slot
course_at_slot = {sk: set() for sk in SLOTS}          # course codes per slot
assignment = {}

for pf, num, sec in offerings:
    inst = instructor_of[(pf, num)]
    placed = False
    order = SLOTS[:]
    random.shuffle(order)
    for sk in order:
        if (pf, num) in course_at_slot[sk]:
            continue
        if inst in slot_taken_by[sk]:
            continue
        assignment[(pf, num, sec)] = sk
        slot_taken_by[sk].add(inst)
        course_at_slot[sk].add((pf, num))
        placed = True
        break
    if not placed:
        print("UNPLACED:", pf, num, sec, inst)

# Write CSV.
rows = []
for pf, num, sec in offerings:
    day, time = assignment[(pf, num, sec)]
    rows.append([pf, num, sec, instructor_of[(pf, num)], day, time])

with open("sample-schedule.csv", "w") as f:
    f.write("dept-prefix,course-number,section,instructor,days,times\n")
    for r in rows:
        f.write(",".join(str(x) for x in r) + "\n")

print("eligible courses:", len(eligible))
print("courses chosen:", len(chosen))
print("100-level chosen:", len(hundred), "| split into 2 sections:", len(split_courses))
print("offerings written:", len(rows))