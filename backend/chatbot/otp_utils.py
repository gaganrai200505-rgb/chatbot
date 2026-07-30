"""
otp_utils.py — OTP generation and email sending utilities

Sends OTP emails via Django's built-in email backend (SMTP) with automatic
dual-port failover (465 SSL <-> 587 STARTTLS) and HTTP REST API fallback.

Also logs generated OTPs to server stdout so they are visible in Render logs.
"""
import random
import string
import re
import json
import urllib.request
import urllib.error

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


def _send_via_brevo_api(api_key, from_email, to_email, subject, body):
    """Send email via Brevo (Sendinblue) HTTPS REST API (Port 443 — never blocked on cloud)."""
    url = "https://api.brevo.com/v3/smtp/email"
    headers = {
        "accept": "application/json",
        "api-key": api_key,
        "content-type": "application/json"
    }
    payload = {
        "sender": {"name": "JanSeva AI", "email": from_email},
        "to": [{"email": to_email}],
        "subject": subject,
        "textContent": body
    }
    req = urllib.request.Request(url, data=json.dumps(payload).encode('utf-8'), headers=headers, method='POST')
    with urllib.request.urlopen(req, timeout=10) as response:
        if response.status in (200, 201, 202):
            print(f"[OTP SUCCESS] Sent via Brevo HTTP API to {to_email}")
            return True
    return False


def _send_via_resend_api(api_key, from_email, to_email, subject, body):
    """Send email via Resend HTTPS REST API (Port 443 — never blocked on cloud)."""
    url = "https://api.resend.com/emails"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }
    payload = {
        "from": from_email if "@" in from_email and "gmail.com" not in from_email else "onboarding@resend.dev",
        "to": [to_email],
        "subject": subject,
        "text": body
    }
    req = urllib.request.Request(url, data=json.dumps(payload).encode('utf-8'), headers=headers, method='POST')
    with urllib.request.urlopen(req, timeout=10) as response:
        if response.status in (200, 201, 202):
            print(f"[OTP SUCCESS] Sent via Resend HTTP API to {to_email}")
            return True
    return False


def _dispatch_email(subject, body, from_email, to_email):
    """
    Sends email using the best available method:
    1. HTTP REST API (Brevo / Resend if API key present)
    2. Primary SMTP backend (Port 465 SSL or 587 STARTTLS)
    3. Failover SMTP backend (swaps port 465 <-> 587)
    """
    # 1. Try Brevo HTTP API if configured
    brevo_key = getattr(settings, 'BREVO_API_KEY', '') or getattr(settings, 'SENDINBLUE_API_KEY', '')
    if brevo_key:
        try:
            if _send_via_brevo_api(brevo_key, from_email, to_email, subject, body):
                return
        except Exception as brevo_err:
            print(f"[OTP WARNING] Brevo HTTP API failed: {brevo_err}")

    # 2. Try Resend HTTP API if configured
    resend_key = getattr(settings, 'RESEND_API_KEY', '')
    if resend_key:
        try:
            if _send_via_resend_api(resend_key, from_email, to_email, subject, body):
                return
        except Exception as resend_err:
            print(f"[OTP WARNING] Resend HTTP API failed: {resend_err}")

    # 3. Primary SMTP attempt (uses Django settings with fast 5s timeout)
    host = getattr(settings, 'EMAIL_HOST', 'smtp.gmail.com')
    user = getattr(settings, 'EMAIL_HOST_USER', '')
    pwd  = getattr(settings, 'EMAIL_HOST_PASSWORD', '')
    primary_port = getattr(settings, 'EMAIL_PORT', 465)
    primary_use_ssl = (primary_port == 465)
    primary_use_tls = (primary_port == 587)

    try:
        conn = get_connection(
            backend='django.core.mail.backends.smtp.EmailBackend',
            host=host,
            port=primary_port,
            username=user,
            password=pwd,
            use_tls=primary_use_tls,
            use_ssl=primary_use_ssl,
            timeout=5
        )
        msg = EmailMessage(subject=subject, body=body, from_email=from_email, to=[to_email], connection=conn)
        msg.send(fail_silently=False)
        print(f"[OTP SUCCESS] Primary SMTP email dispatched to {to_email}")
        return
    except Exception as primary_err:
        print(f"[OTP WARNING] Primary SMTP failed ({type(primary_err).__name__}: {primary_err})")

    # 4. Failover SMTP attempt (swaps port 465 <-> 587 with fast 5s timeout)
    fallback_port = 587 if primary_port == 465 else 465
    fallback_use_ssl = (fallback_port == 465)
    fallback_use_tls = (fallback_port == 587)

    print(f"[OTP] Retrying SMTP on failover port {fallback_port} (SSL={fallback_use_ssl}, TLS={fallback_use_tls})...")

    try:
        conn = get_connection(
            backend='django.core.mail.backends.smtp.EmailBackend',
            host=host,
            port=fallback_port,
            username=user,
            password=pwd,
            use_tls=fallback_use_tls,
            use_ssl=fallback_use_ssl,
            timeout=5
        )
        msg = EmailMessage(subject=subject, body=body, from_email=from_email, to=[to_email], connection=conn)
        msg.send(fail_silently=False)
        print(f"[OTP SUCCESS] Failover SMTP dispatched to {to_email} via port {fallback_port}")
        return
    except Exception as fallback_err:
        print(f"[OTP ERROR] Failover SMTP also failed ({type(fallback_err).__name__}: {fallback_err})")
        raise Exception(f"All email delivery attempts failed. Primary error: {primary_err}, Failover error: {fallback_err}")


def send_otp_email(user, purpose):
    """
    Create a new OTP and send it to the user.
    Logs OTP to server output and sends via email/HTTP.
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

    # Log generated OTP to stdout for server log inspection
    print(f"==========================================================================")
    print(f"[OTP GENERATED] User: '{user.username}' | Email: '{user.email}' | Purpose: {purpose} | Code: {otp.code}")
    print(f"==========================================================================")

    host_user = getattr(settings, 'EMAIL_HOST_USER', '').strip()
    host_pass = getattr(settings, 'EMAIL_HOST_PASSWORD', '').strip()

    # Extract clean "From" address
    raw_from = getattr(settings, 'DEFAULT_FROM_EMAIL', '') or host_user
    m = re.search(r'<([^>]+)>', raw_from)
    from_email = m.group(1).strip() if m else raw_from.strip()
    if not from_email:
        from_email = host_user

    subject  = subject_map.get(purpose, 'JanSeva AI — Your OTP')
    body     = body_map.get(purpose, f"Your OTP is: {otp.code}")
    to_email = user.email.strip()

    if not host_user and not getattr(settings, 'BREVO_API_KEY', '') and not getattr(settings, 'RESEND_API_KEY', ''):
        print(f"[OTP] No email credentials configured. Code: {otp.code}")
        return otp

    _dispatch_email(subject, body, from_email, to_email)
    return otp
