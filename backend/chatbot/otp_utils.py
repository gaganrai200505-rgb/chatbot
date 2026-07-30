"""
otp_utils.py — OTP generation and email sending utilities

Uses raw smtplib with explicit IPv4 DNS resolution to guarantee
email delivery from cloud hosts (e.g. Render) that block IPv6.

Key trick: resolve hostname -> IPv4, create raw TCP socket to IPv4,
but pass the original HOSTNAME to SSL wrap for SNI/cert validation.
"""
import random
import string
import socket
import smtplib
import ssl
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
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


def _resolve_ipv4(hostname):
    """
    Resolve hostname to the first IPv4 address found.
    This bypasses the OS default that prefers IPv6 on cloud containers.
    """
    try:
        results = socket.getaddrinfo(hostname, None, socket.AF_INET, socket.SOCK_STREAM)
        if results:
            return results[0][4][0]  # First IPv4 address
    except Exception as e:
        print(f"[OTP] IPv4 resolution failed for {hostname}: {e}")
    return hostname  # Fall back to hostname if resolution fails


def _build_email_message(from_addr, to_addr, subject, body):
    """Build a MIME email message."""
    msg = MIMEMultipart('alternative')
    msg['Subject'] = subject
    msg['From'] = from_addr
    msg['To'] = to_addr
    msg.attach(MIMEText(body, 'plain', 'utf-8'))
    return msg.as_string()


def _send_port_465_ssl(ipv4_host, smtp_host, username, password, from_addr, to_addr, subject, body):
    """
    Send via port 465 (SSL) using a pre-resolved IPv4 address.
    CRITICAL: Create raw TCP socket to IPv4 address, then wrap with SSL
    using the ORIGINAL HOSTNAME for SNI certificate validation.
    """
    raw_sock = socket.create_connection((ipv4_host, 465), timeout=15)
    ctx = ssl.create_default_context()
    ssl_sock = ctx.wrap_socket(raw_sock, server_hostname=smtp_host)

    smtp = smtplib.SMTP(timeout=15)
    smtp.sock = ssl_sock
    smtp._tls_established = True
    smtp.file = smtp.sock.makefile('rb')

    (code, _) = smtp.getreply()
    if code != 220:
        raise smtplib.SMTPConnectError(code, "Unexpected SMTP greeting")

    smtp.ehlo(smtp_host)
    smtp.login(username, password)
    msg_str = _build_email_message(from_addr, to_addr, subject, body)
    smtp.sendmail(from_addr, [to_addr], msg_str)
    smtp.quit()


def _send_port_587_starttls(ipv4_host, smtp_host, username, password, from_addr, to_addr, subject, body):
    """
    Send via port 587 (STARTTLS) using a pre-resolved IPv4 address.
    """
    with smtplib.SMTP(ipv4_host, 587, timeout=15) as smtp:
        smtp.ehlo(smtp_host)
        smtp.starttls()
        smtp.ehlo(smtp_host)
        smtp.login(username, password)
        msg_str = _build_email_message(from_addr, to_addr, subject, body)
        smtp.sendmail(from_addr, [to_addr], msg_str)


def send_otp_email(user, purpose):
    """
    Create a new OTP and email it to the user.
    Uses raw smtplib with forced IPv4 DNS resolution for cloud compatibility.
    Tries port 465 (SSL) first, then 587 (STARTTLS).
    Raises Exception if all attempts fail so callers can handle appropriately.
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

    # Read SMTP credentials from settings
    host_user = getattr(settings, 'EMAIL_HOST_USER', '').strip('"').strip("'").strip()
    host_pass = getattr(settings, 'EMAIL_HOST_PASSWORD', '').strip('"').strip("'").strip()
    smtp_host = getattr(settings, 'EMAIL_HOST', 'smtp.gmail.com').strip('"').strip("'").strip()

    # Extract clean "From" address — handle both "Name <email>" and plain "email" formats
    import re
    raw_from = getattr(settings, 'DEFAULT_FROM_EMAIL', '') or host_user
    match = re.search(r'<([^>]+)>', raw_from)
    from_email = match.group(1).strip() if match else raw_from.strip('"').strip("'").strip()
    if not from_email:
        from_email = host_user

    subject = subject_map.get(purpose, 'JanSeva AI — Your OTP')
    body = body_map.get(purpose, f"Your OTP is: {otp.code}")
    to_email = user.email.strip()

    print(f"[OTP] Preparing to send {purpose} email to {to_email} (OTP: {otp.code})")

    # No credentials configured — skip email
    if not host_user or not host_pass:
        print(f"[OTP] SMTP credentials not configured. Skipping email. OTP: {otp.code}")
        return otp

    # Resolve to IPv4 once — avoids repeated DNS lookups and ensures cloud compatibility
    ipv4_host = _resolve_ipv4(smtp_host)
    print(f"[OTP] Resolved {smtp_host} -> {ipv4_host}")

    # Try port 465 (SSL) first, then 587 (STARTTLS)
    last_err = None

    print(f"[OTP] Trying port 465 (SSL)...")
    try:
        _send_port_465_ssl(ipv4_host, smtp_host, host_user, host_pass, from_email, to_email, subject, body)
        print(f"[OTP SUCCESS] {purpose} OTP sent to {to_email} via port 465 SSL")
        return otp
    except Exception as err:
        last_err = err
        print(f"[OTP WARNING] Port 465 failed: {type(err).__name__}: {err}")

    print(f"[OTP] Trying port 587 (STARTTLS)...")
    try:
        _send_port_587_starttls(ipv4_host, smtp_host, host_user, host_pass, from_email, to_email, subject, body)
        print(f"[OTP SUCCESS] {purpose} OTP sent to {to_email} via port 587 STARTTLS")
        return otp
    except Exception as err:
        last_err = err
        print(f"[OTP WARNING] Port 587 failed: {type(err).__name__}: {err}")

    # All ports failed — raise so the caller knows email was NOT sent
    raise Exception(f"Failed to send OTP email to {to_email} on all ports. Last error: {last_err}")
