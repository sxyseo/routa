#!/usr/bin/env python3
"""
Fitness Function Runner

Scans docs/fitness/*.md files, parses YAML frontmatter,
executes metrics commands, and outputs results to terminal.

Usage:
    python3 docs/fitness/scripts/fitness.py [--dry-run] [--verbose] [--help]

Options:
    --dry-run   Show what would be executed without running
    --verbose   Show command output on failure
    --help      Show this help message
"""

import re
import subprocess
import sys
from pathlib import Path

import yaml

def parse_frontmatter(content: str) -> dict | None:
    """Extract YAML frontmatter from markdown content."""
    match = re.match(r'^---\n(.*?)\n---', content, re.DOTALL)
    if not match:
        return None
    return yaml.safe_load(match.group(1))

def run_metric(metric: dict, dry_run: bool = False, verbose: bool = False) -> tuple[str, bool, str]:
    """Run a single metric command and check result."""
    name = metric.get('name', 'unknown')
    command = metric.get('command', '')
    pattern = metric.get('pattern', '')

    if dry_run:
        return name, True, f"[DRY-RUN] Would run: {command}"

    try:
        # Use shell=False with proper argument splitting for security
        # For simple commands, split on spaces; for complex ones, use shlex
        import shlex
        cmd_args = shlex.split(command)
        
        result = subprocess.run(
            cmd_args, capture_output=True, text=True, timeout=300, shell=False
        )
        output = result.stdout + result.stderr

        if pattern:
            passed = bool(re.search(pattern, output, re.IGNORECASE))
        else:
            passed = result.returncode == 0

        # Return more output in verbose mode
        max_len = 2000 if verbose else 500
        return name, passed, output[:max_len]
    except subprocess.TimeoutExpired:
        return name, False, "TIMEOUT (300s)"
    except Exception as e:
        return name, False, str(e)

def print_help():
    print(__doc__)
    sys.exit(0)

def main():
    if '--help' in sys.argv:
        print_help()

    dry_run = '--dry-run' in sys.argv
    verbose = '--verbose' in sys.argv
    fitness_dir = Path(__file__).parent.parent

    print("=" * 60)
    print("FITNESS FUNCTION REPORT")
    if dry_run:
        print("(DRY-RUN MODE)")
    print("=" * 60)
    
    total_score = 0
    total_weight = 0
    hard_gate_failed = []
    
    for md_file in sorted(fitness_dir.glob('*.md')):
        if md_file.name == 'README.md':
            continue
            
        content = md_file.read_text()
        fm = parse_frontmatter(content)
        
        if not fm or 'metrics' not in fm:
            continue
            
        dimension = fm.get('dimension', 'unknown')
        weight = fm.get('weight', 0)
        
        print(f"\n## {dimension.upper()} (weight: {weight}%)")
        print(f"   Source: {md_file.name}")
        
        dim_passed = 0
        dim_total = 0
        
        for metric in fm.get('metrics', []):
            name, passed, output = run_metric(metric, dry_run, verbose)
            status = "✅ PASS" if passed else "❌ FAIL"
            hard = " [HARD GATE]" if metric.get('hard_gate') else ""

            print(f"   - {name}: {status}{hard}")

            # Show output on failure (or in verbose mode)
            if not passed and (verbose or metric.get('hard_gate')):
                print(f"     Command: {metric.get('command', '')}")
                if output and output != "TIMEOUT (300s)":
                    # Indent output
                    for line in output.strip().split('\n')[:10]:
                        print(f"     > {line}")
                    if output.count('\n') > 10:
                        print(f"     > ... ({output.count(chr(10)) - 10} more lines)")

            if not passed and metric.get('hard_gate'):
                hard_gate_failed.append(name)

            dim_passed += 1 if passed else 0
            dim_total += 1
        
        if dim_total > 0:
            dim_score = (dim_passed / dim_total) * 100
            total_score += dim_score * weight
            total_weight += weight
            print(f"   Score: {dim_score:.0f}%")
    
    print("\n" + "=" * 60)
    
    if hard_gate_failed:
        print(f"❌ HARD GATES FAILED: {', '.join(hard_gate_failed)}")
        print("   Cannot proceed until hard gates pass.")
        sys.exit(2)
    
    if total_weight > 0:
        final_score = total_score / total_weight
        print(f"FINAL SCORE: {final_score:.1f}%")
        
        if final_score >= 90:
            print("✅ PASS")
        elif final_score >= 80:
            print("⚠️  WARN - Consider improvements")
        else:
            print("❌ BLOCK - Score too low")
            sys.exit(1)
    
    print("=" * 60)

if __name__ == '__main__':
    main()

