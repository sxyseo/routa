"""Graph runner — execute graph-backed fitness probes via the StructuralAnalyzer."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from routa_fitness.model import MetricResult, Tier
from routa_fitness.structure.adapter import try_create_adapter
from routa_fitness.structure.impact import (
    classify_test_file,
    filter_code_files,
    git_changed_files,
    git_commit_changed_files,
    git_recent_commits,
)


class GraphRunner:
    """Runs fitness probes backed by the code graph.

    Gracefully skips when no graph backend is available.
    """

    _QUERYABLE_NODE_KINDS = {"Function", "Class", "Method", "Type", "Interface", "Enum"}

    def __init__(self, project_root: Path):
        self.project_root = project_root
        self._adapter = try_create_adapter(project_root)

    @property
    def available(self) -> bool:
        return self._adapter is not None

    def _unavailable_result(self) -> dict[str, Any]:
        return {"status": "unavailable", "reason": "graph backend unavailable"}

    def _has_graph_cache(self) -> bool:
        return any(
            path.exists()
            for path in (
                self.project_root / ".routa-fitness" / "index.json",
                self.project_root / ".routa-fitness" / "graph.json",
                self.project_root / ".code-review-graph" / "graph.db",
            )
        )

    def build_graph(self, *, base: str = "HEAD", build_mode: str = "auto") -> dict[str, Any]:
        """Build or update the backing code graph."""
        if not self.available:
            return self._unavailable_result()

        if build_mode == "skip":
            return {"status": "skipped", "summary": "Graph build skipped."}

        full = build_mode == "full" or (build_mode == "auto" and not self._has_graph_cache())
        return self._adapter.build_or_update(full=full, base=base)

    def stats(self) -> dict[str, Any]:
        """Return graph statistics if the backend is available."""
        if not self.available:
            return self._unavailable_result()
        stats = self._adapter.stats()
        if "status" not in stats:
            stats["status"] = "ok"
        return stats

    def query(
        self,
        query_type: str,
        target: str,
        *,
        base: str = "HEAD",
        build_mode: str = "auto",
    ) -> dict[str, Any]:
        """Run a graph query after ensuring the graph is current."""
        if not self.available:
            return self._unavailable_result()

        build = self.build_graph(base=base, build_mode=build_mode)
        if build.get("status") == "unavailable":
            return build

        result = self._adapter.query(query_type, target)
        result.setdefault("status", "ok")
        result["build"] = build
        return result

    def analyze_impact(
        self,
        changed_files: list[str] | None = None,
        *,
        base: str = "HEAD",
        max_depth: int = 2,
        max_impacted_files: int = 200,
        build_mode: str = "auto",
    ) -> dict[str, Any]:
        """Return structured blast-radius analysis for the current graph."""
        if not self.available:
            return self._unavailable_result()

        raw_changed = list(changed_files) if changed_files is not None else git_changed_files(
            self.project_root, base
        )
        changed = filter_code_files(raw_changed, self.project_root)
        skipped = [path for path in raw_changed if path not in changed]

        if not changed:
            return {
                "status": "ok",
                "summary": "No changed code files detected.",
                "base": base,
                "changed_files": [],
                "skipped_files": skipped,
                "changed_nodes": [],
                "impacted_nodes": [],
                "impacted_files": [],
                "impacted_test_files": [],
                "edges": [],
                "wide_blast_radius": False,
                "build": self.build_graph(base=base, build_mode=build_mode),
            }

        build = self.build_graph(base=base, build_mode=build_mode)
        if build.get("status") == "unavailable":
            return build

        impact = self._adapter.impact_radius(changed, depth=max_depth)
        impacted_files = impact.get("impacted_files", [])
        impacted_test_files = sorted(
            {path for path in impacted_files if isinstance(path, str) and classify_test_file(path)}
        )
        wide = len(impacted_files) > max_impacted_files

        return {
            "status": impact.get("status", "ok"),
            "summary": impact.get(
                "summary",
                (
                    f"Blast radius for {len(changed)} changed file(s): "
                    f"{len(impact.get('changed_nodes', []))} changed nodes, "
                    f"{len(impact.get('impacted_nodes', []))} impacted nodes."
                ),
            ),
            "base": base,
            "changed_files": changed,
            "skipped_files": skipped,
            "changed_nodes": impact.get("changed_nodes", []),
            "impacted_nodes": impact.get("impacted_nodes", []),
            "impacted_files": impacted_files,
            "impacted_test_files": impacted_test_files,
            "edges": impact.get("edges", []),
            "wide_blast_radius": wide,
            "build": build,
        }

    def analyze_test_radius(
        self,
        changed_files: list[str] | None = None,
        *,
        base: str = "HEAD",
        max_depth: int = 2,
        build_mode: str = "auto",
        max_targets: int = 25,
    ) -> dict[str, Any]:
        """Return changed-node-to-test relationships for a diff."""
        impact = self.analyze_impact(
            changed_files,
            base=base,
            max_depth=max_depth,
            build_mode=build_mode,
        )
        if impact.get("status") != "ok":
            return impact

        target_nodes = self._select_query_targets(impact.get("changed_nodes", []), max_targets=max_targets)
        all_tests: dict[str, dict[str, Any]] = {}
        all_test_files = set(impact.get("impacted_test_files", []))
        query_failures: list[dict[str, str]] = []
        targets_with_tests = 0

        for target in target_nodes:
            query = self._adapter.query("tests_for", target["qualified_name"])
            status = query.get("status", "ok")
            if status != "ok":
                query_failures.append(
                    {
                        "qualified_name": target["qualified_name"],
                        "status": status,
                        "summary": query.get("summary") or query.get("error", ""),
                    }
                )
                target["tests"] = []
                continue

            tests = query.get("results", [])
            deduped_tests = []
            seen = set()
            for test in tests:
                key = test.get("qualified_name") or test.get("file_path") or test.get("name")
                if not key or key in seen:
                    continue
                seen.add(key)
                deduped_tests.append(test)
                all_tests[key] = test
                file_path = test.get("file_path")
                if isinstance(file_path, str) and file_path:
                    all_test_files.add(file_path)

            target["tests"] = deduped_tests
            target["tests_count"] = len(deduped_tests)
            if deduped_tests:
                targets_with_tests += 1

        untested_targets = [
            {
                "qualified_name": target["qualified_name"],
                "kind": target.get("kind", ""),
                "file_path": target.get("file_path", ""),
            }
            for target in target_nodes
            if not target.get("tests")
        ]

        summary = (
            f"Estimated test radius for {len(impact['changed_files'])} changed file(s): "
            f"{len(target_nodes)} queryable target(s), "
            f"{targets_with_tests} with explicit tests, "
            f"{len(all_test_files)} unique test file(s)."
        )
        if not target_nodes:
            summary = (
                f"Estimated test radius for {len(impact['changed_files'])} changed file(s): "
                "no queryable changed nodes found."
            )

        return {
            "status": "ok",
            "analysis_mode": "current_graph",
            "summary": summary,
            "base": base,
            "changed_files": impact["changed_files"],
            "skipped_files": impact["skipped_files"],
            "changed_nodes": impact["changed_nodes"],
            "impacted_nodes": impact["impacted_nodes"],
            "impacted_files": impact["impacted_files"],
            "impacted_test_files": impact["impacted_test_files"],
            "target_nodes": target_nodes,
            "query_failures": query_failures,
            "tests": sorted(
                all_tests.values(),
                key=lambda item: (
                    str(item.get("file_path", "")),
                    str(item.get("qualified_name", item.get("name", ""))),
                ),
            ),
            "test_files": sorted(all_test_files),
            "untested_targets": untested_targets,
            "wide_blast_radius": impact["wide_blast_radius"],
            "build": impact["build"],
        }

    def analyze_history(
        self,
        *,
        count: int = 10,
        ref: str = "HEAD",
        max_depth: int = 2,
        build_mode: str = "auto",
        max_targets: int = 25,
    ) -> dict[str, Any]:
        """Estimate test radius for recent commits using the current graph."""
        if not self.available:
            return self._unavailable_result()

        build = self.build_graph(base=ref, build_mode=build_mode)
        if build.get("status") == "unavailable":
            return build

        commits = git_recent_commits(self.project_root, count=count, ref=ref)
        results: list[dict[str, Any]] = []
        for commit_info in commits:
            raw_changed = git_commit_changed_files(self.project_root, commit_info["commit"])
            filtered_changed = filter_code_files(raw_changed, self.project_root)
            analysis = self.analyze_test_radius(
                filtered_changed,
                base=ref,
                max_depth=max_depth,
                build_mode="skip",
                max_targets=max_targets,
            )
            results.append(
                {
                    **commit_info,
                    "analysis_mode": "retrospective_current_graph",
                    "raw_changed_files": raw_changed,
                    "changed_files": filtered_changed,
                    "changed_file_count": len(filtered_changed),
                    "target_count": len(analysis.get("target_nodes", [])),
                    "test_file_count": len(analysis.get("test_files", [])),
                    "untested_target_count": len(analysis.get("untested_targets", [])),
                    "wide_blast_radius": analysis.get("wide_blast_radius", False),
                    "summary": analysis.get("summary", ""),
                    "test_files": analysis.get("test_files", []),
                    "untested_targets": analysis.get("untested_targets", []),
                }
            )

        return {
            "status": "ok",
            "analysis_mode": "retrospective_current_graph",
            "summary": (
                f"Estimated test radius for {len(results)} recent commit(s) using the current graph."
            ),
            "ref": ref,
            "build": build,
            "commits": results,
        }

    def probe_impact(
        self,
        *,
        base: str = "HEAD",
        max_depth: int = 2,
        max_impacted_files: int = 200,
        build_mode: str = "auto",
        require_graph: bool = False,
    ) -> MetricResult:
        """Run blast-radius analysis and return a structured MetricResult."""
        impact = self.analyze_impact(
            base=base,
            max_depth=max_depth,
            max_impacted_files=max_impacted_files,
            build_mode=build_mode,
        )
        if impact.get("status") == "unavailable":
            if require_graph:
                return MetricResult(
                    metric_name="graph_probe",
                    passed=False,
                    output="graph_probe_status: blocked import_error=ImportError",
                    tier=Tier.NORMAL,
                )
            return MetricResult(
                metric_name="graph_probe",
                passed=True,
                output="graph_probe_status: skipped reason=import_error",
                tier=Tier.NORMAL,
            )

        lines = [
            f"graph_probe_status: {impact.get('status', 'ok')}",
            f"graph_changed_files: {len(impact.get('changed_files', []))}",
            f"graph_impacted_files: {len(impact.get('impacted_files', []))}",
            f"graph_impacted_test_files: {len(impact.get('impacted_test_files', []))}",
            f"graph_wide_blast_radius: {'yes' if impact.get('wide_blast_radius') else 'no'}",
        ]
        if impact.get("summary"):
            lines.append(f"graph_summary: {impact['summary']}")

        return MetricResult(
            metric_name="graph_probe",
            passed=not impact.get("wide_blast_radius", False),
            output="\n".join(lines),
            tier=Tier.NORMAL,
        )

    def probe_test_coverage(
        self, changed_files: list[str] | None = None, *, base: str = "HEAD"
    ) -> MetricResult:
        """Check if changed functions have TESTED_BY edges in the graph."""
        radius = self.analyze_test_radius(changed_files, base=base, max_depth=1)
        if radius.get("status") == "unavailable":
            return MetricResult(
                metric_name="graph_test_coverage",
                passed=True,
                output="graph_test_coverage: skipped (graph unavailable)",
                tier=Tier.NORMAL,
            )

        test_files = radius.get("test_files", [])
        return MetricResult(
            metric_name="graph_test_coverage",
            passed=len(test_files) > 0,
            output=(
                f"graph_test_coverage: {'ok' if test_files else 'warn'}\n"
                f"changed_files: {len(radius.get('changed_files', []))}\n"
                f"test_files_in_radius: {len(test_files)}"
            ),
            tier=Tier.NORMAL,
        )

    def _select_query_targets(
        self, changed_nodes: list[dict[str, Any]], *, max_targets: int
    ) -> list[dict[str, Any]]:
        seen = set()
        targets: list[dict[str, Any]] = []

        for node in changed_nodes:
            qualified_name = node.get("qualified_name")
            if not isinstance(qualified_name, str) or not qualified_name:
                continue
            if qualified_name in seen:
                continue
            if node.get("kind") not in self._QUERYABLE_NODE_KINDS:
                continue
            if node.get("is_test"):
                continue
            seen.add(qualified_name)
            targets.append(
                {
                    "qualified_name": qualified_name,
                    "name": node.get("name", ""),
                    "kind": node.get("kind", ""),
                    "file_path": node.get("file_path", ""),
                }
            )
            if len(targets) >= max_targets:
                break

        return targets
