"""Run detect-secrets offline and fail on findings without printing secret values."""

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EXCLUDED = r"(^|[\\/])(node_modules|\.venv|__pycache__|test-tmp|tmp|\.git)[\\/]"


def main():
    result = subprocess.run(
        [
            sys.executable,
            "-m",
            "detect_secrets",
            "scan",
            "--no-verify",
            "--all-files",
            "--exclude-files",
            EXCLUDED,
            str(ROOT),
        ],
        capture_output=True,
        text=True,
        encoding="utf-8",
        cwd=ROOT,
    )
    if result.returncode:
        print("Secret scanner failed. Install requirements-dev.txt and retry.")
        return 2
    findings = json.loads(result.stdout).get("results", {})
    for name, rows in findings.items():
        path = Path(name)
        if path.is_absolute():
            path = path.relative_to(ROOT)
        for row in rows:
            print(f"{path}:{row['line_number']}: {row['type']}")
    count = sum(map(len, findings.values()))
    print(f"Offline secret scan: {count} findings")
    return int(bool(count))


if __name__ == "__main__":
    sys.exit(main())
