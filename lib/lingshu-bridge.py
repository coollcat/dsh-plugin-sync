#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""灵枢写入桥：一次进程、一批节点。

为什么不让 Node 直接写 .md：
  灵枢的索引（_index.json + _index_log 分片）是派生面，节点文件是唯一真源，
  但**运行中的大脑只在读面探代际签名**（快照/分片），裸写 .md 对它不可见，
  直到 rebuild/重启；而 rebuild 又可能把他进程未 flush 的写入判旧。
  因此写入必须走库层 `MdCGSecure.add()`——它持有节点跨进程锁、继承未提供的
  frontmatter 字段（access_count/session/created_at 等本机态不会被远端冲掉）、
  并按分层复核闸（writegate）判定能不能写。

输入（stdin 一行 JSON）：
  {"root": "...", "packagePath": "...", "actor": "plugin-sync",
   "clearance": "internal",
   "operations": [{"id": "...", "layer": "contextual", "body": "...",
                   "frontMatter": "<canonical yaml 块，无 id/layer>"}]}

输出（stdout 一行）：
  RESULT_JSON:{"ok":true,"results":[{"key":"...","ok":true}, {"key":"...","ok":false,"error":"...","detail":"..."}]}
"""
import json
import os
import sys


def result(payload):
    sys.stdout.write("RESULT_JSON:" + json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def classify(exc):
    text = str(exc)
    name = type(exc).__name__
    if "复核" in text or "write_gate" in text.lower() or "writegate" in text.lower():
        return "write-gate-requires-review"
    if name in ("AccessDenied", "PermissionError") or "无权" in text or "拒绝" in text:
        return "lingshu-write-denied"
    return "lingshu-write-failed"



def _read_local_edges(path):
    """读本机既有节点的 edges（灵枢 frontmatter 行格式：`edges: <json>`）。"""
    try:
        with open(path, encoding="utf-8") as handle:
            lines = handle.read(65536).splitlines()
    except OSError:
        return None
    for index, line in enumerate(lines):
        if index == 0 and line.strip() == "---":
            continue
        if line.strip() == "---":
            break
        if line.startswith("edges:"):
            try:
                value = json.loads(line.split(":", 1)[1].strip())
                return value if isinstance(value, list) else None
            except ValueError:
                return None
    return None

def main():
    try:
        job = json.loads(sys.stdin.readline() or "{}")
    except ValueError as exc:
        result({"ok": False, "error": "lingshu-bridge-bad-input", "detail": str(exc)[:300]})
        return 1
    package_path = job.get("packagePath")
    if package_path and package_path not in sys.path:
        sys.path.insert(0, package_path)
    try:
        import yaml
        from md_cg.mdcos import MdCGSecure
        from md_cg.security import Principal
    except Exception as exc:  # noqa: BLE001 - any import failure means the bridge is unusable
        result({"ok": False, "error": "lingshu-bridge-unavailable",
                "detail": "%s: %s" % (type(exc).__name__, str(exc)[:300])})
        return 2
    principal = Principal(
        actor=job.get("actor") or "plugin-sync",
        clearance=job.get("clearance") or "internal",
        can_write=True,
        can_admin=False,
        role="sync",
        auth_mode="local-cli",
    )
    try:
        cg = MdCGSecure(job["root"], principal=principal, autoflush=1, async_flush=False)
    except Exception as exc:  # noqa: BLE001
        result({"ok": False, "error": "lingshu-root-unavailable",
                "detail": "%s: %s" % (type(exc).__name__, str(exc)[:300])})
        return 3
    results = []
    try:
        for op in job.get("operations") or []:
            node_id = op.get("id")
            try:
                fields = yaml.safe_load(op.get("frontMatter") or "") or {}
                if not isinstance(fields, dict):
                    raise ValueError("front matter is not a mapping")
                for reserved in ("id", "layer", "sensitivity"):
                    fields.pop(reserved, None)
                fields = {k: v for k, v in fields.items() if isinstance(k, str) and k.isidentifier()}
                kwargs = dict(fields)
                # 覆写时由灵枢自己的继承规则决定本机权威字段：
                #   · sensitivity：既有节点继承旧密级（缺省不传），新节点必须传；
                #   · edges：正文变了且不传会被清空，故显式带本机值；
                #   · consistency：关掉写入期冲突闸，避免跨设备副本触发 ConsistencyError。
                target = os.path.join(job["root"], op.get("layer") or "", node_id + ".md")
                exists = os.path.isfile(target)
                if not exists and op.get("sensitivity"):
                    kwargs["sensitivity"] = op["sensitivity"]
                if exists:
                    local_edges = _read_local_edges(target)
                    if local_edges is not None:
                        kwargs["edges"] = local_edges
                kwargs["consistency"] = False
                cg.add(node_id, op.get("body") or "", layer=op.get("layer"), **kwargs)
                results.append({"key": node_id, "ok": True})
            except Exception as exc:  # noqa: BLE001 - one bad node must not abort the batch
                results.append({"key": node_id, "ok": False,
                                "error": classify(exc), "detail": str(exc)[:400]})
    finally:
        try:
            cg.close()
        except Exception:  # noqa: BLE001
            pass
    ok = all(item.get("ok") for item in results)
    result({"ok": ok, "results": results})
    return 0 if ok else 0


if __name__ == "__main__":
    sys.exit(main())
