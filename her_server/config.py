"""Configuration. Everything privacy-relevant is validated here, once."""
import os
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlparse

LOOPBACK_HOSTS = {"127.0.0.1", "localhost", "::1", "[::1]"}


class ConfigError(ValueError):
    pass


@dataclass(frozen=True)
class Config:
    port: int = 8765
    data_dir: Path = Path.home() / ".her"
    web_root: Path = Path(__file__).resolve().parent.parent / "web"
    ollama_url: str = "http://127.0.0.1:11434"
    model: str = ""                 # empty = auto-detect an installed Gemma model
    allow_remote_llm: bool = False  # keep False: chats must never leave this device
    session_idle_s: int = 600
    max_body: int = 8 * 1024 * 1024
    connect_timeout: float = 3.0
    stream_idle_timeout: float = 60.0
    context_chars: int = 12000      # trimmed history budget sent to the model

    def validate(self):
        host = urlparse(self.ollama_url).hostname or ""
        if host not in LOOPBACK_HOSTS and not self.allow_remote_llm:
            raise ConfigError(
                f"OLLAMA_URL host '{host}' is not on this device. HER only talks to a model running locally. "
                "Set HER_ALLOW_REMOTE_LLM=1 only if you understand your chats will leave this machine.")
        if not (0 <= self.port < 65536):
            raise ConfigError("bad port")
        return self


def from_env(env=os.environ, **overrides) -> Config:
    base = dict(
        port=int(env.get("HER_PORT", "8765")),
        data_dir=Path(env.get("HER_DATA", str(Path.home() / ".her"))),
        ollama_url=env.get("OLLAMA_URL", "http://127.0.0.1:11434").rstrip("/"),
        model=env.get("HER_MODEL", ""),
        allow_remote_llm=env.get("HER_ALLOW_REMOTE_LLM") == "1",
    )
    base.update(overrides)
    return Config(**base).validate()
