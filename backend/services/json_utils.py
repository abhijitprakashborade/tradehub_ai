"""Robust JSON extraction from LLM text output."""
import json
import re
from typing import Any, Optional


def extract_json(text: str) -> Optional[Any]:
    """
    Extract the first balanced JSON object/array from LLM output.
    Handles markdown fences, prose preamble, and trailing text.
    """
    if not text:
        return None

    # Strip markdown code fences
    text = re.sub(r"```(?:json)?", "", text)

    candidates = []
    for opener, closer in (("{", "}"), ("[", "]")):
        search_from = 0
        while True:
            start = text.find(opener, search_from)
            if start == -1:
                break
            depth = 0
            in_string = False
            escape = False
            end = -1
            for i in range(start, len(text)):
                ch = text[i]
                if escape:
                    escape = False
                    continue
                if ch == "\\":
                    escape = True
                    continue
                if ch == '"':
                    in_string = not in_string
                    continue
                if in_string:
                    continue
                if ch == opener:
                    depth += 1
                elif ch == closer:
                    depth -= 1
                    if depth == 0:
                        end = i
                        break
            if end != -1:
                candidates.append(text[start:end + 1])
            search_from = end + 1 if end != -1 else start + 1

    # Longest candidate first — usually the complete answer, not a nested fragment
    parsed = None
    for candidate in sorted(candidates, key=len, reverse=True):
        try:
            parsed = json.loads(candidate)
            break
        except json.JSONDecodeError:
            continue
    # If the answer clearly intended a JSON array but we only captured a nested
    # object (typical for truncated output), recover the leading complete objects.
    if parsed is not None and not isinstance(parsed, list) and re.match(r"\s*\[", text.lstrip()):
        salvaged = salvage_truncated_array(text)
        if salvaged:
            return salvaged
    return salvage_truncated_array(text) if parsed is None else parsed


def salvage_truncated_array(text: str) -> Optional[list]:
    """
    Recovery for truncated JSON arrays (output-token cap): collect every *complete*
    top-level object `{...}` that opens before the text ends; incomplete tails are
    discarded, never guessed.
    """
    array_start = text.find("[")
    if array_start == -1:
        return None
    items = []
    search_from = array_start + 1
    while True:
        start = text.find("{", search_from)
        if start == -1:
            break
        depth = 0
        in_string = False
        escape = False
        end = -1
        for i in range(start, len(text)):
            ch = text[i]
            if escape:
                escape = False
                continue
            if ch == "\\":
                escape = True
                continue
            if ch == '"':
                in_string = not in_string
                continue
            if in_string:
                continue
            if ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    end = i
                    break
        if end == -1:
            break  # trailing object incomplete → discard
        try:
            items.append(json.loads(text[start:end + 1]))
        except json.JSONDecodeError:
            pass
        search_from = end + 1
    return items or None
