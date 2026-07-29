import React, { useState } from 'react';
import { checkEligibility } from './api';

const CloseIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18"/>
    <line x1="6" y1="6" x2="18" y2="18"/>
  </svg>
);

const TargetIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"/>
    <circle cx="12" cy="12" r="6"/>
    <circle cx="12" cy="12" r="2"/>
  </svg>
);

const STATES = [
  'All India / Central', 'Andhra Pradesh', 'Assam', 'Bihar', 'Delhi', 
  'Gujarat', 'Haryana', 'Karnataka', 'Kerala', 'Madhya Pradesh', 
  'Maharashtra', 'Odisha', 'Punjab', 'Rajasthan', 'Tamil Nadu', 
  'Telangana', 'Uttar Pradesh', 'West Bengal'
];

const OCCUPATIONS = [
  'Senior Citizen (60+)', 'Small / Marginal Farmer', 'Student', 
  'Unemployed Youth', 'Micro / Small Business Owner', 'Disabled Person (PwD)', 
  'Homemaker / Women', 'Salaried / Private Employee', 'General Citizen'
];

const EligibilityModal = ({ isOpen, onClose }) => {
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState(null);

  const [formData, setFormData] = useState({
    age: '45',
    income_lakhs: '3.5',
    state: 'Karnataka',
    category: 'General',
    occupation: 'Small / Marginal Farmer',
    is_taxpayer: false,
  });

  if (!isOpen) return null;

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value,
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setResults(null);

    try {
      const data = await checkEligibility(formData);
      setResults(data.results || []);
      setStep(5); // Show results view
    } catch (err) {
      alert("Failed to evaluate eligibility. Please check server logs.");
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setStep(1);
    setResults(null);
  };

  const eligibleSchemes = results?.filter((r) => r.eligible) || [];
  const ineligibleSchemes = results?.filter((r) => !r.eligible) || [];

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        {/* Modal Header */}
        <div className="modal-header">
          <div className="modal-title-group">
            <div className="modal-icon">
              <TargetIcon />
            </div>
            <div>
              <h3 className="modal-title">Scheme Eligibility Wizard</h3>
              <p className="modal-subtitle">Find all Indian Government schemes you qualify for</p>
            </div>
          </div>
          <button className="modal-close-btn" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>

        {/* Wizard Form Content */}
        {step <= 4 && (
          <form onSubmit={handleSubmit} className="wizard-form">
            {/* Step Indicators */}
            <div className="wizard-steps">
              {[1, 2, 3, 4].map((s) => (
                <div
                  key={s}
                  className={`step-dot ${step === s ? 'active' : ''} ${step > s ? 'completed' : ''}`}
                  onClick={() => setStep(s)}
                >
                  {s}
                </div>
              ))}
            </div>

            {/* Step 1: Age & Income */}
            {step === 1 && (
              <div className="wizard-step-content">
                <h4>Step 1: Age & Income</h4>
                <div className="form-group">
                  <label>Age (years)</label>
                  <input
                    type="number"
                    name="age"
                    min="1"
                    max="120"
                    value={formData.age}
                    onChange={handleChange}
                    required
                  />
                </div>

                <div className="form-group">
                  <label>Annual Family Income (₹ Lakhs / year)</label>
                  <input
                    type="number"
                    step="0.5"
                    name="income_lakhs"
                    min="0"
                    max="100"
                    value={formData.income_lakhs}
                    onChange={handleChange}
                    required
                  />
                  <small className="help-text">e.g. 2.5 for ₹2.5 Lakh per year</small>
                </div>
              </div>
            )}

            {/* Step 2: State & Social Category */}
            {step === 2 && (
              <div className="wizard-step-content">
                <h4>Step 2: Location & Social Category</h4>
                <div className="form-group">
                  <label>State / Union Territory</label>
                  <select name="state" value={formData.state} onChange={handleChange}>
                    {STATES.map((st) => (
                      <option key={st} value={st}>{st}</option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label>Social Category</label>
                  <select name="category" value={formData.category} onChange={handleChange}>
                    <option value="General">General</option>
                    <option value="OBC">OBC (Other Backward Classes)</option>
                    <option value="SC">SC (Scheduled Caste)</option>
                    <option value="ST">ST (Scheduled Tribe)</option>
                    <option value="Minority">Minority Community</option>
                  </select>
                </div>
              </div>
            )}

            {/* Step 3: Occupation & Status */}
            {step === 3 && (
              <div className="wizard-step-content">
                <h4>Step 3: Occupation & Status</h4>
                <div className="form-group">
                  <label>Primary Occupation / Status</label>
                  <select name="occupation" value={formData.occupation} onChange={handleChange}>
                    {OCCUPATIONS.map((occ) => (
                      <option key={occ} value={occ}>{occ}</option>
                    ))}
                  </select>
                </div>

                <div className="form-group checkbox-group">
                  <label>
                    <input
                      type="checkbox"
                      name="is_taxpayer"
                      checked={formData.is_taxpayer}
                      onChange={handleChange}
                    />
                    Are you or any family member an Income Taxpayer?
                  </label>
                </div>
              </div>
            )}

            {/* Step 4: Summary & Confirm */}
            {step === 4 && (
              <div className="wizard-step-content">
                <h4>Step 4: Confirm Your Details</h4>
                <div className="summary-box">
                  <p><strong>Age:</strong> {formData.age} years</p>
                  <p><strong>Annual Income:</strong> ₹{formData.income_lakhs} Lakh / year</p>
                  <p><strong>State:</strong> {formData.state}</p>
                  <p><strong>Category:</strong> {formData.category}</p>
                  <p><strong>Occupation:</strong> {formData.occupation}</p>
                  <p><strong>Income Taxpayer:</strong> {formData.is_taxpayer ? 'Yes' : 'No'}</p>
                </div>
              </div>
            )}

            {/* Navigation buttons */}
            <div className="wizard-actions">
              {step > 1 && (
                <button type="button" className="btn-secondary" onClick={() => setStep(step - 1)}>
                  Back
                </button>
              )}

              {step < 4 ? (
                <button type="button" className="btn-primary" onClick={() => setStep(step + 1)}>
                  Next Step →
                </button>
              ) : (
                <button type="submit" className="btn-primary evaluate-btn" disabled={loading}>
                  {loading ? 'Evaluating Eligibility...' : 'Find Eligible Schemes 🚀'}
                </button>
              )}
            </div>
          </form>
        )}

        {/* Loading Spinner */}
        {loading && (
          <div className="wizard-loading">
            <div className="spinner" />
            <p>Evaluating schemes against official Government rules...</p>
          </div>
        )}

        {/* Results Screen */}
        {step === 5 && results && !loading && (
          <div className="wizard-results">
            <div className="results-summary-badge">
              Found <strong>{eligibleSchemes.length}</strong> matching scheme(s) you qualify for!
            </div>

            {/* Eligible Schemes Grid */}
            <div className="results-section">
              <h4 className="results-heading eligible">🎉 Schemes You Qualify For ({eligibleSchemes.length})</h4>
              {eligibleSchemes.length === 0 ? (
                <p className="no-matches">No direct matches found. Try adjusting your income or category details.</p>
              ) : (
                <div className="schemes-grid">
                  {eligibleSchemes.map((s, idx) => (
                    <div key={idx} className="scheme-card eligible">
                      <div className="scheme-card-header">
                        <h5>{s.title}</h5>
                        <span className="badge-eligible">Qualified</span>
                      </div>
                      <p className="scheme-benefit">💡 <strong>Benefit:</strong> {s.key_benefit}</p>
                      <p className="scheme-reason">✅ {s.reason}</p>
                      {s.portal_url && s.portal_url !== 'Unknown' && (
                        <a
                          href={s.portal_url.startsWith('http') ? s.portal_url : `https://${s.portal_url}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="portal-link-btn"
                        >
                          Apply on Official Portal ↗
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Ineligible Schemes List */}
            {ineligibleSchemes.length > 0 && (
              <div className="results-section">
                <h4 className="results-heading ineligible">ℹ️ Other Schemes Evaluated ({ineligibleSchemes.length})</h4>
                <div className="schemes-grid ineligible">
                  {ineligibleSchemes.map((s, idx) => (
                    <div key={idx} className="scheme-card ineligible">
                      <h5>{s.title}</h5>
                      <p className="scheme-reason">⚠️ {s.reason}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="wizard-actions">
              <button className="btn-secondary" onClick={resetForm}>
                🔄 Recalculate
              </button>
              <button className="btn-primary" onClick={onClose}>
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default EligibilityModal;
