"""Interactive one-time import of teacher accounts from the owner's workbook.

Run with the bundled Python that includes openpyxl. No database credentials,
teacher data, or passwords are stored in this script or written to disk.
"""

from __future__ import annotations

import argparse
import datetime as dt
import getpass
import http.cookiejar
import json
import re
import sys
import urllib.error
import urllib.request
import warnings
from pathlib import Path

from openpyxl import load_workbook


DEFAULT_FILE = Path.home() / "Desktop" / "الملعمين.xlsx"
DEFAULT_URL = "https://turjuman-v2.hayy-aid-cloudflare.workers.dev"
CENTER_ID = "obai-01"
QUALIFICATIONS = ("ثانوية عامة", "بكالوريوس", "ماجستير", "دكتوراه")
AJKAM = ("نورانية", "تمهيدية", "تأهيلية", "عليا", "تأهيل سند", "سند")


def value(cell: object) -> str:
    return "" if cell is None else str(cell).strip()


def ask_required(label: str, pattern: str) -> str:
    while True:
        answer = input(f"{label}: ").strip()
        if re.fullmatch(pattern, answer):
            return answer
        print("قيمة غير صالحة؛ أعد إدخالها.")


def ask_choice(label: str, choices: tuple[str, ...]) -> str:
    print(f"{label}: " + "، ".join(f"{i + 1}={x}" for i, x in enumerate(choices)))
    while True:
        answer = input("الاختيار: ").strip()
        if answer.isdigit() and 1 <= int(answer) <= len(choices):
            return choices[int(answer) - 1]
        print("اختر رقماً من القائمة.")


def parse_birth(cell: object) -> str:
    if isinstance(cell, (dt.datetime, dt.date)):
        return cell.date().isoformat() if isinstance(cell, dt.datetime) else cell.isoformat()
    return value(cell)


def qualification(raw: str) -> str:
    if raw.startswith("بكالوريوس"):
        return "بكالوريوس"
    if raw.startswith(("ماجستير", "ماجيستير")):
        return "ماجستير"
    if raw in ("توجيهي", "ثانوية عامة"):
        return "ثانوية عامة"
    if raw.startswith("دكتوراه"):
        return "دكتوراه"
    return ""


def read_rows(path: Path) -> list[dict]:
    with warnings.catch_warnings():
        warnings.filterwarnings("ignore", message="Cell .* is marked as a date")
        sheet = load_workbook(path, read_only=True, data_only=True).active
        rows = list(sheet.values)
    expected = ("الاسم الرباعي", "رقم الهوية", "تاريخ الميلاد", "المؤهل العلمي")
    if len(rows[0]) < 11 or tuple(value(x) for x in rows[0][1:5]) != expected:
        raise ValueError("أعمدة ملف المعلمين لا تطابق النموذج المتوقع")
    result = []
    for row_no, row in enumerate(rows[1:], 2):
        if not value(row[1]):
            continue
        raw_wa = value(row[6])
        phone = "0" + raw_wa if re.fullmatch(r"5[69]\d{7}", raw_wa) else raw_wa
        record = {
            "row": row_no,
            "displayName": value(row[1]),
            "nationalId": value(row[2]),
            "birth": parse_birth(row[3]),
            "qualification": qualification(value(row[4])),
            "waCc": value(row[5]),
            "waNational": raw_wa,
            "phone": phone,
            "memorizedParts": row[9],
            "ajkamCourse": value(row[10]),
        }
        result.append(record)
    return result


def repair_and_validate(rows: list[dict]) -> None:
    gender = ask_choice("جنس المعلمين في الملف", ("كلهم ذكور", "كلهم إناث", "يختلف حسب الصف"))
    seen = set()
    today = dt.date.today()
    for r in rows:
        label = f"صف {r['row']} — {r['displayName']}"
        if not re.fullmatch(r"\d{9}", r["nationalId"]):
            r["nationalId"] = ask_required(f"هوية {label} (9 أرقام)", r"\d{9}")
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", r["birth"]):
            r["birth"] = ask_required(f"ميلاد {label} (YYYY-MM-DD)", r"\d{4}-\d{2}-\d{2}")
        if not r["qualification"]:
            r["qualification"] = ask_choice(f"مؤهل {label}", QUALIFICATIONS)
        if gender == "يختلف حسب الصف":
            r["gender"] = "male" if ask_choice(f"جنس {label}", ("ذكر", "أنثى")) == "ذكر" else "female"
        else:
            r["gender"] = "male" if gender == "كلهم ذكور" else "female"
        try:
            birthday = dt.date.fromisoformat(r["birth"])
        except ValueError as exc:
            raise ValueError(f"تاريخ الميلاد غير صالح في {label}") from exc
        if birthday > today.replace(year=today.year - 18):
            raise ValueError(f"العمر أقل من 18 سنة في {label}")
        if not re.fullmatch(r"05[96]\d{7}", r["phone"]):
            raise ValueError(f"رقم الهاتف غير صالح في {label}")
        if r["waCc"] not in ("970", "972") or r["ajkamCourse"] not in AJKAM:
            raise ValueError(f"مقدمة الواتساب أو دورة الأحكام غير صالحة في {label}")
        if not isinstance(r["memorizedParts"], int) or not 0 <= r["memorizedParts"] <= 30:
            raise ValueError(f"عدد الأجزاء غير صالح في {label}")
        if len(r["displayName"]) < 8 or r["nationalId"] in seen:
            raise ValueError(f"اسم قصير أو هوية مكررة في {label}")
        seen.add(r["nationalId"])
        r["username"] = "teacher." + r["nationalId"]


def api(opener, base: str, method: str, endpoint: str, body: dict | None = None) -> dict:
    data = None if body is None else json.dumps(body, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        base + endpoint,
        data=data,
        method=method,
        headers={"Content-Type": "application/json", "Accept": "application/json"},
    )
    try:
        with opener.open(req, timeout=30) as response:
            return json.load(response)
    except urllib.error.HTTPError as exc:
        try:
            message = json.load(exc).get("error", exc.reason)
        except (ValueError, UnicodeError):
            message = exc.reason
        raise RuntimeError(f"HTTP {exc.code}: {message}") from exc


def main() -> int:
    parser = argparse.ArgumentParser(description="Import teachers through Turjuman's authenticated staff API")
    parser.add_argument("--file", type=Path, default=DEFAULT_FILE)
    parser.add_argument("--url", default=DEFAULT_URL)
    parser.add_argument("--check", action="store_true", help="Read workbook and report missing fields; no API writes")
    args = parser.parse_args()
    rows = read_rows(args.file)
    print(f"قرأت {len(rows)} معلمين من {args.file.name}.")
    if args.check:
        for r in rows:
            missing = [key for key in ("nationalId", "birth", "qualification") if not r[key] or r[key] == "#VALUE!"]
            print(f"صف {r['row']}: " + ("ناقص " + ", ".join(missing) if missing else "مكتمل مبدئياً"))
        return 0
    repair_and_validate(rows)
    base = args.url.rstrip("/")
    if not (base.startswith("https://") or base.startswith("http://localhost:") or base.startswith("http://127.0.0.1:")):
        raise ValueError("الرابط يجب أن يكون HTTPS أو خادماً محلياً")
    print(f"المركز: {CENTER_ID} | الخادم: {base} | أسماء المستخدمين: teacher.<رقم الهوية>")
    print("لن تُسنَد الحلقات؛ الملف لا يحوي أسماءها. لن يُحفظ أي سر في ملف.")
    if input("للمتابعة اكتب IMPORT: ").strip() != "IMPORT":
        print("أُلغي الاستيراد.")
        return 0
    admin_username = input("اسم مستخدم المدير: ").strip()
    admin_password = getpass.getpass("كلمة مرور المدير: ")
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
    login = api(opener, base, "POST", "/api/auth/login", {
        "centerId": CENTER_ID, "username": admin_username, "password": admin_password,
    })
    del admin_password
    if login.get("role") != "admin":
        raise ValueError("يلزم حساب مدير المركز")
    current = api(opener, base, "GET", "/api/staff").get("staff", [])
    existing_ids = {value(s.get("nationalId")) for s in current}
    existing_names = {value(s.get("username")) for s in current}
    for r in rows:
        if r["nationalId"] in existing_ids or r["username"] in existing_names:
            r["skip"] = True
    print(f"موجودون مسبقاً: {sum(bool(r.get('skip')) for r in rows)} | سيُضاف: {sum(not r.get('skip') for r in rows)}")
    if input("لبدء الإضافة اكتب CREATE: ").strip() != "CREATE":
        print("أُلغي الاستيراد قبل أي إضافة.")
        return 0
    added = 0
    for r in rows:
        if r.get("skip"):
            print(f"تخطي صف {r['row']}: موجود مسبقاً")
            continue
        password = getpass.getpass(f"كلمة مرور جديدة لصف {r['row']} ({r['username']})، 8 خانات على الأقل: ")
        if not 8 <= len(password) <= 200:
            raise ValueError(f"كلمة مرور صف {r['row']} غير صالحة؛ أوقف الاستيراد")
        body = {key: r[key] for key in (
            "username", "displayName", "nationalId", "phone", "waCc", "waNational",
            "birth", "gender", "qualification", "ajkamCourse", "memorizedParts",
        )}
        body.update(role="teacher", password=password, stages=[], email="", address="")
        try:
            api(opener, base, "POST", "/api/staff", body)
        except Exception as exc:
            print(f"توقف عند صف {r['row']} بعد إضافة {added}: {exc}", file=sys.stderr)
            return 1
        finally:
            del password
            del body
        added += 1
        print(f"أُضيف صف {r['row']} ({r['username']})")
    print(f"اكتمل: أُضيف {added} معلمين. عيّنهم إلى الحلقات من لوحة الإدارة.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, RuntimeError) as exc:
        print(f"خطأ: {exc}", file=sys.stderr)
        raise SystemExit(1)
