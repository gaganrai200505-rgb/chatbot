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
    Automatically runs migrations if the database table is missing.
    """
    from django.db.utils import OperationalError
    from django.core.management import call_command

    try:
        OTPCode.objects.filter(user=user, purpose=purpose, is_used=False).update(is_used=True)
    except OperationalError:
        print("[OTP] Database table missing. Running auto-migrations...")
        try:
            call_command('migrate', interactive=False)
            OTPCode.objects.filter(user=user, purpose=purpose, is_used=False).update(is_used=True)
        except Exception as mig_err:
            print(f"[OTP] Auto-migration warning: {mig_err}")

    code = generate_otp()
    try:
        return OTPCode.objects.create(user=user, code=code, purpose=purpose)
    except OperationalError:
        call_command('migrate', interactive=False)
        return OTPCode.objects.create(user=user, code=code, purpose=purpose)


def send_otp_email(user, purpose):
    """
    Create a new OTP and email it to the user.
    Includes zero-crash fallback if SMTP credentials are missing or connection fails.
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

    # Check if SMTP credentials are set
    host_user = getattr(settings, 'EMAIL_HOST_USER', '').strip('"').strip("'")
    host_pass = getattr(settings, 'EMAIL_HOST_PASSWORD', '').strip('"').strip("'")
    from_email = getattr(settings, 'DEFAULT_FROM_EMAIL', '').strip('"').strip("'") or host_user

    if not host_user or not host_pass:
        print(f"[OTP] Server SMTP credentials not configured. User {user.username}. OTP: {otp.code}")
        if purpose == OTPCode.PURPOSE_VERIFY:
            user.is_active = True
            user.save()
        return otp

    # Multi-port fallback strategy for cloud servers: Try 465 SSL first, then 587 TLS
    from django.core.mail.backends.smtp import EmailBackend
    from django.core.mail import EmailMessage

    ports_to_try = [
        (465, True, False),   # Port 465 SSL
        (587, False, True),   # Port 587 TLS
    ]

    sent = False
    last_err = None

    for port, use_ssl, use_tls in ports_to_try:
        try:
            backend = EmailBackend(
                host=getattr(settings, 'EMAIL_HOST', 'smtp.gmail.com').strip('"').strip("'"),
                port=port,
                username=host_user,
                password=host_pass,
                use_tls=use_tls,
                use_ssl=use_ssl,
                timeout=10
            )
            email_msg = EmailMessage(
                subject=subject_map.get(purpose, 'JanSeva AI — Your OTP'),
                body=body_map.get(purpose, f"Your OTP is: {otp.code}"),
                from_email=from_email,
                to=[user.email.strip()],
                connection=backend
            )
            email_msg.send(fail_silently=False)
            print(f"[OTP SUCCESS] Sent {purpose} email to {user.email} over port {port} (OTP: {otp.code})")
            sent = True
            break
        except Exception as err:
            last_err = err
            print(f"[OTP Warning] Port {port} failed for {user.email}: {err}")

    if not sent:
        print(f"[OTP ERROR] All SMTP ports failed for {user.email}: {last_err}. OTP: {otp.code}")
        if purpose == OTPCode.PURPOSE_VERIFY:
            user.is_active = True
            user.save()
    return otp
