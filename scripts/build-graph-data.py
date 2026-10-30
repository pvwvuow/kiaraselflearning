# -*- coding: utf-8 -*-
"""Build data/graph-en/*.json content files from the Python content modules.

Validates (hard-fails before writing anything):
  - unique node ids across ALL files (including seed.sample.json)
  - every edge endpoint exists
  - no duplicate edges (from, to, type)
  - words have glossFa + frequencyRank; quiz-ability: each CEFR band has
    enough glossed words for placement (pool + distractors)
  - prerequisite subgraph is acyclic

Run: python3 scripts/build-graph-data.py
"""
import json
import os
import sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from graph_data_a1 import A1_WORDS, A1_EDGES
from graph_data_a2 import A2_WORDS, A2_EDGES
from graph_data_b1 import B1_WORDS, B1_EDGES
from graph_data_extra import (
    CHUNKS, CHUNK_EDGES, GRAMMAR, GRAMMAR_EDGES,
    PRAGMATIC, PRAGMATIC_EDGES, ERRORS, ERROR_EDGES, CLUSTERS, CLUSTER_EDGES,
)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(ROOT, "data", "graph-en")
LICENSE = {"text": "hand-authored", "source": "kiara-content", "license": "CC0"}


def word_node(w):
    return {
        "id": w["id"], "type": "word", "cefr": w.get("cefr", None),
        "frequencyRank": w["rank"], "title": w["title"],
        "glossFa": w["gloss"], "explanationFa": w["expl"],
        "tags": w["tags"],
        "examples": ([{"text": w["ex"], **LICENSE}] if w.get("ex") else []),
    }


def pattern_node(n, ntype):
    return {
        "id": n["id"], "type": ntype, "cefr": n["cefr"],
        "frequencyRank": None, "title": n["title"],
        "glossFa": n["gloss"], "explanationFa": n["expl"],
        "tags": n["tags"],
        "examples": ([{"text": n["ex"], **LICENSE}] if n.get("ex") else []),
    }


def cefr_word(w):
    """CEFR band per word list (words are authored per band)."""
    return w.get("cefr", w.get("_band"))


def main():
    # sample file participates in id-uniqueness checks
    with open(os.path.join(DATA_DIR, "seed.sample.json"), encoding="utf-8") as f:
        sample = json.load(f)
    sample_ids = {n["id"] for n in sample["nodes"]}

    files = {}

    # words — each list tagged with its band
    for band, words, edges, fname in [
        ("A1", A1_WORDS, A1_EDGES, "words.a1.json"),
        ("A2", A2_WORDS, A2_EDGES, "words.a2.json"),
        ("B1", B1_WORDS, B1_EDGES, "words.b1.json"),
    ]:
        for w in words:
            w["cefr"] = band
        files[fname] = {
            "$comment": f"Kiara {band} words (new in M1) — hand-authored, CC0. "
                        "frequencyRank values are approximate COCA-style bands.",
            "nodes": [word_node(w) for w in words],
            "edges": [{"from": a, "to": b, "type": t} for a, b, t in edges],
        }

    files["chunks.json"] = {
        "$comment": "Kiara chunks (new in M1) — hand-authored, CC0.",
        "nodes": [pattern_node(n, "chunk") for n in CHUNKS],
        "edges": [{"from": a, "to": b, "type": t} for a, b, t in CHUNK_EDGES],
    }
    files["grammar.json"] = {
        "$comment": "Kiara grammar patterns (new in M1) — hand-authored, CC0.",
        "nodes": [pattern_node(n, "grammar_pattern") for n in GRAMMAR],
        "edges": [{"from": a, "to": b, "type": t} for a, b, t in GRAMMAR_EDGES],
    }
    files["pragmatic.json"] = {
        "$comment": "Kiara pragmatic skills (new in M1) — hand-authored, CC0.",
        "nodes": [pattern_node(n, "pragmatic_skill") for n in PRAGMATIC],
        "edges": [{"from": a, "to": b, "type": t} for a, b, t in PRAGMATIC_EDGES],
    }
    files["errors.json"] = {
        "$comment": "Kiara fa→en error patterns (new in M1) — hand-authored, CC0.",
        "nodes": [pattern_node(n, "error_pattern") for n in ERRORS],
        "edges": [{"from": a, "to": b, "type": t} for a, b, t in ERROR_EDGES],
    }
    files["clusters.json"] = {
        "$comment": "Kiara topic clusters (new in M1) — hand-authored, CC0.",
        "nodes": [pattern_node(n, "topic_cluster") for n in CLUSTERS],
        "edges": [{"from": a, "to": b, "type": t} for a, b, t in CLUSTER_EDGES],
    }

    # ── validations (before writing) ──
    all_ids = set(sample_ids)
    errors = []
    for fname, data in files.items():
        for n in data["nodes"]:
            if n["id"] in all_ids:
                errors.append(f"duplicate id {n['id']} in {fname}")
            all_ids.add(n["id"])
        for n in data["nodes"]:
            if n["type"] == "word":
                if not n["glossFa"]:
                    errors.append(f"word without glossFa: {n['id']}")
                if not n["frequencyRank"]:
                    errors.append(f"word without frequencyRank: {n['id']}")
            if n["type"] != "word" and not n["glossFa"]:
                errors.append(f"node without glossFa: {n['id']}")

    edge_set = set()
    all_edges = []
    for fname, data in files.items():
        for e in data["edges"]:
            all_edges.append((e["from"], e["to"], e["type"], fname))
    for a, b, t, _ in [(n["id"], e["to"], e["type"], None) for n in sample["nodes"] if False for e in []]:
        pass  # sample edges checked below via sample list
    sample_edge_list = [(e["from"], e["to"], e["type"]) for e in sample["edges"]]

    for a, b, t, fname in all_edges:
        if a not in all_ids:
            errors.append(f"{fname}: edge endpoint missing {a}")
        if b not in all_ids:
            errors.append(f"{fname}: edge endpoint missing {b}")
        key = (a, b, t)
        if key in edge_set:
            errors.append(f"duplicate edge {key} in {fname}")
        edge_set.add(key)
    for a, b, t in sample_edge_list:
        if a not in all_ids or b not in all_ids:
            errors.append(f"sample edge endpoint missing: {a} -> {b}")
        if (a, b, t) in edge_set:
            errors.append(f"sample edge duplicates new edge: {(a, b, t)}")
        edge_set.add((a, b, t))

    # acyclic prerequisite check (iterative DFS over all new+sample prereq edges)
    prereq = defaultdict(list)
    for a, b, t in edge_set:
        if t == "prerequisite":
            prereq[b].append(a)  # edge a -> b means a is prereq of b
    state = {}  # 0=unvisited,1=in-stack,2=done

    def has_cycle():
        for start in list(all_ids):
            if state.get(start):
                continue
            stack = [(start, iter(prereq.get(start, [])))]
            state[start] = 1
            while stack:
                node, it = stack[-1]
                nxt = next(it, None)
                if nxt is None:
                    state[node] = 2
                    stack.pop()
                    continue
                st = state.get(nxt, 0)
                if st == 1:
                    return f"prerequisite cycle involving {nxt}"
                if st == 0:
                    state[nxt] = 1
                    stack.append((nxt, iter(prereq.get(nxt, []))))
        return None

    cyc = has_cycle()
    if cyc:
        errors.append(cyc)

    # quiz-ability: per band, distinct glosses among words ≥ pool(4)+distractors(3)
    band_glosses = defaultdict(set)
    for fname, data in files.items():
        for n in data["nodes"]:
            if n["type"] == "word":
                band_glosses[n["cefr"]].add(n["glossFa"])
    for band in ("A1", "A2", "B1"):
        if len(band_glosses[band]) < 7:
            errors.append(f"band {band} has too few distinct glosses ({len(band_glosses[band])})")

    if errors:
        print("VALIDATION FAILED:")
        for e in errors:
            print(" -", e)
        sys.exit(1)

    # ── write ──
    for fname, data in files.items():
        path = os.path.join(DATA_DIR, fname)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=1)
            f.write("\n")
        print(f"wrote {fname}: {len(data['nodes'])} nodes / {len(data['edges'])} edges")

    # summary including sample
    by_type = defaultdict(int)
    for n in sample["nodes"]:
        by_type[n["type"]] += 1
    for data in files.values():
        for n in data["nodes"]:
            by_type[n["type"]] += 1
    total_nodes = sum(by_type.values())
    total_edges = len(edge_set)
    print(f"TOTAL graph: {total_nodes} nodes / {total_edges} edges")
    print("by type:", dict(sorted(by_type.items())))
    if total_nodes < 250:
        print("FAIL: fewer than 250 nodes")
        sys.exit(1)


if __name__ == "__main__":
    main()
