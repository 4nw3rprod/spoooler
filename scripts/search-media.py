#!/usr/bin/env python3
"""
Topical mood/aesthetic media search for the reel generator.

Complements scrape-media.py (which pulls the TOOL's own product imagery). This
script searches Pinterest + Bing for editorial / moodboard / b-roll-style
imagery matching the script's scene queries — used to texture MOOD scenes when
stock footage alone feels generic.

Uses scrapling 0.4's tiered fetchers:
  • Pinterest is aggressively bot-protected → StealthyFetcher (defeats Cloudflare/Turnstile).
  • Bing Images HTML is static-ish → Fetcher.get with Chrome TLS impersonation (fast, no browser).
Both return scrapling's unified parser, but Bing embeds image URLs in a JSON blob
so we still regex the `murl` field out of the rendered HTML.
"""
import argparse
import json
import re
import sys
import urllib.parse
import urllib.request
from pathlib import Path

try:
    from scrapling.fetchers import Fetcher, StealthyFetcher
    SCRAPLING_AVAILABLE = True
except Exception:
    SCRAPLING_AVAILABLE = False

MAX_FILE_BYTES_VIDEO = 15 * 1024 * 1024  
MAX_FILE_BYTES_IMAGE = 8 * 1024 * 1024   

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 OutgrowReelTool/1.0"
)

# Junk we never want: avatars, icons, tracking pixels, UI chrome.
JUNK = re.compile(r"(favicon|avatar|profile|icon|sprite|emoji|/75x75|/30x30|/45x45|badge)", re.IGNORECASE)


def log(msg: str) -> None:
    print(f"[search-media] {msg}", file=sys.stderr)


def search_bing_images(query: str, count: int = 5) -> list:
    """Search Bing Images. Uses Fetcher.get (TLS-impersonated HTTP, no browser)."""
    encoded_query = urllib.parse.quote_plus(query)
    url = f"https://www.bing.com/images/search?q={encoded_query}&qft=+filterui:photo-photo"
    try:
        html = ""
        if SCRAPLING_AVAILABLE:
            page = Fetcher.get(url, timeout=15, stealthy_headers=True, impersonate="chrome", follow_redirects=True)
            html = page.html_content if hasattr(page, "html_content") else str(page.body if hasattr(page, "body") else "")
        if not html:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=15) as resp:
                html = resp.read().decode("utf-8", errors="replace")
        # Bing embeds full-res image URL in m="{...murl:URL...}".
        matches = re.findall(r'murl&quot;:&quot;(.*?)&quot;', html)
        unique_urls, seen = [], set()
        for m in matches:
            if m not in seen and m.startswith("http") and not JUNK.search(m):
                seen.add(m)
                unique_urls.append(m)
        return unique_urls[:count]
    except Exception as exc:  # noqa: BLE001
        log(f"bing failed for '{query}': {exc}")
        return []


def search_pinterest_images(query: str, count: int = 5) -> list:
    """Search Pinterest via StealthyFetcher (defeats its bot protection)."""
    if not SCRAPLING_AVAILABLE:
        return []
    encoded_query = urllib.parse.quote_plus(query)
    url = f"https://www.pinterest.com/search/pins/?q={encoded_query}"
    try:
        page = StealthyFetcher.fetch(
            url, headless=True, network_idle=True, block_ads=True,
            solve_cloudflare=True, wait=3000, timeout=45000,
        )
        if page is None:
            return []
        unique_urls, seen = [], set()
        for img in page.css("img"):
            src = img.attrib.get("src") or img.attrib.get("data-src") or ""
            if not src.startswith("http") or src in seen or JUNK.search(src):
                continue
            # Upgrade Pinterest thumbnails to originals.
            high_res = re.sub(r"pinimg\.com/\d+x\d*/", "pinimg.com/originals/", src)
            seen.add(src)
            unique_urls.append(high_res)
        return unique_urls[:count]
    except Exception as exc:  # noqa: BLE001
        log(f"pinterest failed for '{query}': {exc}")
        return []

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
            if resp.status >= 400: return False
            dest.parent.mkdir(parents=True, exist_ok=True)
            with open(dest, "wb") as fh:
                copied = 0
                while True:
                    chunk = resp.read(64 * 1024)
                    if not chunk: break
                    copied += len(chunk)
                    if copied > MAX_FILE_BYTES_VIDEO:
                        fh.close()
                        dest.unlink(missing_ok=True)
                        return False
                    fh.write(chunk)
        return dest.exists() and dest.stat().st_size > 0
    except Exception:
        return False

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--queries", required=True, help="JSON array of search queries")
    parser.add_argument("--out", required=True, help="Output directory")
    args = parser.parse_args()

    out_dir = Path(args.out) / "scraped"
    out_dir.mkdir(parents=True, exist_ok=True)
    
    try:
        queries = json.loads(args.queries)
    except Exception as e:
        print(json.dumps({"items": [], "errors": [f"Invalid queries: {e}"]}))
        return 0

    items = []
    errors = []

    for query in queries:
        urls = []
        if SCRAPLING_AVAILABLE:
            # Editorial moodboard shots from Pinterest first (best aesthetic signal).
            urls.extend(search_pinterest_images(query + " editorial minimal aesthetic", count=2))
        # Then supporting imagery from Bing.
        urls.extend(search_bing_images(query, count=3))
        
        for idx, url in enumerate(urls):
            ctype, clen = http_head(url)
            
            # Skip huge files
            if clen and clen > MAX_FILE_BYTES_VIDEO:
                continue

            # Identify kind
            ext = ".jpg"
            kind = "image"
            if "gif" in ctype.lower() or url.lower().endswith(".gif"):
                ext = ".gif"
                kind = "video" # For remotion, gif will be treated as video later by conversion, but here let's just mark it as video
            elif "png" in ctype.lower() or url.lower().endswith(".png"):
                ext = ".png"
            elif "webp" in ctype.lower() or url.lower().endswith(".webp"):
                ext = ".webp"

            dest = out_dir / f"search_{len(items):03d}{ext}"
            
            if download(url, dest):
                items.append({
                    "kind": kind,
                    "file": f"scraped/{dest.name}",
                    "source_url": url,
                    "alt": f"Search result for {query}",
                    "score": 0.8
                })

    print(json.dumps({
        "items": items,
        "errors": errors,
        "queries": queries
    }))
    return 0

if __name__ == "__main__":
    sys.exit(main())
