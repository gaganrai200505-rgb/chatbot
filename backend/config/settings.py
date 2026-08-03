"""
Django Settings
================
Main configuration file for the multilingual chatbot backend.
This uses python-dotenv to read secret keys from a .env file.
"""

import os, sys, io
from pathlib import Path
from dotenv import load_dotenv

# Ensure UTF-8 output encoding for Windows consoles to prevent charmap UnicodeEncodeErrors
try:
    if hasattr(sys.stdout, 'buffer') and getattr(sys.stdout, 'encoding', '').lower() != 'utf-8':
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
    if hasattr(sys.stderr, 'buffer') and getattr(sys.stderr, 'encoding', '').lower() != 'utf-8':
        sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')
except Exception:
    pass

# Load environment variables from .env file
load_dotenv()

# Base directory of the project
BASE_DIR = Path(__file__).resolve().parent.parent

# -------------------------------------------------------
# Security
# -------------------------------------------------------
SECRET_KEY = os.getenv("DJANGO_SECRET_KEY", "django-insecure-fallback-key-change-me")

# Set DEBUG from environment variable (defaults to False in production)
DEBUG = os.getenv("DEBUG", "True").lower() in ("true", "1", "t")

ALLOWED_HOSTS = os.getenv("ALLOWED_HOSTS", "*").split(",")

# -------------------------------------------------------
# Installed Apps
# -------------------------------------------------------
INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    # Third-party
    "rest_framework",       # Django REST Framework for building APIs
    "rest_framework_simplejwt", # JWT Auth
    "rest_framework_simplejwt.token_blacklist", # JWT Token Blacklist
    "corsheaders",          # Allow React frontend to call this backend
    # Our app
    "chatbot",
]

# -------------------------------------------------------
# Middleware
# -------------------------------------------------------
MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",  # MUST be first for CORS to work
    "django.middleware.gzip.GZipMiddleware",    # Compress HTTP responses for high speed
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",  # Serve static files in production
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"

# -------------------------------------------------------
# Database (SQLite for development)
# -------------------------------------------------------
DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": BASE_DIR / "db.sqlite3",
        "CONN_MAX_AGE": 600,
    }
}

# -------------------------------------------------------
# CORS & CSRF Settings
# Allow React dev server and LAN mobile devices
# -------------------------------------------------------
CORS_ALLOW_ALL_ORIGINS = True
CORS_ALLOW_CREDENTIALS = True
CORS_ALLOW_HEADERS = [
    "accept",
    "accept-encoding",
    "authorization",
    "content-type",
    "dnt",
    "origin",
    "user-agent",
    "x-csrftoken",
    "x-requested-with",
]

CSRF_TRUSTED_ORIGINS = [
    "http://localhost:8000",
    "http://127.0.0.1:8000",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "https://*.onrender.com",
    "https://*.vercel.app",
    "https://*.netlify.app",
]

# -------------------------------------------------------
# REST Framework
# -------------------------------------------------------
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": (
        "rest_framework_simplejwt.authentication.JWTAuthentication",
    ),
    "DEFAULT_PERMISSION_CLASSES": [
        "rest_framework.permissions.IsAuthenticated",
    ],
    "DEFAULT_RENDERER_CLASSES": [
        "rest_framework.renderers.JSONRenderer",
    ],
    "DEFAULT_PARSER_CLASSES": [
        "rest_framework.parsers.JSONParser",
    ],
    "DEFAULT_THROTTLE_CLASSES": [
        "rest_framework.throttling.AnonRateThrottle",
        "rest_framework.throttling.UserRateThrottle",
    ],
    "DEFAULT_THROTTLE_RATES": {
        "anon": "30/minute",
        "user": "120/minute",
        "auth": "10/minute",
        "tts": "60/minute",
    },
}

# -------------------------------------------------------
# Password Validation
# -------------------------------------------------------
AUTH_PASSWORD_VALIDATORS = [
    {
        "NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator",
    },
    {
        "NAME": "django.contrib.auth.password_validation.MinimumLengthValidator",
        "OPTIONS": {
            "min_length": 8,
        },
    },
    {
        "NAME": "django.contrib.auth.password_validation.CommonPasswordValidator",
    },
    {
        "NAME": "django.contrib.auth.password_validation.NumericPasswordValidator",
    },
]

from datetime import timedelta
SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=60),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=7),
    "ROTATE_REFRESH_TOKENS": True,
    "BLACKLIST_AFTER_ROTATION": True,
    "UPDATE_LAST_LOGIN": True,
    "AUTH_HEADER_TYPES": ("Bearer",),
}

# -------------------------------------------------------
# Static Files
# -------------------------------------------------------
STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
STORAGES = {
    "default": {
        "BACKEND": "django.core.files.storage.FileSystemStorage",
    },
    "staticfiles": {
        "BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage",
    },
}

MEDIA_URL = "/media/"
MEDIA_ROOT = BASE_DIR / "media"

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# -------------------------------------------------------
# API Keys (read from .env)
# -------------------------------------------------------
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
SARVAM_API_KEY = os.getenv("SARVAM_API_KEY", "")

# Gemini 2.0 Multimodal Live model for native voice-to-voice.
# Overridable via GEMINI_LIVE_MODEL env var; defaults to the stable
# Live model (the "exp" preview was retired). The frontend also
# maintains a client-side fallback chain in geminiLiveWebSocket.js.
GEMINI_LIVE_MODEL = os.getenv("GEMINI_LIVE_MODEL", "gemini-2.0-flash-live-001")

# -------------------------------------------------------
# Email (Gmail SMTP) — for OTP verification & password reset
# -------------------------------------------------------

# ── IPv4-only socket patch ──────────────────────────────
# Render (and most cloud providers) do NOT route IPv6 outbound traffic.
# Python's socket.getaddrinfo() prefers IPv6 by default, causing
# [Errno 101] Network is unreachable. We patch it to always use IPv4.
import socket as _socket_module

def _force_ipv4_getaddrinfo(host, port, family=0, type=0, proto=0, flags=0):
    """Redirect all DNS lookups to IPv4 addresses only."""
    return _orig_getaddrinfo(host, port, _socket_module.AF_INET, type, proto, flags)

_orig_getaddrinfo = _socket_module.getaddrinfo
_socket_module.getaddrinfo = _force_ipv4_getaddrinfo

# ── SMTP settings ───────────────────────────────────────
EMAIL_BACKEND  = "django.core.mail.backends.smtp.EmailBackend"
EMAIL_HOST     = os.getenv("EMAIL_HOST", "smtp.gmail.com").strip('"\'')
EMAIL_HOST_USER     = os.getenv("EMAIL_HOST_USER", "").strip('"\'')
EMAIL_HOST_PASSWORD = os.getenv("EMAIL_HOST_PASSWORD", "").strip('"\'')
EMAIL_TIMEOUT  = 15

_raw_from = os.getenv("DEFAULT_FROM_EMAIL", "").strip('"\'')
DEFAULT_FROM_EMAIL = _raw_from if _raw_from else EMAIL_HOST_USER

# Dynamic PORT & SSL/TLS: support both 465 SSL and 587 TLS from env vars
EMAIL_PORT = int(os.getenv("EMAIL_PORT", "465"))
_use_ssl_env = os.getenv("EMAIL_USE_SSL", "True").lower() in ("true", "1")
_use_tls_env = os.getenv("EMAIL_USE_TLS", "False").lower() in ("true", "1")

if EMAIL_PORT == 465 or _use_ssl_env:
    EMAIL_USE_SSL = True
    EMAIL_USE_TLS = False
else:
    EMAIL_USE_TLS = True
    EMAIL_USE_SSL = False

# HTTP-based email API keys (never blocked by cloud firewalls / Google security)
BREVO_API_KEY  = os.getenv("BREVO_API_KEY", "").strip('"\'')
RESEND_API_KEY = os.getenv("RESEND_API_KEY", "").strip('"\'')



