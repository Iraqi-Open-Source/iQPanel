from pathlib import Path
SN = Path(__file__).resolve().parent / "snippets"
order = [
    "app_01.js",
    "app_02a.js",
    "app_02b.js",
    "app_02c.js",
    "app_02d.js",
    "app_02e.js",
    "app_02f.js",
    "app_03a.js",
    "app_03b.js",
    "app_03c.js",
    "app_03d.js",
    "app_04a.js",
    "app_04b.js",
    "app_04c.js",
    "app_05a.js",
    "app_05b.js",
    "app_05c.js",
    "app_06.js",
]
PUBLIC = Path(__file__).resolve().parent.parent / "public"
content = "".join((SN / name).read_text() for name in order)
(PUBLIC / "app.js").write_text(content)
print((PUBLIC / "app.js").stat().st_size)
