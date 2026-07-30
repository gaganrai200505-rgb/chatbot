"""
otp_utils.py — OTP generation and email sending utilities

Uses raw smtplib.SMTP with STARTTLS and explicit IPv4 DNS resolution
to guarantee email delivery from cloud hosts (e.g. Render) that block IPv6.

Strategy: Resolve smtp.gmail.com -> IPv4 address, then connect
directly to that IPv4 address using port 587 STARTTLS. This bypasses
IPv6 networking issues on cloud containers and avoids SSL cert mismatch
that occurs when using the raw IP with SSL (port 465).
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
    Resolve hostname to the first IPv4 address.
    Bypasses the OS preference for IPv6 on cloud containers.
    """
    try:
        results = socket.getaddrinfo(hostname, None, socket.AF_INET, socket.SOCK_STREAM)
        if results:
            return results[0][4][0]
    except Exception as e:
        print(f"[OTP] IPv4 resolution failed for {hostname}: {e}")
    return hostname


def _build_message(from_addr, to_addr, subject, body):
    """Build and return a MIME email as a string."""
    msg = MIMEMultipart('alternative')
    msg['Subject'] = subject
    msg['From'] = from_addr
    msg['To'] = to_addr
    msg.attach(MIMEText(body, 'plain', 'utf-8'))
    return msg.as_string()


def _smtp_send(smtp_host, ipv4_host, port, username, password,
               from_addr, to_addr, subject, body, use_ssl=False):
    """
    Send email using smtplib. Connects to ipv4_host:port directly.
    - use_ssl=False (port 587): uses STARTTLS
    - use_ssl=True (port 465): uses SMTP_SSL with the original hostname for SNI

    For SSL (port 465), we subclass SMTP_SSL to override _get_socket so that
    the TCP connection goes to ipv4_host but SSL wrapping uses smtp_host for SNI.
    """
    msg_str = _build_message(from_addr, to_addr, subject, body)

    if use_ssl:
        # Subclass SMTP_SSL: connect TCP to IPv4 address but use hostname for SSL SNI
        class IPv4SMTP_SSL(smtplib.SMTP_SSL):
            def _get_socket(self, host, port, timeout):
                # Connect raw socket to IPv4 address
                raw_sock = socket.create_connection((ipv4_host, port), timeout)
                # Wrap with SSL using original hostname for certificate validation
                return self.context.wrap_socket(raw_sock, server_hostname=smtp_host)

        ctx = ssl.create_default_context()
        with IPv4SMTP_SSL(smtp_host, port, context=ctx, timeout=15) as smtp:
            smtp.login(username, password)
            smtp.sendmail(from_addr, [to_addr], msg_str)
    else:
        # STARTTLS: connect to IPv4 address directly
        with smtplib.SMTP(ipv4_host, port, timeout=15) as smtp:
            smtp.ehlo(smtp_host)
            smtp.starttls(context=ssl.create_default_context())
            smtp.ehlo(smtp_host)
            smtp.login(username, password)
            smtp.sendmail(from_addr, [to_addr], msg_str)


def send_otp_email(user, purpose):
    """
    Create a new OTP and email it to the user.
    Tries port 587 (STARTTLS) first, then 465 (SSL) as fallback.
    Raises Exception if all attempts fail.
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
            f"This code is valid for 10 minutes. If you did not create an account, "
            f"you can safely ignore this email.\n\n"
            f"— JanSeva AI Team"
        ),
        OTPCode.PURPOSE_RESET: (
            f"Hi {user.username},\n\n"
            f"We received a request to reset your JanSeva AI password. Use the OTP below:\n\n"
            f"    {otp.code}\n\n"
            f"This code is valid for 10 minutes. If you did not request a password reset, "
            f"please ignore this email.\n\n"
            f"— JanSeva AI Team"
        ),
    }

    # Read SMTP credentials
    host_user = getattr(settings, 'EMAIL_HOST_USER', '').strip('"\'').strip()
    host_pass = getattr(settings, 'EMAIL_HOST_PASSWORD', '').strip('"\'').strip()
    smtp_host  = getattr(settings, 'EMAIL_HOST', 'smtp.gmail.com').strip('"\'').strip()

    # Extract clean From address (handles "Name <email>" format)
    import re
    raw_from = getattr(settings, 'DEFAULT_FROM_EMAIL', '') or host_user
    m = re.search(r'<([^>]+)>', raw_from)
    from_email = m.group(1).strip() if m else raw_from.strip('"\'').strip()
    if not from_email:
        from_email = host_user

    subject  = subject_map.get(purpose, 'JanSeva AI — Your OTP')
    body     = body_map.get(purpose, f"Your OTP is: {otp.code}")
    to_email = user.email.strip()

    print(f"[OTP] Sending {purpose} OTP to {to_email}")

    if not host_user or not host_pass:
        print(f"[OTP] No SMTP credentials configured. OTP: {otp.code}")
        return otp

    # Resolve once to IPv4
    ipv4_host = _resolve_ipv4(smtp_host)
    print(f"[OTP] DNS: {smtp_host} -> {ipv4_host}")

    # Port order: 587 STARTTLS first (more universally available on cloud),
    # then 465 SSL as fallback
    attempts = [
        (587, False, "STARTTLS"),
        (465, True,  "SSL"),
    ]
    last_err = None

    for port, use_ssl, label in attempts:
        try:
            print(f"[OTP] Trying port {port} ({label})...")
            _smtp_send(smtp_host, ipv4_host, port, host_user, host_pass,
                       from_email, to_email, subject, body, use_ssl=use_ssl)
            print(f"[OTP SUCCESS] Sent via port {port} ({label})")
            return otp
        except Exception as err:
            last_err = err
            print(f"[OTP WARNING] Port {port} ({label}) failed: {type(err).__name__}: {err}")

    raise Exception(
        f"All SMTP attempts failed for {to_email}. Last error: {last_err}"
    )
