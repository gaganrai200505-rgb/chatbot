"""
otp_utils.py — OTP generation and email sending utilities
"""
import random
import string
from django.core.mail import send_mail
from django.conf import settings
from .models import OTPCode


def generate_otp(length=6):
    """Generate a cryptographically random 6-digit numeric OTP."""
    return ''.join(random.choices(string.digits, k=length))


def create_otp(user, purpose):
    """
    Invalidate all existing OTPs for this user+purpose and create a fresh one.
    Returns the new OTPCode instance.
    """
    OTPCode.objects.filter(user=user, purpose=purpose, is_used=False).update(is_used=True)
    code = generate_otp()
    return OTPCode.objects.create(user=user, code=code, purpose=purpose)


def send_otp_email(user, purpose):
    """
    Create a new OTP and email it to the user.
    Returns the OTPCode instance on success.
    """
    otp = create_otp(user, purpose)
    subject_map = {
        OTPCode.PURPOSE_VERIFY: 'JanSeva AI — Verify your email address',
        OTPCode.PURPOSE_RESET:  'JanSeva AI — Password reset OTP',
    }
    body_map = {
        OTPCode.PURPOSE_VERIFY: (
            f"Hi {user.username},\n\n"
            f"Welcome to JanSeva AI! Please verify your email address using the OTP below:\n\n"
            f"    {otp.code}\n\n"
            f"This code is valid for 10 minutes. If you did not create an account, you can safely ignore this email.\n\n"
            f"— JanSeva AI Team"
        ),
        OTPCode.PURPOSE_RESET: (
            f"Hi {user.username},\n\n"
            f"We received a request to reset your JanSeva AI password. Use the OTP below:\n\n"
            f"    {otp.code}\n\n"
            f"This code is valid for 10 minutes. If you did not request a password reset, please ignore this email.\n\n"
            f"— JanSeva AI Team"
        ),
    }
    send_mail(
        subject=subject_map.get(purpose, 'JanSeva AI — Your OTP'),
        message=body_map.get(purpose, f"Your OTP is: {otp.code}"),
        from_email=settings.DEFAULT_FROM_EMAIL,
        recipient_list=[user.email],
        fail_silently=False,
    )
    return otp
