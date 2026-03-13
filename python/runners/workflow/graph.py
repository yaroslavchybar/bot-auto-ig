from typing import Dict, List, Optional, Tuple


def _build_edge_index(
    edges: List[Dict[str, object]],
) -> Dict[Tuple[str, str], List[str]]:
    out: Dict[Tuple[str, str], List[str]] = {}
    for edge in edges:
        src = str(edge.get('source') or '')
        tgt = str(edge.get('target') or '')
        if not src or not tgt:
            continue
        handle = str(edge.get('sourceHandle') or '')
        key = (src, handle)
        out.setdefault(key, []).append(tgt)
    return out


def _next_node(
    edge_index: Dict[Tuple[str, str], List[str]],
    node_id: str,
    handle: str,
) -> Optional[str]:
    candidates = edge_index.get((node_id, handle))
    if candidates:
        return candidates[0]
    if handle:
        fallback = edge_index.get((node_id, ''))
        if fallback:
            return fallback[0]
    return None
