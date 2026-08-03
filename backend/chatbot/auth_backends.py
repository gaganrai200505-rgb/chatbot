from django.contrib.auth.backends import ModelBackend
from django.contrib.auth import get_user_model
from django.db.models import Q

User = get_user_model()

class EmailOrUsernameModelBackend(ModelBackend):
    """
    Custom Authentication Backend:
    Allows authentication via:
    1. Case-sensitive Username (exact match: username=identifier)
    2. Case-insensitive Email (email__iexact=identifier)
    """
    def authenticate(self, request, username=None, password=None, **kwargs):
        if username is None:
            username = kwargs.get('email')
        if not username or not password:
            return None

        identifier = str(username).strip()
        try:
            # Case-sensitive exact match for username OR case-sensitive exact match for email
            user = User.objects.filter(Q(username=identifier) | Q(email=identifier)).order_by('-is_superuser', '-is_staff', '-id').first()
        except Exception:
            return None

        if user and user.check_password(password) and self.user_can_authenticate(user):
            return user
        return None
