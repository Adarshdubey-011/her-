"""Local model bridge (Ollama-compatible). Talks only to a loopback address (see config).

- availability(): is the runtime up, is a Gemma model installed, which one will be used, and what to do if not.
- stream_chat(): yields content chunks; stops cleanly when the browser disconnects; trims history to a budget.
"""
import json
import re
import urllib.error
import urllib.request

GEMMA_RE = re.compile(r"gemma", re.I)
# Preference order: small on-device sizes first. Exact tags vary by release; we match by pattern, not by name.
PREFER = [re.compile(p, re.I) for p in (r"e2b", r"e4b", r"\b1b\b|:1b", r"2b", r"4b")]


class LLMError(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code, self.message = code, message


def _get_json(url, timeout):
    with urllib.request.urlopen(url, timeout=timeout) as r:
        return json.loads(r.read())


def pick_model(installed, wanted=""):
    names = [m.get("name") or m.get("model") or "" for m in installed]
    if wanted:
        for n in names:
            if n == wanted or n.split(":")[0] == wanted:
                return n
        return None
    gem = [n for n in names if GEMMA_RE.search(n)]
    for rx in PREFER:
        for n in gem:
            if rx.search(n):
                return n
    return gem[0] if gem else None


def availability(cfg) -> dict:
    out = {"runtime": False, "model": None, "ready": False, "installed": [], "hint": ""}
    try:
        tags = _get_json(cfg.ollama_url + "/api/tags", cfg.connect_timeout)
    except (urllib.error.URLError, OSError, ValueError):
        out["hint"] = "no_runtime"      # Ollama is not running or not installed
        return out
    out["runtime"] = True
    models = tags.get("models", [])
    out["installed"] = [m.get("name", "") for m in models][:30]
    chosen = pick_model(models, cfg.model)
    if chosen:
        out.update(model=chosen, ready=True)
    else:
        out["hint"] = "model_missing" if cfg.model else "no_gemma"
    return out


def trim_messages(messages, budget):
    """Keep the system prompt and the most recent turns that fit in `budget` characters."""
    sys_msgs = [m for m in messages if m["role"] == "system"][:1]
    rest = [m for m in messages if m["role"] != "system"]
    used = sum(len(m["content"]) for m in sys_msgs)
    keep = []
    for m in reversed(rest):
        used += len(m["content"])
        if used > budget and keep:
            break
        keep.append(m)
    return sys_msgs + list(reversed(keep))


def clean_messages(system, messages, budget):
    msgs = [{"role": "system", "content": str(system)[:8000]}]
    for m in (messages or [])[-40:]:
        role = "user" if m.get("role") == "user" else "assistant"
        content = str(m.get("content", ""))[:6000]
        if content:
            msgs.append({"role": role, "content": content})
    return trim_messages(msgs, budget)


def stream_chat(cfg, model, system, messages, is_cancelled=lambda: False):
    """Yield text chunks. Raises LLMError for model-level problems. Closes the upstream on cancel."""
    body = json.dumps({"model": model, "stream": True, "messages": clean_messages(system, messages, cfg.context_chars),
                       "options": {"temperature": 0.8, "num_predict": 700}}).encode()
    req = urllib.request.Request(cfg.ollama_url + "/api/chat", data=body, method="POST",
                                 headers={"Content-Type": "application/json"})
    try:
        up = urllib.request.urlopen(req, timeout=cfg.stream_idle_timeout)
    except urllib.error.HTTPError as e:
        raise LLMError("model_missing" if e.code == 404 else "model_error", f"model returned {e.code}")
    except (urllib.error.URLError, OSError):
        raise LLMError("no_runtime", "model runtime not reachable")
    try:
        for line in up:
            if is_cancelled():
                return
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except ValueError:
                continue
            if obj.get("error"):
                raise LLMError("model_error", str(obj["error"])[:200])
            chunk = (obj.get("message") or {}).get("content")
            if chunk:
                yield chunk
            if obj.get("done"):
                return
    except (TimeoutError, OSError):
        raise LLMError("timeout", "model stopped responding")
    finally:
        up.close()
