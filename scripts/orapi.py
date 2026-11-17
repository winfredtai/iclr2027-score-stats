"""Minimal OpenReview API v2 client (stdlib only, so it runs anywhere without pip)."""
import gzip
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

BASE = "https://api2.openreview.net"
UA = "iclr-score-stats/1.0 (+https://github.com/winfredtai/iclr2027-score-stats)"


def load_dotenv(path):
    """Populate os.environ from a KEY=VALUE file without overriding existing vars."""
    p = Path(path)
    if not p.exists():
        return
    for line in p.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        v = v.strip().strip('"').strip("'")
        os.environ.setdefault(k.strip(), v)


class OpenReviewError(RuntimeError):
    pass


class Client:
    def __init__(self, username=None, password=None, token=None):
        self.token = token
        if not self.token and username and password:
            self.login(username, password)

    def _request(self, method, path, params=None, body=None, retries=5):
        url = BASE + path
        if params:
            url += "?" + urllib.parse.urlencode(params)
        headers = {"User-Agent": UA, "Accept": "application/json", "Accept-Encoding": "gzip"}
        data = None
        if body is not None:
            data = json.dumps(body).encode()
            headers["Content-Type"] = "application/json"
        if self.token:
            headers["Authorization"] = "Bearer " + self.token
        delay = 5
        for attempt in range(retries):
            req = urllib.request.Request(url, data=data, headers=headers, method=method)
            try:
                with urllib.request.urlopen(req, timeout=180) as resp:
                    raw = resp.read()
                    if resp.headers.get("Content-Encoding") == "gzip":
                        raw = gzip.decompress(raw)
                    return json.loads(raw)
            except urllib.error.HTTPError as e:
                raw = e.read()
                try:
                    if e.headers.get("Content-Encoding") == "gzip":
                        raw = gzip.decompress(raw)
                    err = json.loads(raw)
                except Exception:
                    err = {"message": raw[:300].decode(errors="replace")}
                name = err.get("name", "")
                if e.code == 429 or e.code >= 500:
                    wait = delay * (2 ** attempt)
                    print(f"  HTTP {e.code} ({name}); retrying in {wait}s", flush=True)
                    time.sleep(wait)
                    continue
                raise OpenReviewError(f"HTTP {e.code} {name}: {err.get('message')}") from None
            except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
                wait = delay * (2 ** attempt)
                print(f"  network error {e!r}; retrying in {wait}s", flush=True)
                time.sleep(wait)
        raise OpenReviewError(f"giving up on {method} {path} after {retries} attempts")

    def login(self, username, password):
        res = self._request("POST", "/login", body={"id": username, "password": password})
        self.token = res.get("token")
        if not self.token:
            raise OpenReviewError("login succeeded but no token returned")

    def get(self, path, **params):
        return self._request("GET", path, params=params)

    def iter_notes(self, page_size=1000, pause=1.0, **params):
        """Yield every note matching params, paging with offset."""
        offset = 0
        while True:
            res = self.get("/notes", limit=page_size, offset=offset, **params)
            notes = res.get("notes", [])
            for n in notes:
                yield n
            offset += len(notes)
            count = res.get("count")
            if not notes or (count is not None and offset >= count):
                break
            time.sleep(pause)
