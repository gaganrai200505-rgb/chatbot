"""
embeddings.py — FAISS Vector Index Builder
===========================================

This module:
1. Defines the government scheme knowledge base (text data)
2. Converts each scheme description into a vector using Sentence Transformers
3. Stores all vectors in a FAISS index for fast similarity search

HOW IT WORKS (for beginners):
- Sentence Transformers turn text into numbers (vectors/embeddings)
- FAISS can quickly find which stored vector is most similar to a query vector
- This allows us to find relevant schemes even if the user's words differ from stored text
"""

import numpy as np

class NumpyIndexFlatIP:
    def __init__(self, d):
        self.d = d
        self.vectors = None
        self.ntotal = 0

    def add(self, embeddings):
        if self.vectors is None:
            self.vectors = embeddings
        else:
            self.vectors = np.vstack((self.vectors, embeddings))
        self.ntotal = self.vectors.shape[0]

    def search(self, query, k=1):
        if self.ntotal == 0:
            return np.array([[]]), np.array([[]])
        
        # Calculate dot products (cosine similarity since vectors are L2-normalized)
        scores = np.dot(query, self.vectors.T)
        
        # Get top k indices for each query
        top_k_indices = np.argsort(scores, axis=1)[:, ::-1][:, :k]
        
        # Get top k scores
        top_k_scores = np.take_along_axis(scores, top_k_indices, axis=1)
        
        return top_k_scores, top_k_indices

def normalize_L2(x):
    norms = np.linalg.norm(x, axis=1, keepdims=True)
    norms[norms == 0] = 1e-10
    x /= norms


# -------------------------------------------------------
# Government Scheme Knowledge Base
# -------------------------------------------------------
# Each entry is a dictionary with:
#   - "title":       Short name of the scheme
#   - "description": Full description (used for embedding)
#   - "details":     Extra info returned to the user in the response

SCHEME_KNOWLEDGE_BASE = [
    {
        "title": "PM Kisan Samman Nidhi",
        "description": (
            "PM Kisan Samman Nidhi is a Central Government scheme that provides "
            "financial support of Rs 6000 per year to small and marginal farmers. "
            "It is given in 3 installments of Rs 2000 directly to the farmer's bank account. "
            "Eligibility: Indian farmers with cultivable land up to 2 hectares. "
            "Apply online at [Apply on PM Kisan Portal](https://pmkisan.gov.in) or nearest Common Service Centre (CSC)."
        ),
        "details": {
            "benefit": "₹6,000/year (3 installments of ₹2,000)",
            "eligibility": "Small & marginal farmers with ≤2 hectares land",
            "apply": "[Apply on PM Kisan Portal](https://pmkisan.gov.in) or nearest CSC",
            "ministry": "Ministry of Agriculture & Farmers Welfare",
        },
    },
    {
        "title": "SSP Scholarship (State Scholarship Portal)",
        "description": (
            "SSP Scholarship is a Karnataka government scholarship for students from "
            "SC, ST, OBC, and minority communities. It covers pre-matric and post-matric "
            "scholarship amounts for school and college students. "
            "Students must apply through the SSP Karnataka portal: [Apply on SSP Karnataka Portal](https://ssp.karnataka.gov.in). "
            "Documents needed: Aadhaar, caste certificate, income certificate, bank passbook."
        ),
        "details": {
            "benefit": "Tuition fees + maintenance allowance",
            "eligibility": "SC/ST/OBC/Minority students in Karnataka",
            "apply": "[Apply on SSP Karnataka Portal](https://ssp.karnataka.gov.in)",
            "ministry": "Karnataka Social Welfare Department",
        },
    },
    {
        "title": "Ayushman Bharat PM-JAY",
        "description": (
            "Ayushman Bharat Pradhan Mantri Jan Arogya Yojana (PM-JAY) is the world's "
            "largest government-funded health insurance scheme. It provides health cover "
            "of Rs 5 lakh per family per year for secondary and tertiary care hospitalization. "
            "Coverage includes 1,929 medical procedures. Eligibility based on SECC 2011 database. "
            "Check eligibility and apply at [Apply on PMJAY Portal](https://beneficiary.nha.gov.in) or call helpline 14555."
        ),
        "details": {
            "benefit": "₹5 lakh/year health insurance per family",
            "eligibility": "Poor & vulnerable families based on SECC 2011",
            "apply": "[Apply on PMJAY Portal](https://beneficiary.nha.gov.in) | Helpline: 14555",
            "ministry": "Ministry of Health & Family Welfare",
        },
    },
    {
        "title": "PM Awas Yojana (Housing for All)",
        "description": (
            "Pradhan Mantri Awas Yojana (PMAY) is a housing scheme by the Indian government "
            "to provide affordable housing to the urban and rural poor. "
            "Urban: PMAY-U provides subsidy on home loans up to Rs 2.67 lakh for EWS/LIG/MIG categories. "
            "Rural: PMAY-G provides Rs 1.2 lakh (plain areas) or Rs 1.3 lakh (hilly areas) for house construction. "
            "Apply online at [Apply on PMAY Portal](https://pmaymis.gov.in) or through your local Gram Panchayat or Urban Local Body."
        ),
        "details": {
            "benefit": "Home loan subsidy up to ₹2.67 lakh (Urban) | ₹1.2-1.3 lakh (Rural)",
            "eligibility": "EWS/LIG/MIG families without pucca house",
            "apply": "[Apply on PMAY Portal](https://pmaymis.gov.in) | Gram Panchayat / ULB",
            "ministry": "Ministry of Housing & Urban Affairs",
        },
    },
    {
        "title": "Ration Card (National Food Security Act - NFSA)",
        "description": (
            "Ration Card under the National Food Security Act (NFSA) entitles beneficiaries "
            "to subsidized food grains from Fair Price Shops (FPS). "
            "Priority Household (PHH): 5 kg of food grains per person per month at subsidized rates. "
            "Antyodaya Anna Yojana (AAY): 35 kg per family per month for the poorest of the poor. "
            "Apply online through [National Food Security Portal](https://nfsa.gov.in). "
            "In Karnataka, apply at [Apply on Ahara Portal](https://ahara.kar.nic.in). One Nation One Ration Card (ONORC) allows "
            "portability across states using Aadhaar."
        ),
        "details": {
            "benefit": "Subsidized rice, wheat at ₹2-3/kg",
            "eligibility": "BPL / low-income households",
            "apply": "[Apply on NFSA Portal](https://nfsa.gov.in) | [Apply on Ahara Portal](https://ahara.kar.nic.in) (Karnataka)",
            "ministry": "Ministry of Consumer Affairs, Food & Public Distribution",
        },
    },
    {
        "title": "Pradhan Mantri Mudra Yojana (PMMY)",
        "description": (
            "Pradhan Mantri Mudra Yojana provides loans up to Rs 10 lakh to non-corporate, "
            "non-farm small/micro enterprises. Three categories: "
            "Shishu (up to Rs 50,000), Kishor (Rs 50,001 to Rs 5 lakh), Tarun (Rs 5 lakh to Rs 10 lakh). "
            "No collateral required. Apply at any bank, MFI, or NBFC. "
            "Scheme supports small businesses, artisans, shopkeepers, and street vendors."
        ),
        "details": {
            "benefit": "Loans up to ₹10 lakh without collateral",
            "eligibility": "Small/micro enterprises, artisans, shopkeepers",
            "apply": "Any nationalized bank, MFI, or NBFC",
            "ministry": "Ministry of Finance / MUDRA Bank",
        },
    },
    {
        "title": "Sukanya Samriddhi Yojana (SSY)",
        "description": (
            "Sukanya Samriddhi Yojana is a government savings scheme for the girl child. "
            "Parents/guardians can open an account for a girl aged below 10 years. "
            "Current interest rate: 8.2% per annum. Minimum deposit: Rs 250/year. Maximum: Rs 1.5 lakh/year. "
            "Tax benefits under Section 80C. Maturity after 21 years from account opening. "
            "Account can be opened at Post Offices and authorized banks."
        ),
        "details": {
            "benefit": "8.2% interest pa | Tax-free maturity corpus",
            "eligibility": "Girl child below 10 years",
            "apply": "Post Office or authorized banks",
            "ministry": "Ministry of Finance",
        },
    },
    {
        "title": "Pradhan Mantri Jan Dhan Yojana (PMJDY)",
        "description": (
            "Pradhan Mantri Jan Dhan Yojana is a National Mission for Financial Inclusion "
            "to ensure access to financial services namely Basic Savings Bank Account, "
            "remittance, credit, insurance, pension in an affordable manner. "
            "Benefits include zero balance account, free RuPay debit card, Rs 2 lakh accidental insurance, "
            "and overdraft facility up to Rs 10,000. "
            "Apply at any bank branch or Bank Mitra kiosk. "
            "Documents needed: Aadhaar Card, Passport size photos, or any Officially Valid Document (OVD)."
        ),
        "details": {
            "benefit": "Zero balance savings account + ₹2 Lakh accidental insurance + ₹10,000 overdraft",
            "eligibility": "Any Indian citizen aged 10 years and above",
            "apply": "Any nationalized/private bank branch or Bank Mitra kiosk",
            "ministry": "Ministry of Finance",
        },
    },
]

# -------------------------------------------------------
# Build FAISS Index from Knowledge Base
# -------------------------------------------------------

# Lazy-load the model (downloaded on first run, ~90MB)
_model = None
_index = None
_descriptions = []
_schemes = []

def get_model():
    """Load HashingVectorizer model to simulate embeddings (bypasses hang)."""
    global _model
    if _model is None:
        print("[Embeddings] Loading HashingVectorizer model to bypass torch hang...")
        from sklearn.feature_extraction.text import HashingVectorizer
        class DummyModel:
            def __init__(self):
                self.vectorizer = HashingVectorizer(n_features=384, alternate_sign=False)
                
            def encode(self, texts, convert_to_numpy=True):
                if isinstance(texts, str):
                    texts = [texts]
                return self.vectorizer.transform(texts).toarray().astype(np.float32)
        _model = DummyModel()
        print("[Embeddings] HashingVectorizer Model loaded successfully.")
    return _model

def seed_db():
    from .models import GovernmentScheme
    print("[Embeddings] Seeding DB with default knowledge base...")
    for item in SCHEME_KNOWLEDGE_BASE:
        # format details mapping back into a markdown string
        d = item.get("details", {})
        details_str = "\n".join([f"- **{str(k).capitalize()}**: {v}" for k, v in d.items()])
        GovernmentScheme.objects.get_or_create(
            title=item["title"],
            defaults={
                "description": item["description"],
                "details": details_str
            }
        )
    print("[Embeddings] Seeding complete.")

def build_faiss_index(force_rebuild=False):
    """
    Build a FAISS index from the database model GovernmentScheme.
    """
    global _index, _descriptions, _schemes

    if _index is not None and not force_rebuild:
        return _index, _schemes

    model = get_model()

    # Local import to prevent AppRegistryNotReady circular errors
    from .models import GovernmentScheme
    db_schemes = list(GovernmentScheme.objects.all())

    if not db_schemes:
        seed_db()
        db_schemes = list(GovernmentScheme.objects.all())

    _schemes = [
        {
            "title": s.title,
            "description": s.description,
            "details": s.details
        } for s in db_schemes
    ]

    # Embed a combination of title, description, and the first chunk of details 
    # to ensure words inside the PDF are caught by the FAISS vector search.
    _descriptions = [f"{s['title']} {s['description']} {s['details'][:1000]}" for s in _schemes]

    print(f"[Embeddings] Building NumPy vector index for {len(_descriptions)} schemes...")

    # If DB is still somehow totally empty
    if not _descriptions:
        _index = NumpyIndexFlatIP(384)
        return _index, _schemes

    embeddings = model.encode(_descriptions, convert_to_numpy=True)
    normalize_L2(embeddings)

    dimension = embeddings.shape[1]
    _index = NumpyIndexFlatIP(dimension)
    _index.add(embeddings.astype(np.float32))

    print(f"[Embeddings] Vector index built with {_index.ntotal} vectors.")
    return _index, _schemes


_query_embedding_cache = {}

def encode_query(query_text: str) -> np.ndarray:
    """
    Convert a query string to a normalized embedding vector with in-memory caching.
    """
    clean_q = query_text.strip().lower()
    if clean_q in _query_embedding_cache:
        return _query_embedding_cache[clean_q]

    model = get_model()
    embedding = model.encode([query_text], convert_to_numpy=True)
    normalize_L2(embedding)
    result = embedding.astype(np.float32)

    if len(_query_embedding_cache) < 256:
        _query_embedding_cache[clean_q] = result

    return result
