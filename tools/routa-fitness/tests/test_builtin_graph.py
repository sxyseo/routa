"""Tests for the built-in structural analyzer."""

from pathlib import Path

from routa_fitness.structure.builtin import BuiltinGraphAdapter


def _write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def test_builtin_graph_parses_typescript_and_links_tests(tmp_path: Path):
    _write(
        tmp_path / "src" / "mod.ts",
        "export function run() { return helper() }\nfunction helper() { return 1 }\n",
    )
    _write(
        tmp_path / "src" / "mod.test.ts",
        "import { run } from './mod'\ntest('run works', () => run())\n",
    )

    adapter = BuiltinGraphAdapter(tmp_path)
    build = adapter.build_or_update(full=True)
    query = adapter.query("tests_for", "src/mod.ts:run")

    assert build["status"] == "ok"
    assert "typescript" in build["languages"]
    assert query["status"] == "ok"
    assert [item["file_path"] for item in query["results"]] == ["src/mod.test.ts"]


def test_builtin_graph_parses_python_and_tracks_import_impact(tmp_path: Path):
    _write(
        tmp_path / "src" / "service.py",
        "def run():\n    return helper()\n\n\ndef helper():\n    return 1\n",
    )
    _write(
        tmp_path / "src" / "consumer.py",
        "from .service import run\n\n\ndef consume():\n    return run()\n",
    )
    _write(
        tmp_path / "src" / "test_service.py",
        "from .service import run\n\n\ndef test_run():\n    assert run() == 1\n",
    )

    adapter = BuiltinGraphAdapter(tmp_path)
    adapter.build_or_update(full=True)
    impact = adapter.impact_radius(["src/service.py"], depth=1)
    tests = adapter.query("tests_for", "src/service.py:run")

    assert impact["status"] == "ok"
    assert sorted(impact["impacted_files"]) == ["src/consumer.py", "src/test_service.py"]
    assert [item["qualified_name"] for item in tests["results"]] == ["src/test_service.py:test_run"]


def test_builtin_graph_parses_rust_test_attributes(tmp_path: Path):
    _write(
        tmp_path / "crates" / "demo" / "src" / "lib.rs",
        "pub fn compute() -> i32 { 1 }\n\n#[cfg(test)]\nmod tests {\n    use super::compute;\n\n    #[test]\n    fn compute_works() {\n        assert_eq!(compute(), 1);\n    }\n}\n",
    )

    adapter = BuiltinGraphAdapter(tmp_path)
    build = adapter.build_or_update(full=True)
    tests = adapter.query("tests_for", "crates/demo/src/lib.rs:compute")
    stats = adapter.stats()

    assert build["status"] == "ok"
    assert "rust" in build["languages"]
    assert tests["status"] == "ok"
    assert [item["qualified_name"] for item in tests["results"]] == [
        "crates/demo/src/lib.rs:compute_works"
    ]
    assert stats["backend"] == "builtin-tree-sitter"


def test_builtin_graph_queries_from_persisted_index_without_file_cache(tmp_path: Path):
    _write(
        tmp_path / "src" / "service.py",
        "def run():\n    return helper()\n\n\ndef helper():\n    return 1\n",
    )
    _write(
        tmp_path / "src" / "consumer.py",
        "from .service import run\n\n\ndef consume():\n    return run()\n",
    )
    _write(
        tmp_path / "src" / "test_service.py",
        "from .service import run\n\n\ndef test_run():\n    assert run() == 1\n",
    )

    adapter = BuiltinGraphAdapter(tmp_path)
    adapter.build_or_update(full=True)
    adapter.files_cache_path.unlink()

    persisted = BuiltinGraphAdapter(tmp_path)
    stats = persisted.stats()
    impact = persisted.impact_radius(["src/service.py"], depth=1)
    tests = persisted.query("tests_for", "src/service.py:run")

    assert stats["status"] == "ok"
    assert stats["files"] == 3
    assert sorted(impact["impacted_files"]) == ["src/consumer.py", "src/test_service.py"]
    assert [item["qualified_name"] for item in tests["results"]] == ["src/test_service.py:test_run"]
