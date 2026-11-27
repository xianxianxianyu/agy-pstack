# Providers & API Keys Reference

Detailed provider routing and key configuration for [`scripts/research.py`](../scripts/research.py). Read this file when choosing a `--provider`, tuning paper sources, or helping the user set up optional API keys.

## Web Providers (`research.py web --provider ...`)

| Provider | Use for | Notes |
|---|---|---|
| `parallel` (default) | general and technical web | Ranked first on every independent search-API benchmark seen (AA 83.4 advanced / 81.6 fast). `fast` costs $1 per 1k requests, `advanced` $5. Keyless MCP fallback. |
| `exa` | papers, GitHub, API docs (`--category`) | AA 80.3. Its index covers GitHub, docs, and papers. Keyless MCP fallback. |
| `deepseek` | Chinese sources; cheapest backstop | AA 69.1. Costs $0.75 per 1k. Queries are capped at 128 chars. |
| `jina` | `fetch` fallback only | The reader works keyless at a low rate. |

## Paper Sources

- **OpenAlex**: broad recall, dedupe, citation counts, and the trend `citations_this_year` / `citations_last_year`.
- **alphaXiv** (with `ALPHAXIV_API_KEY`): keyword + embedding search with an agentic follow-up loop, strongest on recent arXiv work; returns 5–15 papers with first-publication date, institutions, and community votes/views (attention only). Its `pdf` command reads papers page-cited. Search and `pdf` use the account's assistant quota, whose size alphaXiv does not publish; feeds are free.
- **arXiv**: first-release dates.
- **Hugging Face Papers**: AI frontier, with linked models and code.
- **paperswithcode.co**: paper → code → results; verify every number against the original.
- **Semantic Scholar**: joins only when `S2_API_KEY` is set, adding influential citations. Without a key its shared pool is almost always rate-limited, so it is skipped.

Citation counts differ a lot between sources: OpenAlex often counts an arXiv preprint far lower than Semantic Scholar does. Compare counts only from the same source.

## Code Sources

- **GitHub**: artifact facts (`repos`, `repo`).
- **grep.app**: independent downstream usage (`usage`).

## API Keys (All Optional)

Key names: `PARALLEL_API_KEY`, `EXA_API_KEY`, `DEEPSEEK_API_KEY`, `JINA_API_KEY`, `OPENALEX_API_KEY`, `ALPHAXIV_API_KEY`, `S2_API_KEY`, `GITHUB_TOKEN`.

- `research.py` looks in the environment first, then in the per-user keys file `~/.config/secrets/keys.env` (dotenv format, `chmod 600`; `$XDG_CONFIG_HOME` is honored).
- For `GITHUB_TOKEN` it falls back last to `gh auth token`.
- That means omp, Claude Code, and Antigravity on the same machine and user all share the same keys without per-runtime setup.
- Missing keys fall back to keyless paths or return a hint naming the variable.
- Console URLs and key names are listed in [`.env.example`](../.env.example). Run `python3 scripts/research.py doctor` to verify which providers work without printing any secret values.
- **Security rule**: Never print key values, `cat` the keys file, ask the user to paste a key into the chat, or paste keys into reports. If a key appears in the conversation, instruct the user to rotate it at the provider.
