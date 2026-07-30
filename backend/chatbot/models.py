from django.db import models
from django.contrib.auth.models import User

class ChatMessage(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='messages')
    session_id = models.CharField(max_length=100, db_index=True, default='', blank=True)
    session_title = models.CharField(max_length=255, default='', blank=True)
    is_pinned = models.BooleanField(default=False)
    query = models.TextField()
    response = models.TextField()
    language = models.CharField(max_length=10, default='en')
    source = models.CharField(max_length=50, blank=True, null=True)
    timestamp = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.user.username} - {self.query[:30]}"

    class Meta:
        ordering = ['timestamp']

class GovernmentScheme(models.Model):
    title = models.CharField(max_length=255, unique=True)
    description = models.TextField(help_text="Provide a detailed paragraph. This is embedded into FAISS for vector matching.")
    details = models.TextField(help_text="Provide extra info, eligibility, benefits, and how to apply. You can use markdown or plain text.", blank=True)
    pdf_document = models.FileField(upload_to='schemes/pdfs/', blank=True, null=True, help_text="Upload a PDF. Its text will be automatically extracted into the details box upon saving.")
    
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def save(self, *args, **kwargs):
        # Determine if we have a fresh PDF upload that needs extraction
        extract_now = False
        if self.pk is None and self.pdf_document:
            extract_now = True
        elif self.pk is not None and self.pdf_document:
            old = GovernmentScheme.objects.get(pk=self.pk)
            if old.pdf_document != self.pdf_document:
                extract_now = True
                
        # First, save normally so Django writes the uploaded PDF file securely to the media/ server disk
        super().save(*args, **kwargs)

        # Then, if we flagged it for extraction, open the saved file from disk, rip the text, and save the model a second time
        if extract_now and self.pdf_document:
            try:
                import PyPDF2
                
                # Ensure the file pointer is at the beginning
                self.pdf_document.open(mode='rb')
                pdf_reader = PyPDF2.PdfReader(self.pdf_document.file)
                extracted_text = "\n\n--- EXTRACTED FROM PDF ---\n\n"
                for page in pdf_reader.pages:
                    text = page.extract_text()
                    if text:
                        extracted_text += text + "\n"
                
                if extracted_text.strip():
                    self.details = (self.details + extracted_text).strip()
                    # Perform an update ONLY of the details field to avoid infinite loops
                    GovernmentScheme.objects.filter(pk=self.pk).update(details=self.details)
                
            except Exception as e:
                print(f"[PDF Extractor] Error parsing PDF: {e}")
            finally:
                self.pdf_document.close()

    def __str__(self):
        return self.title

    class Meta:
        ordering = ['title']


class OTPCode(models.Model):
    """
    Stores a one-time password for email verification or password reset.
    OTPs are 6-digit codes that expire after 10 minutes and are single-use.
    """
    PURPOSE_VERIFY   = 'verify'
    PURPOSE_RESET    = 'reset'
    PURPOSE_CHOICES  = [(PURPOSE_VERIFY, 'Email Verification'), (PURPOSE_RESET, 'Password Reset')]

    user        = models.ForeignKey(User, on_delete=models.CASCADE, related_name='otps')
    code        = models.CharField(max_length=6)
    purpose     = models.CharField(max_length=10, choices=PURPOSE_CHOICES, default=PURPOSE_VERIFY)
    is_used     = models.BooleanField(default=False)
    created_at  = models.DateTimeField(auto_now_add=True)

    def is_expired(self):
        from django.utils import timezone
        from datetime import timedelta
        return timezone.now() > self.created_at + timedelta(minutes=10)

    def __str__(self):
        return f"{self.user.username} — {self.purpose} OTP ({self.code})"
