"""Tests for project presets."""

from pathlib import Path

from routa_fitness.model import Metric
from routa_fitness.presets import get_project_preset


def test_get_project_preset_returns_routa_behavior():
    preset = get_project_preset()
    assert preset.fitness_dir(Path("/repo")) == Path("/repo/docs/fitness")


def test_routa_preset_domains_from_files():
    preset = get_project_preset()
    domains = preset.domains_from_files(
        [
            "crates/routa-server/src/main.rs",
            "src/app/page.tsx",
            "tools/routa-fitness/routa_fitness/cli.py",
            "api-contract.yaml",
        ]
    )
    assert domains == {"rust", "web", "python", "config"}


def test_routa_preset_metric_domains():
    preset = get_project_preset()
    metric = Metric(name="lint", command="npm run lint")
    assert preset.metric_domains(metric) == {"web"}
