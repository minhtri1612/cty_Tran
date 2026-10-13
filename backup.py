from datetime import datetime
from pathlib import Path
import sqlite3

ROOT = Path(__file__).resolve().parent
source = ROOT / "data" / "scm.sqlite3"
target_dir = ROOT / "backups"
if not source.exists():
    raise SystemExit("Chưa có database. Hãy khởi chạy server và hoàn tất thiết lập quản trị viên trước.")
target_dir.mkdir(exist_ok=True)
target = target_dir / f"scm-{datetime.now().strftime('%Y%m%d-%H%M%S')}.sqlite3"
with sqlite3.connect(source) as src, sqlite3.connect(target) as dst:
    src.backup(dst)
print(f"Backup created: {target}")
