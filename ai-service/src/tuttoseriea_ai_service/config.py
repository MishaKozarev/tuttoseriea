import os
from collections.abc import Mapping
from dataclasses import dataclass

AI_SERVICE_INTERNAL_API_KEY_ENV = "AI_SERVICE_INTERNAL_API_KEY"


class ConfigurationError(RuntimeError):
    pass


@dataclass(frozen=True, slots=True)
class Settings:
    ai_service_internal_api_key: str


def require_env(env: Mapping[str, str], name: str) -> str:
    value = env.get(name)

    if value is None or value.strip() == "":
        raise ConfigurationError(f"{name} is required")

    return value


def load_settings(env: Mapping[str, str] | None = None) -> Settings:
    source = os.environ if env is None else env

    return Settings(
        ai_service_internal_api_key=require_env(
            source,
            AI_SERVICE_INTERNAL_API_KEY_ENV,
        ),
    )
