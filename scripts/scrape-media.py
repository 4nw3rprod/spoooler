#!/usr/bin/env python3
"""
Search-driven, multi-site product media scraper for the Instagram reel generator.

Mission: given a product/topic (and optional seed URLs), FIND the pages that
actually show the product, harvest their hero videos / screenshots / product
imagery, measure each asset, and emit a ranked JSON manifest the Node generator
mixes into the reel.

────────────────────────────────────────────────────────────────────────────
WHY SEARCH-DRIVEN (not just "scrape the homepage")
────────────────────────────────────────────────────────────────────────────
A product is often NOT on its parent company's homepage. "Claude Code" lives at
claude.com/product/claude-code, not anthropic.com; "Codex" lives at openai.com/codex/.
So instead of betting on one homepage, we:
  1. Search DuckDuckGo's HTML endpoint for the product/brand terms,
  2. Take the top official-looking results (deduped, junk-filtered),
  3. Merge them with any seed URLs the caller already extracted,
  4. Scrape SEVERAL of them and pool the media.
This finds the real product page in ~1s instead of guessing.

────────────────────────────────────────────────────────────────────────────
SCRAPLING 0.4 — TIERED FETCH (cheapest fetcher that works wins)
────────────────────────────────────────────────────────────────────────────
  Tier 1 · Fetcher.get(impersonate='chrome')   — HTTP + spoofed Chrome TLS, no browser, ms-fast.
  Tier 2 · DynamicFetcher.fetch(network_idle)  — Playwright render for JS/SPA hero media.
  Tier 3 · StealthyFetcher.fetch(solve_cloudflare, block_ads) — defeats Cloudflare; also screenshots.

────────────────────────────────────────────────────────────────────────────
RANKING (what the caller asked for)
────────────────────────────────────────────────────────────────────────────
Assets are ranked by, in order:
  1. TYPE:        video  >  image  >  screenshot      (video is first priority)
  2. ORIENTATION: landscape > square > portrait        (rectangular fits "video screens"/frames)
  3. heuristic score (og:image > hero <img> > body img)
  4. resolution
Every downloaded asset is probed with ffprobe for REAL width/height, so the
orientation ranking is based on actual pixels, not guessed markup.

Output (stdout, JSON):
    {
      "items": [
        {"kind":"image"|"video", "assetType":"video"|"image"|"screenshot",
         "file":"scraped/<n>.<ext>", "source_url":"...", "source_site":"...",
         "alt":"...", "score":0.0-1.0, "width":int, "height":int,
         "orientation":"landscape"|"portrait"|"square"|"unknown", "aspect":float}
      ],
      "errors":[...], "sites_scraped":[...], "strategy":"...", "stats":{...}
    }

Failure rule: NEVER raise. Empty `items` => Node falls back to stock.
"""
import argparse
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Optional

try:
    from scrapling.fetchers import Fetcher, DynamicFetcher, StealthyFetcher  # type: ignore
    SCRAPLING_AVAILABLE = True
    SCRAPLING_ERROR: Optional[str] = None
except Exception as exc:  # noqa: BLE001
    SCRAPLING_AVAILABLE = False
    SCRAPLING_ERROR = f"{type(exc).__name__}: {exc}"

MAX_FILE_BYTES_VIDEO = 15 * 1024 * 1024
MAX_FILE_BYTES_IMAGE = 8 * 1024 * 1024
MAX_FILE_BYTES = MAX_FILE_BYTES_VIDEO
DOWNLOAD_TIMEOUT_SECONDS = 25
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 OutgrowReelTool/1.0"
)

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".avif"}
VIDEO_EXTS = {".mp4", ".webm", ".mov", ".m4v"}
GIF_EXT = ".gif"

JUNK_URL_PATTERNS = re.compile(
    r"(sprite|favicon|icon|logo|avatar|badge|pixel|tracking|1x1|spacer|"
    r"app-?store|google-?play|gdpr|cookie|placeholder|loading|spinner)",
    re.IGNORECASE,
)

# Domains that rarely carry usable PRODUCT hero media — skip when discovered via search.
SEARCH_DENY_DOMAINS = (
    "youtube.com", "youtu.be", "twitter.com", "x.com", "facebook.com",
    "instagram.com", "linkedin.com", "reddit.com", "npmjs.com", "pypi.org",
    "apps.microsoft.com", "marketplace.visualstudio.com", "play.google.com",
    "apps.apple.com", "wikipedia.org", "medium.com", "quora.com", "techspot.com",
    "g2.com", "capterra.com", "producthunt.com",
)

# Type / orientation ranking weights (higher = preferred).
TYPE_WEIGHT = {"video": 3, "image": 2, "screenshot": 1}
ORIENT_WEIGHT = {"landscape": 3, "square": 2, "unknown": 1, "portrait": 0}


def log(msg: str) -> None:
    print(f"[scrape-media] {msg}", file=sys.stderr)


# ────────────────────────────────────────────────────────────────────────────
# URL / asset helpers
# ────────────────────────────────────────────────────────────────────────────
def absolutize(url: str, base: str) -> str:
    if not url:
        return ""
    url = url.strip().replace("&amp;", "&").replace("&#x26;", "&").replace("&#38;", "&")
    return urllib.parse.urljoin(base, url)


def url_extension(url: str) -> str:
    path = urllib.parse.urlparse(url).path
    _, ext = os.path.splitext(path)
    return ext.lower()


def parse_int(value: str) -> Optional[int]:
    try:
        return int(re.sub(r"[^0-9]", "", value or ""))
    except (TypeError, ValueError):
        return None


def is_junk_url(url: str) -> bool:
    return bool(JUNK_URL_PATTERNS.search(url or ""))


def registrable_domain(url: str) -> str:
    try:
        host = urllib.parse.urlparse(url).hostname or ""
        host = host.lstrip("www.")
        parts = host.split(".")
        return ".".join(parts[-2:]) if len(parts) >= 2 else host
    except Exception:  # noqa: BLE001
        return ""


def full_host(url: str) -> str:
    try:
        return (urllib.parse.urlparse(url).hostname or "").lstrip("www.").lower()
    except Exception:  # noqa: BLE001
        return ""


def is_denied_domain(url: str) -> bool:
    host = full_host(url)
    dom = registrable_domain(url)
    return any(d in host or d == dom for d in SEARCH_DENY_DOMAINS)


def http_head(url: str) -> tuple[Optional[str], Optional[int]]:
    try:
        req = urllib.request.Request(url, method="HEAD", headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(req, timeout=10) as resp:
            ctype = resp.headers.get("Content-Type") or None
            clen = resp.headers.get("Content-Length")
            return ctype, int(clen) if clen and clen.isdigit() else None
    except Exception:  # noqa: BLE001
        return None, None


def download(url: str, dest: Path) -> bool:
    try:
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(req, timeout=DOWNLOAD_TIMEOUT_SECONDS) as resp:
            if resp.status >= 400:
                return False
            length = resp.headers.get("Content-Length")
            if length and length.isdigit() and int(length) > MAX_FILE_BYTES:
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
                        try:
                            dest.unlink()
                        except OSError:
                            pass
                        return False
                    fh.write(chunk)
        return dest.exists() and dest.stat().st_size > 0
    except Exception:  # noqa: BLE001
        return False


def gif_to_mp4(gif_path: Path) -> Optional[Path]:
    if shutil.which("ffmpeg") is None:
        return None
    out_path = gif_path.with_suffix(".mp4")
    try:
        result = subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error", "-i", str(gif_path),
             "-movflags", "faststart", "-pix_fmt", "yuv420p",
             "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2", str(out_path)],
            check=True, capture_output=True, timeout=60,
        )
        if result.returncode == 0 and out_path.exists() and out_path.stat().st_size > 0:
            try:
                gif_path.unlink()
            except OSError:
                pass
            return out_path
    except Exception:  # noqa: BLE001
        pass
    return None


def probe_dimensions(path: Path) -> tuple[Optional[int], Optional[int]]:
    """Read real pixel width/height via ffprobe (works for images AND video)."""
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-select_streams", "v:0",
             "-show_entries", "stream=width,height", "-of", "csv=p=0", str(path)],
            capture_output=True, text=True, timeout=20,
        )
        nums = re.findall(r"\d+", out.stdout or "")
        if len(nums) >= 2 and int(nums[0]) > 0 and int(nums[1]) > 0:
            return int(nums[0]), int(nums[1])
    except Exception:  # noqa: BLE001
        pass
    return None, None


def classify_orientation(w: Optional[int], h: Optional[int]) -> tuple[str, float]:
    if not w or not h:
        return "unknown", 0.0
    ratio = w / h
    if ratio >= 1.25:
        return "landscape", ratio
    if ratio <= 0.8:
        return "portrait", ratio
    return "square", ratio


def score_image(width: Optional[int], height: Optional[int], src_alt_score: float) -> float:
    base = src_alt_score
    if width and height and width >= 1200 and height >= 800:
        base += 0.4
    elif width and height and width >= 800 and height >= 600:
        base += 0.2
    return min(1.0, base)


# ────────────────────────────────────────────────────────────────────────────
# Extraction via scrapling's unified .css() parser
# ────────────────────────────────────────────────────────────────────────────
LAZY_ATTRS = ["data-src", "data-original", "data-lazy-src", "data-srcset", "data-bg"]


def _attr(el, *names: str) -> str:
    for name in names:
        val = el.attrib.get(name)
        if val:
            return str(val).strip()
    return ""


def _best_from_srcset(srcset: str) -> str:
    candidates = [c.strip() for c in srcset.split(",") if c.strip()]
    return candidates[-1].split()[0] if candidates else ""


def extract_meta_images(page, base_url: str) -> list[dict]:
    out, seen = [], set()
    for selector in ['meta[property="og:image"]', 'meta[property="og:image:secure_url"]',
                     'meta[name="twitter:image"]', 'meta[name="twitter:image:src"]',
                     'link[rel="image_src"]']:
        try:
            nodes = page.css(selector)
        except Exception:  # noqa: BLE001
            continue
        for node in nodes:
            url = absolutize(_attr(node, "content", "href"), base_url)
            if not url or url in seen or is_junk_url(url):
                continue
            seen.add(url)
            out.append({"url": url, "alt": "og:image", "score": 0.9, "kind_hint": "image"})
    return out


def extract_imgs(page, base_url: str) -> list[dict]:
    out, seen = [], set()
    try:
        nodes = page.css("img")
    except Exception:  # noqa: BLE001
        return out
    for img in nodes:
        srcset = _attr(img, "srcset", "data-srcset")
        url = _best_from_srcset(srcset) if srcset else ""
        if not url:
            url = _attr(img, "src", *LAZY_ATTRS)
        url = absolutize(url, base_url)
        if not url or url.startswith("data:") or url in seen:
            continue
        if url.lower().endswith(".svg") or is_junk_url(url):
            continue
        seen.add(url)
        ext = url_extension(url)
        if ext == GIF_EXT:
            kind = "gif"
        elif ext in IMAGE_EXTS or not ext:
            kind = "image"
        else:
            continue
        width = parse_int(_attr(img, "width"))
        height = parse_int(_attr(img, "height"))
        if width and height and (width < 200 or height < 150):
            continue
        out.append({
            "url": url,
            "alt": _attr(img, "alt")[:200],
            "score": score_image(width, height, 0.45),
            "kind_hint": kind,
        })
    return out


def extract_videos(page, base_url: str) -> list[dict]:
    out, seen = [], set()
    try:
        videos = page.css("video")
    except Exception:  # noqa: BLE001
        videos = []
    for v in videos:
        poster = absolutize(_attr(v, "poster"), base_url)
        if poster and poster not in seen and not is_junk_url(poster):
            seen.add(poster)
            out.append({"url": poster, "alt": "video poster", "score": 0.6, "kind_hint": "image"})
        # <video src> plus common lazy-load video attrs.
        src = _attr(v, "src", "data-src", "data-video-src", "data-lazy-src")
        if src:
            url = absolutize(src, base_url)
            if url and url not in seen and url_extension(url) in VIDEO_EXTS:
                seen.add(url)
                out.append({"url": url, "alt": "hero video", "score": 0.85, "kind_hint": "video"})
    try:
        sources = page.css("video source, source")
    except Exception:  # noqa: BLE001
        sources = []
    for source in sources:
        url = absolutize(_attr(source, "src", "data-src"), base_url)
        if not url or url in seen or url_extension(url) not in VIDEO_EXTS:
            continue
        seen.add(url)
        out.append({"url": url, "alt": "video source", "score": 0.85, "kind_hint": "video"})
    # Anchor / link tags pointing directly at a video file (common for demo loops).
    try:
        anchors = page.css("a")
    except Exception:  # noqa: BLE001
        anchors = []
    for a in anchors:
        href = absolutize(_attr(a, "href"), base_url)
        if href and href not in seen and url_extension(href) in VIDEO_EXTS and not is_junk_url(href):
            seen.add(href)
            out.append({"url": href, "alt": "linked video", "score": 0.7, "kind_hint": "video"})
    return out


# Scan the RAW HTML for direct video URLs the DOM walk can miss — background
# videos injected via JS config blobs, <link rel=preload as=video>, CDN .mp4 in
# inline JSON. This is a cheap regex pass over the page's HTML string.
def extract_videos_from_html(html: str, base_url: str) -> list[dict]:
    out, seen = [], set()
    if not html:
        return out
    for m in re.finditer(r'https?://[^\s"\'<>()]+?\.(?:mp4|webm|mov|m4v)(?:\?[^\s"\'<>()]*)?', html, re.IGNORECASE):
        url = m.group(0).replace("&amp;", "&")
        if url in seen or is_junk_url(url):
            continue
        seen.add(url)
        out.append({"url": url, "alt": "embedded video", "score": 0.72, "kind_hint": "video"})
    return out[:8]


def _page_html(page) -> str:
    """Best-effort raw HTML string from any scrapling Response/Selector."""
    for attr in ("html_content", "body", "html"):
        val = getattr(page, attr, None)
        if isinstance(val, str) and val:
            return val
        if isinstance(val, bytes):
            try:
                return val.decode("utf-8", errors="replace")
            except Exception:  # noqa: BLE001
                pass
    try:
        return str(page)
    except Exception:  # noqa: BLE001
        return ""


def extract_all(page, base_url: str) -> list[dict]:
    media = extract_meta_images(page, base_url) + extract_videos(page, base_url) + extract_imgs(page, base_url)
    # Augment with direct video URLs found in the raw HTML (background/JS-config videos).
    html = _page_html(page)
    if html:
        known = {m["url"] for m in media}
        for vid in extract_videos_from_html(html, base_url):
            if vid["url"] not in known:
                media.append(vid)
    return media


# ────────────────────────────────────────────────────────────────────────────
# URL variants — TLD correction for misheard domains (cotera.ai → cotera.co)
# ────────────────────────────────────────────────────────────────────────────
ALT_TLDS = ["co", "com", "io", "ai", "app", "dev", "tech", "xyz", "so"]


def host_resolves(hostname: str) -> bool:
    if not hostname:
        return False
    try:
        socket.getaddrinfo(hostname, None)
        return True
    except socket.gaierror:
        return False


def build_url_variants(url: str) -> list[str]:
    parsed = urllib.parse.urlparse(url)
    if not parsed.hostname:
        return [url]
    variants, seen = [], set()

    def add(u: str) -> None:
        if u and u not in seen:
            seen.add(u)
            variants.append(u)

    add(url)
    if parsed.hostname.startswith("www."):
        add(parsed._replace(netloc=parsed.netloc.replace("www.", "", 1)).geturl())
    else:
        add(parsed._replace(netloc=f"www.{parsed.netloc}").geturl())
    add(parsed._replace(scheme="http" if parsed.scheme == "https" else "https").geturl())

    if not host_resolves(parsed.hostname):
        host_parts = parsed.hostname.lstrip("www.").split(".")
        if len(host_parts) >= 2:
            base_name = ".".join(host_parts[:-1])
            current_tld = host_parts[-1].lower()
            for tld in ALT_TLDS:
                if tld == current_tld:
                    continue
                alt_host = f"{base_name}.{tld}"
                if host_resolves(alt_host):
                    add(parsed._replace(netloc=alt_host).geturl())
                    add(parsed._replace(netloc=f"www.{alt_host}").geturl())
    return variants


# ────────────────────────────────────────────────────────────────────────────
# Search discovery — find the real product pages
# ────────────────────────────────────────────────────────────────────────────
def ddg_search(query: str, limit: int = 6) -> list[str]:
    """DuckDuckGo HTML endpoint — most scrape-friendly SERP. Returns clean result URLs."""
    if not SCRAPLING_AVAILABLE:
        return []
    url = "https://html.duckduckgo.com/html/?q=" + urllib.parse.quote_plus(query)
    out = []
    try:
        page = Fetcher.get(url, timeout=18, stealthy_headers=True, impersonate="chrome", follow_redirects=True)
        if not (getattr(page, "status", 0) and page.status < 400):
            return []
        for a in page.css("a.result__a"):
            href = a.attrib.get("href", "")
            m = re.search(r"uddg=([^&]+)", href)
            real = urllib.parse.unquote(m.group(1)) if m else href
            if real.startswith("http"):
                out.append(real)
    except Exception as exc:  # noqa: BLE001
        log(f"ddg search failed for '{query}': {exc}")
    return out[:limit]


def discover_sites(queries: list[str], seed_urls: list[str], max_sites: int, errors: list[str]) -> list[str]:
    """Build the ordered list of sites to scrape: seed URLs first (most specific),
    then top search results for the product/brand queries. Dedupe by registrable
    domain (max 2 pages per domain) and drop junk/aggregator domains."""
    ordered: list[str] = []
    seen_urls: set[str] = set()
    per_domain: dict[str, int] = {}

    def consider(u: str, allow_deny: bool = True) -> None:
        if not u or u in seen_urls:
            return
        dom = registrable_domain(u)
        if allow_deny and is_denied_domain(u):
            return
        if per_domain.get(dom, 0) >= 2:
            return
        seen_urls.add(u)
        per_domain[dom] = per_domain.get(dom, 0) + 1
        ordered.append(u)

    # Seed URLs first — caller already extracted these, they're high-signal.
    for u in seed_urls:
        consider(u, allow_deny=False)

    # Then search the product/brand queries (cap searches to keep it fast).
    for q in [q for q in queries if q and q.strip()][:2]:
        for result in ddg_search(q, limit=6):
            consider(result, allow_deny=True)
            if len(ordered) >= max_sites:
                break
        if len(ordered) >= max_sites:
            break

    if not ordered:
        errors.append("no candidate sites after discovery")
    return ordered[:max_sites]


# ────────────────────────────────────────────────────────────────────────────
# Tiered fetch
# ────────────────────────────────────────────────────────────────────────────
MIN_USABLE_MEDIA = 3


def tier1_http(url: str, errors: list[str]):
    try:
        page = Fetcher.get(url, timeout=20, stealthy_headers=True, impersonate="chrome", follow_redirects=True)
        if getattr(page, "status", 0) and page.status < 400:
            return page, extract_all(page, url), "http-impersonate"
        errors.append(f"tier1 status {getattr(page, 'status', '?')} for {url}")
    except Exception as exc:  # noqa: BLE001
        errors.append(f"tier1 {url}: {type(exc).__name__}")
    return None, [], "http-impersonate"


def tier2_dynamic(url: str, wait_ms: int, errors: list[str]):
    # load_dom (not network_idle): wait for DOM + a fixed `wait`, NOT for the network
    # to go quiet — sites with background video/analytics never reach network_idle and
    # would hang until timeout. Hard timeout caps the worst case regardless.
    try:
        page = DynamicFetcher.fetch(url, headless=True, load_dom=True, network_idle=False,
                                    wait=wait_ms, timeout=30000)
        if page is not None:
            return page, extract_all(page, url), "dynamic"
    except Exception as exc:  # noqa: BLE001
        errors.append(f"tier2 {url}: {type(exc).__name__}")
    return None, [], "dynamic"


def tier3_stealth(url: str, wait_ms: int, errors: list[str]):
    try:
        page = StealthyFetcher.fetch(url, headless=True, load_dom=True, network_idle=False,
                                     block_ads=True, solve_cloudflare=True, wait=wait_ms, timeout=45000)
        if page is not None:
            return page, extract_all(page, url), "stealth"
    except Exception as exc:  # noqa: BLE001
        errors.append(f"tier3 {url}: {type(exc).__name__}")
    return None, [], "stealth"


def scrape_one_site(url: str, wait_ms: int, errors: list[str], hunt_video: bool = False) -> tuple[list[dict], str, str]:
    """Scrape a single site through the tier ladder. Returns (media, strategy, final_url).

    Escalation policy (video is priority): if Tier 1 already found a real <video>
    src OR enough quality stills, stop — don't pay for a browser. Only escalate to
    Tier 2/3 when Tier 1 is thin, since SPA hero videos often need JS rendering.

    hunt_video: when True (used on the primary site), if Tier 1 found NO video we
    do ONE Tier 2 JS render to chase a hero/background video — because video is the
    caller's #1 priority and those are almost always JS-injected. We keep whichever
    result has video, or the richer media set.

    Dead-domain guard: if a URL variant's host doesn't resolve, skip all tiers."""
    for candidate in build_url_variants(url):
        host = urllib.parse.urlparse(candidate).hostname or ""
        if not host_resolves(host):
            errors.append(f"skip (no DNS): {candidate}")
            continue
        page, media, strat = tier1_http(candidate, errors)
        if page is None and not media:
            continue
        has_video = any(m["kind_hint"] == "video" for m in media)
        good_stills = [m for m in media if m["kind_hint"] != "video" and m["score"] >= 0.6]
        total_stills = [m for m in media if m["kind_hint"] != "video"]
        has_og = any(m["score"] >= 0.85 and m["kind_hint"] != "video" for m in media)

        # If Tier 1 already has a video, we're done — best possible outcome.
        if has_video:
            return media, strat, candidate

        # Video-hunt pass (primary site only): render once to chase a hero video.
        if hunt_video:
            page2, media2, strat2 = tier2_dynamic(candidate, wait_ms, errors)
            if any(m["kind_hint"] == "video" for m in media2):
                return media2, strat2, candidate  # found the hero video — ship it
            # No video even after render: keep whichever set is richer.
            if len(media2) > len(media):
                media, strat = media2, strat2
            if (has_og and len(total_stills) >= 1) or len(media) >= 2:
                return media, strat, candidate

        # Non-primary sites: og:image + 1 more, or several stills, is enough.
        if (has_og and len(total_stills) >= 2) or len(good_stills) >= 2 or len(total_stills) >= 4:
            return media, strat, candidate
        best, best_strat, best_url = media, strat, candidate

        # Thin Tier 1 → one JS render to enrich.
        page2, media2, strat2 = tier2_dynamic(candidate, wait_ms, errors)
        if len(media2) > len(best) or any(m["kind_hint"] == "video" for m in media2):
            best, best_strat, best_url = media2, strat2, candidate
        if any(m["kind_hint"] == "video" for m in best) or \
                len([m for m in best if m["kind_hint"] != "video"]) >= MIN_USABLE_MEDIA:
            return best, best_strat, best_url

        # Still nothing → likely bot-walled, go stealth.
        if len(best) < 1:
            page3, media3, strat3 = tier3_stealth(candidate, wait_ms, errors)
            if len(media3) > len(best):
                best, best_strat, best_url = media3, strat3, candidate

        if best:
            return best, best_strat, best_url
    return [], "none", url


def stealth_screenshots(url: str, out_dir: Path, count: int, start_idx: int, errors: list[str]) -> list[dict]:
    """Last-resort hero source: clean LANDSCAPE screenshots (16:10) so they slot
    cleanly into on-screen browser/device frames."""
    items: list[dict] = []
    try:
        shots: list[bytes] = []

        def _action(page):  # noqa: ANN001
            try:
                page.set_viewport_size({"width": 1440, "height": 900})  # landscape, frame-friendly
            except Exception:  # noqa: BLE001
                pass
            try:
                page.evaluate("document.body.style.overflow='hidden'")
            except Exception:  # noqa: BLE001
                pass
            for off in [0, 900, 1800][:count]:
                try:
                    page.evaluate(f"window.scrollTo(0, {off})")
                    page.wait_for_timeout(700)
                    shots.append(page.screenshot(type="jpeg", quality=85, full_page=False))
                except Exception:  # noqa: BLE001
                    continue
            return page

        StealthyFetcher.fetch(url, headless=True, load_dom=True, network_idle=False, block_ads=True,
                              solve_cloudflare=True, timeout=45000, page_action=_action)
        for i, data in enumerate(shots):
            dest = out_dir / f"shot_{start_idx + i:03d}.jpg"
            try:
                dest.write_bytes(data)
                if dest.exists() and dest.stat().st_size > 0:
                    items.append({"kind": "image", "assetType": "screenshot",
                                  "file": f"scraped/{dest.name}", "source_url": url,
                                  "alt": f"Website screenshot {i + 1}", "score": 0.75})
            except OSError:
                continue
    except Exception as exc:  # noqa: BLE001
        errors.append(f"screenshot fallback: {type(exc).__name__}")
    return items


# ────────────────────────────────────────────────────────────────────────────
# Main
# ────────────────────────────────────────────────────────────────────────────
def main() -> int:
    parser = argparse.ArgumentParser(description="Search-driven product media scraper for reels.")
    parser.add_argument("--url", help="A single seed URL (back-compat).")
    parser.add_argument("--seed-urls", help="JSON array of seed URLs to scrape first.")
    parser.add_argument("--queries", help="JSON array of product/brand search phrases.")
    parser.add_argument("--out", required=True, help="Output directory (media under scraped/).")
    parser.add_argument("--max-images", type=int, default=8)
    parser.add_argument("--max-videos", type=int, default=6)
    parser.add_argument("--max-sites", type=int, default=4)
    parser.add_argument("--wait-ms", type=int, default=2500)
    args = parser.parse_args()

    out_dir = Path(args.out) / "scraped"
    errors: list[str] = []

    if not SCRAPLING_AVAILABLE:
        print(json.dumps({"items": [], "errors": [f"scrapling unavailable: {SCRAPLING_ERROR}"]}))
        return 0
    out_dir.mkdir(parents=True, exist_ok=True)

    # Parse inputs.
    seed_urls: list[str] = []
    if args.url:
        seed_urls.append(args.url)
    if args.seed_urls:
        try:
            seed_urls.extend([u for u in json.loads(args.seed_urls) if isinstance(u, str)])
        except Exception:  # noqa: BLE001
            errors.append("invalid --seed-urls JSON")
    queries: list[str] = []
    if args.queries:
        try:
            queries = [q for q in json.loads(args.queries) if isinstance(q, str) and q.strip()]
        except Exception:  # noqa: BLE001
            errors.append("invalid --queries JSON")

    # 1. Discover the sites to scrape (seed URLs + searched product pages).
    sites = discover_sites(queries, seed_urls, args.max_sites, errors)
    if not sites:
        print(json.dumps({"items": [], "errors": errors or ["no sites to scrape"], "sites_scraped": []}))
        return 0
    log(f"scraping {len(sites)} site(s): {sites}")

    # 2. Scrape each site, pooling candidate media (tagged with its source site).
    candidates: list[dict] = []
    sites_scraped: list[str] = []
    strategy_used = "none"
    for site_i, site in enumerate(sites):
        # Hunt for hero video on the FIRST (most relevant) site only — video is the
        # caller's top priority and is almost always JS-injected, but we don't want
        # to pay a browser render on every site.
        media, strat, final_url = scrape_one_site(site, args.wait_ms, errors, hunt_video=(site_i == 0))
        if media:
            sites_scraped.append(final_url)
            if strategy_used == "none":
                strategy_used = strat
            for m in media:
                m["source_site"] = final_url
            candidates.extend(media)

    # 3. Dedupe by URL, then pre-rank: videos first, then by heuristic score.
    seen_urls: set[str] = set()
    deduped: list[dict] = []
    for c in candidates:
        if c["url"] in seen_urls:
            continue
        seen_urls.add(c["url"])
        deduped.append(c)
    type_pre = {"video": 2, "gif": 2, "image": 1}
    deduped.sort(key=lambda c: (type_pre.get(c["kind_hint"], 0), c["score"]), reverse=True)

    # 4. Download (videos first, then images) up to a generous buffer, then probe.
    downloaded: list[dict] = []
    vids_dl = imgs_dl = 0
    video_budget = args.max_videos + 2
    image_budget = args.max_images + 4
    for idx, cand in enumerate(deduped):
        is_video_like = cand["kind_hint"] in ("video", "gif")
        if is_video_like and vids_dl >= video_budget:
            continue
        if not is_video_like and imgs_dl >= image_budget:
            continue
        ctype, clen = http_head(cand["url"])
        cap = MAX_FILE_BYTES_VIDEO if is_video_like else MAX_FILE_BYTES_IMAGE
        if clen and clen > cap:
            continue
        if ctype:
            primary = ctype.split(";", 1)[0].strip().lower()
            if cand["kind_hint"] in ("image", "gif") and not primary.startswith("image/"):
                continue
            if cand["kind_hint"] == "video" and not primary.startswith("video/"):
                continue
        ext = url_extension(cand["url"])
        if not ext:
            mapping = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp",
                       "image/gif": ".gif", "video/mp4": ".mp4", "video/webm": ".webm"}
            ext = next((v for k, v in mapping.items() if ctype and k in ctype), ".bin")
        dest = out_dir / f"asset_{idx:03d}{ext}"
        if not download(cand["url"], dest):
            errors.append(f"download failed: {cand['url'][:80]}")
            continue
        asset_type = "video"
        if ext == GIF_EXT:
            converted = gif_to_mp4(dest)
            if converted:
                dest, asset_type = converted, "video"
            else:
                asset_type = "image"
        elif cand["kind_hint"] == "video":
            asset_type = "video"
        else:
            asset_type = "image"

        # Probe REAL dimensions so orientation ranking is based on pixels.
        w, h = probe_dimensions(dest)
        orientation, aspect = classify_orientation(w, h)
        # Drop tiny assets that slipped through (icons/thumbnails).
        if w and h and (w < 480 or h < 270) and asset_type != "video":
            try:
                dest.unlink()
            except OSError:
                pass
            continue
        downloaded.append({
            "kind": "video" if asset_type == "video" else "image",
            "assetType": asset_type,
            "file": f"scraped/{dest.name}",
            "source_url": cand["url"],
            "source_site": cand.get("source_site", ""),
            "alt": cand.get("alt", ""),
            "score": cand.get("score", 0.5),
            "width": w, "height": h,
            "orientation": orientation, "aspect": round(aspect, 3),
            "_path": dest,
        })
        if asset_type == "video":
            vids_dl += 1
        else:
            imgs_dl += 1

    # 5. Screenshot fallback if we have too few usable stills.
    if len([d for d in downloaded if d["assetType"] != "video"]) < 2 and sites_scraped:
        shots = stealth_screenshots(sites_scraped[0], out_dir, 3 - imgs_dl if imgs_dl < 3 else 1,
                                    len(deduped) + 50, errors)
        for s in shots:
            p = out_dir / Path(s["file"]).name
            w, h = probe_dimensions(p)
            orientation, aspect = classify_orientation(w, h)
            s.update({"source_site": sites_scraped[0], "width": w, "height": h,
                      "orientation": orientation, "aspect": round(aspect, 3), "_path": p})
            downloaded.append(s)

    # 6. FINAL RANK: type (video>image>screenshot) → orientation (landscape>square>portrait)
    #    → heuristic score → resolution. This is exactly the caller's priority.
    def rank_key(item: dict):
        return (
            TYPE_WEIGHT.get(item["assetType"], 0),
            ORIENT_WEIGHT.get(item["orientation"], 0),
            item.get("score", 0),
            (item.get("width") or 0) * (item.get("height") or 0),
        )
    downloaded.sort(key=rank_key, reverse=True)

    # 7. Trim to caps (videos first, then images/screenshots), delete the rest.
    kept, kept_v, kept_i = [], 0, 0
    for item in downloaded:
        if item["assetType"] == "video":
            if kept_v >= args.max_videos:
                continue
            kept_v += 1
        else:
            if kept_i >= args.max_images:
                continue
            kept_i += 1
        kept.append(item)
    for item in downloaded:
        if item not in kept:
            try:
                item["_path"].unlink()
            except (OSError, KeyError, AttributeError):
                pass
    for item in kept:
        item.pop("_path", None)

    print(json.dumps({
        "items": kept,
        "errors": errors,
        "sites_scraped": sites_scraped,
        "strategy": strategy_used,
        "stats": {"candidates": len(deduped), "videos_kept": kept_v, "images_kept": kept_i,
                  "sites": len(sites_scraped)},
    }))
    return 0


if __name__ == "__main__":
    sys.exit(main())
