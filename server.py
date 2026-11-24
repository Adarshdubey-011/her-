#!/usr/bin/env python3
"""HER: private companion that runs only on this computer.  Start:  python3 server.py"""
import sys
import threading
import webbrowser

from her_server import llm
from her_server.app import serve
from her_server.config import ConfigError, from_env


def main():
    args = sys.argv[1:]
    try:
        cfg = from_env()
    except ConfigError as e:
        sys.exit(f"HER: {e}")
    httpd, _ = serve(cfg)
    port = httpd.server_address[1]
    url = f"http://127.0.0.1:{port}"
    av = llm.availability(cfg)
    print(f"HER is running at {url}\nData folder : {cfg.data_dir}")
    if av["ready"]:
        print(f"Model       : {av['model']} (local)")
    elif av["hint"] == "no_runtime":
        print("Model       : Ollama is not running. HER will use demo replies. Install/start Ollama, then reload.")
    else:
        print("Model       : no Gemma model installed. Run:  ollama pull <your gemma tag>   (see README)")
    print("Press Ctrl+C to stop.")
    if "--no-browser" not in args:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()
