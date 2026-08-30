"""
clover_client.py -- one shared Clover Platform API client.

Replaces the duplicated get_client() copies that used to be inlined in
square_import.py, sync_products.py, transform_events.py, reset_catalog.py,
and create_test_order.py -- a deliberate consolidation, not incidental.

Two hard-won facts from live sandbox verification, not documentation:

  1. The host is api.clover.com (the PRODUCTION Platform API host) even for a
     sandbox test merchant -- sandbox.dev.clover.com returned a clean 401 for
     every call tried against it. Sandbox-ness here is a property of the
     merchant record, not a separate hostname, at least for this account.
  2. Auth is a genuine OAuth access_token (obtained via the browser
     authorize -> immediate code exchange flow -- see web/app/api/webhooks/
     clover-oauth-capture/route.ts for that flow), NOT the merchant-specific
     "Platform API" token generated from the merchant dashboard's own Setup ->
     API Tokens page -- that token returned 401 on every call tried, including
     a plain GET of the merchant object itself.

No official Clover Python SDK exists (confirmed) -- this hand-rolls a thin
requests-based client rather than adding an unofficial third-party package,
same reasoning as the truststore fix over a one-off curl shim: one shared
piece of internal code beats another dependency.
"""

import os
import sys

import requests
import truststore

# Same fix as sync_products.py: this machine's Python/OpenSSL doesn't do the
# AIA chasing Windows' native TLS stack does for a missing intermediate cert.
# truststore patches ssl to use the OS's own verification -- the durable fix,
# not another one-off curl shim, since it's a Windows-Python issue that would
# recur against any HTTPS host, not just Clover's.
truststore.inject_into_ssl()

PLATFORM_HOST = "https://api.clover.com"


class CloverClient:
    def __init__(self, access_token: str, merchant_id: str):
        self.access_token = access_token
        self.merchant_id = merchant_id
        self.session = requests.Session()
        self.session.headers.update({
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json",
        })

    def _url(self, path: str) -> str:
        return f"{PLATFORM_HOST}/v3/merchants/{self.merchant_id}{path}"

    def get(self, path: str, **kwargs):
        resp = self.session.get(self._url(path), timeout=30, **kwargs)
        resp.raise_for_status()
        return resp.json()

    def post(self, path: str, json_body=None, **kwargs):
        resp = self.session.post(self._url(path), json=json_body, timeout=30, **kwargs)
        resp.raise_for_status()
        return resp.json() if resp.content else {}

    def delete(self, path: str, **kwargs):
        resp = self.session.delete(self._url(path), timeout=30, **kwargs)
        resp.raise_for_status()
        return resp.json() if resp.content else {}

    # ---------------------------------------------------------------- #
    # Items / catalog
    # ---------------------------------------------------------------- #
    def list_items(self, expand=None, limit=1000):
        """Yield every item, paginating with offset/limit."""
        offset = 0
        while True:
            params = {"limit": limit, "offset": offset}
            if expand:
                params["expand"] = expand
            data = self.get("/items", params=params)
            elements = data.get("elements") or []
            for el in elements:
                yield el
            if len(elements) < limit:
                return
            offset += limit

    def create_item_group(self, name: str) -> dict:
        return self.post("/item_groups", {"name": name})

    def create_attribute(self, item_group_id: str, name: str) -> dict:
        return self.post("/attributes", {"itemGroup": {"id": item_group_id}, "name": name})

    def create_attribute_option(self, attribute_id: str, name: str) -> dict:
        return self.post(f"/attributes/{attribute_id}/options", {"name": name})

    def create_item(self, name: str, price_cents: int, sku: str,
                     item_group_id: str | None = None, upc: str | None = None) -> dict:
        body = {"name": name, "price": price_cents, "sku": sku}
        if item_group_id:
            body["itemGroup"] = {"id": item_group_id}
        if upc:
            body["code"] = upc
        return self.post("/items", body)

    def link_option_item(self, option_id: str, item_id: str) -> dict:
        return self.post("/option_items", {
            "elements": [{"option": {"id": option_id}, "item": {"id": item_id}}]
        })

    def set_item_stock(self, item_id: str, quantity: int) -> dict:
        return self.post(f"/item_stocks/{item_id}", {"quantity": quantity})

    def delete_item(self, item_id: str):
        return self.delete(f"/items/{item_id}")

    def delete_item_group(self, item_group_id: str):
        return self.delete(f"/item_groups/{item_group_id}")

    # ---------------------------------------------------------------- #
    # Orders / devices
    # ---------------------------------------------------------------- #
    def get_order(self, order_id: str, expand=None) -> dict:
        params = {"expand": expand} if expand else None
        return self.get(f"/orders/{order_id}", params=params)

    def list_devices(self) -> list:
        data = self.get("/devices")
        return data.get("elements") or []


def get_client() -> CloverClient:
    """Build a CloverClient from env vars, exiting with a clear message if
    something required is missing -- same pattern the old per-script
    get_client() copies used for SQUARE_ACCESS_TOKEN."""
    token = os.environ.get("CLOVER_API_TOKEN")
    merchant_id = os.environ.get("CLOVER_MERCHANT_ID")
    if not token:
        sys.exit(
            "CLOVER_API_TOKEN is not set. This must be a genuine OAuth "
            "access_token (see web/app/api/webhooks/clover-oauth-capture/"
            "route.ts for how to get one) -- the merchant dashboard's own "
            "'Platform API' token does NOT work for these calls, confirmed "
            "live (401 on every call, including a plain GET of the merchant)."
        )
    if not merchant_id:
        sys.exit("CLOVER_MERCHANT_ID is not set.")
    env_name = os.environ.get("CLOVER_ENVIRONMENT", "sandbox").lower()
    if env_name == "production":
        print("!! Targeting a PRODUCTION-looking merchant id — this writes "
              "to the real store account if CLOVER_MERCHANT_ID is the live "
              "kiosk merchant.")
    return CloverClient(access_token=token, merchant_id=merchant_id)
