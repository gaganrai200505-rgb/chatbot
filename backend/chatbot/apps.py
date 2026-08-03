from django.apps import AppConfig

class ChatbotConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "chatbot"

    def ready(self):
        from django.db.models.signals import post_save, post_delete
        from .models import GovernmentScheme
        from .embeddings import build_faiss_index

        def rebuild_index(sender, **kwargs):
            print("[Signals] Database changed! Rebuilding FAISS index in background...")
            build_faiss_index(force_rebuild=True)

        post_save.connect(rebuild_index, sender=GovernmentScheme)
        post_delete.connect(rebuild_index, sender=GovernmentScheme)

        # Auto-ensure superuser credentials on live deployment & startup
        try:
            from django.contrib.auth import get_user_model
            User = get_user_model()
            admin_user, created = User.objects.get_or_create(username='admin', defaults={'email': 'gaganrai2005.05@gmail.com'})
            admin_user.email = 'gaganrai2005.05@gmail.com'
            admin_user.set_password('admin123!')
            admin_user.is_staff = True
            admin_user.is_superuser = True
            admin_user.is_active = True
            admin_user.save()
            print("[AutoAdmin] Verified live superuser 'admin' with email 'gaganrai2005.05@gmail.com' on startup ✓")
        except Exception as e:
            print(f"[AutoAdmin Warning] Could not auto-create admin on startup: {e}")
