#!/usr/bin/env python3
"""
Entity-specific media scraping for the reel generator.

Called by scrape_media (runMediaOp 'scrape-media') per entity extracted from
the voiceover. Returns 1-3 candidates per entity, with GIFs preferred over
static logos (per the user's "animated demo (GIF) side-by-side, fallback
static images" rule).

Source order per entity:
  1. Giphy (scrapling — no API key) — try animated .gif first
  2. Brandfetch (per-entity file-based cache) — official logo, cached forever
  3. Google Images via StealthyFetcher (with Bing fallback) — logos specifically
  4. Bing Images — last-ditch fallback

JSON manifest shape on stdout:
{
  "items": [
    {"kind": "image", "assetType": "gif", "file": "scraped/...", "source": "giphy",
     "sourceUrl": "...", "entity": "Claude Code", "sceneIndex": 0},
    {"kind": "image", "assetType": "image", "file": "scraped/...", "source": "brandfetch",
     "sourceUrl": "...", "entity": "Anthropic", "sceneIndex": 2}
  ],
  "errors": [],
  "queries": [{"entity": "...", "sceneIndex": 0, "type": "gif-or-logo"}]
}
"""
import argparse
import datetime
import json
import os
import re
import subprocess
import sys
import urllib.parse
import urllib.request
from pathlib import Path

try:
    from scrapling.fetchers import Fetcher, StealthyFetcher
    SCRAPLING_AVAILABLE = True
except Exception:
    SCRAPLING_AVAILABLE = False

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 OutgrowReelTool/1.0"
)

MAX_FILE_BYTES = 8 * 1024 * 1024  # 8MB cap per asset

JUNK = re.compile(r"(favicon|avatar|profile|icon|sprite|emoji|/75x75|/30x30|/45x45|badge)", re.IGNORECASE)


def log(msg: str) -> None:
    print(f"[scrape-entities] {msg}", file=sys.stderr)


def normalize_entity_key(name: str) -> str:
    """Anthropic → anthropic, Claude Code → claude-code, OpenAI → openai."""
    return re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-')


def http_head(url: str):
    try:
        req = urllib.request.Request(url, method="HEAD", headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(req, timeout=10) as resp:
            ctype = resp.headers.get("Content-Type") or ""
            clen = resp.headers.get("Content-Length")
            return ctype, int(clen) if clen and clen.isdigit() else None
    except Exception:
        return "", None


def download(url: str, dest: Path) -> bool:
    try:
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(req, timeout=25) as resp:
            if resp.status >= 400:
                return False
            dest.parent.mkdir(parents=True, exist_ok=True)
            with open(dest, "wb") as fh:
                copied = 0
                while True:
                    chunk = resp.read(64 * 1024)
                    if not chunk:
                        break
                    copied += len(chunk)
                    if copied > MAX_FILE_BYTES:
                        fh.close()
                        dest.unlink(missing_ok=True)
                        return False
                    fh.write(chunk)
        return dest.exists() and dest.stat().st_size > 0
    except Exception:
        return False


def probe_dimensions(path: Path) -> tuple:
    """Return (width, height) via ffprobe, or (None, None) on failure."""
    try:
        out = subprocess.run(
            ['ffprobe', '-v', 'error', '-select_streams', 'v:0',
             '-show_entries', 'stream=width,height', '-of', 'csv=p=0', str(path)],
            capture_output=True, text=True, timeout=5,
        )
        dims = out.stdout.strip()
        if dims and ',' in dims:
            w, h = dims.split(',')
            return int(w), int(h)
    except Exception:
        pass
    return None, None


# ─── Giphy (scrapling, no API key) ───────────────────────────────────────────

def search_giphy(query: str, count: int = 2) -> list:
    """Scrape giphy.com search results via StealthyFetcher; return .gif URLs."""
    if not SCRAPLING_AVAILABLE:
        return []
    url = f"https://giphy.com/search/{urllib.parse.quote(query.replace(' ', '-'))}"
    try:
        page = StealthyFetcher.fetch(
            url, headless=True, network_idle=True, block_ads=True,
            solve_cloudflare=True, wait=2500, timeout=30000,
        )
        if page is None:
            return []
        unique_urls, seen = [], set()
        for img in page.css("img"):
            src = img.attrib.get("src") or img.attrib.get("data-src") or ""
            if not src.startswith("http") or src in seen or JUNK.search(src):
                continue
            if ".gif" in src.lower() or "/media/" in src:
                upgraded = re.sub(r'/giphy\.webp$', '/giphy.gif', src)
                if upgraded not in seen:
                    seen.add(upgraded)
                    unique_urls.append(upgraded)
            if len(unique_urls) >= count:
                break
        return unique_urls
    except Exception as exc:
        log(f"giphy failed for '{query}': {exc}")
        return []


# ─── Brandfetch (with per-entity file-based cache) ───────────────────────────

def brandfetch_cache_path(cache_dir: Path, entity: str) -> Path:
    return cache_dir / f"{normalize_entity_key(entity)}.json"


def fetch_brandfetch_logo(entity: str, cache_dir: Path) -> dict | None:
    """Returns {url, format, transparent, domain} or None on failure.
    Caches per-entity (case-insensitive slug) — same entity across runs = 1 API call total.
    """
    cache_path = brandfetch_cache_path(cache_dir, entity)

    # 1. Cache hit
    if cache_path.exists():
        try:
            cached = json.loads(cache_path.read_text())
            if cached.get('logos'):
                log(f"brandfetch cache hit: {entity}")
                return cached['logos'][0]
        except Exception:
            pass

    # 2. Cache miss — call Brandfetch search + CDN
    try:
        search_url = f"https://api.brandfetch.io/v2/search/{urllib.parse.quote(entity)}"
        req = urllib.request.Request(search_url, headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(req, timeout=15) as resp:
            if resp.status != 200:
                return None
            data = json.loads(resp.read().decode('utf-8', errors='replace'))
        if not data or not isinstance(data, list) or not data[0].get('domain'):
            return None
        domain = data[0]['domain']
        logo_url = f"https://cdn.brandfetch.io/{domain}?c=1idq4HNz7jtRuv8vA8G"
        entry = {
            'url': logo_url,
            'format': 'png',
            'transparent': True,
            'domain': domain,
        }
        # 3. Persist to cache (Brandfetch lookup is the expensive part)
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        cache_path.write_text(json.dumps({
            'entity': entity,
            'normalizedKey': normalize_entity_key(entity),
            'fetchedAt': datetime.datetime.utcnow().isoformat() + 'Z',
            'source': 'brandfetch',
            'logos': [entry],
        }, indent=2))
        return entry
    except Exception as exc:
        log(f"brandfetch failed for '{entity}': {exc}")
        return None


# ─── Google Images via StealthyFetcher (+ Bing fallback) ─────────────────────

def search_google_images(query: str, count: int = 3, prefer_gif: bool = False) -> list:
    """StealthyFetcher first, Bing fallback on block. Returns image URLs."""
    if not SCRAPLING_AVAILABLE:
        return search_bing_images(query, count, prefer_gif)

    url = f"https://www.google.com/search?q={urllib.parse.quote_plus(query)}&tbm=isch"
    try:
        page = StealthyFetcher.fetch(
            url, headless=True, network_idle=True, block_ads=True,
            solve_cloudflare=True, wait=2000, timeout=30000,
        )
        if page is None:
            return search_bing_images(query, count, prefer_gif)

        unique_urls, seen = [], set()
        for img in page.css("img"):
            src = img.attrib.get("src") or img.attrib.get("data-src") or ""
            if not src.startswith("http") or src in seen or JUNK.search(src):
                continue
            if prefer_gif and ".gif" not in src.lower():
                continue
            seen.add(src)
            unique_urls.append(src)
            if len(unique_urls) >= count:
                break
        if not unique_urls:
            return search_bing_images(query, count, prefer_gif)
        return unique_urls
    except Exception as exc:
        log(f"google images failed for '{query}': {exc} — falling back to Bing")
        return search_bing_images(query, count, prefer_gif)


def search_bing_images(query: str, count: int = 3, prefer_gif: bool = False) -> list:
    """Bing Images HTML scraper. Static (no JS), reliable fallback."""
    encoded_query = urllib.parse.quote_plus(query)
    url = f"https://www.bing.com/images/search?q={encoded_query}&qft=+filterui:photo-photo"
    try:
        html = ""
        if SCRAPLING_AVAILABLE:
            try:
                page = Fetcher.get(url, timeout=15, stealthy_headers=True, impersonate="chrome", follow_redirects=True)
                html = page.html_content if hasattr(page, "html_content") else str(page.body if hasattr(page, "body") else "")
            except Exception:
                pass
        if not html:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=15) as resp:
                html = resp.read().decode("utf-8", errors="replace")
        matches = re.findall(r'murl&quot;:&quot;(.*?)&quot;', html)
        unique_urls, seen = [], set()
        for m in matches:
            if m not in seen and m.startswith("http") and not JUNK.search(m):
                if prefer_gif and ".gif" not in m.lower():
                    continue
                seen.add(m)
                unique_urls.append(m)
        return unique_urls[:count]
    except Exception as exc:
        log(f"bing failed for '{query}': {exc}")
        return []


# ─── Per-entity orchestration (GIF first, static fallback) ──────────────────

def scrape_entity_media(entity: str, out_dir: Path, prefer_gif: bool = True, count_per_kind: int = 1) -> list:
    """For one entity, try Giphy first, then Brandfetch + Google + Bing.

    Returns list of item dicts: {kind, assetType, file, source, sourceUrl, entity}
    """
    items = []
    safe = normalize_entity_key(entity)

    # 1. Try GIF first
    if prefer_gif:
        gifs = search_giphy(f"{entity} demo animation", count=count_per_kind)
        for i, url in enumerate(gifs):
            ext = ".gif"
            dest = out_dir / f"giphy-{safe}-{i}{ext}"
            if download(url, dest):
                items.append({
                    'kind': 'image',
                    'assetType': 'gif',
                    'file': f"scraped/{dest.name}",
                    'source': 'giphy',
                    'sourceUrl': url,
                    'entity': entity,
                })

    # 2. Static logo (Brandfetch → Google → Bing) — independent of GIF success
    static = _scrape_static_logos_for_entity(entity, out_dir, count=count_per_kind)
    items.extend(static)

    return items


def _scrape_static_logos_for_entity(entity: str, out_dir: Path, count: int = 1) -> list:
    """Brandfetch first, then Google Images, then Bing. Returns item dicts."""
    items = []
    safe = normalize_entity_key(entity)
    cache_dir = Path(os.environ.get('SCRAPE_ENTITIES_CACHE', str(out_dir.parent.parent / '.cache' / 'brandfetch')))

    # 1. Brandfetch
    bf = fetch_brandfetch_logo(entity, cache_dir)
    if bf and len(items) < count:
        for ext in ('.png', '.svg', '.ico'):
            dest = out_dir / f"brandfetch-{safe}{ext}"
            if download(bf['url'], dest):
                items.append({
                    'kind': 'image',
                    'assetType': 'image',
                    'file': f"scraped/{dest.name}",
                    'source': 'brandfetch',
                    'sourceUrl': bf['url'],
                    'entity': entity,
                })
                break

    if len(items) >= count:
        return items

    # 2. Google Images (with Bing fallback inside) for logos
    google_urls = search_google_images(f"{entity} logo no background png", count=count, prefer_gif=False)
    for i, url in enumerate(google_urls):
        if len(items) >= count:
            break
        ctype, _ = http_head(url)
        ext = ".png"
        if "image/jpeg" in ctype.lower() or ".jpg" in url.lower():
            ext = ".jpg"
        elif "image/webp" in ctype.lower() or ".webp" in url.lower():
            ext = ".webp"
        dest = out_dir / f"google-{safe}-{i}{ext}"
        if download(url, dest):
            items.append({
                'kind': 'image',
                'assetType': 'image',
                'file': f"scraped/{dest.name}",
                'source': 'google-images',
                'sourceUrl': url,
                'entity': entity,
            })

    return items[:count]


# ─── CLI entry point (spawned by runMediaOp 'scrape-media') ─────────────────

def main():
    parser = argparse.ArgumentParser(description="Per-entity media scraping for reel alternate scenes.")
    parser.add_argument("--entities", required=True, help='JSON array: [{"sceneIndex": 0, "entity": "Claude Code", "preferGif": true}, ...]')
    parser.add_argument("--out", required=True, help="Output directory (project-root/public/instagram-reel-tool/<slug>/)")
    parser.add_argument("--per-entity-count", type=int, default=1, help="How many candidates to fetch per entity per kind (gif or static)")
    args = parser.parse_args()

    out_dir = Path(args.out) / "scraped"
    out_dir.mkdir(parents=True, exist_ok=True)

    try:
        entities = json.loads(args.entities)
    except Exception as e:
        print(json.dumps({"items": [], "errors": [f"Invalid entities JSON: {e}"]}))
        return 1

    items = []
    errors = []
    queries_meta = []

    for entry in entities:
        scene_idx = int(entry.get('sceneIndex', 0))
        entity = str(entry.get('entity', '')).strip()
        prefer_gif = bool(entry.get('preferGif', True))
        if not entity:
            continue
        log(f"scene {scene_idx} entity '{entity}' (gif={prefer_gif})")
        queries_meta.append({"entity": entity, "sceneIndex": scene_idx, "type": "gif-or-logo"})
        try:
            scraped = scrape_entity_media(entity, out_dir, prefer_gif=prefer_gif, count_per_kind=args.per_entity_count)
            for s in scraped:
                s['sceneIndex'] = scene_idx
                # Probe dimensions
                local = out_dir / s['file'].split('/')[-1]
                w, h = probe_dimensions(local)
                if w and h:
                    s['width'] = w
                    s['height'] = h
                    s['orientation'] = 'landscape' if w > h else ('portrait' if h > w else 'square')
                    s['aspect'] = round(w / h, 3)
            items.extend(scraped)
        except Exception as e:
            errors.append(f"scene {scene_idx} entity '{entity}': {e}")

    print(json.dumps({
        "items": items,
        "errors": errors,
        "queries": queries_meta,
    }, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
