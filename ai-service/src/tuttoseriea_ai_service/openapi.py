import json
import sys

from tuttoseriea_ai_service.main import app


def main() -> None:
    json.dump(
        app.openapi(),
        sys.stdout,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
