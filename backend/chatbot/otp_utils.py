"""
otp_utils.py — Fast, Non-blocking OTP generation & delivery

Generates a 6-digit OTP and attempts email delivery via SMTP/HTTP.
Logs the generated OTP clearly to server stdout so it can be read from Render logs.
Returns the created OTP object so user accounts are registered in inactive state (is_active=False)
pending OTP verification.
"""
import secrets
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
    return ''.join(str(secrets.randbelow(10)) for _ in range(length))


def create_otp(user, purpose):
    """
    Invalidate all existing OTPs for this user+purpose and create a fresh one.
    Auto-runs migrations if the DB table is missing.
    """
    from django.core.management import call_command

    code = generate_otp()
    try:
        OTPCode.objects.filter(user=user, purpose=purpose, is_used=False).update(is_used=True)
        return OTPCode.objects.create(user=user, code=code, purpose=purpose)
    except Exception as err:
        print(f"[OTP] create_otp DB warning ({err}) — running migrate & retrying...")
        try:
            call_command('migrate', interactive=False)
            OTPCode.objects.filter(user=user, purpose=purpose, is_used=False).update(is_used=True)
            return OTPCode.objects.create(user=user, code=code, purpose=purpose)
        except Exception as retry_err:
            print(f"[OTP ERROR] create_otp retry failed: {retry_err}")
            raise retry_err



def _send_via_brevo_api(api_key, from_email, to_email, subject, body):
    """Send email via Brevo HTTPS REST API (Port 443 — never blocked on cloud)."""
    url = "https://api.brevo.com/v3/smtp/email"
    clean_key = api_key.strip('"\' \t\r\n')
    headers = {
        "accept": "application/json",
        "api-key": clean_key,
        "content-type": "application/json"
    }
    payload = {
        "sender": {"name": "JanSeva AI", "email": from_email},
        "to": [{"email": to_email}],
        "subject": subject,
        "textContent": body
    }
    req = urllib.request.Request(url, data=json.dumps(payload).encode('utf-8'), headers=headers, method='POST')
    try:
        with urllib.request.urlopen(req, timeout=8) as response:
            res_body = response.read().decode('utf-8')
            if response.status in (200, 201, 202):
                print(f"[OTP SUCCESS] Sent via Brevo HTTP API to {to_email}: {res_body}")
                return True
    except urllib.error.HTTPError as err:
        err_text = err.read().decode('utf-8')
        print(f"[OTP BREVO API ERROR] HTTP {err.code}: {err_text}")
    except Exception as e:
        print(f"[OTP BREVO API EXCEPTION] {e}")
    return False



def _send_via_resend_api(api_key, from_email, to_email, subject, body):
    """Send email via Resend HTTPS REST API (Port 443 — never blocked on cloud)."""
    url = "https://api.resend.com/emails"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }
    # Resend free testing domain onboarding@resend.dev
    sender = "JanSeva AI <onboarding@resend.dev>"
    payload = {
        "from": sender,
        "to": [to_email],
        "subject": subject,
        "text": body
    }
    req = urllib.request.Request(url, data=json.dumps(payload).encode('utf-8'), headers=headers, method='POST')
    try:
        with urllib.request.urlopen(req, timeout=5) as response:
            res_body = response.read().decode('utf-8')
            if response.status in (200, 201, 202):
                print(f"[OTP SUCCESS] Sent via Resend HTTP API to {to_email}: {res_body}")
                return True
    except urllib.error.HTTPError as err:
        err_text = err.read().decode('utf-8')
        print(f"[OTP RESEND API ERROR] HTTP {err.code}: {err_text}")
    except Exception as e:
        print(f"[OTP RESEND API EXCEPTION] {e}")
    return False



def send_otp_email(user, purpose):
    """
    Create a new OTP and dispatch email asynchronously/with short timeouts.
    Always logs OTP code to server stdout so it can be verified from Render logs.
    Account stays is_active=False until user verifies the OTP via /api/verify-otp/.
    Never raises an exception — guarantees registration response succeeds.
    """
    try:
        otp = create_otp(user, purpose)
    except Exception as e:
        print(f"[OTP ERROR] create_otp failed: {e}")
        return None

    # ALWAYS log OTP to stdout for instant log inspection
    print("==========================================================================")
    print(f"[JANSEVA OTP] User: '{user.username}' | Email: '{user.email}' | Purpose: {purpose} | CODE: [REDACTED]")
    print("==========================================================================")

    try:
        host_user = getattr(settings, 'EMAIL_HOST_USER', '').strip()
        raw_from = getattr(settings, 'DEFAULT_FROM_EMAIL', '') or host_user
        m = re.search(r'<([^>]+)>', raw_from)
        from_email = m.group(1).strip() if m else raw_from.strip()
        if not from_email:
            from_email = host_user

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

        subject  = subject_map.get(purpose, 'JanSeva AI — Your OTP')
        body     = body_map.get(purpose, f"Your OTP is: {otp.code}")
        to_email = user.email.strip()

        # 1. Try Brevo HTTP API
        brevo_key = getattr(settings, 'BREVO_API_KEY', '') or getattr(settings, 'SENDINBLUE_API_KEY', '')
        if brevo_key:
            try:
                if _send_via_brevo_api(brevo_key, from_email, to_email, subject, body):
                    return otp
            except Exception as e:
                print(f"[OTP WARNING] Brevo API failed: {e}")

        # 2. Try Resend HTTP API
        resend_key = getattr(settings, 'RESEND_API_KEY', '')
        if resend_key:
            try:
                if _send_via_resend_api(resend_key, from_email, to_email, subject, body):
                    return otp
            except Exception as e:
                print(f"[OTP WARNING] Resend API failed: {e}")

        # 3. Fast SMTP attempt with 3s timeout
        host = getattr(settings, 'EMAIL_HOST', 'smtp.gmail.com')
        pwd  = getattr(settings, 'EMAIL_HOST_PASSWORD', '').strip()
        port = getattr(settings, 'EMAIL_PORT', 587)
        use_ssl = (port == 465)
        use_tls = (port == 587)

        if host_user and pwd:
            try:
                print(f"[OTP] Attempting SMTP dispatch to {to_email} (port {port})...")
                conn = get_connection(
                    backend='django.core.mail.backends.smtp.EmailBackend',
                    host=host,
                    port=port,
                    username=host_user,
                    password=pwd,
                    use_tls=use_tls,
                    use_ssl=use_ssl,
                    timeout=3
                )
                msg = EmailMessage(subject=subject, body=body, from_email=from_email, to=[to_email], connection=conn)
                msg.send(fail_silently=False)
                print(f"[OTP SUCCESS] SMTP email sent to {to_email}")
            except Exception as smtp_err:
                print(f"[OTP NOTICE] SMTP dispatch failed ({type(smtp_err).__name__}: {smtp_err}). OTP is logged in server output: {otp.code}")

    except Exception as general_err:
        print(f"[OTP WARNING] Outer dispatch error: {general_err}")

    return otp
