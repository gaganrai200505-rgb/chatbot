"""
WSGI config — JanSeva AI backend entry point for Gunicorn.

IPv4-only socket patch is applied FIRST before Django loads,
ensuring that all outbound DNS lookups (including SMTP) use IPv4.
Render and most cloud providers do not route IPv6 outbound traffic.
"""
import os
import socket

# ── IPv4-only socket patch ───────────────────────────────────────────────────
# Must be applied before Django (and any other library) imports socket.
# This ensures smtp.gmail.com resolves to an IPv4 address, preventing
# [Errno 101] Network is unreachable on cloud containers without IPv6 routing.
_orig_getaddrinfo = socket.getaddrinfo

def _force_ipv4(host, port, family=0, type=0, proto=0, flags=0):
    return _orig_getaddrinfo(host, port, socket.AF_INET, type, proto, flags)

socket.getaddrinfo = _force_ipv4
# ─────────────────────────────────────────────────────────────────────────────

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

from django.core.wsgi import get_wsgi_application  # noqa: E402
application = get_wsgi_application()
