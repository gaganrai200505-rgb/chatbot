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
