#!/usr/bin/env python3
"""
Shared production API client for Mbumah Hardware POS population.
Auth flow: GET /api/security/csrf-token (cookie jar) -> POST /api/auth/login
with X-CSRF-Token + Origin + Referer -> Bearer token from data.token.
"""
import json
import sys
import time
import urllib.request
import urllib.error
import http.cookiejar

BASE = "https://mbumah-hardware-pos-one.vercel.app"
EMAIL = "admin@mbumahhardware.co.ke"
PASSWORD = "password123"


class Client:
    def __init__(self, base=BASE, email=EMAIL, password=PASSWORD, verbose=False):
        self.base = base
        self.verbose = verbose
        self.token = None
        self.user = None
        self.jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))
        self.opener.addheaders = [
            ("User-Agent", "Mozilla/5.0 (X11; Linux x86_64) population-script/1.0"),
            ("Accept", "application/json"),
        ]
        self.login(email, password)

    def _req(self, method, path, body=None, csrf=False, retries=2):
        url = self.base + path
        headers = {"Content-Type": "application/json"}
        if csrf:
            headers["X-CSRF-Token"] = self._get_csrf()
            headers["Origin"] = self.base
            headers["Referer"] = self.base + "/login"
        if self.token:
            headers["Authorization"] = "Bearer " + self.token
        data = json.dumps(body).encode() if body is not None else None
        last_err = None
        for attempt in range(retries + 1):
            try:
                req = urllib.request.Request(url, data=data, headers=headers, method=method)
                with self.opener.open(req, timeout=60) as resp:
                    payload = json.loads(resp.read().decode())
                return resp.status, payload
            except urllib.error.HTTPError as e:
                try:
                    payload = json.loads(e.read().decode())
                except Exception:
                    payload = {"raw": e.read().decode()[:300]}
                # 401 -> re-login once then retry
                if e.code == 401 and self.token and attempt == 0:
                    self.login(EMAIL, PASSWORD)
                    last_err = (e.code, payload)
                    continue
                if e.code in (429, 500, 502, 503, 504) and attempt < retries:
                    time.sleep(1.5 * (attempt + 1))
                    last_err = (e.code, payload)
                    continue
                return e.code, payload
            except Exception as e:
                if attempt < retries:
                    time.sleep(1.5 * (attempt + 1))
                    last_err = (0, {"error": str(e)})
                    continue
                return 0, {"error": str(e)}
        return last_err

    def _get_csrf(self):
        status, payload = self._req("GET", "/api/security/csrf-token")
        if status == 200:
            data = payload.get("data") or {}
            tok = data.get("csrfToken") or data.get("token")
            if tok:
                return tok
        for c in self.jar:
            if "csrf" in c.name.lower():
                return c.value
        raise RuntimeError("cannot obtain csrf token: %s %s" % (status, str(payload)[:200]))

    def login(self, email, password):
        self.token = None
        status, payload = self._req("POST", "/api/auth/login",
                                    {"email": email, "password": password}, csrf=True)
        if status != 200:
            raise RuntimeError("login failed %s %s" % (status, str(payload)[:300]))
        data = payload.get("data") or payload
        self.token = data.get("token") or data.get("accessToken")
        self.user = data.get("user")
        if not self.token:
            raise RuntimeError("no token in login response: %s" % str(payload)[:300])
        if self.verbose:
            print("logged in as", email, "->", (self.user or {}).get("role"))

    def get(self, path):
        return self._req("GET", path)

    def post(self, path, body):
        return self._req("POST", path, body, csrf=True)

    def put(self, path, body):
        return self._req("PUT", path, body, csrf=True)

    def delete(self, path):
        return self._req("DELETE", path, csrf=True)


def list_data(cl, path):
    """GET a list endpoint; handle {data:[...]} and {data:{items:[...]}} shapes."""
    status, payload = cl.get(path)
    if status != 200:
        raise RuntimeError("GET %s -> %s %s" % (path, status, str(payload)[:200]))
    data = payload.get("data")
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        for k in ("items", "transactions", "products", "accounts", "customers",
                  "users", "ledger", "records", "entries", "suppliers", "rentals"):
            if isinstance(data.get(k), list):
                return data[k]
    return []


if __name__ == "__main__":
    cl = Client(verbose=True)
    print("user:", json.dumps(cl.user)[:200])
    s, p = cl.get("/api/branches")
    print("branches:", s, json.dumps(p)[:800])
