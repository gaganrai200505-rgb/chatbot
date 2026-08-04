"""
urls.py — Chatbot App Routing
==============================

This module connects the `/chat/` URL endpoint to the `ChatAPIView` class.
"""

from django.urls import path
from rest_framework_simplejwt.views import TokenRefreshView
from .views import (
    ChatAPIView, RegisterView, LogoutView, ThrottledTokenObtainPairView,
    ChatHistoryView, SessionDetailAPIView, CheckEligibilityAPIView,
    TextToSpeechAPIView, PingView, GroqSTTView,
    VerifyOTPView, ResendOTPView, ForgotPasswordView, ResetPasswordView,
    GeminiLiveConfigView, SearchSchemesToolView, TrendingSchemesView, ivr_incoming_handler,
)

urlpatterns = [
    # Auth
    path("register/",         RegisterView.as_view(),                   name="register"),
    path("verify-otp/",       VerifyOTPView.as_view(),                  name="verify_otp"),
    path("resend-otp/",       ResendOTPView.as_view(),                  name="resend_otp"),
    path("forgot-password/",  ForgotPasswordView.as_view(),             name="forgot_password"),
    path("reset-password/",   ResetPasswordView.as_view(),              name="reset_password"),
    path("token/",            ThrottledTokenObtainPairView.as_view(),   name="token_obtain_pair"),
    path("token/refresh/",    TokenRefreshView.as_view(),               name="token_refresh"),
    path("logout/",           LogoutView.as_view(),                     name="logout"),

    # Chat & Sessions
    path("chat/", ChatAPIView.as_view(), name="chat_api"),
    path("history/", ChatHistoryView.as_view(), name="chat_history"),
    path("session/<str:session_id>/", SessionDetailAPIView.as_view(), name="session_detail"),
    path("check-eligibility/", CheckEligibilityAPIView.as_view(), name="check_eligibility"),
    path("tts/", TextToSpeechAPIView.as_view(), name="tts_api"),

    # Dynamic Live Schemes Feed
    path("trending-schemes/", TrendingSchemesView.as_view(), name="trending_schemes"),

    # Health check — keeps Render free-tier server alive (pinged every 10 min)
    path("ping/", PingView.as_view(), name="ping"),

    # Groq Whisper STT — high-accuracy transcription for en / hi / mr
    path("stt/groq/", GroqSTTView.as_view(), name="groq_stt"),

    # Direct Gemini 2.0 Multimodal Live Voice-to-Voice endpoints
    path("voice/live-config/", GeminiLiveConfigView.as_view(), name="gemini_live_config"),
    path("voice/tool-search/", SearchSchemesToolView.as_view(), name="search_schemes_tool"),

    # Exotel IVR Phone Endpoint
    path("ivr/incoming/", ivr_incoming_handler, name="ivr_incoming"),
]



