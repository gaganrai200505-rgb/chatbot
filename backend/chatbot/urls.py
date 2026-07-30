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
    TextToSpeechAPIView, PingView,
    VerifyOTPView, ResendOTPView, ForgotPasswordView, ResetPasswordView,
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

    # Health check — keeps Render free-tier server alive (pinged every 10 min)
    path("ping/", PingView.as_view(), name="ping"),
]
