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

        # Auto-ensure superuser credentials & clean up duplicate email accounts on live deployment & startup
        try:
            from django.contrib.auth import get_user_model
            User = get_user_model()
            admin_email = 'gaganrai2005.05@gmail.com'
            admin_user, created = User.objects.get_or_create(username='admin', defaults={'email': admin_email})
            admin_user.email = admin_email
            admin_user.set_password('admin123!')
            admin_user.is_staff = True
            admin_user.is_superuser = True
            admin_user.is_active = True
            admin_user.save()

            # Remove any duplicate accounts with the same email except the primary 'admin' account
            User.objects.filter(email__iexact=admin_email).exclude(username='admin').delete()
            print(f"[AutoAdmin] Verified live superuser 'admin' with email '{admin_email}' & cleaned duplicate accounts ✓")
        except Exception as e:
            print(f"[AutoAdmin Warning] Could not auto-create admin on startup: {e}")

        # Auto-seed all 30 government schemes if database is empty on live deployment
        try:
            if GovernmentScheme.objects.count() < 30:
                import json
                from django.conf import settings
                seed_path = settings.BASE_DIR / 'schemes_seed.json'
                if seed_path.exists():
                    with open(seed_path, 'r', encoding='utf-8') as f:
                        data = json.load(f)
                    created_count = 0
                    for item in data:
                        obj, created = GovernmentScheme.objects.get_or_create(
                            title=item['title'],
                            defaults={
                                'description': item.get('description', ''),
                                'details': item.get('details', ''),
                                'application_deadline': item.get('application_deadline', 'Ongoing / Open'),
                                'is_active': item.get('is_active', True)
                            }
                        )
                        if created:
                            created_count += 1
                    print(f"[AutoSeed] Populated {created_count} missing government schemes into live DB (Total: {GovernmentScheme.objects.count()}) ✓")
        except Exception as seed_err:
            print(f"[AutoSeed Warning] {seed_err}")
