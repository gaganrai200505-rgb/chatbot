"""
otp_utils.py — OTP generation and email sending utilities

Sends OTP emails via Django's built-in email backend (SMTP).
The IPv4-only socket patch applied in config/wsgi.py ensures
that smtp.gmail.com resolves to an IPv4 address on Render,
avoiding the [Errno 101] Network is unreachable error caused
by cloud hosts that don't route IPv6 traffic.
"""
import random
import string
import re

from django.core.mail import EmailMessage
from django.conf import settings
from .models import OTPCode


def generate_otp(length=6):
    """Generate a cryptographically random 6-digit numeric OTP."""
    return ''.join(random.choices(string.digits, k=length))


def create_otp(user, purpose):
    """
    Invalidate all existing OTPs for this user+purpose and create a fresh one.
    Auto-runs migrations if the DB table is missing (first deploy).
    """
    from django.db.utils import OperationalError
    from django.core.management import call_command

    try:
        OTPCode.objects.filter(user=user, purpose=purpose, is_used=False).update(is_used=True)
    except OperationalError:
        print("[OTP] DB table missing — running migrate...")
        try:
            call_command('migrate', interactive=False)
            OTPCode.objects.filter(user=user, purpose=purpose, is_used=False).update(is_used=True)
        except Exception as mig_err:
            print(f"[OTP] migrate warning: {mig_err}")

    code = generate_otp()
    try:
        return OTPCode.objects.create(user=user, code=code, purpose=purpose)
    except OperationalError:
        call_command('migrate', interactive=False)
        return OTPCode.objects.create(user=user, code=code, purpose=purpose)


def send_otp_email(user, purpose):
    """
    Create a new OTP and send it to the user via email.

    Uses Django's configured email backend (see settings.py).
    The wsgi.py IPv4 socket patch ensures cloud-compatible DNS resolution.

    Raises Exception on failure — callers must handle this and NOT
    silently activate the user account.
    """
    otp = create_otp(user, purpose)

    subject_map = {
        OTPCode.PURPOSE_VERIFY: 'JanSeva AI — Verify your email address',
        OTPCode.PURPOSE_RESET:  'JanSeva AI — Password reset OTP',
    }
    body_map = {
        OTPCode.PURPOSE_VERIFY: (
            f"Hi {user.username},\n\n"
            f"Welcome to JanSeva AI! Please verify your email using the OTP below:\n\n"
            f"    {otp.code}\n\n"
            f"This code expires in 10 minutes.\n"
            f"If you did not create an account, you can safely ignore this email.\n\n"
            f"— JanSeva AI Team"
        ),
        OTPCode.PURPOSE_RESET: (
            f"Hi {user.username},\n\n"
            f"We received a password reset request for your JanSeva AI account.\n"
            f"Use the OTP below to reset your password:\n\n"
            f"    {otp.code}\n\n"
            f"This code expires in 10 minutes.\n"
            f"If you did not request this, please ignore this email.\n\n"
            f"— JanSeva AI Team"
        ),
    }

    # Credentials check
    host_user = getattr(settings, 'EMAIL_HOST_USER', '').strip()
    host_pass = getattr(settings, 'EMAIL_HOST_PASSWORD', '').strip()

    if not host_user or not host_pass:
        print(f"[OTP] No SMTP credentials — skipping email. OTP={otp.code}")
        return otp

    # Extract clean "From" address from "Name <email>" or plain "email"
    raw_from = getattr(settings, 'DEFAULT_FROM_EMAIL', '') or host_user
    m = re.search(r'<([^>]+)>', raw_from)
    from_email = m.group(1).strip() if m else raw_from.strip()
    if not from_email:
        from_email = host_user

    subject  = subject_map.get(purpose, 'JanSeva AI — Your OTP')
    body     = body_map.get(purpose, f"Your OTP is: {otp.code}")
    to_email = user.email.strip()

    print(f"[OTP] Sending {purpose} OTP to {to_email} (code={otp.code})")

    # Send via Django's configured backend — raises on failure
    msg = EmailMessage(
        subject=subject,
        body=body,
        from_email=from_email,
        to=[to_email],
    )
    msg.send(fail_silently=False)

    print(f"[OTP SUCCESS] {purpose} email dispatched to {to_email}")
    return otp
