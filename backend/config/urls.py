"""
Root URL Configuration
=======================
This connects the main urls.py to the chatbot app's urls.py.
"""

from django.contrib import admin
from django.urls import path, include
from django.conf import settings
from django.conf.urls.static import static

from django.views.generic import RedirectView

urlpatterns = [
    # Redirect root URL (/) directly to Django Admin Panel (/admin/)
    path("", RedirectView.as_view(url="/admin/", permanent=False)),
    path("admin/", admin.site.urls),
    # All chatbot API routes are under /api/
    path("api/", include("chatbot.urls")),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
