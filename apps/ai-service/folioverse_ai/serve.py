"""Process launcher: `python -m folioverse_ai.serve --port 8000 [--role api|ingest|all]`.

On Windows uvicorn defaults to the Proactor loop, which psycopg's async driver cannot use, so a
selector loop factory is passed explicitly.
"""

import argparse
import os
import sys

import uvicorn


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--host", default=os.environ.get("HOST", "0.0.0.0"))  # noqa: S104 - container default
    p.add_argument("--port", type=int, default=int(os.environ.get("PORT", "8000")))
    p.add_argument("--role", default=None)
    p.add_argument("--env-file", default=None)
    args = p.parse_args()
    if args.env_file and os.path.exists(args.env_file):
        from dotenv import load_dotenv

        load_dotenv(args.env_file, override=False)
    if args.role:
        os.environ["ROLE"] = args.role
    loop = "asyncio:SelectorEventLoop" if sys.platform == "win32" else "auto"
    uvicorn.run(
        "folioverse_ai.main:app",
        host=args.host,
        port=args.port,
        loop=loop,
        proxy_headers=True,
        log_level=os.environ.get("LOG_LEVEL", "info").lower(),
    )


if __name__ == "__main__":
    main()
