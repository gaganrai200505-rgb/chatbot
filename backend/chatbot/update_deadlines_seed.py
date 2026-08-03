import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
import django
django.setup()

from chatbot.models import GovernmentScheme

SCHEME_DEADLINES = {
    "PM Kisan Samman Nidhi": {
        "deadline": "Ongoing (New Registrations Open Year-Round / eKYC Mandatory)",
        "is_active": True,
    },
    "SSP Scholarship (State Scholarship Portal)": {
        "deadline": "31 October 2026 (Post-Matric & Pre-Matric Applications Active)",
        "is_active": True,
    },
    "Ayushman Bharat PM-JAY": {
        "deadline": "Ongoing / No Expiry (Instant Ayushman Card Generation Open)",
        "is_active": True,
    },
    "PM Awas Yojana (Housing for All)": {
        "deadline": "31 December 2026 (Extended under PMAY Urban 2.0 & Rural Phase 2)",
        "is_active": True,
    },
    "Ration Card (National Food Security Act - NFSA)": {
        "deadline": "Ongoing (Aadhaar Seeding & Ration Card Renewal Active)",
        "is_active": True,
    },
    "Pradhan Mantri Mudra Yojana (PMMY)": {
        "deadline": "Ongoing Year-Round (Applications accepted at Bank Branches & JanSamarth Portal)",
        "is_active": True,
    },
    "Sukanya Samriddhi Yojana (SSY)": {
        "deadline": "Ongoing (Accounts can be opened at Post Office/Bank anytime for girls <10 yrs)",
        "is_active": True,
    },
    "Pradhan Mantri Jan Dhan Yojana (PMJDY)": {
        "deadline": "Ongoing Year-Round (Open Zero Balance Bank Account Anytime)",
        "is_active": True,
    },
}

def update_deadlines():
    print("Updating scheme application deadlines in SQLite DB...")
    updated_count = 0
    for scheme in GovernmentScheme.objects.all():
        data = SCHEME_DEADLINES.get(scheme.title)
        if data:
            scheme.application_deadline = data["deadline"]
            scheme.is_active = data["is_active"]
        else:
            if not scheme.application_deadline or scheme.application_deadline == "Ongoing / Open":
                scheme.application_deadline = "Ongoing / Check Official Portal for Phase Updates"
            scheme.is_active = True
        scheme.save()
        updated_count += 1
        print(f"✓ Updated [{scheme.title}] -> Deadline: '{scheme.application_deadline}'")

    print(f"\nSuccessfully updated {updated_count} schemes with up-to-date deadline metadata!")

if __name__ == "__main__":
    update_deadlines()
