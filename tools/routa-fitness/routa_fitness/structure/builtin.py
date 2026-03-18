"""Built-in Tree-sitter structural analyzer."""

from __future__ import annotations

import json
import re
from collections import defaultdict, deque
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from routa_fitness.structure.impact import (
    classify_test_file,
    filter_code_files,
    git_changed_files,
)

try:
    from tree_sitter_language_pack import get_parser
except ImportError:  # pragma: no cover - exercised via adapter selection
    get_parser = None


_CACHE_VERSION = 3
_CACHE_DIR = ".routa-fitness"
_FILES_CACHE_FILE = "files.json"
_INDEX_CACHE_FILE = "index.json"
_LEGACY_CACHE_FILE = "graph.json"
_SCAN_ROOTS = ("src", "apps", "crates")
_CODE_EXTENSIONS = {
    ".py",
    ".rs",
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
}
_TEST_CALL_RE = re.compile(r"""\b(?:test|it)\s*\(\s*['"]([^'"]+)['"]""")
_LANGUAGE_BY_SUFFIX = {
    ".py": "python",
    ".rs": "rust",
    ".ts": "typescript",
    ".tsx": "tsx",
    ".js": "javascript",
    ".jsx": "javascript",
}
_SYMBOL_KINDS = {
    "python": {
        "class_definition": "Class",
        "function_definition": "Function",
    },
    "rust": {
        "struct_item": "Struct",
        "enum_item": "Enum",
        "trait_item": "Trait",
        "function_item": "Function",
    },
    "typescript": {
        "class_declaration": "Class",
        "interface_declaration": "Interface",
        "enum_declaration": "Enum",
        "function_declaration": "Function",
        "variable_declarator": "Function",
    },
    "tsx": {
        "class_declaration": "Class",
        "interface_declaration": "Interface",
        "enum_declaration": "Enum",
        "function_declaration": "Function",
        "variable_declarator": "Function",
    },
    "javascript": {
        "class_declaration": "Class",
        "function_declaration": "Function",
        "variable_declarator": "Function",
    },
}
_SUPPORTED_QUERY_TYPES = {
    "tests_for",
    "callers_of",
    "callees_of",
    "imports_of",
    "importers_of",
    "children_of",
    "inheritors_of",
    "file_summary",
}


class BuiltinGraphAdapter:
    """Tree-sitter backed structural analyzer with incremental caches."""

    def __init__(self, repo_root: Path):
        if get_parser is None:
            raise ImportError("tree-sitter-language-pack is not installed")
        self.repo_root = repo_root
        self.cache_dir = repo_root / _CACHE_DIR
        self.files_cache_path = self.cache_dir / _FILES_CACHE_FILE
        self.index_cache_path = self.cache_dir / _INDEX_CACHE_FILE
        self.legacy_cache_path = self.cache_dir / _LEGACY_CACHE_FILE
        self._file_data: dict[str, Any] | None = None
        self._index: dict[str, Any] | None = None

    def build_or_update(self, *, full: bool = False, base: str = "HEAD~1") -> dict:
        existing = self._load_file_data()
        current_files = self._collect_source_files()
        stale_files = sorted(set(existing.get("files", {})) - set(current_files))

        if full or not existing.get("files"):
            files_to_parse = current_files
            build_type = "full"
            changed_files = current_files
        else:
            changed_files = filter_code_files(
                git_changed_files(self.repo_root, base),
                self.repo_root,
            )
            files_to_parse = sorted(set(changed_files) | set(stale_files))
            build_type = "incremental"

        files_map = dict(existing.get("files", {}))
        for stale in stale_files:
            files_map.pop(stale, None)

        parsed = 0
        for rel_path in files_to_parse:
            abs_path = self.repo_root / rel_path
            if not abs_path.exists():
                files_map.pop(rel_path, None)
                continue
            files_map[rel_path] = self._parse_file(rel_path, abs_path.read_bytes())
            parsed += 1

        metadata = {
            "last_updated": self._timestamp(),
            "last_build_type": build_type,
        }
        file_data = {
            "version": _CACHE_VERSION,
            "repo_root": str(self.repo_root),
            "files": files_map,
            "metadata": metadata,
        }
        index = self._build_index(files_map, metadata)
        self._persist_cache(file_data, index)

        return {
            "status": "ok",
            "backend": "builtin-tree-sitter",
            "build_type": build_type,
            "summary": (
                f"{build_type.capitalize()} build: parsed {parsed} file(s), "
                f"{index['stats']['total_nodes']} nodes, {index['stats']['total_edges']} edges."
            ),
            "files_updated": parsed,
            "changed_files": changed_files,
            "stale_files": stale_files,
            "total_nodes": index["stats"]["total_nodes"],
            "total_edges": index["stats"]["total_edges"],
            "languages": index["stats"]["languages"],
        }

    def impact_radius(self, files: list[str], *, depth: int = 2) -> dict:
        index = self._ensure_index()
        changed_files = [path for path in files if path in index["file_nodes"]]
        if not changed_files:
            return {
                "status": "ok",
                "summary": "No changed files detected.",
                "changed_nodes": [],
                "impacted_nodes": [],
                "impacted_files": [],
                "edges": [],
            }

        visited = set(changed_files)
        queue = deque((path, 0) for path in changed_files)
        while queue:
            current, hops = queue.popleft()
            if hops >= depth:
                continue
            for neighbor in index["file_neighbors"].get(current, []):
                if neighbor not in visited:
                    visited.add(neighbor)
                    queue.append((neighbor, hops + 1))

        impacted_files = sorted(visited - set(changed_files))
        visible_files = set(changed_files) | set(impacted_files)

        return {
            "status": "ok",
            "summary": (
                f"Blast radius for {len(changed_files)} changed file(s): "
                f"{len(self._nodes_for_files(index, changed_files))} changed node(s), "
                f"{len(impacted_files)} additional file(s)."
            ),
            "changed_nodes": self._nodes_for_files(index, changed_files),
            "impacted_nodes": self._nodes_for_files(index, impacted_files),
            "impacted_files": impacted_files,
            "edges": self._edges_for_files(index, visible_files),
        }

    def query(self, query_type: str, target: str) -> dict:
        index = self._ensure_index()
        if query_type not in _SUPPORTED_QUERY_TYPES:
            return {"status": "error", "summary": f"Unknown query type '{query_type}'."}

        if query_type == "file_summary":
            rel_path = self._resolve_file_target(index, target)
            if not rel_path:
                return {"status": "not_found", "summary": f"No file found matching '{target}'."}
            result_qns = [rel_path, *index["children_by_file"].get(rel_path, [])]
            return self._query_result(
                query_type,
                target,
                self._nodes_for_qns(index, result_qns),
                [],
            )

        node = self._resolve_target(index, target)
        if not node:
            return {"status": "not_found", "summary": f"No node found matching '{target}'."}

        if query_type == "tests_for":
            results, edges = self._tests_for(index, node)
        elif query_type == "callers_of":
            results, edges = self._callers_of(index, node)
        elif query_type == "callees_of":
            results, edges = self._callees_of(index, node)
        elif query_type == "imports_of":
            results, edges = self._imports_of(index, node)
        elif query_type == "importers_of":
            results, edges = self._importers_of(index, node)
        elif query_type == "children_of":
            results, edges = self._children_of(index, node)
        else:
            results, edges = self._inheritors_of(index, node)

        return self._query_result(query_type, target, results, edges)

    def stats(self) -> dict:
        index = self._ensure_index()
        return {
            "status": "ok",
            "nodes": index["stats"]["total_nodes"],
            "edges": index["stats"]["total_edges"],
            "files": index["stats"]["files_count"],
            "languages": index["stats"]["languages"],
            "last_updated": index["stats"]["last_updated"],
            "backend": "builtin-tree-sitter",
        }

    def _load_file_data(self) -> dict[str, Any]:
        if self._file_data is not None:
            return self._file_data

        cached = self._read_json(self.files_cache_path)
        if not cached:
            cached = self._read_json(self.legacy_cache_path)

        if cached and cached.get("version") == _CACHE_VERSION and "files" in cached:
            self._file_data = cached
        else:
            self._file_data = {"version": _CACHE_VERSION, "files": {}, "metadata": {}}
        return self._file_data

    def _load_index(self) -> dict[str, Any]:
        if self._index is not None:
            return self._index

        cached = self._read_json(self.index_cache_path)
        if cached and cached.get("version") == _CACHE_VERSION:
            self._index = cached
            return self._index

        file_data = self._load_file_data()
        self._index = self._build_index(
            file_data.get("files", {}),
            file_data.get("metadata", {}),
        )
        if file_data.get("files"):
            self._persist_index(self._index)
        return self._index

    def _persist_cache(self, file_data: dict[str, Any], index: dict[str, Any]) -> None:
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.files_cache_path.write_text(
            json.dumps(file_data, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
        self.index_cache_path.write_text(
            json.dumps(index, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
        self._file_data = file_data
        self._index = index

    def _persist_index(self, index: dict[str, Any]) -> None:
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.index_cache_path.write_text(
            json.dumps(index, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
        self._index = index

    def _read_json(self, path: Path) -> dict[str, Any] | None:
        if not path.exists():
            return None
        return json.loads(path.read_text(encoding="utf-8"))

    def _ensure_index(self) -> dict[str, Any]:
        return self._load_index()

    def _collect_source_files(self) -> list[str]:
        files: list[str] = []
        for root_name in _SCAN_ROOTS:
            root = self.repo_root / root_name
            if not root.exists():
                continue
            for path in root.rglob("*"):
                if path.is_file() and path.suffix.lower() in _CODE_EXTENSIONS:
                    files.append(path.relative_to(self.repo_root).as_posix())
        return sorted(files)

    def _parse_file(self, rel_path: str, source: bytes) -> dict[str, Any]:
        language = _LANGUAGE_BY_SUFFIX.get(Path(rel_path).suffix.lower(), "unknown")
        parser = get_parser(language)
        tree = parser.parse(source)
        is_test_file = classify_test_file(rel_path)
        imports: set[str] = set()
        symbols: list[dict[str, Any]] = []
        test_nodes: list[dict[str, Any]] = []
        source_text = source.decode("utf-8", errors="replace")

        def visit(node, ancestors: list[Any]) -> None:
            node_type = node.type
            if node_type in {"import_statement", "import_from_statement", "use_declaration"}:
                resolved = self._extract_import(rel_path, language, node, source)
                if resolved:
                    imports.add(resolved)

            kind = _SYMBOL_KINDS.get(language, {}).get(node_type)
            if kind:
                symbol = self._extract_symbol(
                    rel_path,
                    language,
                    node,
                    source,
                    ancestors,
                    is_test_file,
                )
                if symbol:
                    symbols.append(symbol)
                    if symbol["is_test"]:
                        test_nodes.append(symbol)

            for child in node.children:
                if child.is_named:
                    visit(child, [*ancestors, node])

        visit(tree.root_node, [])

        if language in {"typescript", "tsx", "javascript"} and is_test_file:
            test_nodes.extend(self._extract_js_test_calls(rel_path, language, source_text))

        seen = set()
        ordered_symbols = []
        for symbol in [*symbols, *test_nodes]:
            qualified_name = symbol["qualified_name"]
            if qualified_name in seen:
                continue
            seen.add(qualified_name)
            ordered_symbols.append(symbol)

        return {
            "language": language,
            "is_test_file": is_test_file,
            "imports": sorted(imports),
            "symbols": ordered_symbols,
            "source_basename": self._normalized_source_basename(rel_path),
        }

    def _build_index(
        self,
        file_records: dict[str, Any],
        metadata: dict[str, Any],
    ) -> dict[str, Any]:
        nodes_by_qn: dict[str, dict[str, Any]] = {}
        file_nodes: dict[str, dict[str, Any]] = {}
        symbols_by_file_nodes: dict[str, list[dict[str, Any]]] = {}
        symbols_by_name_nodes: dict[str, list[dict[str, Any]]] = defaultdict(list)
        children_by_file: dict[str, list[str]] = {}
        imports_by_file: dict[str, set[str]] = defaultdict(set)
        importers_by_file: dict[str, set[str]] = defaultdict(set)
        file_neighbors: dict[str, set[str]] = defaultdict(set)
        inheritors_by_target: dict[str, set[str]] = defaultdict(set)
        tests_by_target: dict[str, set[str]] = defaultdict(set)
        callers_by_target: dict[str, set[str]] = defaultdict(set)
        callees_by_source: dict[str, set[str]] = defaultdict(set)

        for rel_path, record in file_records.items():
            file_node = {
                "qualified_name": rel_path,
                "name": Path(rel_path).name,
                "kind": "File",
                "file_path": rel_path,
                "language": record.get("language", "unknown"),
                "is_test": record.get("is_test_file", False),
            }
            file_nodes[rel_path] = file_node
            nodes_by_qn[rel_path] = file_node
            symbols: list[dict[str, Any]] = []
            child_qns: list[str] = []
            for symbol in record.get("symbols", []):
                normalized = dict(symbol)
                symbols.append(normalized)
                child_qns.append(normalized["qualified_name"])
                nodes_by_qn[normalized["qualified_name"]] = normalized
                symbols_by_name_nodes[normalized["name"]].append(normalized)
            symbols_by_file_nodes[rel_path] = symbols
            children_by_file[rel_path] = child_qns

        for rel_path, record in file_records.items():
            for imported in record.get("imports", []):
                if imported not in file_nodes:
                    continue
                imports_by_file[rel_path].add(imported)
                importers_by_file[imported].add(rel_path)
                file_neighbors[rel_path].add(imported)
                file_neighbors[imported].add(rel_path)

        for rel_path, symbols in symbols_by_file_nodes.items():
            for symbol in symbols:
                if not symbol.get("extends"):
                    continue
                for candidate in symbols_by_name_nodes.get(symbol["extends"], []):
                    if candidate["qualified_name"] == symbol["qualified_name"]:
                        continue
                    inheritors_by_target[candidate["qualified_name"]].add(
                        symbol["qualified_name"]
                    )
                    file_neighbors[rel_path].add(candidate["file_path"])
                    file_neighbors[candidate["file_path"]].add(rel_path)

        for symbols in symbols_by_file_nodes.values():
            for symbol in symbols:
                for reference in symbol.get("references", []):
                    for candidate in symbols_by_name_nodes.get(reference, []):
                        if candidate["qualified_name"] == symbol["qualified_name"]:
                            continue
                        callees_by_source[symbol["qualified_name"]].add(
                            candidate["qualified_name"]
                        )
                        callers_by_target[candidate["qualified_name"]].add(
                            symbol["qualified_name"]
                        )

        for rel_path, symbols in symbols_by_file_nodes.items():
            record = file_records[rel_path]
            if not record.get("is_test_file") and not any(
                node.get("is_test") for node in symbols
            ):
                continue
            targets = self._target_nodes_for_test_file(
                rel_path,
                record,
                file_records,
                symbols_by_name_nodes,
                symbols_by_file_nodes,
            )
            test_nodes = [node for node in symbols if node.get("is_test")] or [
                file_nodes[rel_path]
            ]
            for target in targets:
                for test_node in test_nodes:
                    tests_by_target[target["qualified_name"]].add(
                        test_node["qualified_name"]
                    )
                    file_neighbors[rel_path].add(target["file_path"])
                    file_neighbors[target["file_path"]].add(rel_path)

        total_edges = (
            sum(len(children) for children in children_by_file.values())
            + sum(len(imports) for imports in imports_by_file.values())
            + sum(len(inheritors) for inheritors in inheritors_by_target.values())
            + sum(len(tests) for tests in tests_by_target.values())
            + sum(len(callees) for callees in callees_by_source.values())
        )

        return {
            "version": _CACHE_VERSION,
            "repo_root": str(self.repo_root),
            "file_nodes": file_nodes,
            "nodes_by_qn": nodes_by_qn,
            "symbols_by_file": {
                rel_path: list(children)
                for rel_path, children in children_by_file.items()
            },
            "symbols_by_name": {
                name: sorted(node["qualified_name"] for node in nodes)
                for name, nodes in symbols_by_name_nodes.items()
            },
            "children_by_file": {
                rel_path: list(children)
                for rel_path, children in children_by_file.items()
            },
            "imports_by_file": self._sorted_mapping(imports_by_file),
            "importers_by_file": self._sorted_mapping(importers_by_file),
            "file_neighbors": self._sorted_mapping(file_neighbors),
            "inheritors_by_target": self._sorted_mapping(inheritors_by_target),
            "tests_by_target": self._sorted_mapping(tests_by_target),
            "callers_by_target": self._sorted_mapping(callers_by_target),
            "callees_by_source": self._sorted_mapping(callees_by_source),
            "stats": {
                "total_nodes": len(nodes_by_qn),
                "total_edges": total_edges,
                "files_count": len(file_nodes),
                "languages": sorted(
                    {record.get("language", "unknown") for record in file_records.values()}
                ),
                "last_updated": metadata.get("last_updated", ""),
            },
        }

    def _extract_import(
        self,
        rel_path: str,
        language: str,
        node,
        source: bytes,
    ) -> str | None:
        text = self._node_text(node, source)
        if language in {"typescript", "tsx", "javascript"}:
            for child in node.children:
                if child.type == "string":
                    return self._resolve_relative_import(
                        rel_path,
                        self._strip_quotes(self._node_text(child, source)),
                    )
            return None

        if language == "python" and node.type == "import_from_statement":
            relative = None
            for child in node.children:
                if child.type == "relative_import":
                    relative = self._node_text(child, source)
                    break
            if relative:
                return self._resolve_python_import(rel_path, relative)
            return None

        if language == "rust":
            return self._resolve_rust_import(rel_path, text)

        return None

    def _extract_symbol(
        self,
        rel_path: str,
        language: str,
        node,
        source: bytes,
        ancestors: list[Any],
        is_test_file: bool,
    ) -> dict[str, Any] | None:
        name = self._symbol_name(language, node, source)
        if not name:
            return None

        if node.type == "variable_declarator" and not self._looks_like_arrow_function(
            node,
            source,
        ):
            return None

        text = self._node_text(node, source)
        kind = _SYMBOL_KINDS[language][node.type]
        is_test = is_test_file or self._is_test_symbol(
            language,
            node,
            name,
            text,
            source,
            ancestors,
        )

        return {
            "qualified_name": f"{rel_path}:{name}",
            "name": name,
            "kind": kind,
            "file_path": rel_path,
            "line_start": node.start_point[0] + 1,
            "line_end": node.end_point[0] + 1,
            "language": language,
            "is_test": is_test,
            "references": sorted(self._symbol_references(language, node, source, name)),
            "extends": self._extract_extends(language, node, source),
        }

    def _extract_js_test_calls(
        self,
        rel_path: str,
        language: str,
        source_text: str,
    ) -> list[dict[str, Any]]:
        nodes: list[dict[str, Any]] = []
        for index, line in enumerate(source_text.splitlines(), start=1):
            match = _TEST_CALL_RE.search(line)
            if not match:
                continue
            label = match.group(1).strip()
            nodes.append(
                {
                    "qualified_name": f"{rel_path}:test:{index}",
                    "name": label,
                    "kind": "Test",
                    "file_path": rel_path,
                    "line_start": index,
                    "line_end": index,
                    "language": language,
                    "is_test": True,
                    "references": sorted(self._normalize_test_tokens(label)),
                    "extends": "",
                }
            )
        return nodes

    def _target_nodes_for_test_file(
        self,
        rel_path: str,
        record: dict[str, Any],
        file_records: dict[str, Any],
        symbols_by_name: dict[str, list[dict[str, Any]]],
        symbols_by_file: dict[str, list[dict[str, Any]]],
    ) -> list[dict[str, Any]]:
        targets: dict[str, dict[str, Any]] = {}

        for imported in record.get("imports", []):
            for symbol in symbols_by_file.get(imported, []):
                if not symbol.get("is_test"):
                    targets[symbol["qualified_name"]] = symbol

        basename = record.get("source_basename", "")
        if basename:
            for source_path, source_record in file_records.items():
                if source_path == rel_path or source_record.get("is_test_file"):
                    continue
                if source_record.get("source_basename") == basename:
                    for symbol in symbols_by_file.get(source_path, []):
                        if not symbol.get("is_test"):
                            targets[symbol["qualified_name"]] = symbol

        for test_node in symbols_by_file.get(rel_path, []):
            if not test_node.get("is_test"):
                continue
            normalized = self._normalize_test_tokens(test_node["name"])
            for symbol_name, candidates in symbols_by_name.items():
                symbol_tokens = self._normalize_test_tokens(symbol_name)
                if symbol_tokens and symbol_tokens.issubset(normalized):
                    for candidate in candidates:
                        if not candidate.get("is_test"):
                            targets[candidate["qualified_name"]] = candidate

        return sorted(targets.values(), key=lambda item: item["qualified_name"])

    def _tests_for(
        self,
        index: dict[str, Any],
        node: dict[str, Any],
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        targets = [node["qualified_name"]]
        if node["kind"] == "File":
            targets = index["children_by_file"].get(node["file_path"], [])

        results: dict[str, dict[str, Any]] = {}
        edges: list[dict[str, Any]] = []
        seen_edges = set()
        for target_qn in targets:
            for test_qn in index["tests_by_target"].get(target_qn, []):
                test_node = index["nodes_by_qn"].get(test_qn)
                target_node = index["nodes_by_qn"].get(target_qn)
                if not test_node or not target_node:
                    continue
                results[test_qn] = test_node
                edge = self._edge(
                    "TESTED_BY",
                    test_qn,
                    target_qn,
                    test_node["file_path"],
                    target_node["file_path"],
                )
                edge_key = self._edge_key(edge)
                if edge_key not in seen_edges:
                    seen_edges.add(edge_key)
                    edges.append(edge)
        return sorted(results.values(), key=lambda item: item["qualified_name"]), edges

    def _callers_of(
        self,
        index: dict[str, Any],
        node: dict[str, Any],
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        caller_qns = index["callers_by_target"].get(node["qualified_name"], [])
        results = self._nodes_for_qns(index, caller_qns)
        edges = [
            self._edge(
                "CALLS",
                caller_qn,
                node["qualified_name"],
                index["nodes_by_qn"][caller_qn]["file_path"],
                node["file_path"],
            )
            for caller_qn in caller_qns
            if caller_qn in index["nodes_by_qn"]
        ]
        return results, edges

    def _callees_of(
        self,
        index: dict[str, Any],
        node: dict[str, Any],
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        callee_qns = index["callees_by_source"].get(node["qualified_name"], [])
        results = self._nodes_for_qns(index, callee_qns)
        edges = [
            self._edge(
                "CALLS",
                node["qualified_name"],
                callee_qn,
                node["file_path"],
                index["nodes_by_qn"][callee_qn]["file_path"],
            )
            for callee_qn in callee_qns
            if callee_qn in index["nodes_by_qn"]
        ]
        return results, edges

    def _imports_of(
        self,
        index: dict[str, Any],
        node: dict[str, Any],
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        file_path = node["file_path"]
        imported_files = index["imports_by_file"].get(file_path, [])
        results = self._nodes_for_qns(index, imported_files)
        edges = [
            self._edge("IMPORTS_FROM", file_path, imported, file_path, imported)
            for imported in imported_files
        ]
        return results, edges

    def _importers_of(
        self,
        index: dict[str, Any],
        node: dict[str, Any],
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        file_path = node["file_path"]
        importers = index["importers_by_file"].get(file_path, [])
        results = self._nodes_for_qns(index, importers)
        edges = [
            self._edge("IMPORTS_FROM", importer, file_path, importer, file_path)
            for importer in importers
        ]
        return results, edges

    def _children_of(
        self,
        index: dict[str, Any],
        node: dict[str, Any],
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        file_path = node["file_path"]
        child_qns = index["children_by_file"].get(file_path, [])
        results = self._nodes_for_qns(index, child_qns)
        edges = [
            self._edge("CONTAINS", file_path, child_qn, file_path, file_path)
            for child_qn in child_qns
        ]
        return results, edges

    def _inheritors_of(
        self,
        index: dict[str, Any],
        node: dict[str, Any],
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        child_qns = index["inheritors_by_target"].get(node["qualified_name"], [])
        results = self._nodes_for_qns(index, child_qns)
        edges = [
            self._edge(
                "INHERITS",
                child_qn,
                node["qualified_name"],
                index["nodes_by_qn"][child_qn]["file_path"],
                node["file_path"],
            )
            for child_qn in child_qns
            if child_qn in index["nodes_by_qn"]
        ]
        return results, edges

    def _nodes_for_files(self, index: dict[str, Any], files: list[str]) -> list[dict[str, Any]]:
        qns: list[str] = []
        for file_path in files:
            qns.extend(index["children_by_file"].get(file_path, []))
        return self._nodes_for_qns(index, qns)

    def _nodes_for_qns(self, index: dict[str, Any], qns: list[str]) -> list[dict[str, Any]]:
        return [
            index["nodes_by_qn"][qualified_name]
            for qualified_name in sorted(set(qns))
            if qualified_name in index["nodes_by_qn"]
        ]

    def _edges_for_files(
        self,
        index: dict[str, Any],
        visible_files: set[str],
    ) -> list[dict[str, Any]]:
        edge_map: dict[tuple[str, str, str], dict[str, Any]] = {}

        for file_path in sorted(visible_files):
            for child_qn in index["children_by_file"].get(file_path, []):
                edge = self._edge("CONTAINS", file_path, child_qn, file_path, file_path)
                edge_map[self._edge_key(edge)] = edge

            for imported in index["imports_by_file"].get(file_path, []):
                if imported not in visible_files:
                    continue
                edge = self._edge("IMPORTS_FROM", file_path, imported, file_path, imported)
                edge_map[self._edge_key(edge)] = edge

        for target_qn, child_qns in index["inheritors_by_target"].items():
            target_node = index["nodes_by_qn"].get(target_qn)
            if not target_node or target_node["file_path"] not in visible_files:
                continue
            for child_qn in child_qns:
                child_node = index["nodes_by_qn"].get(child_qn)
                if not child_node or child_node["file_path"] not in visible_files:
                    continue
                edge = self._edge(
                    "INHERITS",
                    child_qn,
                    target_qn,
                    child_node["file_path"],
                    target_node["file_path"],
                )
                edge_map[self._edge_key(edge)] = edge

        for target_qn, test_qns in index["tests_by_target"].items():
            target_node = index["nodes_by_qn"].get(target_qn)
            if not target_node or target_node["file_path"] not in visible_files:
                continue
            for test_qn in test_qns:
                test_node = index["nodes_by_qn"].get(test_qn)
                if not test_node or test_node["file_path"] not in visible_files:
                    continue
                edge = self._edge(
                    "TESTED_BY",
                    test_qn,
                    target_qn,
                    test_node["file_path"],
                    target_node["file_path"],
                )
                edge_map[self._edge_key(edge)] = edge

        return sorted(
            edge_map.values(),
            key=lambda edge: (
                edge["kind"],
                edge["source_qualified"],
                edge["target_qualified"],
            ),
        )

    def _resolve_target(self, index: dict[str, Any], target: str) -> dict[str, Any] | None:
        if target in index["nodes_by_qn"]:
            return index["nodes_by_qn"][target]
        rel_path = self._resolve_file_target(index, target)
        if rel_path:
            return index["file_nodes"][rel_path]
        candidates = index["symbols_by_name"].get(target, [])
        if len(candidates) == 1:
            return index["nodes_by_qn"].get(candidates[0])
        return None

    def _resolve_file_target(self, index: dict[str, Any], target: str) -> str | None:
        if target in index["file_nodes"]:
            return target
        normalized = target.removeprefix(str(self.repo_root)).lstrip("/")
        if normalized in index["file_nodes"]:
            return normalized
        return None

    def _query_result(
        self,
        query_type: str,
        target: str,
        results: list[dict[str, Any]],
        edges: list[dict[str, Any]],
    ) -> dict[str, Any]:
        return {
            "status": "ok",
            "pattern": query_type,
            "target": target,
            "summary": f"Found {len(results)} result(s) for {query_type}('{target}')",
            "results": results,
            "edges": edges,
        }

    def _edge(
        self,
        kind: str,
        source: str,
        target: str,
        source_file: str,
        target_file: str,
    ) -> dict[str, Any]:
        return {
            "kind": kind,
            "source_qualified": source,
            "target_qualified": target,
            "file_path": source_file,
            "source_file": source_file,
            "target_file": target_file,
        }

    def _edge_key(self, edge: dict[str, Any]) -> tuple[str, str, str]:
        return (
            edge["kind"],
            edge["source_qualified"],
            edge["target_qualified"],
        )

    def _sorted_mapping(
        self,
        mapping: dict[str, set[str]],
    ) -> dict[str, list[str]]:
        return {
            key: sorted(values)
            for key, values in mapping.items()
            if values
        }

    def _symbol_name(self, language: str, node, source: bytes) -> str:
        if language == "python":
            identifier = self._first_child(node, {"identifier"})
            return self._node_text(identifier, source) if identifier else ""
        if language == "rust":
            identifier = self._first_child(node, {"identifier", "type_identifier"})
            return self._node_text(identifier, source) if identifier else ""
        if language in {"typescript", "tsx", "javascript"}:
            if node.type == "variable_declarator":
                identifier = self._first_child(node, {"identifier"})
                return self._node_text(identifier, source) if identifier else ""
            identifier = self._first_child(node, {"identifier", "type_identifier"})
            return self._node_text(identifier, source) if identifier else ""
        return ""

    def _symbol_references(
        self,
        language: str,
        node,
        source: bytes,
        declared_name: str,
    ) -> set[str]:
        refs: set[str] = set()
        for child in node.children:
            for identifier in self._descendants(child, {"identifier", "type_identifier"}):
                text = self._node_text(identifier, source)
                if text and text != declared_name and text != "self":
                    refs.add(text)
        return refs

    def _extract_extends(self, language: str, node, source: bytes) -> str:
        if language == "python":
            for identifier in self._descendants(node, {"identifier"}):
                text = self._node_text(identifier, source)
                if text != self._symbol_name(language, node, source):
                    return text
            return ""
        if language in {"typescript", "tsx", "javascript"}:
            heritage = self._first_child(node, {"class_heritage"})
            if not heritage:
                return ""
            for identifier in self._descendants(heritage, {"identifier", "type_identifier"}):
                return self._node_text(identifier, source)
        return ""

    def _is_test_symbol(
        self,
        language: str,
        node,
        name: str,
        text: str,
        source: bytes,
        ancestors: list[Any],
    ) -> bool:
        lowered = name.lower()
        if lowered.startswith("test"):
            return True
        if language == "rust":
            prefix = text[: max(text.find("{"), 0)] if "{" in text else text
            if "#[test]" in prefix:
                return True
            for ancestor in ancestors:
                if ancestor.type == "mod_item" and "tests" in self._node_text(
                    ancestor,
                    source,
                ):
                    return True
        return False

    def _looks_like_arrow_function(self, node, source: bytes) -> bool:
        return "=>" in self._node_text(node, source)

    def _resolve_relative_import(self, rel_path: str, import_path: str) -> str | None:
        if not import_path.startswith("."):
            return None
        base_dir = (self.repo_root / rel_path).parent
        candidate = (base_dir / import_path).resolve()
        suffix = Path(rel_path).suffix.lower()
        extensions = [suffix] if suffix else []
        extensions.extend([".ts", ".tsx", ".js", ".jsx", ".py", ".rs"])

        candidates = [candidate]
        if not candidate.suffix:
            candidates.extend(candidate.with_suffix(ext) for ext in extensions)
            candidates.extend(candidate / f"index{ext}" for ext in extensions)

        for path in candidates:
            try:
                relative = path.relative_to(self.repo_root).as_posix()
            except ValueError:
                continue
            if path.exists() and path.is_file():
                return relative
        return None

    def _resolve_python_import(self, rel_path: str, import_path: str) -> str | None:
        leading_dots = len(import_path) - len(import_path.lstrip("."))
        relative_part = import_path.lstrip(".").replace(".", "/")
        anchor = (self.repo_root / rel_path).parent
        for _ in range(max(leading_dots - 1, 0)):
            anchor = anchor.parent
        candidate = (anchor / relative_part).resolve() if relative_part else anchor.resolve()
        for path in [candidate.with_suffix(".py"), candidate / "__init__.py"]:
            try:
                relative = path.relative_to(self.repo_root).as_posix()
            except ValueError:
                continue
            if path.exists() and path.is_file():
                return relative
        return None

    def _resolve_rust_import(self, rel_path: str, import_text: str) -> str | None:
        path_text = import_text.removeprefix("use").strip().rstrip(";")
        if "::" not in path_text:
            return None
        parts = [
            part
            for part in path_text.split("::")
            if part and part not in {"crate", "self", "super"}
        ]
        if not parts:
            return None

        crate_root = self._rust_crate_root(rel_path)
        if not crate_root:
            return None

        current_dir = (self.repo_root / rel_path).parent
        anchors = []
        if path_text.startswith("crate::"):
            anchors.append(crate_root)
        elif path_text.startswith("super::"):
            anchors.append(current_dir.parent)
        elif path_text.startswith("self::"):
            anchors.append(current_dir)
        else:
            anchors.append(crate_root)

        module_parts = parts[:-1] or parts
        for anchor in anchors:
            module_base = anchor.joinpath(*module_parts)
            for path in [module_base.with_suffix(".rs"), module_base / "mod.rs"]:
                try:
                    relative = path.relative_to(self.repo_root).as_posix()
                except ValueError:
                    continue
                if path.exists() and path.is_file():
                    return relative
        return None

    def _rust_crate_root(self, rel_path: str) -> Path | None:
        path = self.repo_root / rel_path
        parts = list(path.parts)
        if "src" not in parts:
            return None
        src_index = parts.index("src")
        return Path(*parts[: src_index + 1])

    def _node_text(self, node, source: bytes) -> str:
        return source[node.start_byte : node.end_byte].decode("utf-8", errors="replace")

    def _first_child(self, node, types: set[str]):
        for child in node.children:
            if child.is_named and child.type in types:
                return child
        return None

    def _descendants(self, node, types: set[str]):
        for child in node.children:
            if not child.is_named:
                continue
            if child.type in types:
                yield child
            yield from self._descendants(child, types)

    def _strip_quotes(self, value: str) -> str:
        return value.strip("\"'")

    def _normalize_test_tokens(self, value: str) -> set[str]:
        normalized = re.sub(r"[^a-z0-9]+", " ", value.lower())
        return {part for part in normalized.split() if part and part != "test"}

    def _normalized_source_basename(self, rel_path: str) -> str:
        name = Path(rel_path).name
        name = re.sub(r"(\.test|\.spec|_test|_spec)(?=\.)", "", name)
        for suffix in Path(rel_path).suffixes:
            if name.endswith(suffix):
                name = name[: -len(suffix)]
        return name

    def _timestamp(self) -> str:
        return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
