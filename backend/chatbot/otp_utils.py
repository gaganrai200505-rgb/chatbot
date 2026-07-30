"""
otp_utils.py — OTP generation and email sending utilities

Sends OTP emails via Django's built-in email backend (SMTP) with automatic
dual-port failover (465 SSL <-> 587 STARTTLS) for cloud host compatibility.

The IPv4-only socket patch applied in config/wsgi.py and settings.py ensures
that smtp.gmail.com resolves to an IPv4 address on Render, avoiding the
[Errno 101] Network is unreachable error caused by cloud hosts without IPv6.
"""
import random
import string
import re

from django.core.mail import EmailMessage, get_connection
from django.conf import settings
from .models import OTPCode


def generate_otp(length=6):
    """Generate a cryptographically random 6-digit numeric OTP."""
    return ''.join(random.choices(string.digits, k=length))


def create_otp(user, purpose):
    """
    Invalidate all existing OTPs for this user+purpose and create a fresh one.
    Auto-runs migrations if the DB table is missing.
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


def _dispatch_email(subject, body, from_email, to_email):
    """
    Sends an email with automatic dual-port failover between 465 SSL and 587 STARTTLS.
    Raises Exception if both ports fail.
    """
    host = getattr(settings, 'EMAIL_HOST', 'smtp.gmail.com')
    user = getattr(settings, 'EMAIL_HOST_USER', '')
    pwd  = getattr(settings, 'EMAIL_HOST_PASSWORD', '')

    # Primary attempt (uses settings configuration)
    try:
        msg = EmailMessage(subject=subject, body=body, from_email=from_email, to=[to_email])
        msg.send(fail_silently=False)
        print(f"[OTP SUCCESS] Primary email dispatched to {to_email}")
        return
    except Exception as primary_err:
        print(f"[OTP WARNING] Primary email attempt failed: {primary_err}")

    # Failover attempt (swaps port 465 <-> 587)
    primary_port = getattr(settings, 'EMAIL_PORT', 465)
    fallback_port = 587 if primary_port == 465 else 465
    fallback_use_ssl = (fallback_port == 465)
    fallback_use_tls = (fallback_port == 587)

    print(f"[OTP] Attempting failover connection on port {fallback_port} (SSL={fallback_use_ssl}, TLS={fallback_use_tls})...")

    conn = get_connection(
        backend='django.core.mail.backends.smtp.EmailBackend',
        host=host,
        port=fallback_port,
        username=user,
        password=pwd,
        use_tls=fallback_use_tls,
        use_ssl=fallback_use_ssl,
        timeout=15
    )
    msg = EmailMessage(subject=subject, body=body, from_email=from_email, to=[to_email], connection=conn)
    msg.send(fail_silently=False)
    print(f"[OTP SUCCESS] Failover email dispatched to {to_email} via port {fallback_port}")


def send_otp_email(user, purpose):
    """
    Create a new OTP and send it to the user via email.
    Uses dual-port failover (465 SSL / 587 STARTTLS).
    Raises Exception on failure so callers can abort/rollback user creation.
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
    _dispatch_email(subject, body, from_email, to_email)
    return otp
