"""
urls.py — Chatbot App Routing
==============================

This module connects the `/chat/` URL endpoint to the `ChatAPIView` class.
"""

from django.urls import path
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView
from .views import ChatAPIView, RegisterView, ChatHistoryView, SessionDetailAPIView, CheckEligibilityAPIView, TextToSpeechAPIView

urlpatterns = [
    # Auth
    path("register/", RegisterView.as_view(), name="register"),
    path("token/", TokenObtainPairView.as_view(), name="token_obtain_pair"),
    path("token/refresh/", TokenRefreshView.as_view(), name="token_refresh"),

    # Chat & Sessions
    path("chat/", ChatAPIView.as_view(), name="chat_api"),
    path("history/", ChatHistoryView.as_view(), name="chat_history"),
    path("session/<str:session_id>/", SessionDetailAPIView.as_view(), name="session_detail"),
    path("check-eligibility/", CheckEligibilityAPIView.as_view(), name="check_eligibility"),
    path("tts/", TextToSpeechAPIView.as_view(), name="tts_api"),
]
