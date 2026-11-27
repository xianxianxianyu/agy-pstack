#!/usr/bin/env python3
"""topic-research retrieval: web, pages, papers, repos, code usage, and HN signal as normalized JSON.

Stdlib only (Python >= 3.9). Every command prints exactly one JSON object to stdout; errors print
{"command", "error", "hint"} and exit 2. Keys are read only by secret(): the env var first, then the
per-user keys file ${XDG_CONFIG_HOME:-~/.config}/secrets/keys.env (dotenv, chmod 600), so every agent
runtime on the machine (omp, Claude Code, Antigravity, cron) finds the same keys without its own config.
Every provider call (keyless and free ones too) is logged to ${XDG_CACHE_HOME:-~/.cache}/topic-research/ledger.jsonl.
"""
from __future__ import annotations

import argparse
import concurrent.futures as cf
import contextlib
import datetime as dt
import email.utils
import fcntl
import functools
import hashlib
import html
import itertools
import json
import os
import re
import shutil
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
import xml.etree.ElementTree as ET
from types import SimpleNamespace

UA = "topic-research/1.0 (+https://github.com/xianxianxianyu/topic-research)"
SNIPPET_CAP = 4000          # chars per search item; fetch uses --max-chars
README_CAP = 12000          # default for `repo --max-chars`
BRIEF_CAP = 300             # snippet chars per item on stdout with --brief
FIRST_WEB_DATE = "1991-01-01"   # web dates before this are parse errors, not history
TIMEOUT, FETCH_TIMEOUT = 30, 60
MAX_RETRIES = 2             # on 429/5xx only
MAX_RETRY_WAIT = 60         # a longer Retry-After fails now instead of stalling the agent
POOL = 4                    # max concurrent requests per fan-out
# Seconds between requests to a host, enforced across threads and processes (see host_slot).
MIN_INTERVAL = {"export.arxiv.org": 3.0, "arxiv.org": 3.0, "api.semanticscholar.org": 1.0}

# List prices in USD per unit (request, URL/page, or token). Calls not priced here log est_usd 0.
PRICES = {
    "parallel/search-fast": 0.001,
    "parallel/search-advanced": 0.005,
    "parallel/extract": 0.001,       # per URL
    "exa/search-lite": 0.004,        # base price, <= 10 results; response costDollars wins when present
    "exa/search-auto": 0.007,
    "exa/contents": 0.001,           # per page
    "deepseek/search": 0.00075,      # per non-empty result set
    "jina/search": 0.05e-6,          # per token ($50 per 1B-token pack)
    "jina/read": 0.05e-6,
    "openalex/search": 0.001,        # keyed only; the response's meta.cost_usd wins when present
}

PARALLEL_API = "https://api.parallel.ai"
PARALLEL_MCP = "https://search.parallel.ai/mcp"
EXA_API = "https://api.exa.ai"
EXA_MCP = "https://mcp.exa.ai/mcp"
DEEPSEEK_API = "https://api.deepseek.com"
JINA_SEARCH = "https://s.jina.ai/search"
JINA_READER = "https://r.jina.ai/"
OPENALEX = "https://api.openalex.org"
S2 = "https://api.semanticscholar.org/graph/v1"
ARXIV_API = "https://export.arxiv.org/api/query"
HF = "https://huggingface.co"
PWC = "https://paperswithcode.co"
GITHUB_API = "https://api.github.com"
GREP_MCP = "https://mcp.grep.app"
HN = "https://hn.algolia.com/api/v1/search"
ALPHAXIV_MCP = "https://api.alphaxiv.org/mcp/v1"

HOST_PROVIDER = {
    "api.parallel.ai": "parallel", "search.parallel.ai": "parallel", "api.exa.ai": "exa", "mcp.exa.ai": "exa",
    "api.deepseek.com": "deepseek", "s.jina.ai": "jina", "r.jina.ai": "jina", "api.openalex.org": "openalex",
    "api.semanticscholar.org": "s2", "export.arxiv.org": "arxiv", "arxiv.org": "arxiv", "huggingface.co": "hf",
    "paperswithcode.co": "pwc", "api.github.com": "github", "mcp.grep.app": "grepapp", "hn.algolia.com": "hn",
    "api.alphaxiv.org": "alphaxiv",
}
AUTH_HEADERS = {"authorization", "x-api-key"}   # a call without one of these is keyless
KINDS = {"web": "search", "papers": "search", "repos": "search", "hn": "search", "fetch": "read", "repo": "read",
         "pdf": "read", "paper": "enrich", "usage": "enrich", "doctor": "check"}

KEY_HELP = {
    "PARALLEL_API_KEY": "https://platform.parallel.ai",
    "EXA_API_KEY": "https://dashboard.exa.ai/api-keys",
    "DEEPSEEK_API_KEY": "https://platform.deepseek.com/api_keys",
    "JINA_API_KEY": "https://jina.ai/api-dashboard/key-manager",
    "OPENALEX_API_KEY": "https://openalex.org/settings/api",
    "S2_API_KEY": "https://www.semanticscholar.org/product/api#api-key-form",
    "GITHUB_TOKEN": "or run `gh auth login`",
    "ALPHAXIV_API_KEY": "https://www.alphaxiv.org → Settings → API Keys",
}

SESSION = uuid.uuid4().hex   # Parallel MCP free-tier session id, one per process
RUN = SimpleNamespace(command=None)   # the command being run; stamped on every ledger row
WARNINGS: list = []
CALLS: list = []             # ledger rows for this process, appended to the ledger once by main()
_lock = threading.Lock()
_local = threading.local()   # .row: this thread's last provider call, for account()


# ---------------------------------------------------------------- keys, ledger, errors

def keys_file() -> str:
    return os.path.join(os.environ.get("XDG_CONFIG_HOME") or os.path.expanduser("~/.config"), "secrets", "keys.env")


@functools.lru_cache(maxsize=1)
def _file_keys() -> dict:
    """NAME=value lines from keys_file(); `export ` prefixes, comments, and surrounding quotes are allowed."""
    try:
        with open(keys_file(), encoding="utf-8") as f:
            lines = f.read().splitlines()
    except OSError:
        return {}
    out = {}
    for line in lines:
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        name, value = line.removeprefix("export ").split("=", 1)
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        out[name.strip()] = value
    return out


@functools.lru_cache(maxsize=None)
def secret(name: str) -> str | None:
    """The only place keys are read: env var > keys file > (GITHUB_TOKEN only) `gh auth token`."""
    value = os.environ.get(name, "").strip() or _file_keys().get(name, "").strip()
    if value or name != "GITHUB_TOKEN" or not shutil.which("gh"):
        return value or None
    try:
        out = subprocess.run(["gh", "auth", "token"], capture_output=True, text=True, timeout=10)
    except (OSError, subprocess.SubprocessError):
        return None
    token = out.stdout.strip()
    return token if out.returncode == 0 and token else None


class Fail(Exception):
    """User-facing failure. Messages never contain key values."""

    def __init__(self, message: str, hint: str = "", status: int | None = None):
        super().__init__(message)
        self.hint, self.status = hint, status


def need(name: str) -> str:
    key = secret(name)
    if not key:
        raise Fail(f"{name} is not set", hint=f"add {name}=<key> to {keys_file()} or export it ({KEY_HELP[name]})")
    return key


def warn(message: str) -> None:
    with _lock:
        if message not in WARNINGS:
            WARNINGS.append(message)


def cache_dir() -> str:
    return os.path.join(os.environ.get("XDG_CACHE_HOME") or os.path.expanduser("~/.cache"), "topic-research")


def _cache_ttl() -> int:
    try:
        return max(0, int(os.environ.get("TOPIC_RESEARCH_CACHE_TTL", "86400")))
    except ValueError:
        return 86400


def _cache_path(namespace: str, key_obj) -> str:
    raw = json.dumps(key_obj, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    digest = hashlib.sha256(raw.encode("utf-8")).hexdigest()
    return os.path.join(cache_dir(), "read_cache", namespace, f"{digest}.json")


def cache_get(namespace: str, key_obj, *, enabled: bool = True) -> dict | None:
    ttl = _cache_ttl()
    if not enabled or ttl <= 0:
        return None
    path = _cache_path(namespace, key_obj)
    try:
        if not os.path.isfile(path) or (time.time() - os.path.getmtime(path)) > ttl:
            return None
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, dict) and data.get("items"):
            return data
    except (OSError, json.JSONDecodeError):
        return None
    return None


def cache_put(namespace: str, key_obj, payload: dict, *, enabled: bool = True) -> None:
    if not enabled or _cache_ttl() <= 0 or not payload.get("items"):
        return
    path = _cache_path(namespace, key_obj)
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        tmp = f"{path}.{os.getpid()}.tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False)
        os.replace(tmp, path)
    except OSError:
        pass


def ledger_path() -> str:
    return os.path.join(cache_dir(), "ledger.jsonl")


def _log_call(url: str, headers: dict, status) -> None:
    s = urllib.parse.urlsplit(url)
    row = {"ts": dt.datetime.now().astimezone().isoformat(timespec="seconds"), "command": RUN.command,
           "provider": HOST_PROVIDER.get(s.hostname, s.hostname),
           "endpoint": s.path[:80] or "/", "keyless": not any(h.lower() in AUTH_HEADERS for h in headers),
           "status": status, "n": 1, "est_usd": 0.0}
    _local.row = row
    with _lock:
        CALLS.append(row)


def account(*, price: str | None = None, units: float = 1, usd=None, n: int | None = None,
            endpoint: str | None = None) -> None:
    """Annotate this thread's last provider call: its cost (provider-reported `usd`, else PRICES[price] x units),
    how many query strings / URLs / ids it served (`n`), or a more telling endpoint name."""
    row = _local.row
    if usd is not None or price:
        row["units"] = units
        row["est_usd"] = round(float(usd) if usd is not None else PRICES[price] * units, 8)
    if n is not None:
        row["n"] = n
    if endpoint:
        row["endpoint"] = endpoint


def flush_ledger() -> None:
    if not CALLS:
        return
    try:
        os.makedirs(cache_dir(), exist_ok=True)
        with open(ledger_path(), "a", encoding="utf-8") as f:
            fcntl.flock(f, fcntl.LOCK_EX)   # one locked append per process keeps concurrent runs' rows whole
            f.write("".join(json.dumps(r) + "\n" for r in CALLS))
    except OSError as e:
        warn(f"ledger not written: {e}")


# ---------------------------------------------------------------- HTTP

class HttpFail(Fail):
    pass


class Resp:
    def __init__(self, status, headers, body: bytes):
        self.status, self.headers, self.body = status, headers, body

    def json(self):
        return json.loads(self.body.decode("utf-8")) if self.body.strip() else None

    @property
    def text(self) -> str:
        return self.body.decode("utf-8", "replace")


@contextlib.contextmanager
def host_slot(host: str):
    """Hold an exclusive flock on a per-host stamp file for the whole request, starting no sooner than
    MIN_INTERVAL after the previous request ended. Threads and processes queue on the same lock, so arXiv
    also gets its 'one connection at a time'."""
    gap = MIN_INTERVAL.get(host)
    if not gap:
        yield
        return
    folder = os.path.join(cache_dir(), "ratelimit")
    os.makedirs(folder, exist_ok=True)
    with open(os.path.join(folder, host), "a+") as f:
        fcntl.flock(f, fcntl.LOCK_EX)
        f.seek(0)
        try:
            last = float(f.read().strip() or 0)
        except ValueError:
            last = 0.0
        time.sleep(max(0.0, last + gap - time.time()))
        try:
            yield
        finally:
            f.seek(0)
            f.truncate()
            f.write(f"{time.time():.3f}")
            f.flush()


def _retry_after(headers) -> float | None:
    value = headers.get("Retry-After") if headers else None
    if not value:
        return None
    try:
        return max(0.0, float(value))
    except ValueError:
        try:
            return max(0.0, email.utils.parsedate_to_datetime(value).timestamp() - time.time())
        except (TypeError, ValueError):
            return None


def _error_text(raw: bytes) -> str:
    text = raw.decode("utf-8", "replace").strip()
    try:
        data = json.loads(text)
    except ValueError:
        data = None
    if isinstance(data, dict):
        err = data.get("error")
        for candidate in (err.get("message") if isinstance(err, dict) else err, data.get("message"),
                          data.get("detail"), data.get("readableMessage")):
            if isinstance(candidate, str) and candidate:
                return candidate[:300]
    title = re.search(r"<title>(.*?)</title>", text, re.S | re.I)
    if title:
        return " ".join(title.group(1).split())[:200]
    return " ".join(text.split())[:300]


def http(url: str, *, method="GET", params=None, headers=None, body=None, timeout=TIMEOUT,
         accept="application/json") -> Resp:
    if params:
        query = urllib.parse.urlencode({k: v for k, v in params.items() if v is not None})
        url = f"{url}{'&' if '?' in url else '?'}{query}"
    data = None if body is None else json.dumps(body).encode("utf-8")
    hdrs = {"User-Agent": UA, "Accept": accept}
    if data is not None:
        hdrs["Content-Type"] = "application/json"
    hdrs.update(headers or {})
    host = urllib.parse.urlsplit(url).hostname or url
    for attempt in range(MAX_RETRIES + 1):
        request = urllib.request.Request(url, data=data, headers=hdrs, method=method)
        try:
            with host_slot(host), urllib.request.urlopen(request, timeout=timeout) as r:
                resp = Resp(r.status, r.headers, r.read())
            _log_call(url, hdrs, resp.status)
            return resp
        except urllib.error.HTTPError as e:
            raw = e.read() or b""
            if (e.code == 429 or e.code >= 500) and attempt < MAX_RETRIES:
                wait = _retry_after(e.headers)
                wait = 2.0 * (attempt + 1) if wait is None else wait
                if wait <= MAX_RETRY_WAIT:
                    time.sleep(wait)
                    continue
            _log_call(url, hdrs, e.code)
            raise HttpFail(f"{host}: HTTP {e.code}: {_error_text(raw)}", status=e.code) from None
        except (urllib.error.URLError, OSError) as e:  # DNS, TLS, refused, timeout
            _log_call(url, hdrs, None)
            raise Fail(f"{host}: {getattr(e, 'reason', None) or e}") from None
    raise AssertionError("unreachable")


def get_json(url, **kw):
    return http(url, **kw).json()


def post_json(url, body, **kw):
    return http(url, method="POST", body=body, **kw).json()


def optional(fn, *args):
    """Call fn; a 404 means 'not indexed here' and yields None."""
    try:
        return fn(*args)
    except HttpFail as e:
        if e.status == 404:
            return None
        raise


def pmap(fn, xs, workers=POOL):
    xs = list(xs)
    if len(xs) <= 1:
        return [fn(x) for x in xs]
    with cf.ThreadPoolExecutor(max_workers=min(workers, len(xs))) as pool:
        return list(pool.map(fn, xs))


def mcp(endpoint: str, method: str, params: dict | None = None, timeout=TIMEOUT, headers=None) -> dict:
    """One stateless JSON-RPC call to a streamable-HTTP MCP server (these servers need no initialize)."""
    message = {"jsonrpc": "2.0", "id": 1, "method": method, "params": params or {}}
    resp = http(endpoint, method="POST", body=message, timeout=timeout, headers=headers,
                accept="application/json, text/event-stream")
    account(endpoint=f"mcp:{(params or {}).get('name') or method}")
    if "text/event-stream" in (resp.headers.get("Content-Type") or ""):
        events = [json.loads(line[5:]) for line in resp.text.splitlines()
                  if line.startswith("data:") and line[5:].strip()]
        reply = next((m for m in reversed(events) if "result" in m or "error" in m), {})
    else:
        reply = resp.json() or {}
    host = urllib.parse.urlsplit(endpoint).hostname
    if reply.get("error"):
        raise Fail(f"{host}: {method}: {reply['error'].get('message')}")
    result = reply.get("result") or {}
    if result.get("isError"):
        raise Fail(f"{host}: {params.get('name') if params else method}: {mcp_text(result)[:300]}")
    return result


def mcp_tool(endpoint: str, tool: str, args: dict, timeout=TIMEOUT, headers=None) -> dict:
    return mcp(endpoint, "tools/call", {"name": tool, "arguments": args}, timeout, headers)


def alphaxiv(tool: str, args: dict, timeout=FETCH_TIMEOUT) -> str:
    """alphaXiv MCP with a Bearer key. Search and paper-reading tools count against the account's assistant
    quota (size not published); feeds don't. Returns the tool's text content."""
    headers = {"Authorization": f"Bearer {need('ALPHAXIV_API_KEY')}"}
    return mcp_text(mcp_tool(ALPHAXIV_MCP, tool, prune(args), timeout, headers))


def mcp_text(result: dict) -> str:
    return "\n".join(c.get("text", "") for c in result.get("content") or [] if c.get("type") == "text")


# ---------------------------------------------------------------- normalization

ARXIV_ID = r"(?:\d{4}\.\d{4,5}|[a-z][a-z.\-]*/\d{7})"
TRACKING = re.compile(r"^(utm_\w+|ref|ref_src|fbclid|gclid)$")
ITEM_ORDER = ("kind", "id", "title", "url", "published", "updated", "source", "sources", "snippet", "authors",
              "venue", "metrics", "links", "extra")


def prune(value):
    """Drop None, empty strings, lists and dicts, recursively; keep 0 and False."""
    if isinstance(value, dict):
        value = {k: prune(v) for k, v in value.items()}
        return {k: v for k, v in value.items() if v not in (None, "", [], {})}
    if isinstance(value, list):
        return [v for v in (prune(v) for v in value) if v not in (None, "", [], {})]
    return value


def day(value) -> str | None:
    """YYYY-MM-DD when the day is known, YYYY when only the year is; never a fabricated -01-01."""
    m = re.match(r"[12]\d{3}(?:-\d{2}-\d{2})?", str(value or "").strip())
    return m.group(0) if m else None


def is_before(date: str | None, after: str | None) -> bool:
    """A known date earlier than `after`; a year-only date is earlier only when its whole year is."""
    return bool(date and after and date < after[: len(date)])


def clip(text, cap: int) -> str:
    return (text or "").strip()[:cap]


def canon_url(url: str) -> str:
    s = urllib.parse.urlsplit(url.strip())
    host = (s.hostname or "").lower()
    host = host[4:] if host.startswith("www.") else host
    if s.port and s.port not in (80, 443):
        host = f"{host}:{s.port}"
    query = urllib.parse.urlencode([(k, v) for k, v in urllib.parse.parse_qsl(s.query, keep_blank_values=True)
                                    if not TRACKING.match(k)])
    scheme = "https" if s.scheme in ("http", "https") else s.scheme
    return urllib.parse.urlunsplit((scheme, host, s.path.rstrip("/"), query, ""))


def norm_doi(doi) -> str | None:
    doi = re.sub(r"^(?:https?://(?:dx\.)?doi\.org/|doi:)", "", str(doi or "").strip(), flags=re.I).lower()
    return doi if doi.startswith("10.") else None


def norm_arxiv(value) -> str | None:
    value = re.sub(r"^(?:arxiv:|https?://arxiv\.org/(?:abs|pdf|html)/)", "", str(value or "").strip(), flags=re.I)
    m = re.fullmatch(rf"({ARXIV_ID})(?:v\d+)?(?:\.pdf)?/?", value, re.I)
    return m.group(1).lower() if m else None


def url_id(url: str) -> str:
    """Typed id for a URL so web hits, pages, papers and repos dedupe across commands."""
    m = re.search(rf"arxiv\.org/(?:abs|pdf|html)/({ARXIV_ID})", url, re.I) \
        or re.search(r"huggingface\.co/papers/(\d{4}\.\d{4,5})", url)
    if m:
        return f"arxiv:{m.group(1).lower()}"
    m = re.match(r"https?://(?:dx\.)?doi\.org/(10\.\S+)", url, re.I)
    if m:
        doi = norm_doi(m.group(1))
        return f"arxiv:{doi[15:]}" if doi.startswith("10.48550/arxiv.") else f"doi:{doi}"
    m = re.match(r"https?://(?:www\.)?github\.com/([\w.-]+)/([\w.-]+?)(?:\.git)?/?$", url, re.I)
    if m:
        return f"gh:{m.group(1)}/{m.group(2)}".lower()
    return "url:" + canon_url(url)


def web_item(kind, source, url, title, snippet, published=None, authors=None, extra=None) -> dict:
    date = day(published)
    if is_before(date, FIRST_WEB_DATE):   # epoch-zero and similar placeholders from page metadata
        date, extra = None, {**(extra or {}), "date_invalid": True}
    return {"kind": kind, "id": url_id(url or ""), "title": " ".join(str(title or "").split()), "url": url,
            "published": date, "source": source, "snippet": (snippet or "").strip(),
            "authors": authors, "extra": extra}


def interleave(lists):
    return [x for row in itertools.zip_longest(*lists) for x in row if x is not None]


def dedupe(items):
    seen, out = set(), []
    for it in items:
        if it["id"] not in seen:
            seen.add(it["id"])
            out.append(it)
    return out


def take_per_group(groups, quota: int) -> list:
    """Round-robin over groups (one per query string); each adds up to `quota` items not already taken."""
    seen, taken, out = set(), [0] * len(groups), []
    for row in itertools.zip_longest(*groups):
        for i, it in enumerate(row):
            if it is not None and taken[i] < quota and it["id"] not in seen:
                seen.add(it["id"])
                taken[i] += 1
                out.append(it)
    return out


def mark_undated(items, after: str | None) -> None:
    """--after keeps undated items (they may be new); flag them rather than drop or pass them silently."""
    undated = [it for it in items if after and not it.get("published")]
    for it in undated:
        it["extra"] = {**(it.get("extra") or {}), "undated": True}
    if undated:
        warn(f"--after {after}: kept {len(undated)} undated item(s), marked extra.undated")


def clamp_n(label: str, n: int, maximum: int) -> int:
    if n > maximum:
        warn(f"{label}: -n {n} is above its max of {maximum} per request; using {maximum}")
    return min(n, maximum)


def domain_match(url: str, entries) -> bool:
    s = urllib.parse.urlsplit(url or "")
    host = (s.hostname or "").lower()
    host = host[4:] if host.startswith("www.") else host
    for entry in entries:
        domain, _, path = entry.lower().strip().removeprefix("www.").partition("/")
        hit = host.endswith(domain) if domain.startswith(".") else host == domain or host.endswith("." + domain)
        if hit and (not path or s.path.lstrip("/").startswith(path.rstrip("/"))):
            return True
    return False


# ---------------------------------------------------------------- web

CATEGORY_HINT = {"paper": "Prefer research papers and technical reports.", "news": "Prefer news coverage.",
                 "github": "Prefer GitHub repositories."}
EXA_CATEGORY = {"paper": "publication", "news": "news"}
# Filters each keyed web backend applies server-side. Keyless MCP backends apply none: there every filter is
# an objective hint, and domains and --after are re-checked on the results.
WEB_NATIVE = {"parallel": {"mode", "after", "domains"}, "exa": {"mode", "after", "domains", "paper", "news"},
              "deepseek": {"after", "domains"}, "jina": {"domains"}}
WEB_OBJECTIVE = {"parallel", "exa", "deepseek"}   # backends that take the objective (deepseek: first 128 chars)


def web_spec(a) -> SimpleNamespace:
    include = list(a.include_domain)
    if a.category == "github" and "github.com" not in include:
        include.append("github.com")
    hints = [CATEGORY_HINT[a.category]] if a.category else []
    if include:
        hints.append("Only use sources from: " + ", ".join(include) + ".")
    if a.exclude_domain:
        hints.append("Exclude sources from: " + ", ".join(a.exclude_domain) + ".")
    if a.after:
        hints.append(f"Only content published on or after {a.after}.")
    objective = a.objective or "Find material about: " + "; ".join(a.query)
    return SimpleNamespace(queries=a.query, objective=" ".join([objective, *hints]), mode=a.mode or "fast",
                           explicit_mode=a.mode is not None, n=a.n, include=include,
                           exclude=list(a.exclude_domain), after=a.after, category=a.category)


def web_flag_warnings(name: str, keyless: bool, spec) -> None:
    native = set() if keyless else WEB_NATIVE[name]
    label = f"{name} (keyless)" if keyless else name
    how = "only hinted in the objective" if name in WEB_OBJECTIVE else "not supported server-side"
    if spec.explicit_mode and "mode" not in native:
        warn(f"{label}: --mode is not supported; ignored")
    if spec.category in ("paper", "news") and spec.category not in native:
        warn(f"{label}: --category {spec.category} is {how}")
    if spec.category == "github" and "domains" not in native:
        warn(f"{label}: --category github is {how}; results are post-filtered to github.com")
    if spec.after and "after" not in native:
        warn(f"{label}: --after is {how}; results are post-filtered on known dates")


def parallel_item(r: dict, kind: str, cap: int) -> dict:
    text = r.get("full_content") or "\n\n".join(r.get("excerpts") or [])
    return web_item(kind, "parallel", r.get("url"), r.get("title"), clip(text, cap), published=r.get("publish_date"))


def web_parallel(spec):
    """One request for all query strings: Parallel ranks across them, so results are not attributed per query."""
    total = spec.n * len(spec.queries)
    body = prune({"objective": spec.objective, "search_queries": spec.queries, "mode": spec.mode,
                  "max_chars_total": SNIPPET_CAP * total,
                  "advanced_settings": {"max_results": total, "source_policy": {
                      "include_domains": spec.include, "exclude_domains": spec.exclude, "after_date": spec.after}}})
    data = post_json(f"{PARALLEL_API}/v1/search", body, headers={"x-api-key": need("PARALLEL_API_KEY")})
    account(price=f"parallel/search-{spec.mode}", n=len(spec.queries))
    for w in data.get("warnings") or []:
        warn(f"parallel: {w.get('message')}")
    results = data.get("results") or []
    if len(results) < total and len(spec.queries) > 1:
        warn(f"parallel: asked for {total} results over {len(spec.queries)} query strings, got {len(results)}; "
             "one request is capped, so split the query strings over several calls when you need more")
    return [[parallel_item(r, "web", SNIPPET_CAP) for r in results]]


def web_parallel_mcp(spec):
    clamp_n("parallel (keyless)", spec.n, 10)   # the MCP tool returns a fixed 10 results per call
    site = f" site:{spec.include[0]}" if len(spec.include) == 1 and "/" not in spec.include[0] else ""

    def one(query):   # one call per query string so results stay attributed to it
        result = mcp_tool(PARALLEL_MCP, "web_search",
                          {"objective": spec.objective, "search_queries": [query + site], "session_id": SESSION})
        data = result.get("structuredContent") or json.loads(mcp_text(result) or "{}")
        return [parallel_item(r, "web", SNIPPET_CAP) for r in data.get("results") or []]

    return pmap(one, spec.queries)


def exa_item(r: dict, kind: str, cap: int) -> dict:
    text = "\n\n".join(r.get("highlights") or []) or r.get("text") or r.get("summary")
    author = r.get("author")
    return web_item(kind, "exa", r.get("url"), r.get("title"), clip(text, cap), published=r.get("publishedDate"),
                     authors=[author] if author else None)


def web_exa(spec):
    key, kind, n = need("EXA_API_KEY"), "lite" if spec.mode == "fast" else "auto", clamp_n("exa", spec.n, 100)

    def one(query):
        body = prune({"query": query, "type": kind, "numResults": n, "objective": spec.objective,
                      "category": EXA_CATEGORY.get(spec.category), "includeDomains": spec.include,
                      "excludeDomains": spec.exclude,
                      "startPublishedDate": f"{spec.after}T00:00:00.000Z" if spec.after else None,
                      "contents": {"highlights": {"maxCharacters": SNIPPET_CAP, "query": spec.objective}}})
        data = post_json(f"{EXA_API}/search", body, headers={"x-api-key": key})
        account(price=f"exa/search-{kind}", usd=(data.get("costDollars") or {}).get("total"))
        return [exa_item(r, "web", SNIPPET_CAP) for r in data.get("results") or []]

    return pmap(one, spec.queries)


EXA_RECORD = re.compile(r"^(?:Title: |# )(.*)\nURL: (\S+)\n", re.M)


def parse_exa_text(text: str, kind: str, cap: int):
    """Exa MCP returns text records: 'Title:|# <title>', 'URL:', optional 'Published:'/'Author:'/'Highlights:'."""
    records, items = list(EXA_RECORD.finditer(text or "")), []
    for i, m in enumerate(records):
        body = text[m.end(): records[i + 1].start() if i + 1 < len(records) else len(text)]
        meta = {}
        while True:
            line = re.match(r"(Published|Author|Highlights|Text):[ \t]*(.*)(?:\n|$)", body)
            if not line:
                break
            meta[line.group(1)] = line.group(2).strip()
            body = body[line.end():]
        body = re.sub(r"\n-{3,}\s*$", "", body.strip()).strip()
        author = meta.get("Author")
        items.append(web_item(kind, "exa", m.group(2), m.group(1), clip(body, cap), published=meta.get("Published"),
                              authors=[author] if author and author != "N/A" else None))
    return items


def web_exa_mcp(spec):
    n = clamp_n("exa (keyless)", spec.n, 100)

    def one(query):
        result = mcp_tool(EXA_MCP, "web_search_exa", {"query": query, "numResults": n, "objective": spec.objective})
        return parse_exa_text(mcp_text(result), "web", SNIPPET_CAP)

    return pmap(one, spec.queries)


def web_deepseek(spec):
    key = need("DEEPSEEK_API_KEY")
    ops = [" OR ".join(f"site:{d}" for d in spec.include)] if spec.include else []
    ops += [f"-site:{d}" for d in spec.exclude] + ([f"after:{spec.after}"] if spec.after else [])
    suffix = " ".join(ops)
    room = 128 - len(suffix) - 1   # the API caps query + operators at 128 chars
    if room < 8:
        raise Fail("deepseek: domain/date operators exceed the 128-char query limit",
                   hint="pass fewer --include-domain/--exclude-domain values")

    n = clamp_n("deepseek", spec.n, 50)

    def one(query):
        if len(query) > room:
            warn(f"deepseek: query clipped to {room} chars to fit the 128-char limit")
        body = {"query": f"{query[:room].strip()} {suffix}".strip(), "count": n, "need_content": True,
                "ori_question": spec.objective[:128]}
        data = post_json(f"{DEEPSEEK_API}/v1/tools/search", body, headers={"Authorization": f"Bearer {key}"})
        rows = data.get("results") or []
        if rows:   # billed only for a non-empty result set
            account(price="deepseek/search")
        return [web_item("web", "deepseek", r.get("url"), r.get("title"),
                         clip("\n\n".join(x for x in (r.get("summary"), r.get("content")) if x), SNIPPET_CAP),
                         published=r.get("date"),
                         extra={"site": r.get("site_name"), "rerank_score": r.get("rerank_score"),
                                "authority": r.get("authority")})
                for r in rows]

    return pmap(one, spec.queries)


def jina_tokens(data: dict, rows) -> int:
    meta = ((data.get("meta") or {}).get("usage") or {}).get("tokens")
    return meta or sum(((r.get("usage") or {}).get("tokens") or 0) for r in rows)


def web_jina(spec):
    key = need("JINA_API_KEY")
    sites = " ".join(f"site:{d}" for d in spec.include)

    def one(query):
        data = post_json(JINA_SEARCH, {"q": f"{query} {sites}".strip(), "num": spec.n},
                         headers={"Authorization": f"Bearer {key}"})
        rows = data.get("data") or []
        account(price="jina/search", units=jina_tokens(data, rows) or 10000)
        return [web_item("web", "jina", r.get("url"), r.get("title"),
                         clip(r.get("content") or r.get("description"), SNIPPET_CAP),
                         published=r.get("date") or r.get("publishedTime")) for r in rows]

    return pmap(one, spec.queries)


WEB_BACKENDS = [  # (name, env var, keyed, keyless)
    ("parallel", "PARALLEL_API_KEY", web_parallel, web_parallel_mcp),
    ("exa", "EXA_API_KEY", web_exa, web_exa_mcp),
    ("deepseek", "DEEPSEEK_API_KEY", web_deepseek, None),
    ("jina", "JINA_API_KEY", web_jina, None),
]


def run_chain(choice: str, backends, spec):
    """auto: every keyed backend in order, then keyless ones; explicit: keyed, else keyless, else a key error."""
    plan = [(name, False, keyed) for name, env, keyed, _ in backends if choice in ("auto", name) and secret(env)]
    if choice == "auto":
        plan += [(name, True, keyless) for name, _, _, keyless in backends if keyless]
    elif not plan:
        name, env, _, keyless = next(b for b in backends if b[0] == choice)
        if not keyless:
            need(env)
        plan = [(name, True, keyless)]
    errors = []
    for name, keyless, fn in plan:
        try:
            items = fn(spec)
        except Fail as e:
            errors.append(f"{name}{' (keyless)' if keyless else ''}: {e}")
            continue
        for e in errors:
            warn(f"fell back after {e}")
        return items, name, keyless
    envs = ", ".join(env for name, env, _, _ in backends if choice in ("auto", name))
    raise Fail("; ".join(errors), hint=f"keyless endpoints failed or were rate-limited; set one of {envs}")


def cmd_web(a):
    spec = web_spec(a)
    groups, provider, keyless = run_chain(a.provider, WEB_BACKENDS, spec)
    web_flag_warnings(provider, keyless, spec)

    def keep(it):
        if spec.include and not domain_match(it["url"], spec.include):
            return False
        if spec.exclude and domain_match(it["url"], spec.exclude):
            return False
        return not is_before(it.get("published"), spec.after)

    # -n is per query string; a backend answering all queries in one ranked list gets n x queries
    quota = a.n if len(groups) == len(spec.queries) else a.n * len(spec.queries)
    items = take_per_group([[it for it in g if keep(it)] for g in groups], quota)
    mark_undated(items, spec.after)
    return {"query": a.query, "provider": provider, "keyless": keyless, "items": items}


# ---------------------------------------------------------------- fetch

def chunks(xs, size):
    return [xs[i:i + size] for i in range(0, len(xs), size)]


def fetch_parallel(spec):
    key, items = need("PARALLEL_API_KEY"), []
    # an objective asks for focused excerpts; full content only when there is no objective
    settings = ({"excerpt_settings": {"max_chars_per_result": spec.max_chars}} if spec.objective
                else {"full_content": {"max_chars_per_result": spec.max_chars}})
    for batch in chunks(spec.urls, 20):
        body = prune({"urls": batch, "objective": spec.objective, "advanced_settings": settings})
        data = post_json(f"{PARALLEL_API}/v1/extract", body, headers={"x-api-key": key}, timeout=FETCH_TIMEOUT)
        account(price="parallel/extract", units=len(batch), n=len(batch))
        items += [parallel_item(r, "page", spec.max_chars) for r in data.get("results") or []]
        for e in data.get("errors") or []:
            warn(f"parallel: {e.get('url')}: {e.get('error_type')} {e.get('http_status_code') or ''}".strip())
    return items


def fetch_parallel_mcp(spec):
    items = []
    for batch in chunks(spec.urls, 20):
        args = prune({"urls": batch, "objective": spec.objective, "session_id": SESSION,
                      "full_content": None if spec.objective else True})   # web_fetch returns excerpts by default
        result = mcp_tool(PARALLEL_MCP, "web_fetch", args, timeout=FETCH_TIMEOUT)
        account(n=len(batch))
        data = result.get("structuredContent") or json.loads(mcp_text(result) or "{}")
        items += [parallel_item(r, "page", spec.max_chars) for r in data.get("results") or []]
        for e in data.get("errors") or []:
            warn(f"parallel: {e.get('url')}: {e.get('error_type')} {e.get('http_status_code') or ''}".strip())
    return items


def fetch_exa(spec):
    key, items = need("EXA_API_KEY"), []
    content = ({"highlights": {"query": spec.objective, "maxCharacters": spec.max_chars}} if spec.objective
               else {"text": {"maxCharacters": spec.max_chars}})
    for batch in chunks(spec.urls, 100):
        data = post_json(f"{EXA_API}/contents", {"urls": batch, **content}, headers={"x-api-key": key},
                         timeout=FETCH_TIMEOUT)
        rows = data.get("results") or []
        account(price="exa/contents", units=len(rows), usd=(data.get("costDollars") or {}).get("total"), n=len(batch))
        items += [exa_item(r, "page", spec.max_chars) for r in rows]
        for s in data.get("statuses") or []:
            if s.get("status") == "error":
                warn(f"exa: {s.get('id')}: {(s.get('error') or {}).get('tag') or 'error'}")
    return items


def fetch_exa_mcp(spec):
    result = mcp_tool(EXA_MCP, "web_fetch_exa", {"urls": spec.urls, "maxCharacters": spec.max_chars},
                      timeout=FETCH_TIMEOUT)
    account(n=len(spec.urls))
    return parse_exa_text(mcp_text(result), "page", spec.max_chars)


def _jina_read(spec, key):
    def one(url):
        try:
            data = get_json(JINA_READER + url, headers={"Authorization": f"Bearer {key}"} if key else None,
                            timeout=FETCH_TIMEOUT)
        except Fail as e:
            warn(f"jina: {url}: {e}")
            return None
        d = (data or {}).get("data") or {}
        if key:
            account(price="jina/read", units=(d.get("usage") or {}).get("tokens") or 0)
        return web_item("page", "jina", d.get("url") or url, d.get("title"), clip(d.get("content"), spec.max_chars),
                        published=d.get("publishedTime"))

    return [x for x in pmap(one, spec.urls) if x]


def fetch_jina(spec):
    return _jina_read(spec, need("JINA_API_KEY"))


def fetch_jina_keyless(spec):
    return _jina_read(spec, None)


FETCH_BACKENDS = [
    ("parallel", "PARALLEL_API_KEY", fetch_parallel, fetch_parallel_mcp),
    ("exa", "EXA_API_KEY", fetch_exa, fetch_exa_mcp),
    ("jina", "JINA_API_KEY", fetch_jina, fetch_jina_keyless),
]
FETCH_OBJECTIVE = {("parallel", False), ("parallel", True), ("exa", False)}   # (provider, keyless) with excerpts
MD_LINK = re.compile(r"!?\[([^\]]*)\]\([^)]*\)")


def looks_like_navigation(text: str) -> bool:
    """Menus and link lists: no prose line of ~200 chars, or prose under 10% of the text once markdown links
    are cut to their labels. Calibrated on live pages: a GitHub org page scores 0.08, an arXiv abs page 0.18."""
    lines = [" ".join(line.split()) for line in MD_LINK.sub(r"\1", text).splitlines()]
    prose = [line for line in lines if len(line) >= 120 and not line.startswith("|")]
    return max(map(len, prose), default=0) < 200 or sum(map(len, prose)) < 0.1 * len(text)


def cmd_fetch(a):
    urls = [u if re.match(r"https?://", u) else f"https://{u}" for u in a.url]
    cache_key = {"urls": [canon_url(u) for u in urls], "objective": a.objective or "", "max_chars": a.max_chars, "provider": a.provider}
    cached = cache_get("fetch", cache_key, enabled=not getattr(a, "no_cache", False))
    if cached is not None:
        return {**cached, "cached": True}
    spec = SimpleNamespace(urls=urls, objective=a.objective, max_chars=a.max_chars)

    def nonempty(fn):
        def run(s):
            items = [it for it in fn(s) if it["snippet"]]
            if not items:
                raise Fail("no content returned")
            return items
        return run

    backends = [(n, env, nonempty(k), nonempty(kl)) for n, env, k, kl in FETCH_BACKENDS]
    items, provider, keyless = run_chain(a.provider, backends, spec)
    label = f"{provider} (keyless)" if keyless else provider
    if a.objective and (provider, keyless) not in FETCH_OBJECTIVE:
        warn(f"{label}: no objective-focused excerpts; returned the page text from the top")
    got = {it["id"] for it in items}
    for url in urls:   # backends warn about failures they report; this catches URLs dropped silently
        if url_id(url) not in got and not any(url in w for w in WARNINGS):
            warn(f"{label}: no content for {url}")
    for it in items:
        if looks_like_navigation(it["snippet"]):
            warn(f"{it['url']}: mostly navigation (low text density, no paragraph over ~200 chars); "
                 "the content may be missing or behind a script")
    result = {"query": urls, "provider": provider, "keyless": keyless, "items": dedupe(items)}
    cache_put("fetch", cache_key, result, enabled=not getattr(a, "no_cache", False))
    return result


# ---------------------------------------------------------------- papers

S2_FIELDS = ("paperId,title,abstract,url,venue,publicationDate,year,citationCount,influentialCitationCount,"
             "externalIds,openAccessPdf,authors")
OA_SELECT = ("id,doi,display_name,publication_date,publication_year,cited_by_count,counts_by_year,ids,authorships,"
             "primary_location,best_oa_location,abstract_inverted_index")
ATOM = {"a": "http://www.w3.org/2005/Atom", "arxiv": "http://arxiv.org/schemas/atom"}
PAPER_ENV = {"openalex": "OPENALEX_API_KEY", "s2": "S2_API_KEY", "alphaxiv": "ALPHAXIV_API_KEY"}
# discover_papers lines: "N. [ID=2609.17184] **Title** (url). Published YYYY-MM-DD by Org, Org · 66 votes · 756 views: abstract…"
AX_ENTRY = re.compile(r"^\d+\. \[ID=(?P<id>[^\]]+)\] \*\*(?P<title>.+?)\*\* \((?P<url>[^)\s]+)\)\.\s*"
                      r"(?:Published (?P<date>\d{4}-\d{2}-\d{2}))?(?: by (?P<orgs>.*?))?"
                      r"(?: · (?P<votes>\d+) votes?)?(?: · (?P<views>\d+) views?)?:\s*(?P<abstract>.*)$", re.S)


def paper(source, *, title, url=None, doi=None, arxiv=None, s2=None, **fields) -> dict:
    doi = norm_doi(doi)
    if doi and doi.startswith("10.48550/arxiv."):   # arXiv's DataCite DOI is an alias of the arXiv id
        arxiv, doi = arxiv or doi[15:], None
    ids = {k: v for k, v in (("doi", doi), ("arxiv", norm_arxiv(arxiv)), ("s2", s2)) if v}
    date = fields.get("published")
    # merge preference for `published`: arXiv v1 date > a full date from any source (earliest) > year-only
    rank = 3 if not date else 0 if source == "arxiv" else 1 if len(date) == 10 else 2
    return {"kind": "paper", "title": " ".join(str(title or "").split()), "url": url, "source": source,
            "sources": [source], **fields, "_ids": ids, "_date_rank": (rank, date or "")}


def paper_keys(it) -> set:
    keys = {f"{k}:{v}" for k, v in it["_ids"].items()}
    title = re.sub(r"[^a-z0-9]+", "", it.get("title", "").lower())
    return keys | ({f"title:{title}"} if len(title) >= 24 else set())


def merge_into(a: dict, b: dict) -> None:
    a["sources"] += [s for s in b["sources"] if s not in a["sources"]]
    for k, v in b["_ids"].items():
        a["_ids"].setdefault(k, v)
    for f in ("title", "url", "authors"):
        if not a.get(f) and b.get(f):
            a[f] = b[f]
    if len(b.get("snippet") or "") > len(a.get("snippet") or ""):
        a["snippet"] = b["snippet"]
    if b.get("venue") and (not a.get("venue") or "arxiv" in a["venue"].lower()):
        a["venue"] = b["venue"]   # a real venue beats arXiv
    if b["_date_rank"] < a["_date_rank"]:
        a["published"], a["_date_rank"] = b.get("published"), b["_date_rank"]
    a["updated"] = max(filter(None, (a.get("updated"), b.get("updated"))), default=None)
    metrics = a.setdefault("metrics", {})
    for k, v in (b.get("metrics") or {}).items():
        if v is not None:
            metrics[k] = v if metrics.get(k) is None else max(metrics[k], v)
    links = a.setdefault("links", {})
    for k, v in (b.get("links") or {}).items():
        if isinstance(v, list):
            links[k] = (links.get(k) or []) + [x for x in v if x not in (links.get(k) or [])]
        elif not links.get(k):
            links[k] = v
    a["extra"] = {**(b.get("extra") or {}), **(a.get("extra") or {})}


def merge_papers(stream) -> list:
    """Union items that share any DOI, arXiv id, S2 id, or normalized title."""
    groups, index = [], {}
    for it in stream:
        keys = paper_keys(it)
        hits = sorted({index[k] for k in keys if k in index})
        if not hits:
            groups.append(it)
            g = len(groups) - 1
        else:
            g = hits[0]
            merge_into(groups[g], it)
            for other in hits[1:]:   # this item bridges two groups: fold them
                merge_into(groups[g], groups[other])
                groups[other] = None
                for k, v in index.items():
                    if v == other:
                        index[k] = g
        for k in keys | paper_keys(groups[g]):
            index[k] = g
    return [g for g in groups if g]


def finish_paper(it: dict) -> dict:
    ids = it.pop("_ids")
    it.pop("_date_rank")
    it["id"] = next((f"{k}:{ids[k]}" for k in ("doi", "arxiv", "s2") if ids.get(k)), url_id(it.get("url") or ""))
    it["extra"] = {**(it.get("extra") or {}), "ids": ids}
    return it


def oa_headers():
    key = secret("OPENALEX_API_KEY")
    return {"Authorization": f"Bearer {key}"} if key else None


def s2_headers():
    key = secret("S2_API_KEY")
    return {"x-api-key": key} if key else None


def citation_trend(counts_by_year) -> dict:
    """OpenAlex counts_by_year → citations this calendar year and last year (a velocity signal without snapshots)."""
    by_year = {r.get("year"): r.get("cited_by_count") or 0 for r in counts_by_year or [] if r.get("year")}
    this = dt.date.today().year
    return {"citations_this_year": by_year.get(this, 0), "citations_last_year": by_year.get(this - 1, 0)} if by_year else {}


def oa_item(w: dict) -> dict:
    inv = w.get("abstract_inverted_index") or {}
    abstract = " ".join(word for _, word in sorted((i, word) for word, pos in inv.items() for i in pos))
    loc = w.get("primary_location") or {}
    ids = w.get("ids") or {}
    date = w.get("publication_date") or str(w.get("publication_year") or "")
    # OpenAlex fills a year-only date in as YYYY-01-01; keep just the year rather than a made-up day
    published = date[:4] if date.endswith("-01-01") else day(date)
    return paper("openalex", title=w.get("display_name"), url=loc.get("landing_page_url") or w.get("doi") or w.get("id"),
                 doi=w.get("doi"), arxiv=ids.get("arxiv"), snippet=abstract,
                 authors=[(x.get("author") or {}).get("display_name") for x in w.get("authorships") or []],
                 venue=(loc.get("source") or {}).get("display_name"), published=published,
                 metrics={"citations": w.get("cited_by_count"), **citation_trend(w.get("counts_by_year"))},
                 links={"pdf": (w.get("best_oa_location") or {}).get("pdf_url") or loc.get("pdf_url")},
                 extra={"openalex": w.get("id")})


def s2_item(p: dict) -> dict:
    ext = p.get("externalIds") or {}
    return paper("s2", title=p.get("title"), url=p.get("url"), doi=ext.get("DOI"), arxiv=ext.get("ArXiv"),
                 s2=p.get("paperId"), snippet=p.get("abstract"),
                 authors=[x.get("name") for x in p.get("authors") or []], venue=p.get("venue"),
                 published=day(p.get("publicationDate")) or day(str(p.get("year") or "")),
                 metrics={"citations": p.get("citationCount"), "influential_citations": p.get("influentialCitationCount")},
                 links={"pdf": (p.get("openAccessPdf") or {}).get("url")})


def hf_item(row: dict, extra_metrics=None) -> dict:
    p = row.get("paper") or row
    page = f"{HF}/papers/{p.get('id')}"
    return paper("hf", title=p.get("title") or row.get("title"), url=page, arxiv=p.get("id"),
                 snippet=p.get("summary") or row.get("summary"),
                 authors=[x.get("name") for x in p.get("authors") or [] if x.get("name")],
                 published=day(p.get("publishedAt")),
                 metrics={"hf_upvotes": p.get("upvotes"), "comments": row.get("numComments"), **(extra_metrics or {})},
                 links={"hf": page, "code": [p["githubRepo"]] if p.get("githubRepo") else None,
                        "project": p.get("projectPage")},
                 extra={"ai_summary": p.get("ai_summary"), "code_stars": p.get("githubStars")})


def arxiv_feed(params) -> list:
    root = ET.fromstring(http(ARXIV_API, params=params, accept="application/atom+xml").body)
    items = []
    for e in root.findall("a:entry", ATOM):
        text = lambda path: " ".join((e.findtext(path, "", ATOM) or "").split())  # noqa: E731
        m = re.search(rf"arxiv\.org/abs/({ARXIV_ID})(v\d+)?$", text("a:id"), re.I)
        if not m:
            if text("a:title") == "Error":
                raise Fail(f"arxiv: {text('a:summary')}")
            continue
        pdf = next((l.get("href") for l in e.findall("a:link", ATOM) if l.get("title") == "pdf"), None)
        primary = e.find("arxiv:primary_category", ATOM)
        items.append(paper("arxiv", title=text("a:title"), url=f"https://arxiv.org/abs/{m.group(1)}",
                           arxiv=m.group(1), doi=text("arxiv:doi"), snippet=text("a:summary"),
                           authors=[" ".join((a.findtext("a:name", "", ATOM)).split()) for a in e.findall("a:author", ATOM)],
                           venue=text("arxiv:journal_ref"), published=day(text("a:published")),
                           updated=day(text("a:updated")), links={"pdf": pdf},
                           extra={"arxiv_latest_version": m.group(2), "comment": text("arxiv:comment"),
                                  "primary_category": primary.get("term") if primary is not None else None}))
    return items


def arxiv_query(q: str) -> str:
    """Each quoted phrase or bare word becomes an all: clause; clauses are ANDed."""
    terms = []
    for phrase, word in re.findall(r'"([^"]+)"|(\S+)', q):
        word = re.sub(r"[^\w.+-]", "", word)
        if phrase or word:
            terms.append(f'all:"{phrase}"' if phrase else f"all:{word}")
    return " AND ".join(terms)


def papers_openalex(a):
    # title/abstract/keywords search (openalex.org's default); plain search= also matches full text,
    # which lets highly cited papers that merely mention the topic dominate --sort citations
    sort = {"date": "publication_date:desc", "citations": "cited_by_count:desc"}.get(a.sort)
    data = get_json(f"{OPENALEX}/works", headers=oa_headers(), params={
        "search.title_abstract_keywords": a.query, "per_page": clamp_n("openalex", a.n, 100), "select": OA_SELECT,
        "sort": sort, "filter": f"from_publication_date:{a.after}" if a.after else None})
    if secret("OPENALEX_API_KEY"):
        account(price="openalex/search", usd=(data.get("meta") or {}).get("cost_usd"))
    return [oa_item(w) for w in data.get("results") or []]


def papers_s2(a):
    data = get_json(f"{S2}/paper/search", headers=s2_headers(), params={
        "query": a.query, "limit": clamp_n("s2", a.n, 100), "fields": S2_FIELDS,
        "publicationDateOrYear": f"{a.after}:" if a.after else None})
    return [s2_item(p) for p in data.get("data") or []]


def papers_arxiv(a):
    query = arxiv_query(a.query)
    if a.after:
        query = f"({query}) AND submittedDate:[{a.after.replace('-', '')}0000 TO {dt.date.today():%Y%m%d}2359]"
    return arxiv_feed({"search_query": query, "start": 0, "max_results": clamp_n("arxiv", a.n, 2000),
                       "sortBy": "submittedDate" if a.sort == "date" else "relevance", "sortOrder": "descending"})


def papers_hf(a):   # no server-side date filter: --after is applied here
    rows = get_json(f"{HF}/api/papers/search", params={"q": a.query, "limit": clamp_n("hf", a.n, 120)}) or []
    return [it for it in map(hf_item, rows) if not is_before(it.get("published"), a.after)]


def ax_items(text: str) -> list:
    items = []
    for entry in re.split(r"\n(?=\d+\. \[ID=)", "\n" + text):
        m = AX_ENTRY.match(entry.strip())
        if not m:
            continue
        pid = m["id"]
        orgs = [o.strip() for o in (m["orgs"] or "").split(",") if o.strip()]
        items.append(paper("alphaxiv", title=m["title"], url=m["url"],
                           arxiv=pid if re.fullmatch(ARXIV_ID + r"(v\d+)?", pid) else None,
                           snippet=" ".join(m["abstract"].split()).removesuffix("..."), published=m["date"],
                           metrics={"alphaxiv_votes": int(m["votes"]) if m["votes"] else None,
                                    "alphaxiv_views": int(m["views"]) if m["views"] else None},
                           extra={"organizations": orgs, "alphaxiv_id": pid}))
    return items


def papers_alphaxiv(a):
    """alphaXiv discover_papers: keyword + embedding search with an agentic follow-up loop; 5–15 papers per call,
    first-publication date filter server-side. Uses the account's assistant quota (size not published)."""
    words = [w for w in re.split(r"\s*(?:,|;| OR )\s*", a.query) if w] or [a.query]
    text = alphaxiv("discover_papers", {
        "keywords": words[:4] if len(words) > 1 else [a.query], "question": a.objective or a.query,
        "difficulty": a.difficulty, "published_after": a.after,
        "prioritize": "recency" if a.sort == "date" else None}, timeout=180)
    items = ax_items(text)
    if text.strip() and not items:
        warn("alphaxiv: reply did not match the expected list format; nothing parsed")
    return items


PAPER_SOURCES = {"openalex": papers_openalex, "s2": papers_s2, "arxiv": papers_arxiv, "hf": papers_hf,
                 "alphaxiv": papers_alphaxiv}


def key_hint(name: str) -> str:
    env = PAPER_ENV.get(name)
    return f" (set {env} for a dedicated quota)" if env and not secret(env) else ""


def default_paper_sources() -> set:
    """Sources used by `papers --source all` and `paper`. Keyless Semantic Scholar shares one global pool
    that answers 429 most of the time (≈10 s of retries per call), so it joins only when S2_API_KEY is set;
    OpenAlex already supplies citation counts and the per-year trend. alphaXiv has no keyless access and joins
    `papers` only with ALPHAXIV_API_KEY. `--source s2|alphaxiv` still forces one."""
    return set(PAPER_SOURCES) - {n for n, env in (("s2", "S2_API_KEY"), ("alphaxiv", "ALPHAXIV_API_KEY"))
                                 if not secret(env)}


def cmd_papers(a):
    names = [n for n in PAPER_SOURCES if n in default_paper_sources()] if a.source == "all" else [a.source]

    def run(name):
        try:
            return PAPER_SOURCES[name](a)
        except Fail as e:
            if len(names) == 1:
                raise Fail(str(e), hint=key_hint(name).strip(" ()") or "retry later") from None
            warn(f"{name}: {e}{key_hint(name)}")
            return None

    results = dict(zip(names, pmap(run, names)))
    used = [n for n in names if results[n] is not None]
    if not used:
        raise Fail("every paper source failed", hint="see warnings; set OPENALEX_API_KEY or S2_API_KEY")
    items = merge_papers(interleave([results[n] for n in used]))   # relevance: round-robin by source rank
    if a.sort == "date":
        items.sort(key=lambda it: it.get("published") or "", reverse=True)
    elif a.sort == "citations":
        items.sort(key=lambda it: (it.get("metrics") or {}).get("citations") or 0, reverse=True)
    top = [finish_paper(it) for it in items[: a.n]]
    mark_undated(top, a.after)
    return {"query": a.query, "provider": "+".join(used),
            "keyless": not any(secret(PAPER_ENV[n]) for n in used if n in PAPER_ENV), "items": top}


# ---------------------------------------------------------------- paper ID

def parse_paper_id(raw: str) -> dict:
    s = raw.strip()
    m = re.search(rf"(?:arxiv\.org/(?:abs|pdf|html)|huggingface\.co/papers|paperswithcode\.co/paper)/({ARXIV_ID})", s, re.I)
    if m or norm_arxiv(s):
        return {"arxiv": norm_arxiv(m.group(1) if m else s)}
    m = re.search(r"semanticscholar\.org/paper/(?:[^/]+/)?([0-9a-f]{40})", s, re.I) \
        or re.fullmatch(r"(?:s2:)?([0-9a-f]{40})", s, re.I)
    if m:
        return {"s2": m.group(1).lower()}
    doi = norm_doi(s)
    if doi:
        return {"arxiv": doi[15:]} if doi.startswith("10.48550/arxiv.") else {"doi": doi}
    raise Fail(f"unrecognized paper id: {raw}", hint="use a DOI, arXiv id (2401.12345 or arxiv:...), S2 paper id, or a URL of those")


def lookup_arxiv(ids):
    """Reads the abs page, not the export API: the page is CDN-cached (the export API often answers 429
    'Rate exceeded' under load) and its submission history lists every version with its date."""
    aid = ids["arxiv"]
    page = http(f"https://arxiv.org/abs/{aid}", accept="text/html").text

    def meta(name):
        return next((html.unescape(v).strip() for v in re.findall(rf'<meta name="citation_{name}" content="([^"]*)"', page)), None)

    def cell(cls):
        m = re.search(rf'<td class="tablecell {cls}[^"]*">(.*?)</td>', page, re.S)
        return " ".join(html.unescape(re.sub(r"<[^>]+>", " ", m.group(1))).split()) if m else None

    if not meta("title"):
        raise Fail(f"arxiv: no metadata on the abs page of {aid}")
    versions = [{"version": f"v{n}", "date": dt.datetime.strptime(d, "%d %b %Y").strftime("%Y-%m-%d")}
                for n, d in re.findall(r"\[v(\d+)\](?:</a>)?</strong>\s*\w{3}, (\d{1,2} \w{3} \d{4})", page)]
    primary = re.search(r'<span class="primary-subject">[^<]*\(([^)]+)\)</span>', page)
    authors = [" ".join(reversed(a.split(", ", 1))) for a in
               (html.unescape(v) for v in re.findall(r'<meta name="citation_author" content="([^"]*)"', page))]
    return paper("arxiv", title=meta("title"), url=f"https://arxiv.org/abs/{aid}", arxiv=aid, doi=meta("doi"),
                 snippet=meta("abstract"), authors=authors, venue=cell("jref"),
                 published=versions[0]["date"] if versions else day((meta("date") or "").replace("/", "-")),
                 updated=versions[-1]["date"] if versions else day((meta("online_date") or "").replace("/", "-")),
                 links={"pdf": meta("pdf_url")},
                 extra={"arxiv_versions": versions, "comment": cell("comments"),
                        "primary_category": primary.group(1) if primary else None})


def lookup_s2(ids):
    ref = f"ARXIV:{ids['arxiv']}" if ids.get("arxiv") else f"DOI:{ids['doi']}" if ids.get("doi") else ids["s2"]
    return s2_item(get_json(f"{S2}/paper/{urllib.parse.quote(ref, safe=':/')}", headers=s2_headers(),
                            params={"fields": S2_FIELDS}))


def lookup_openalex(ids):   # singleton lookups are free, keyed or not
    doi = ids.get("doi") or f"10.48550/arxiv.{ids['arxiv']}"
    return oa_item(get_json(f"{OPENALEX}/works/doi:{doi}", headers=oa_headers(), params={"select": OA_SELECT}))


def lookup_pwc(ids):
    p = get_json(f"{PWC}/api/v1/papers/arxiv/{ids['arxiv']}", params={"include_resources": "true"})
    repos = sorted(p.get("repositories") or [], key=lambda r: (not r.get("is_official"), -(r.get("num_stars") or 0)))
    page = f"{PWC}/paper/{ids['arxiv']}"
    return paper("pwc", title=p.get("title"), url=page, arxiv=p.get("arxiv_id"), s2=p.get("semantic_scholar_id"),
                 snippet=p.get("abstract"), authors=p.get("authors"), published=day(p.get("published")),
                 venue=p.get("conference_name"), metrics={"citations": p.get("citation_count")},
                 links={"code": [r.get("url") for r in repos], "pwc": page,
                        "project": (p.get("project_pages") or [None])[0] if isinstance(p.get("project_pages"), list) else None},
                 extra={"tldr": p.get("tldr"), "pwc_code_repository_count": p.get("code_repository_count"),
                        "pwc_repositories": [{"url": r.get("url"), "stars": r.get("num_stars"), "official": r.get("is_official")}
                                             for r in repos],
                        "tasks": [t.get("name") for t in p.get("tasks") or [] if isinstance(t, dict)],
                        "methods": [t.get("name") for t in p.get("methods") or [] if isinstance(t, dict)]})


def lookup_hf(ids):
    aid = ids["arxiv"]
    page, repos = pmap(lambda path: optional(get_json, f"{HF}{path}"), [f"/api/papers/{aid}", f"/api/arxiv/{aid}/repos"])
    if not page and not repos:
        return None
    repos = repos or {}
    models = sorted(repos.get("models") or [], key=lambda m: -(m.get("downloads") or 0))
    spaces = sorted(repos.get("spaces") or [], key=lambda s: -(s.get("likes") or 0))
    it = hf_item(page or {"id": aid}, {"downloads_30d": sum(m.get("downloads") or 0 for m in models) if models else None})
    it["links"].update({"models": [f"{HF}/{m['id']}" for m in models[:10]],
                        "spaces": [f"{HF}/spaces/{s['id']}" for s in spaces[:10]]})
    it["extra"].update({"hf_models": len(models), "hf_spaces": len(spaces), "hf_datasets": len(repos.get("datasets") or [])})
    return it


PAPER_JOINS = [  # (name, ids any of which enables it, lookup); merge order = list order
    ("arxiv", ("arxiv",), lookup_arxiv),
    ("s2", ("arxiv", "doi", "s2"), lookup_s2),
    ("openalex", ("doi", "arxiv"), lookup_openalex),
    ("pwc", ("arxiv",), lookup_pwc),
    ("hf", ("arxiv",), lookup_hf),
]


def cmd_paper(a):
    ids, found, tried = parse_paper_id(a.id), {}, set()

    def attempt(job):
        name, fn = job
        try:
            return optional(fn, dict(ids))
        except Fail as e:
            warn(f"{name}: {e}{key_hint(name)}")
            return None

    for _ in range(2):   # the second wave runs joins unlocked by ids the first wave discovered
        todo = [(n, fn) for n, needs, fn in PAPER_JOINS
                if n not in tried and n in default_paper_sources() and any(ids.get(k) for k in needs)]
        if not todo:
            break
        tried.update(n for n, _ in todo)
        for (name, _), part in zip(todo, pmap(attempt, todo, workers=len(todo))):
            if part:
                found[name] = part
                for k, v in part["_ids"].items():
                    ids.setdefault(k, v)
    if not found:
        raise Fail(f"no source returned {a.id}", hint="check the id; keyless S2 is often rate-limited (set S2_API_KEY)")
    order = [n for n, _, _ in PAPER_JOINS if n in found]
    item = found[order[0]]
    for name in order[1:]:
        merge_into(item, found[name])
    return {"query": a.id, "provider": "+".join(order),
            "keyless": not (secret("S2_API_KEY") or secret("OPENALEX_API_KEY")), "items": [finish_paper(item)]}


# ---------------------------------------------------------------- GitHub

def gh_get(path, params=None, accept="application/vnd.github+json") -> Resp:
    token = secret("GITHUB_TOKEN")
    resp = http(GITHUB_API + path, params=params, accept=accept,
                headers={"Authorization": f"Bearer {token}"} if token else None)
    left, limit = resp.headers.get("x-ratelimit-remaining"), resp.headers.get("x-ratelimit-limit")
    if left and limit and int(left) <= int(limit) // 10:
        warn(f"github {resp.headers.get('x-ratelimit-resource') or 'api'}: {left}/{limit} requests left in this window")
    return resp


def gh_keyless_note():
    if not secret("GITHUB_TOKEN"):
        warn("GITHUB_TOKEN unset and `gh auth token` unavailable: keyless GitHub allows 60 requests/hour")


def repo_item(r: dict) -> dict:
    license_id = (r.get("license") or {}).get("spdx_id")
    return {"kind": "repo", "id": f"gh:{r['full_name'].lower()}", "title": r["full_name"], "url": r.get("html_url"),
            "source": "github", "snippet": r.get("description"), "published": day(r.get("created_at")),
            "updated": day(r.get("pushed_at")),
            "metrics": {"stars": r.get("stargazers_count"), "forks": r.get("forks_count")},
            "links": {"project": r.get("homepage")},
            "extra": {"language": r.get("language"), "license": None if license_id == "NOASSERTION" else license_id,
                      "topics": r.get("topics"), "open_issues": r.get("open_issues_count"),
                      "archived": r.get("archived"), "pushed_at": r.get("pushed_at"), "created_at": r.get("created_at")}}


def cmd_repos(a):
    gh_keyless_note()
    q = " ".join([a.query] + ([f"pushed:>={a.pushed_after}"] if a.pushed_after else [])
                 + ([f"language:{a.language}"] if a.language else []))
    sort = {"stars": "stars", "updated": "updated"}.get(a.sort)
    try:
        data = gh_get("/search/repositories", params={"q": q, "sort": sort, "order": "desc" if sort else None,
                                                       "per_page": clamp_n("github", a.n, 100)}).json()
    except HttpFail as e:
        raise Fail(str(e), hint="set GITHUB_TOKEN or run `gh auth login`" if not secret("GITHUB_TOKEN") else "") from None
    if data.get("incomplete_results"):
        warn("github: search timed out server-side; results may be incomplete")
    return {"query": q, "provider": "github", "keyless": not secret("GITHUB_TOKEN"),
            "items": [repo_item(r) for r in data.get("items") or []][: a.n]}


def stars_last_30d(weeks) -> int:
    cutoff = time.time() - 30 * 86400
    return sum(count for w in weeks for i, count in enumerate(w.get("days") or []) if w["week"] + i * 86400 >= cutoff)


def cmd_repo(a):
    m = re.match(r"^(?:https?://)?(?:www\.)?(?:github\.com/)?([\w.-]+)/([\w.-]+?)(?:\.git)?(?:[/#?].*)?$", a.repo.strip())
    if not m:
        raise Fail(f"not a GitHub repo: {a.repo}", hint="use OWNER/NAME or https://github.com/OWNER/NAME")
    base = f"/repos/{m.group(1)}/{m.group(2)}"
    gh_keyless_note()
    calls = {"repo": (base, None, "application/vnd.github+json"),
             "release": (f"{base}/releases/latest", None, "application/vnd.github+json"),
             "readme": (f"{base}/readme", None, "application/vnd.github.raw"),
             "history": (f"{base}/stargazers/history", {"per_page": 6}, "application/vnd.github+json")}

    def get(name):
        path, params, accept = calls[name]
        try:
            resp = gh_get(path, params, accept)
            return resp.text if name == "readme" else resp.json()
        except Fail as e:
            if name == "repo":
                raise Fail(str(e), hint="check OWNER/NAME; set GITHUB_TOKEN if rate-limited") from None
            if e.status != 404:
                warn(f"github {name}: {e}")
            return None

    repo, release, readme, history = pmap(get, list(calls))
    it = repo_item(repo)
    if isinstance(history, list):
        it["metrics"]["stars_30d"] = stars_last_30d(history)
    it["links"]["code"] = [repo.get("html_url")]
    if not it["extra"].get("license"):
        warn(f"{repo.get('full_name')}: license not detected; check the LICENSE file / model card")
    it["extra"].update({"homepage": repo.get("homepage"), "default_branch": repo.get("default_branch"),
                        "readme": clip(readme, a.max_chars),
                        "latest_release": release and {"tag": release.get("tag_name"),
                                                       "date": day(release.get("published_at")),
                                                       "url": release.get("html_url")}})
    return {"query": a.repo, "provider": "github", "keyless": not secret("GITHUB_TOKEN"), "items": [it]}


# ---------------------------------------------------------------- grep.app, HN

def usage_item(text: str) -> dict | None:
    m = re.match(r"Repository: (.+)\nPath: (.+)\nURL: (\S+)\n(?:License: (.*)\n)?", text)
    if not m:
        return None
    repo, path, url, license_id = m.groups()
    snippets = re.sub(r"^\s*Snippets:\s*\n", "", text[m.end():]).strip()
    return {"kind": "usage", "id": "url:" + canon_url(url), "title": f"{repo}: {path}", "url": url,
            "source": "grepapp", "snippet": clip(snippets, SNIPPET_CAP),
            "extra": {"repo": repo, "path": path, "license": license_id}}


PDF_PAGE = re.compile(r'<page num="(\d+)">(.*?)</page>', re.S)


def cmd_pdf(a):
    """alphaXiv answer_pdf_queries: only the pages of one paper relevant to the questions, with page numbers,
    so numbers and settings can be quoted with a page citation. All questions about a paper go in one call."""
    cache_key = {"paper": norm_arxiv(a.paper) or a.paper.strip(), "questions": list(a.question), "max_chars": a.max_chars}
    cached = cache_get("pdf", cache_key, enabled=not getattr(a, "no_cache", False))
    if cached is not None:
        return {**cached, "cached": True}
    text = alphaxiv("answer_pdf_queries", {"paper": a.paper, "queries": a.question}, timeout=180)
    m = re.search(r'<paper id="([^"]+)"', text)
    paper_id = m.group(1) if m else a.paper
    pages = PDF_PAGE.findall(text)
    if not pages:
        raise Fail(f"alphaxiv: no pages returned for {a.paper}", hint="check the id or title; titles must match exactly")
    budget, items = a.max_chars, []
    for num, body in pages:
        body = body.strip()
        if budget <= 0:
            warn(f"--max-chars {a.max_chars} reached; pages after {items[-1]['extra']['page']} dropped")
            break
        items.append({"kind": "page", "id": f"arxiv:{paper_id}#p{num}" if re.match(ARXIV_ID, paper_id) else f"{paper_id}#p{num}",
                      "title": f"{paper_id} p.{num}", "url": f"https://www.alphaxiv.org/abs/{paper_id}",
                      "source": "alphaxiv", "snippet": clip(body, budget), "extra": {"page": int(num)}})
        budget -= len(body)
    result = {"query": a.question, "provider": "alphaxiv", "keyless": False, "paper": paper_id, "items": items}
    cache_put("pdf", cache_key, result, enabled=not getattr(a, "no_cache", False))
    return result


def cmd_usage(a):
    # grep.app's REST API sits behind a bot checkpoint for scripts; its MCP server is the supported route.
    args = {"query": a.pattern, "language": [a.lang] if a.lang else None}
    result = mcp_tool(GREP_MCP, "searchGitHub", prune(args))
    blocks = [c.get("text", "") for c in result.get("content") or [] if c.get("type") == "text"]
    items = [it for it in map(usage_item, blocks) if it]
    if not items and blocks:
        warn(f"grepapp: {blocks[0][:200]}")
    return {"query": a.pattern, "provider": "grepapp", "keyless": True,
            "items": items[: clamp_n("grepapp", a.n, 10)]}   # the MCP tool returns at most 10 files


def cmd_hn(a):
    since = int(dt.datetime.strptime(a.after, "%Y-%m-%d").replace(tzinfo=dt.timezone.utc).timestamp()) if a.after else None
    data = get_json(HN, params={"query": a.query, "tags": "story", "hitsPerPage": clamp_n("hn", a.n, 1000),
                                "numericFilters": f"created_at_i>{since}" if since else None})
    items = []
    for h in data.get("hits") or []:
        thread = f"https://news.ycombinator.com/item?id={h.get('objectID')}"
        story = html.unescape(re.sub(r"<[^>]+>", " ", h.get("story_text") or ""))
        items.append({"kind": "discussion", "id": f"url:{canon_url(thread)}", "title": h.get("title"), "url": thread,
                      "published": day(h.get("created_at")), "source": "hn", "snippet": clip(" ".join(story.split()), SNIPPET_CAP),
                      "authors": [h.get("author")], "metrics": {"hn_points": h.get("points"), "comments": h.get("num_comments")},
                      "extra": {"story_url": h.get("url")}})
    return {"query": a.query, "provider": "hn", "keyless": True, "items": items}


# ---------------------------------------------------------------- doctor, ledger

def doctor_checks():
    """(provider, env var or None, keyed check or None, keyless check or None); each check returns a note."""
    def parallel_keyed():
        post_json(f"{PARALLEL_API}/v1/search", {"objective": "health check", "search_queries": ["parallel web search"],
                                                 "mode": "fast", "advanced_settings": {"max_results": 1}},
                  headers={"x-api-key": need("PARALLEL_API_KEY")})
        account(price="parallel/search-fast")
        return "search ok"

    def exa_keyed():
        data = post_json(f"{EXA_API}/search", {"query": "exa search api", "type": "lite", "numResults": 1},
                         headers={"x-api-key": need("EXA_API_KEY")})
        account(price="exa/search-lite", usd=(data.get("costDollars") or {}).get("total"))
        return "search ok"

    def deepseek_keyed():
        data = get_json(f"{DEEPSEEK_API}/user/balance", headers={"Authorization": f"Bearer {need('DEEPSEEK_API_KEY')}"})
        return f"balance available: {data.get('is_available')}"

    def jina(key):
        data = get_json(JINA_READER + "https://example.com", headers={"Authorization": f"Bearer {key}"} if key else None)
        if key:
            account(price="jina/read", units=((data.get("data") or {}).get("usage") or {}).get("tokens") or 0)
        return "reader ok"

    def tools(endpoint):
        return lambda: f"{len(mcp(endpoint, 'tools/list').get('tools') or [])} MCP tools"

    def ok(url, headers=None, params=None, accept="application/json"):
        return lambda: (http(url, headers=headers, params=params, accept=accept), "ok")[1]

    def github():
        core = gh_get("/rate_limit").json()["resources"]["core"]
        return f"core {core['remaining']}/{core['limit']} left"

    return [
        ("parallel", "PARALLEL_API_KEY", parallel_keyed, tools(PARALLEL_MCP)),
        ("exa", "EXA_API_KEY", exa_keyed, tools(EXA_MCP)),
        ("deepseek", "DEEPSEEK_API_KEY", deepseek_keyed, None),
        ("jina", "JINA_API_KEY", lambda: jina(need("JINA_API_KEY")), lambda: jina(None)),
        ("openalex", "OPENALEX_API_KEY", ok(f"{OPENALEX}/rate-limit", headers=oa_headers()),
         ok(f"{OPENALEX}/works/W2741809807", params={"select": "id"})),
        ("s2", "S2_API_KEY", ok(f"{S2}/paper/arXiv:1706.03762", headers=s2_headers(), params={"fields": "title"}),
         None),   # optional; skipped without a key (the shared keyless pool is almost always 429)
        ("arxiv", None, None, ok(ARXIV_API, params={"id_list": "1706.03762"}, accept="application/atom+xml")),
        ("hf", None, None, ok(f"{HF}/api/papers/1706.03762")),
        ("pwc", None, None, ok(f"{PWC}/api/v1/papers/arxiv/1706.03762")),
        ("github", "GITHUB_TOKEN", github, github),
        ("grepapp", None, None, tools(GREP_MCP)),
        ("alphaxiv", "ALPHAXIV_API_KEY", lambda: f"{len(json.loads(alphaxiv('get_hot_feed', {'limit': 1}))['papers'])} hot paper(s); feeds use no quota",
         None),
        ("hn", None, None, ok(HN, params={"query": "llm", "hitsPerPage": 1})),
    ]


def cmd_doctor(a):
    def check(row):
        name, env, keyed, keyless = row
        present = bool(env and secret(env))
        fn = keyed if present else keyless
        out = {"provider": name, "env": env, "key_present": present if env else None,
               "mode": "keyed" if present else "keyless"}
        if fn is None:
            return {**out, "mode": None, "ok": False, "note": f"no keyless path; add {env} to the keys file"}
        start = time.monotonic()
        try:
            note, good = fn(), True
        except Fail as e:
            note, good = str(e), False
        return {**out, "ok": good, "latency_ms": round((time.monotonic() - start) * 1000), "note": note}

    path = keys_file()
    return {"provider": "all", "checks": [prune(c) for c in pmap(check, doctor_checks(), workers=12)],
            "keys_file": path, "keys_file_found": os.path.exists(path), "ledger": ledger_path()}


LEDGER_BUCKETS = {"search": "searches", "read": "reads", "enrich": "enrich"}


def local_day(ts: str) -> str:
    try:
        return dt.datetime.fromisoformat(ts).astimezone().date().isoformat()
    except (TypeError, ValueError):
        return (ts or "")[:10]


def on_or_after(ts: str, since: str) -> bool:
    """A date compares with the row's local day; a timestamp compares instants (naive ones are local time)."""
    if len(since) == 10:
        return local_day(ts) >= since
    try:
        return dt.datetime.fromisoformat(ts).astimezone() >= dt.datetime.fromisoformat(since).astimezone()
    except (TypeError, ValueError):
        return False


def cmd_ledger(a):
    """Calls and spend per provider and overall, plus the budget counts the skill defines: searches (each `web`
    query string, each papers/repos/hn call), reads (each fetch URL, each repo/pdf call), enrich (paper/usage calls).
    Budget counts come from one row per command invocation, not from the HTTP calls behind it (a `repo` read makes
    several GitHub requests). --since takes a local date or a run's start timestamp."""
    path, providers = ledger_path(), {}
    budget = dict.fromkeys(LEDGER_BUCKETS.values(), 0)
    try:
        with open(path, encoding="utf-8") as f:
            rows = [json.loads(line) for line in f if line.strip()]
    except FileNotFoundError:
        rows = []
    for r in rows:
        if a.since and not on_or_after(r.get("ts"), a.since):
            continue
        bucket = LEDGER_BUCKETS.get(r.get("kind"))
        if r.get("budget"):
            budget[bucket] += r.get("n") or 1
            continue
        if bucket:   # HTTP rows written before budget rows existed carried the kind themselves
            budget[bucket] += r.get("n") or 1
        t = providers.setdefault(r.get("provider"), {"calls": 0, "keyless_calls": 0, "est_usd": 0.0})
        t["calls"] += 1
        t["keyless_calls"] += bool(r.get("keyless"))
        t["est_usd"] = round(t["est_usd"] + (r.get("est_usd") or 0), 8)
    return {"path": path, "since": a.since, "providers": providers,
            "calls": sum(t["calls"] for t in providers.values()), **budget,
            "total_usd": round(sum(t["est_usd"] for t in providers.values()), 6)}


# ---------------------------------------------------------------- CLI

class JsonArgParser(argparse.ArgumentParser):
    def error(self, message):
        raise Fail(message, hint=self.format_usage().strip())


def date_arg(value: str) -> str:
    try:
        dt.datetime.strptime(value, "%Y-%m-%d")
    except ValueError:
        raise argparse.ArgumentTypeError(f"expected YYYY-MM-DD, got {value!r}") from None
    return value


def since_arg(value: str) -> str:
    """A local date (YYYY-MM-DD), or the ISO timestamp `report.py init` prints as a run's start."""
    try:
        dt.datetime.fromisoformat(value)
    except ValueError:
        raise argparse.ArgumentTypeError(f"expected YYYY-MM-DD or an ISO timestamp, got {value!r}") from None
    return value


def build_parser() -> argparse.ArgumentParser:
    p = JsonArgParser(prog="research.py", description=__doc__.splitlines()[0])
    # --save/--brief go before or after the command; SUPPRESS keeps a subcommand from resetting the top-level value
    common = argparse.ArgumentParser(add_help=False)
    for parser, save, brief in ((p, None, False), (common, argparse.SUPPRESS, argparse.SUPPRESS)):
        parser.add_argument("--save", metavar="FILE", default=save, help="also write the full JSON to FILE")
        parser.add_argument("--brief", action="store_true", default=brief,
                            help="stdout: snippets cut to 300 chars; no extra; links only pdf/code")
    sub = p.add_subparsers(dest="command", required=True)
    add = functools.partial(sub.add_parser, parents=[common])

    w = add("web", help="web search")
    w.add_argument("query", nargs="+")
    w.add_argument("--objective")
    w.add_argument("--provider", choices=["auto", "parallel", "exa", "deepseek", "jina"], default="auto")
    w.add_argument("--mode", choices=["fast", "advanced"], help="default fast")
    w.add_argument("--after", type=date_arg)
    w.add_argument("--include-domain", action="append", default=[])
    w.add_argument("--exclude-domain", action="append", default=[])
    w.add_argument("--category", choices=["paper", "github", "news"])
    w.add_argument("-n", type=int, default=10, help="results per query string")

    f = add("fetch", help="read pages (24h local cache; --no-cache to bypass)")
    f.add_argument("url", nargs="+")
    f.add_argument("--objective", help="return excerpts focused on this instead of the full page")
    f.add_argument("--provider", choices=["auto", "parallel", "exa", "jina"], default="auto")
    f.add_argument("--max-chars", type=int, default=20000)
    f.add_argument("--no-cache", action="store_true", help="bypass 24h local read cache")

    ps = add("papers", help="search paper indexes")
    ps.add_argument("query")
    ps.add_argument("--source", choices=["all", *PAPER_SOURCES], default="all")
    ps.add_argument("--after", type=date_arg)
    ps.add_argument("-n", type=int, default=20)
    ps.add_argument("--sort", choices=["relevance", "date", "citations"], default="relevance")
    ps.add_argument("--objective", help="alphaxiv: the question a qualifying paper answers (default: the query)")
    ps.add_argument("--difficulty", type=int, choices=range(1, 11), default=3, metavar="1-10",
                    help="alphaxiv retrieval effort; higher runs more follow-up rounds and uses more quota")

    pq = add("pdf", help="pages of one paper relevant to questions, with page numbers (alphaXiv; 24h local cache)")
    pq.add_argument("paper", help="arXiv id, arXiv/alphaXiv/PDF URL, or exact title")
    pq.add_argument("question", nargs="+", help="batch every question about this paper into one call")
    pq.add_argument("--max-chars", type=int, default=60000, help="total page text kept (pages arrive in page order)")
    pq.add_argument("--no-cache", action="store_true", help="bypass 24h local read cache")

    pp = add("paper", help="one paper joined across sources")
    pp.add_argument("id")

    rs = add("repos", help="search GitHub repositories")
    rs.add_argument("query")
    rs.add_argument("--pushed-after", type=date_arg)
    rs.add_argument("--language")
    rs.add_argument("-n", type=int, default=10)
    rs.add_argument("--sort", choices=["stars", "updated", "best"], default="stars")

    r = add("repo", help="one GitHub repository in depth")
    r.add_argument("repo")
    r.add_argument("--max-chars", type=int, default=README_CAP, help="README chars to keep")

    u = add("usage", help="real-world code usage via grep.app")
    u.add_argument("pattern")
    u.add_argument("--lang")
    u.add_argument("-n", type=int, default=10)

    h = add("hn", help="Hacker News stories")
    h.add_argument("query")
    h.add_argument("--after", type=date_arg)
    h.add_argument("-n", type=int, default=10)

    add("doctor", help="check keys and endpoints")
    lg = add("ledger", help="calls and estimated spend")
    lg.add_argument("--since", type=since_arg, help="local date, or a run's start timestamp from `report.py init`")
    return p


COMMANDS = {"web": cmd_web, "fetch": cmd_fetch, "papers": cmd_papers, "paper": cmd_paper, "pdf": cmd_pdf,
            "repos": cmd_repos, "repo": cmd_repo, "usage": cmd_usage, "hn": cmd_hn, "doctor": cmd_doctor,
            "ledger": cmd_ledger}


def finish_item(it: dict) -> dict:
    it = {k: it[k] for k in ITEM_ORDER if k in it}
    if len(it.get("published") or "") == 4:
        it["extra"] = {**(it.get("extra") or {}), "date_precision": "year"}
    return prune(it)


def brief_item(it: dict) -> dict:
    out = {}
    for k, v in it.items():
        if k == "extra":
            continue
        if k == "snippet":
            v = v[:BRIEF_CAP]
        elif k == "links":
            v = {lk: lv for lk, lv in v.items() if lk in ("pdf", "code")}
        if v:
            out[k] = v
    return out


def save_json(path: str, obj: dict) -> None:
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    tmp = f"{path}.{os.getpid()}.tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=1)
    os.replace(tmp, path)


def main(argv=None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    command, a = next((x for x in argv if not x.startswith("-")), None), None
    try:
        a = build_parser().parse_args(argv)
        RUN.command = a.command
        payload = COMMANDS[a.command](a)
        if "items" in payload:
            payload["items"] = [finish_item(it) for it in payload["items"]]
        out, code = {"command": a.command, **payload}, 0
    except Fail as e:
        out, code = {"command": getattr(a, "command", command), "error": str(e), "hint": e.hint}, 2
    except Exception as e:  # noqa: BLE001 - the contract is one JSON object, even for bugs
        out, code = {"command": getattr(a, "command", command), "error": f"{type(e).__name__}: {e}",
                     "hint": "unexpected failure in research.py"}, 2
    kind = KINDS.get(getattr(a, "command", None) or "")
    if CALLS and kind in LEDGER_BUCKETS:   # the budget unit is what was asked for, not the HTTP calls behind it
        CALLS.append({"ts": dt.datetime.now().astimezone().isoformat(timespec="seconds"), "command": a.command,
                      "kind": kind, "budget": True, "est_usd": 0.0,
                      "n": len(a.query) if a.command == "web" else len(a.url) if a.command == "fetch" else 1})
    flush_ledger()
    if code == 0:
        out.update(warnings=WARNINGS, cost_usd=round(sum(r["est_usd"] for r in CALLS), 6))
    save, brief = getattr(a, "save", None), getattr(a, "brief", False)
    if save:
        out["saved"] = os.path.abspath(save)
        try:
            save_json(save, out)
        except OSError as e:   # keep the data: print it all instead of the brief view
            del out["saved"]
            out.setdefault("warnings", []).append(f"--save failed: {e}")
            brief = False
    if brief and "items" in out:
        out = {**out, "items": [brief_item(it) for it in out["items"]]}
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    print(json.dumps(out, ensure_ascii=False, indent=1))
    return code


if __name__ == "__main__":
    sys.exit(main())
