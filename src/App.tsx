  import React, { useState, useEffect, useRef, useCallback } from 'react';
  import { GoogleGenAI, Type } from "@google/genai";
  import { 
    auth, db, googleProvider, signInWithPopup, signOut, onAuthStateChanged, 
    doc, setDoc, getDoc, collection, query, where, onSnapshot, addDoc, updateDoc, deleteDoc, serverTimestamp,
    handleFirestoreError, OperationType 
  } from './firebase';

  // Initialize Gemini AI
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  // Groq Configuration (Fallback)
  const GROQ_CONFIG = {
  apiKey: import.meta.env.VITE_GROQ_API_KEY,
  model: "llama-3.3-70b-versatile",
  endpoint: "https://api.groq.com/openai/v1/chat/completions"
};
  /**
   * Helper to call AI with Gemini-to-Groq fallback
   */
  async function callAI(params: any): Promise<{ text: string }> {
    try {
      const response = await ai.models.generateContent(params);
      return { text: response.text || '' };
    } catch (error: any) {
      const errorMsg = error?.message?.toLowerCase() || '';
      const isQuota = errorMsg.includes('quota') || errorMsg.includes('429') || errorMsg.includes('limit') || errorMsg.includes('exhausted');
      
      if (isQuota) {
        console.warn('Gemini quota exceeded, falling back to Groq via Fetch...');
        try {
          let prompt = '';
          if (typeof params.contents === 'string') {
            prompt = params.contents;
          } else if (Array.isArray(params.contents)) {
            prompt = params.contents.map((c: any) => {
              if (typeof c === 'string') return c;
              if (c.parts) return c.parts.map((p: any) => p.text || '').join(' ');
              return JSON.stringify(c);
            }).join('\n');
          } else if (params.contents?.parts) {
            prompt = params.contents.parts.map((p: any) => p.text || '').join('\n');
          } else {
            prompt = JSON.stringify(params.contents);
          }

          // If JSON is requested, append the schema to the prompt for Groq
          if (params.config?.responseMimeType === 'application/json' && params.config?.responseSchema) {
            prompt += `\n\nIMPORTANT: You MUST return a valid JSON object strictly following this schema: ${JSON.stringify(params.config.responseSchema)}. Do not include any other text or markdown formatting outside the JSON.`;
          }

          const response = await fetch(GROQ_CONFIG.endpoint, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${GROQ_CONFIG.apiKey}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              messages: [
                { role: 'system', content: 'You are a professional resume expert and data extractor. Always provide high-quality, accurate, and concise information.' },
                { role: 'user', content: prompt }
              ],
              model: GROQ_CONFIG.model,
              temperature: 0.1, // Lower temperature for more consistent JSON
              response_format: params.config?.responseMimeType === 'application/json' ? { type: 'json_object' } : undefined,
            })
          });

          if (!response.ok) {
            const errData = await response.json();
            throw new Error(errData.error?.message || 'Groq API error');
          }

          const data = await response.json();
          return { text: data.choices[0]?.message?.content || '' };
        } catch (groqErr) {
          console.error('Groq fallback failed:', groqErr);
          throw error;
        }
      }
      throw error;
    }
  }

  // Constants from original HTML
  const ACTION_VERBS = ['Achieved','Architected','Built','Collaborated','Delivered','Designed','Developed','Drove','Enhanced','Established','Executed','Generated','Grew','Implemented','Improved','Increased','Initiated','Launched','Led','Managed','Mentored','Negotiated','Optimized','Orchestrated','Pioneered','Produced','Reduced','Resolved','Scaled','Shipped','Spearheaded','Streamlined','Transformed','Unified','Upgraded'];
  const PAGE_DIMS = { a4:{w:794,h:1123}, letter:{w:816,h:1056} };
  const DEFAULT_SECTION_ORDER = ['summary','experience','internships','education','skills','languages','certifications','projects','awards','volunteer','publications','conferences','interests','references','extracurricular'];

  const TEMPLATES = [
    {name:'Modern Minimal',style:'t1',palette:['#2563eb','#f8fafc'],badge:''},
    {name:'Bold Side',style:'t2',palette:['#7c3aed','#1e293b'],badge:'✦ HOT'},
    {name:'Executive',style:'t3',palette:['#1e293b','#f8fafc'],badge:''},
    {name:'Creative Split',style:'t4',palette:['#059669','#ecfdf5'],badge:'NEW'},
    {name:'Tech Dark',style:'t1',palette:['#0891b2','#0f172a'],badge:''},
    {name:'Rose Gold',style:'t2',palette:['#be185d','#fff1f2'],badge:''},
    {name:'Amber Pro',style:'t4',palette:['#d97706','#fffbeb'],badge:''},
    {name:'Navy Classic',style:'t3',palette:['#1e40af','#eff6ff'],badge:''},
    {name:'Forest',style:'t1',palette:['#065f46','#ecfdf5'],badge:''},
    {name:'Crimson',style:'t2',palette:['#991b1b','#fef2f2'],badge:''},
    {name:'Slate',style:'t3',palette:['#334155','#f1f5f9'],badge:''},
    {name:'Indigo Clean',style:'t4',palette:['#4338ca','#eef2ff'],badge:''},
    {name:'Teal Flow',style:'t1',palette:['#0d9488','#f0fdfa'],badge:''},
    {name:'Graphite',style:'t2',palette:['#374151','#111827'],badge:''},
    {name:'Coral',style:'t4',palette:['#e11d48','#fff1f2'],badge:'NEW'},
    {name:'Sky Blue',style:'t1',palette:['#0284c7','#f0f9ff'],badge:''},
    {name:'Violet Night',style:'t2',palette:['#6d28d9','#0f0a1a'],badge:'✦'},
    {name:'Sand',style:'t3',palette:['#92400e','#fffbeb'],badge:''},
    {name:'Mint',style:'t1',palette:['#047857','#ecfdf5'],badge:''},
    {name:'Dark Minimal',style:'t3',palette:['#e5e7eb','#111827'],badge:''},
    {name:'Burgundy',style:'t4',palette:['#9f1239','#fff1f2'],badge:''},
    {name:'Ocean',style:'t2',palette:['#0369a1','#082f49'],badge:''},
    {name:'Warm Grey',style:'t1',palette:['#6b7280','#f9fafb'],badge:''},
    {name:'Plum',style:'t4',palette:['#7e22ce','#faf5ff'],badge:''},
    {name:'Emerald Dark',style:'t2',palette:['#10b981','#064e3b'],badge:'NEW'},
    {name:'Classic Black',style:'t3',palette:['#111827','#f9fafb'],badge:''},
    {name:'Copper',style:'t1',palette:['#b45309','#fef3c7'],badge:''},
    {name:'Ice',style:'t4',palette:['#38bdf8','#f0f9ff'],badge:''},
    {name:'Monochrome',style:'t3',palette:['#4b5563','#f3f4f6'],badge:''},
    {name:'Gold Rush',style:'t2',palette:['#b45309','#1c1209'],badge:'✦ PRO'},
    {name:'Cyberpunk',style:'t5',palette:['#f0ab00','#000000'],badge:'ULTRA'},
    {name:'Swiss Grid',style:'t6',palette:['#ff0000','#ffffff'],badge:'DESIGN'},
    {name:'Brutalist',style:'t7',palette:['#0000ff','#ffffff'],badge:'BOLD'},
    {name:'Minimalist Sidebar',style:'t1',palette:['#1e293b','#ffffff'],badge:''},
    {name:'Modern Serif',style:'t3',palette:['#111827','#f8fafc'],badge:''},
    {name:'Two Column Grid',style:'t4',palette:['#2563eb','#ffffff'],badge:''},
    {name:'Retro Terminal',style:'t8',palette:['#00ff00','#000000'],badge:'RETRO'},
    {name:'Magazine Style',style:'t9',palette:['#000000','#ffffff'],badge:'CHIC'},
    {name:'The Architect',style:'t10',palette:['#1e293b','#f1f5f9'],badge:'NEW'},
    {name:'Creative Bloom',style:'t11',palette:['#ec4899','#fff1f2'],badge:'NEW'},
    {name:'Data Scientist',style:'t12',palette:['#0ea5e9','#0f172a'],badge:'NEW'},
    {name:'Bento Grid',style:'t13',palette:['#6366f1','#ffffff'],badge:'MODERN'},
    {name:'Minimalist Serif',style:'t14',palette:['#111827','#ffffff'],badge:'ELEGANT'},
    {name:'Dark Mode Elite',style:'t15',palette:['#facc15','#000000'],badge:'PREMIUM'},
  ];

  const SEC_LABELS: Record<string, string> = {
    summary:'Summary',experience:'Work Experience',internships:'Internships',education:'Education',
    skills:'Skills',languages:'Languages',certifications:'Certifications',projects:'Projects',
    awards:'Awards / Achievements',volunteer:'Volunteer',publications:'Publications',
    conferences:'Conferences',interests:'Interests / Hobbies',references:'References',extracurricular:'Extracurricular'
  };

  export default function App() {
    // State
    const [state, setState] = useState<any>({
      template: 0, accentColor: '#2563eb', secondaryColor: '#f8fafc', fontColor: '#1a1a2e',
      photoData: null, skillMode: 'tags',
      skills: [], exp: [], edu: [], intern: [], lang: [], cert: [], proj: [],
      award: [], volunteer: [], pub: [], conf: [], ref: [], extra: [],
      profileLinks: [], customSections: [],
      sectionOrder: [...DEFAULT_SECTION_ORDER],
      sectionVisible: {},
      name: '', title: '', email: '', phone: '', location: '', web: '', summary: '', interests: '', qrUrl: '',
      font: "'DM Sans',sans-serif", fontWeight: '400', lineHeight: 1.5, fontSize: 100,
      sectionSpacing: 24, marginTop: 20, marginBottom: 20, marginLeft: 28, marginRight: 28,
      skillLayout: 'auto', langLayout: 'auto', autoHide: true,
      bulletStyle: 'disc', skillStyle: 'bar',
      headerStyle: 'none', photoShape: 'circle', dividerStyle: 'none', titleCase: 'uppercase',
      compactMode: false, showSectionIcons: false, showProfileIcons: true, showQRCode: false,
      sidebarPattern: 'none',
    });

    const [user, setUser] = useState<any>(null);
    const [userResumes, setUserResumes] = useState<any[]>([]);
    const [currentResumeId, setCurrentResumeId] = useState<string | null>(null);
    const [showAuthModal, setShowAuthModal] = useState(false);
    const [showResumesModal, setShowResumesModal] = useState(false);

    const [zoom, setZoom] = useState(0.8);
    const [pageSize, setPageSize] = useState('a4');
    const [activeTab, setActiveTab] = useState('content');
    const [viewMode, setViewMode] = useState('desktop');
    const [mobileTab, setMobileTab] = useState('edit');
    const [loading, setLoading] = useState({ show: false, text: '' });
    const [notif, setNotif] = useState({ show: false, text: '', err: false });
    const [aiOutput, setAiOutput] = useState({ show: false, title: '', text: '' });
    const [profilesModal, setProfilesModal] = useState(false);
    const [startModal, setStartModal] = useState(false);
    const [undoStack, setUndoStack] = useState<string[]>([]);
    const [redoStack, setRedoStack] = useState<string[]>([]);
    const [atsScore, setAtsScore] = useState<number | null>(null);
    const [atsIssues, setAtsIssues] = useState<string[]>([]);
    const [jobs, setJobs] = useState<any[]>([]);
    const [jobQuery, setJobQuery] = useState('');
    const [jobLocation, setJobLocation] = useState('');
    const [tone, setTone] = useState('Professional');

    const [interviewMode, setInterviewMode] = useState(false);
    const [interviewMessages, setInterviewMessages] = useState<any[]>([]);
    const [interviewInput, setInterviewInput] = useState('');
    const [isInterviewing, setIsInterviewing] = useState(false);
    const [landingPage, setLandingPage] = useState('home'); // home, about, privacy

    const cvPreviewRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const photoInputRef = useRef<HTMLInputElement>(null);
    const sectionOrderRef = useRef<HTMLDivElement>(null);

    // Initialize
    useEffect(() => {
      const unsubscribe = onAuthStateChanged(auth, (u) => {
        setUser(u);
        if (u) {
          // Load user resumes
          const q = query(collection(db, 'resumes'), where('uid', '==', u.uid));
          const unsubResumes = onSnapshot(q, (snapshot) => {
            const list = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setUserResumes(list);
          }, (err) => handleFirestoreError(err, OperationType.LIST, 'resumes'));
          
          // Sync user profile
          setDoc(doc(db, 'users', u.uid), {
            uid: u.uid,
            email: u.email,
            displayName: u.displayName,
            photoURL: u.photoURL,
            updatedAt: serverTimestamp()
          }, { merge: true }).catch(err => handleFirestoreError(err, OperationType.WRITE, `users/${u.uid}`));

          return () => unsubResumes();
        } else {
          setUserResumes([]);
          setCurrentResumeId(null);
        }
      });

      const saved = localStorage.getItem('bmr_draft');
      if (saved) {
        try {
          const d = JSON.parse(saved);
          setState((prev: any) => ({ ...prev, ...d }));
        } catch (e) {
          setStartModal(true);
        }
      } else {
        setStartModal(true);
      }
      
      if (window.innerWidth <= 768) setViewMode('mobile');
    }, []);

    // Sync viewMode and mobileTab to body for CSS targeting
    useEffect(() => {
      document.body.className = viewMode === 'mobile' ? `mode-mobile mview-${mobileTab}` : 'mode-desktop';
    }, [viewMode, mobileTab]);

    // Save state
    useEffect(() => {
      localStorage.setItem('bmr_draft', JSON.stringify(state));
    }, [state]);

    // SortableJS for section reordering
    useEffect(() => {
      if (activeTab === 'sections' && sectionOrderRef.current) {
        // @ts-ignore
        const Sortable = window.Sortable;
        if (Sortable) {
          Sortable.create(sectionOrderRef.current, {
            animation: 150,
            ghostClass: 'sortable-ghost',
            handle: '.sec-drag-icon',
            onEnd: () => {
              const items = Array.from(sectionOrderRef.current!.querySelectorAll('[data-sec]'));
              const newOrder = items.map(el => (el as HTMLElement).dataset.sec!);
              setState((prev: any) => ({ ...prev, sectionOrder: newOrder }));
            }
          });
        }
      }
    }, [activeTab]);

    // Helpers
    const notify = (text: string, type = '') => {
      setNotif({ show: true, text, err: type === 'err' });
      setTimeout(() => setNotif(prev => ({ ...prev, show: false })), 3200);
    };

    const showLoading = (text: string) => setLoading({ show: true, text });
    const hideLoading = () => setLoading(prev => ({ ...prev, show: false }));

    const pushUndo = () => {
      setUndoStack(prev => [...prev.slice(-49), JSON.stringify(state)]);
      setRedoStack([]);
    };

    const undo = () => {
      if (undoStack.length === 0) return;
      const prev = JSON.parse(undoStack[undoStack.length - 1]);
      setRedoStack(r => [...r, JSON.stringify(state)]);
      setUndoStack(u => u.slice(0, -1));
      setState(prev);
      notify('Action undone');
    };

    const redo = () => {
      if (redoStack.length === 0) return;
      const next = JSON.parse(redoStack[redoStack.length - 1]);
      setUndoStack(u => [...u, JSON.stringify(state)]);
      setRedoStack(r => r.slice(0, -1));
      setState(next);
    };

    // Auth & Cloud Functions
    const handleLogin = async () => {
      try {
        await signInWithPopup(auth, googleProvider);
        notify('Logged in successfully!');
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, 'auth');
      }
    };

    const handleLogout = async () => {
      try {
        await signOut(auth);
        notify('Logged out');
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, 'auth');
      }
    };

    const saveResumeToCloud = async (customName?: string) => {
      if (!user) {
        setShowAuthModal(true);
        return;
      }
      showLoading('Saving to cloud...');
      try {
        const resumeName = customName || state.name || 'Untitled Resume';
        const data = {
          uid: user.uid,
          name: resumeName,
          data: state,
          updatedAt: serverTimestamp()
        };

        if (currentResumeId) {
          await updateDoc(doc(db, 'resumes', currentResumeId), data);
        } else {
          const docRef = await addDoc(collection(db, 'resumes'), {
            ...data,
            createdAt: serverTimestamp()
          });
          setCurrentResumeId(docRef.id);
        }
        notify('✅ Saved to cloud!');
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, 'resumes');
      } finally {
        hideLoading();
      }
    };

    const loadResume = (resume: any) => {
      pushUndo();
      setState(resume.data);
      setCurrentResumeId(resume.id);
      setShowResumesModal(false);
      notify(`Loaded: ${resume.name}`);
    };

    const deleteResume = async (id: string) => {
      if (!window.confirm('Are you sure you want to delete this resume?')) return;
      try {
        await deleteDoc(doc(db, 'resumes', id));
        if (currentResumeId === id) setCurrentResumeId(null);
        notify('Resume deleted');
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, `resumes/${id}`);
      }
    };

    // Landing Page Components
    const LandingPage = () => (
      <div className="landing-page">
        <nav className="landing-nav">
          <div className="logo">BuildMy<span>Resume</span></div>
          <div style={{ display: 'flex', gap: '20px', alignItems: 'center' }}>
            <button className="footer-link" onClick={() => setLandingPage('home')}>Home</button>
            <button className="footer-link" onClick={() => setLandingPage('about')}>About</button>
            <button className="footer-link" onClick={() => setLandingPage('privacy')}>Privacy</button>
            <button className="top-btn primary" onClick={handleLogin}>Login / Sign Up</button>
          </div>
        </nav>

        {landingPage === 'home' && (
          <>
            <section className="landing-hero">
              <h1>Build a Resume That <br/> <span style={{ color: 'var(--accent)' }}>Gets You Hired.</span></h1>
              <p>AI-powered resume builder with professional templates, ATS optimization, and cloud sync. Start your career journey today.</p>
              <button className="modal-btn primary" style={{ width: '250px', fontSize: '18px' }} onClick={handleLogin}>Get Started for Free</button>
            </section>

            <section className="landing-features">
              <div className="feature-card">
                <span className="feature-icon">🤖</span>
                <h3>AI CV Parsing</h3>
                <p>Upload your old CV and let our AI extract and organize your data in seconds.</p>
              </div>
              <div className="feature-card">
                <span className="feature-icon">✨</span>
                <h3>ATS Optimization</h3>
                <p>Get real-time feedback on your resume's ATS compatibility and improve your score.</p>
              </div>
              <div className="feature-card">
                <span className="feature-icon">☁️</span>
                <h3>Cloud Sync</h3>
                <p>Save multiple versions of your resume and access them from any device, anywhere.</p>
              </div>
            </section>
          </>
        )}

        {landingPage === 'about' && (
          <section className="landing-section">
            <h2>About Us</h2>
            <p>BuildMyResume is a cutting-edge platform designed to empower job seekers with the best tools in the industry. We believe that everyone deserves a professional resume that truly reflects their potential.</p>
            <p>Our team of designers and engineers work tirelessly to integrate the latest AI technologies, ensuring your resume stands out in the modern job market.</p>
            <h3>Contact Us</h3>
            <p>Have questions or feedback? Reach out to us:</p>
            <div style={{ background: 'var(--surface2)', padding: '20px', borderRadius: '12px', border: '1px solid var(--border)' }}>
              <div style={{ marginBottom: '10px' }}>📞 <strong>Phone:</strong> +92 330 1547862</div>
              <div>✉️ <strong>Email:</strong> akahmed080@gmail.com</div>
            </div>
          </section>
        )}

        {landingPage === 'privacy' && (
          <section className="landing-section">
            <h2>Privacy Policy</h2>
            <p>Your privacy is our top priority. We only collect the data necessary to provide you with a high-quality resume building experience.</p>
            <h3>Data Collection</h3>
            <p>We store your resume data and profile information securely in Firebase. We do not sell your personal information to third parties.</p>
            <h3>Cookies</h3>
            <p>We use cookies to keep you logged in and to analyze our traffic to improve our services.</p>
          </section>
        )}

        <footer className="landing-footer">
          <div className="footer-links">
            <span className="footer-link" onClick={() => setLandingPage('home')}>Home</span>
            <span className="footer-link" onClick={() => setLandingPage('about')}>About Us</span>
            <span className="footer-link" onClick={() => setLandingPage('privacy')}>Privacy Policy</span>
          </div>
          <div style={{ color: 'var(--muted)', fontSize: '12px' }}>© 2026 BuildMyResume. All rights reserved.</div>
        </footer>
      </div>
    );

    // AI Functions
    const parseWithAI = async (text: string) => {
      showLoading('🤖 AI parsing your CV…');
      try {
        const response = await callAI({
          model: "gemini-3-flash-preview",
          contents: `Extract ALL information from the provided resume text and return a valid JSON object. 
          Be extremely thorough. Do not skip any sections. If a section is present in the text but not explicitly in the schema, try to map it to the most relevant field or use 'extra'.
          
          Resume text:
          ${text}
          `,
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                name: { type: Type.STRING },
                title: { type: Type.STRING },
                email: { type: Type.STRING },
                phone: { type: Type.STRING },
                location: { type: Type.STRING },
                web: { type: Type.STRING },
                summary: { type: Type.STRING },
                interests: { type: Type.STRING },
                skills: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      name: { type: Type.STRING },
                      level: { type: Type.STRING },
                      pct: { type: Type.NUMBER }
                    }
                  }
                },
                exp: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      role: { type: Type.STRING },
                      company: { type: Type.STRING },
                      start: { type: Type.STRING },
                      end: { type: Type.STRING },
                      desc: { type: Type.STRING }
                    }
                  }
                },
                edu: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      degree: { type: Type.STRING },
                      school: { type: Type.STRING },
                      year: { type: Type.STRING },
                      grade: { type: Type.STRING }
                    }
                  }
                },
                intern: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      role: { type: Type.STRING },
                      company: { type: Type.STRING },
                      start: { type: Type.STRING },
                      end: { type: Type.STRING },
                      desc: { type: Type.STRING }
                    }
                  }
                },
                proj: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      name: { type: Type.STRING },
                      link: { type: Type.STRING },
                      desc: { type: Type.STRING }
                    }
                  }
                },
                award: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      name: { type: Type.STRING },
                      issuer: { type: Type.STRING },
                      year: { type: Type.STRING }
                    }
                  }
                },
                lang: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      lang: { type: Type.STRING },
                      level: { type: Type.STRING }
                    }
                  }
                },
                cert: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      name: { type: Type.STRING },
                      issuer: { type: Type.STRING },
                      year: { type: Type.STRING }
                    }
                  }
                },
                volunteer: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      role: { type: Type.STRING },
                      org: { type: Type.STRING },
                      year: { type: Type.STRING },
                      desc: { type: Type.STRING }
                    }
                  }
                },
                pub: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      name: { type: Type.STRING },
                      publisher: { type: Type.STRING },
                      year: { type: Type.STRING }
                    }
                  }
                },
                conf: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      name: { type: Type.STRING },
                      year: { type: Type.STRING },
                      location: { type: Type.STRING }
                    }
                  }
                },
                ref: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      name: { type: Type.STRING },
                      contact: { type: Type.STRING }
                    }
                  }
                },
                extra: { type: Type.STRING }
              }
            }
          }
        });

        const responseText = response.text || '';
        let parsed: any = {};
        try {
          const jsonMatch = responseText.match(/\{.*\}/s);
          const cleanText = jsonMatch ? jsonMatch[0] : responseText.trim();
          parsed = JSON.parse(cleanText);
        } catch (parseErr) {
          console.error('JSON Parse Error:', parseErr, 'Raw text:', responseText);
          throw new Error('Could not parse CV data. Please try again.');
        }

        pushUndo();
        setState((prev: any) => {
          const newState = {
            ...prev,
            ...parsed,
            skills: Array.isArray(parsed.skills) ? parsed.skills : prev.skills,
            exp: Array.isArray(parsed.exp) ? parsed.exp : prev.exp,
            edu: Array.isArray(parsed.edu) ? parsed.edu : prev.edu,
            intern: Array.isArray(parsed.intern) ? parsed.intern : prev.intern,
            proj: Array.isArray(parsed.proj) ? parsed.proj : prev.proj,
            award: Array.isArray(parsed.award) ? parsed.award : prev.award,
            lang: Array.isArray(parsed.lang) ? parsed.lang : prev.lang,
            cert: Array.isArray(parsed.cert) ? parsed.cert : prev.cert,
            volunteer: Array.isArray(parsed.volunteer) ? parsed.volunteer : prev.volunteer,
            pub: Array.isArray(parsed.pub) ? parsed.pub : prev.pub,
            conf: Array.isArray(parsed.conf) ? parsed.conf : prev.conf,
            ref: Array.isArray(parsed.ref) ? parsed.ref : prev.ref,
            extra: parsed.extra || prev.extra,
          };

          // Auto-show sections that have data
          const newVisible = { ...prev.sectionVisible };
          const sectionsToCheck = [
            'summary', 'experience', 'internships', 'education', 'skills', 
            'languages', 'certifications', 'projects', 'awards', 'volunteer', 
            'publications', 'conferences', 'interests', 'references', 'extracurricular'
          ];
          
          if (newState.summary) newVisible.summary = true;
          if (newState.exp?.length) newVisible.experience = true;
          if (newState.intern?.length) newVisible.internships = true;
          if (newState.edu?.length) newVisible.education = true;
          if (newState.skills?.length) newVisible.skills = true;
          if (newState.lang?.length) newVisible.languages = true;
          if (newState.cert?.length) newVisible.certifications = true;
          if (newState.proj?.length) newVisible.projects = true;
          if (newState.award?.length) newVisible.awards = true;
          if (newState.volunteer?.length) newVisible.volunteer = true;
          if (newState.pub?.length) newVisible.publications = true;
          if (newState.conf?.length) newVisible.conferences = true;
          if (newState.interests) newVisible.interests = true;
          if (newState.ref?.length) newVisible.references = true;
          if (newState.extra) newVisible.extracurricular = true;

          newState.sectionVisible = newVisible;
          return newState;
        });
        notify('✅ CV imported successfully!');
      } catch (e: any) {
        notify('AI parsing failed: ' + e.message, 'err');
      } finally {
        hideLoading();
      }
    };

    const generateCoverLetter = async () => {
      if (!state.name || !state.title) { notify('Add your name and job title first', 'err'); return; }
      const jobDesc = prompt('Paste the job description (optional):', '');
      showLoading('✉ Generating cover letter…');
      try {
        const response = await callAI({
          model: "gemini-3-flash-preview",
          contents: `Write a professional cover letter for ${state.name}, a ${state.title}.
          Background: ${state.summary || 'N/A'}
          Recent Role: ${state.exp?.[0]?.role || 'N/A'} at ${state.exp?.[0]?.company || 'N/A'}
          Skills: ${state.skills?.slice(0, 5).map((s: any) => s.name).join(', ')}
          ${jobDesc ? `Job Description: ${jobDesc}` : ''}
          
          IMPORTANT: Return ONLY the cover letter text. No markdown, no bolding (**), no headers (##), and no conversational filler like "Here is your cover letter".`
        });
        setAiOutput({ show: true, title: '✉ Cover Letter', text: response.text?.replace(/[\*\#]/g, '') || '' });
      } catch (e: any) {
        notify('Failed: ' + e.message, 'err');
      } finally {
        hideLoading();
      }
    };

    const generateLinkedInHeadline = async () => {
      if (!state.title) { notify('Add your job title first', 'err'); return; }
      showLoading('💼 Generating headline…');
      try {
        const response = await callAI({
          model: "gemini-3-flash-preview",
          contents: `Generate 5 punchy LinkedIn headlines for a ${state.title}. Skills: ${state.skills?.slice(0, 5).map((s: any) => s.name).join(', ')}.
          Return ONLY the headlines separated by new lines. No markdown, no numbers, no bolding, no "Here are your headlines".`
        });
        setAiOutput({ show: true, title: '💼 LinkedIn Headlines', text: response.text?.replace(/[\*\#]/g, '') || '' });
      } catch (e: any) {
        notify('Failed: ' + e.message, 'err');
      } finally {
        hideLoading();
      }
    };

    const analyzeKeywords = async () => {
      const jobDesc = prompt('Paste job description:', '');
      if (!jobDesc) return;
      showLoading('🔍 Analyzing keywords…');
      try {
        const cvText = `${state.summary} ${state.exp.map((e: any) => e.desc).join(' ')} ${state.skills.map((s: any) => s.name).join(' ')}`;
        const response = await callAI({
          model: "gemini-3-flash-preview",
          contents: `Analyze keyword match between this CV and Job Description. Provide a score and missing keywords.
          CV: ${cvText}
          Job: ${jobDesc}
          Return as plain text. No markdown.`
        });
        setAiOutput({ show: true, title: '🔍 Keyword Analysis', text: response.text?.replace(/[\*\#]/g, '') || '' });
      } catch (e: any) {
        notify('Failed: ' + e.message, 'err');
      } finally {
        hideLoading();
      }
    };

    const suggestImprovements = async () => {
      showLoading('💡 Reviewing CV…');
      try {
        const cvText = `${state.summary} ${state.exp.map((e: any) => e.desc).join(' ')} ${state.skills.map((s: any) => s.name).join(' ')}`;
        const response = await callAI({
          model: "gemini-3-flash-preview",
          contents: `Review this CV and suggest 5 specific improvements: ${cvText}. Return as plain text list. No markdown.`
        });
        setAiOutput({ show: true, title: '💡 CV Review', text: response.text?.replace(/[\*\#]/g, '') || '' });
      } catch (e: any) {
        notify('Failed: ' + e.message, 'err');
      } finally {
        hideLoading();
      }
    };

    const aiSummaryTemplate = async () => {
      if (!state.title) { notify('Add a job title first', 'err'); return; }
      showLoading('AI generating summary…');
      try {
        const response = await callAI({
          model: "gemini-3-flash-preview",
          contents: `Write a professional 2-sentence CV summary for a ${state.title}. Name: ${state.name}.
          Return ONLY the summary text itself. No conversational filler, no "Here is your summary", no markdown, no bolding. Provide only ONE version.`
        });
        let text = response.text?.replace(/[\*\#]/g, '').trim() || '';
        // If AI still provides multiple options (e.g. 1. ..., 2. ...), take only the first one
        if (text.includes('1.')) text = text.split('2.')[0].replace('1.', '').trim();
        setState((prev: any) => ({ ...prev, summary: text }));
        notify('✦ Summary generated!');
      } catch (e: any) {
        notify('Failed: ' + e.message, 'err');
      } finally {
        hideLoading();
      }
    };

    const aiImproveBullets = async (type: string, i: number) => {
      const arr = state[type];
      const desc = arr[i]?.desc || '';
      if (!desc.trim()) { notify('Add a description first'); return; }
      showLoading('AI improving bullets…');
      try {
        const response = await callAI({
          model: "gemini-3-flash-preview",
          contents: `Convert this job description into 3-4 concise bullet points starting with strong action verbs: ${desc}.
          Current Tone: ${tone}.
          Return ONLY the bullet points. No markdown, no bolding, no conversational filler. Provide only ONE set of bullets.`
        });
        let text = response.text?.replace(/[\*\#]/g, '').trim() || '';
        // Clean up potential "Option 1" etc.
        if (text.toLowerCase().includes('option 1')) text = text.split(/option 2/i)[0].replace(/option 1:?/i, '').trim();
        const newArr = [...arr];
        newArr[i] = { ...newArr[i], desc: text };
        setState((prev: any) => ({ ...prev, [type]: newArr }));
        notify('✦ Improved!');
      } catch (e: any) {
        notify('Failed: ' + e.message, 'err');
      } finally {
        hideLoading();
      }
    };

    const aiEnhanceField = async (field: string, value: string) => {
      if (!value.trim()) { notify('Field is empty'); return; }
      showLoading(`AI enhancing ${field}…`);
      try {
        const response = await callAI({
          model: "gemini-3-flash-preview",
          contents: `Improve this ${field} for a resume. Make it more professional, impactful, and concise. 
          Current Tone: ${tone}.
          Text: ${value}
          Return ONLY the improved text. No markdown, no conversational filler.`
        });
        const improved = response.text?.replace(/[\*\#]/g, '').trim() || '';
        setState((prev: any) => ({ ...prev, [field]: improved }));
        notify('✦ Enhanced!');
      } catch (e: any) {
        notify('Failed: ' + e.message, 'err');
      } finally {
        hideLoading();
      }
    };

    const getCurrentLocation = () => {
      if (!navigator.geolocation) {
        notify('Geolocation is not supported by your browser', 'err');
        return;
      }
      showLoading('📍 Getting your location…');
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const { latitude, longitude } = pos.coords;
          setJobLocation(`${latitude.toFixed(2)}, ${longitude.toFixed(2)} (Near Me)`);
          hideLoading();
          notify('Location updated!');
        },
        (err) => {
          console.error(err);
          hideLoading();
          notify('Could not get location. Please enter manually.', 'err');
        }
      );
    };

    const findJobs = async (useResume = false) => {
      // Sanitize and limit inputs to prevent prompt bloat or errors
      const safeTitle = (state.title || '').substring(0, 100);
      const safeSummary = (state.summary || '').substring(0, 500);
      const safeSkills = (state.skills || []).slice(0, 15).map(s => s.name).join(', ');
      
      const query = useResume ? `${safeTitle} ${safeSkills}` : (jobQuery || safeTitle);
      const loc = (jobLocation || state.location || 'Remote').substring(0, 100);
      
      if (!useResume && !jobQuery && !safeTitle) { 
        notify('Enter a job title or search query'); 
        return; 
      }
      
      showLoading(useResume ? '🧠 Analyzing resume & searching jobs…' : '🔍 Searching for best jobs…');
      try {
        let response;
        const prompt = `Find 5 current job openings for a candidate with this profile: "${query}" in ${loc}. 
        ${useResume ? `Candidate Summary: ${safeSummary}` : ''}
        Use Google Search to find real, current job listings that best match this profile.
        For each job, provide: Title, Company, Location, and a short 1-sentence description explaining why it's a good match.
        Return the results as a JSON array of objects with keys: title, company, location, desc.`;

        try {
          response = await callAI({
            model: "gemini-3-flash-preview",
            contents: prompt,
            config: {
              tools: [{ googleSearch: {} } as any],
              toolConfig: { includeServerSideToolInvocations: true } as any,
              responseMimeType: "application/json"
            } as any
          });
        } catch (e) {
          console.warn('Job search tool failed, trying standard search:', e);
          response = await callAI({
            model: "gemini-3-flash-preview",
            contents: prompt,
            config: {
              responseMimeType: "application/json"
            }
          });
        }
        
        const text = response.text || '';
        console.log('Job search raw response:', text);
        
        if (!text) throw new Error('Empty response from AI');

        // Robust JSON extraction in case model returns markdown or extra text
        let results;
        try {
          const jsonMatch = text.match(/\[\s*\{.*\}\s*\]/s);
          const cleanText = jsonMatch ? jsonMatch[0] : text.trim();
          results = JSON.parse(cleanText);
        } catch (parseErr) {
          console.error('JSON Parse Error:', parseErr, 'Raw text:', text);
          throw new Error('Could not parse job results. Please try again.');
        }
        
        if (Array.isArray(results) && results.length > 0) {
          setJobs(results);
          notify(`Found ${results.length} matched jobs!`);
        } else {
          notify('No matching jobs found. Try a different location.');
        }
      } catch (e: any) {
        console.error('Job search error:', e);
        notify(e.message.includes('internet') ? 'Job search failed. Ensure you have internet access.' : `Job search failed: ${e.message}`, 'err');
      } finally {
        hideLoading();
      }
    };

    // AI Interview Logic
    const startInterview = () => {
      setInterviewMode(true);
      setInterviewMessages([
        { role: 'ai', text: "Hi! I'm your AI Resume Architect. I'll help you build a professional CV from scratch. What's your full name and current or target job title?" }
      ]);
    };

    const handleInterviewMessage = async () => {
      if (!interviewInput.trim() || isInterviewing) return;
      
      const userMsg = interviewInput.trim();
      setInterviewInput('');
      setInterviewMessages(prev => [...prev, { role: 'user', text: userMsg }]);
      setIsInterviewing(true);

      try {
        const response = await callAI({
          model: "gemini-3-flash-preview",
          contents: `You are an expert career coach and resume writer. You are interviewing a user to build their CV.
          
          Conversation history:
          ${interviewMessages.map(m => `${m.role === 'ai' ? 'AI' : 'User'}: ${m.text}`).join('\n')}
          User just said: ${userMsg}
          
          Goal:
          1. If you have enough info (Name, Title, Contact, Summary, Experience, Education, Skills), say "FINISH" and then provide a complete JSON object representing the CV state.
          2. Otherwise, ask the next most important question to fill the gaps. Be conversational and helpful.
          
          JSON Schema for "FINISH":
          {
            "name": string, "title": string, "email": string, "phone": string, "location": string, "summary": string,
            "skills": [{ "name": string, "level": string, "pct": number }],
            "exp": [{ "role": string, "company": string, "start": string, "end": string, "desc": string }],
            "edu": [{ "degree": string, "school": string, "year": string, "grade": string }],
            "bestTemplate": number (0-50),
            "bestAccent": string (hex)
          }
          `,
        });

        const aiText = response.text || '';
        if (aiText.includes('FINISH')) {
          const jsonMatch = aiText.match(/\{.*\}/s);
          if (jsonMatch) {
            const data = JSON.parse(jsonMatch[0]);
            processInterviewResults(data);
          } else {
            setInterviewMessages(prev => [...prev, { role: 'ai', text: "I've gathered enough info! Generating your CV now..." }]);
            // Fallback parse if JSON is messy
          }
        } else {
          setInterviewMessages(prev => [...prev, { role: 'ai', text: aiText }]);
        }
      } catch (e) {
        console.error(e);
        setInterviewMessages(prev => [...prev, { role: 'ai', text: "I hit a snag. Can you repeat that?" }]);
      } finally {
        setIsInterviewing(false);
      }
    };

    const processInterviewResults = (data: any) => {
      showLoading('🏗️ Building your perfect CV…');
      setTimeout(() => {
        setState((prev: any) => ({
          ...prev,
          ...data,
          template: data.bestTemplate ?? prev.template,
          accentColor: data.bestAccent ?? prev.accentColor,
          sectionVisible: { ...prev.sectionVisible, summary: true, experience: true, education: true, skills: true }
        }));
        setInterviewMode(false);
        hideLoading();
        notify('✦ CV Built Successfully!');
      }, 1500);
    };
    const exportJSON = () => {
      const data = JSON.stringify(state, null, 2);
      const blob = new Blob([data], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `resume_${state.name.replace(/\s+/g, '_') || 'draft'}.json`;
      a.click();
      notify('Backup downloaded!');
    };

    const saveToBrowser = () => {
      localStorage.setItem('bmr_draft', JSON.stringify(state));
      notify('Saved to browser storage!');
    };

    const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const ext = file.name.split('.').pop()?.toLowerCase();
      showLoading('📂 Reading CV…');
      try {
        let text = '';
        if (ext === 'txt') {
          text = await file.text();
        } else if (ext === 'pdf') {
          // @ts-ignore
          const pdfjsLib = window.pdfjsLib;
          if (!pdfjsLib) throw new Error('PDF library not loaded');
          pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
          const arrayBuffer = await file.arrayBuffer();
          const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
          for (let i = 1; i <= Math.min(pdf.numPages, 20); i++) {
            const page = await pdf.getPage(i);
            const content = await page.getTextContent();
            let lastY = -1;
            let pageText = '';
            for (const item of content.items as any[]) {
              if (lastY !== -1 && Math.abs(item.transform[5] - lastY) > 5) {
                pageText += '\n';
              }
              pageText += item.str + ' ';
              lastY = item.transform[5];
            }
            text += pageText + '\n\n';
          }
        } else if (ext === 'docx' || ext === 'doc') {
          // @ts-ignore
          const mammoth = window.mammoth;
          const ab = await file.arrayBuffer();
          const result = await mammoth.extractRawText({ arrayBuffer: ab });
          text = result.value;
        }
        if (text) await parseWithAI(text);
        else notify('Could not extract text', 'err');
      } catch (err: any) {
        notify('Error: ' + err.message, 'err');
      } finally {
        hideLoading();
      }
    };

    const handlePhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        setState((prev: any) => ({ ...prev, photoData: ev.target?.result }));
      };
      reader.readAsDataURL(file);
    };

    // Export Logic
    const exportPDF = async () => {
      showLoading('Preparing PDF…');
      // @ts-ignore
      const html2canvas = window.html2canvas;
      // @ts-ignore
      const jsPDF = window.jspdf.jsPDF;
      if (!html2canvas || !jsPDF) { notify('PDF libraries not loaded', 'err'); hideLoading(); return; }

      const el = document.getElementById('cv-preview');
      if (!el) return;

      try {
        await document.fonts.ready;
        
        // Create a hidden clone to capture at 1:1 scale without any UI transforms
        const clone = el.cloneNode(true) as HTMLElement;
        clone.style.position = 'absolute';
        clone.style.left = '-9999px';
        clone.style.top = '0';
        clone.style.transform = 'none';
        clone.style.display = 'block';
        document.body.appendChild(clone);

        const canvas = await html2canvas(clone, { 
          scale: 3, 
          useCORS: true,
          logging: false,
          allowTaint: true,
          backgroundColor: '#ffffff',
          // Important for text alignment:
          letterRendering: false,
        });
        
        document.body.removeChild(clone);
        
        const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: pageSize });
        const imgData = canvas.toDataURL('image/jpeg', 0.95);
        const pW = pdf.internal.pageSize.getWidth();
        const pH = pdf.internal.pageSize.getHeight();
        
        pdf.addImage(imgData, 'JPEG', 0, 0, pW, pH);
        pdf.save((state.name || 'resume') + '.pdf');
        notify('PDF exported!');
      } catch (e: any) {
        notify('Export failed: ' + e.message, 'err');
      } finally {
        hideLoading();
      }
    };

    const exportPNG = async () => {
      showLoading('Preparing Image…');
      // @ts-ignore
      const html2canvas = window.html2canvas;
      const el = document.getElementById('cv-preview');
      if (!el || !html2canvas) return;
      
      try {
        await document.fonts.ready;
        
        // Create a hidden clone to capture at 1:1 scale without any UI transforms
        const clone = el.cloneNode(true) as HTMLElement;
        clone.style.position = 'absolute';
        clone.style.left = '-9999px';
        clone.style.top = '0';
        clone.style.transform = 'none';
        clone.style.display = 'block';
        document.body.appendChild(clone);

        const canvas = await html2canvas(clone, { 
          scale: 3, 
          useCORS: true,
          logging: false,
          allowTaint: true,
          backgroundColor: '#ffffff',
          // Important for text alignment:
          letterRendering: false,
        });
        
        document.body.removeChild(clone);

        const link = document.createElement('a');
        link.download = (state.name || 'resume') + '.png';
        link.href = canvas.toDataURL('image/png');
        link.click();
        notify('PNG exported!');
      } catch (e: any) {
        notify('Export failed', 'err');
      } finally {
        hideLoading();
      }
    };

    const exportTXT = () => {
      const text = `
  ${state.name.toUpperCase()}
  ${state.title}
  ${state.email} | ${state.phone} | ${state.location}

  SUMMARY
  ${state.summary}

  EXPERIENCE
  ${state.exp.map((e: any) => `${e.role} @ ${e.company} (${e.start} - ${e.end})\n${e.desc}`).join('\n\n')}

  EDUCATION
  ${state.edu.map((e: any) => `${e.degree} - ${e.school} (${e.year})`).join('\n')}

  SKILLS
  ${state.skills.map((s: any) => s.name).join(', ')}
      `;
      const blob = new Blob([text], { type: 'text/plain' });
      const link = document.createElement('a');
      link.download = (state.name || 'resume') + '.txt';
      link.href = URL.createObjectURL(blob);
      link.click();
      notify('TXT exported!');
    };

    const exportWord = () => {
      const el = document.getElementById('cv-preview');
      if (!el) return;
      const html = `
        <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
        <head><meta charset='utf-8'><title>Export</title></head>
        <body>${el.innerHTML}</body>
        </html>
      `;
      const blob = new Blob(['\ufeff', html], { type: 'application/msword' });
      const link = document.createElement('a');
      link.download = (state.name || 'resume') + '.doc';
      link.href = URL.createObjectURL(blob);
      link.click();
      notify('Word (.doc) exported!');
    };

    const runATSCheck = async () => {
      showLoading('🧠 AI analyzing ATS compatibility…');
      try {
        const cvText = JSON.stringify({
          name: state.name,
          title: state.title,
          summary: state.summary,
          exp: state.exp,
          skills: state.skills,
          edu: state.edu
        });

        const response = await callAI({
          model: "gemini-3-flash-preview",
          contents: `Analyze this resume for ATS (Applicant Tracking System) compatibility. 
          Resume: ${cvText}
          Provide:
          1. A score from 0-100.
          2. A list of 5 specific issues or missing elements.
          3. 3 actionable tips to improve ranking.
          Return as a JSON object with keys: score (number), issues (array of strings), tips (array of strings).`
        });

        const result = JSON.parse(response.text?.match(/\{.*\}/s)?.[0] || '{"score":0, "issues":[], "tips":[]}');
        setAtsScore(result.score);
        setAtsIssues([...result.issues, ...result.tips]);
        notify('ATS Check complete!');
      } catch (e: any) {
        notify('ATS Check failed', 'err');
      } finally {
        hideLoading();
      }
    };

    const suggestSkills = async () => {
      if (!state.title) { notify('Add a job title first', 'err'); return; }
      showLoading('🧠 AI suggesting skills…');
      try {
        const response = await callAI({
          model: "gemini-3-flash-preview",
          contents: `Suggest 10 relevant skills for a ${state.title}. 
          Return ONLY the skills separated by commas. No markdown, no conversational filler.`
        });
        const suggested = response.text?.split(',').map(s => s.trim()) || [];
        setAiOutput({ show: true, title: '🧠 Suggested Skills', text: suggested.join('\n') });
      } catch (e: any) {
        notify('Failed: ' + e.message, 'err');
      } finally {
        hideLoading();
      }
    };

    const getATSData = () => {
      let score = 0; const issues = [];
      if (state.name) score += 5; else issues.push('Missing name');
      if (state.email) score += 5; else issues.push('Missing email');
      if (state.phone) score += 5; else issues.push('Missing phone');
      if (state.summary && state.summary.length > 50) score += 10; else issues.push('Summary too short');
      if (state.exp?.length >= 1) score += 15; else issues.push('No work experience');
      if (state.skills?.length >= 5) score += 10; else issues.push('Add more skills');
      return { score: Math.min(score + 50, 100), issues };
    };

    // Render CV Logic
    const renderCV = () => {
      const t = TEMPLATES[state.template];
      const ac = state.accentColor;
      const sc = state.secondaryColor;
      const isDark = (hex: string) => {
        const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
        return (r * 299 + g * 587 + b * 114) / 1000 < 128;
      };
      const sideIsDark = isDark(sc);
      const textCol = state.fontColor || (isDark(sc) ? '#f0eff8' : '#1a1a2e');
      const mutedCol = isDark(sc) ? 'rgba(240,239,248,0.6)' : `${textCol}99`;

      const renderBullets = (text: string) => {
        if (!text) return null;
        const lines = text.split('\n').filter(l => l.trim());
        if (lines.length === 0) return null;
        
        const bStyle = state.bulletStyle || 'disc';
        let listStyleType = 'disc';
        let customBullet = null;

        if (bStyle === 'circle') listStyleType = 'circle';
        else if (bStyle === 'square') listStyleType = 'square';
        else if (bStyle === 'none') listStyleType = 'none';
        else if (bStyle === 'arrow') customBullet = '→';
        else if (bStyle === 'bubble') customBullet = '•';

        return (
          <ul style={{ paddingLeft: customBullet ? '0' : '18px', listStyleType, margin: 0 }}>
            {lines.map((l, i) => (
              <li key={i} style={{ marginBottom: '4px', position: 'relative', paddingLeft: customBullet ? '18px' : '0' }}>
                {customBullet && (
                  <span style={{ position: 'absolute', left: 0, color: ac, fontWeight: 'bold' }}>{customBullet}</span>
                )}
                {l.replace(/^[•\-\*]\s*/, '')}
              </li>
            ))}
          </ul>
        );
      };

      const renderSkillLevel = (pct: number) => {
        const sStyle = state.skillStyle || 'bar';
        if (sStyle === 'text') return null;
        
        if (sStyle === 'dots') {
          return (
            <div style={{ display: 'flex', gap: '4px', marginTop: '4px' }}>
              {[1, 2, 3, 4, 5].map(i => (
                <div key={i} style={{ 
                  width: '8px', height: '8px', borderRadius: '50%', 
                  background: i <= (pct / 20) ? ac : '#e2e8f0' 
                }} />
              ))}
            </div>
          );
        }

        if (sStyle === 'stars') {
          return (
            <div style={{ display: 'flex', gap: '2px', marginTop: '2px', color: ac, fontSize: '12px' }}>
              {[1, 2, 3, 4, 5].map(i => (
                <span key={i}>{i <= (pct / 20) ? '★' : '☆'}</span>
              ))}
            </div>
          );
        }

        return (
          <div style={{ width: '100%', height: '6px', background: '#e2e8f0', borderRadius: '3px', marginTop: '5px', overflow: 'hidden' }}>
            <div style={{ width: `${pct}%`, height: '100%', background: ac }} />
          </div>
        );
      };

      const renderHeader = (title: string) => {
        const hStyle = state.headerStyle || 'none';
        const tCase = state.titleCase || 'uppercase';
        const displayTitle = tCase === 'uppercase' ? title.toUpperCase() : title;
        
        const icons: any = {
          'Summary': '📝',
          'Experience': '💼',
          'Internships': '🎓',
          'Education': '🏛',
          'Skills': '🛠',
          'Languages': '🌐',
          'Certifications': '📜',
          'Projects': '🚀',
          'Awards': '🏆',
          'Interests': '🎨'
        };

        const baseStyle: any = {
          fontSize: '10px',
          fontWeight: 700,
          color: ac,
          marginBottom: state.compactMode ? '5px' : '10px',
          display: 'flex',
          alignItems: 'center',
          gap: '8px'
        };

        const content = (
          <>
            {state.showSectionIcons && icons[title] && <span style={{ fontSize: '14px' }}>{icons[title]}</span>}
            <span style={{ letterSpacing: '1px' }}>{displayTitle}</span>
          </>
        );

        if (hStyle === 'underline') {
          return (
            <div style={{ ...baseStyle, borderBottom: `1px solid ${ac}44`, paddingBottom: '4px', marginBottom: state.compactMode ? '8px' : '12px' }}>
              {content}
            </div>
          );
        }
        if (hStyle === 'background') {
          return (
            <div style={{ ...baseStyle, background: `${ac}15`, padding: '4px 10px', borderRadius: '4px', marginLeft: '-10px', width: 'calc(100% + 10px)' }}>
              {content}
            </div>
          );
        }
        if (hStyle === 'border-left') {
          return (
            <div style={{ ...baseStyle, borderLeft: `4px solid ${ac}`, paddingLeft: '10px', marginLeft: '-14px' }}>
              {content}
            </div>
          );
        }

        return <div style={baseStyle}>{content}</div>;
      };

      const renderPhoto = (size: number, border?: string) => {
        if (!state.photoData) return null;
        const shape = state.photoShape || 'circle';
        let borderRadius = '50%';
        if (shape === 'square') borderRadius = '0';
        if (shape === 'rounded') borderRadius = '12px';
        
        return (
          <img 
            src={state.photoData} 
            style={{ 
              width: `${size}px`, 
              height: `${size}px`, 
              borderRadius, 
              objectFit: 'cover',
              border: border || 'none'
            }} 
          />
        );
      };

      const renderDivider = () => {
        const dStyle = state.dividerStyle || 'none';
        if (dStyle === 'none') return null;
        return <div style={{ borderTop: `1px ${dStyle} ${ac}33`, margin: `${state.compactMode ? 8 : 15}px 0` }} />;
      };

      const renderQR = (size: number) => {
        if (!state.showQRCode || !state.qrUrl) return null;
        return (
          <div style={{ textAlign: 'center', marginTop: '10px' }}>
            <img 
              src={`https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(state.qrUrl)}`} 
              style={{ width: `${size}px`, height: `${size}px`, border: `1px solid ${ac}33`, padding: '4px', background: 'white' }} 
              alt="QR Code"
            />
            <div style={{ fontSize: '8px', color: mutedCol, marginTop: '2px' }}>Scan for Portfolio</div>
          </div>
        );
      };

      const renderSidebarPattern = () => {
        const pattern = state.sidebarPattern || 'none';
        if (pattern === 'none') return null;
        
        let bg = '';
        if (pattern === 'dots') bg = `radial-gradient(${ac}22 1px, transparent 1px)`;
        if (pattern === 'lines') bg = `linear-gradient(0deg, ${ac}11 1px, transparent 1px)`;
        if (pattern === 'grid') bg = `linear-gradient(${ac}11 1px, transparent 1px), linear-gradient(90deg, ${ac}11 1px, transparent 1px)`;
        
        return (
          <div style={{ 
            position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, 
            backgroundImage: bg, 
            backgroundSize: pattern === 'dots' ? '10px 10px' : '20px 20px',
            pointerEvents: 'none',
            opacity: 0.5
          }} />
        );
      };

      const renderSection = (sec: string) => {
        if (state.sectionVisible[sec] === false) return null;
        if (state.autoHide) {
          if (sec === 'summary' && !state.summary) return null;
          if (sec === 'experience' && !state.exp?.length) return null;
          if (sec === 'education' && !state.edu?.length) return null;
          if (sec === 'skills' && !state.skills?.length) return null;
          // ... other auto-hide checks
        }

        const ss = state.compactMode ? state.sectionSpacing / 2 : state.sectionSpacing;
        const mT = { marginTop: `${ss}px` };

        switch (sec) {
          case 'summary':
            return state.summary && (
              <div style={mT}>
                {renderHeader('Summary')}
                <div style={{ fontSize: '13px', color: textCol, opacity: 0.82 }}>{state.summary}</div>
                {renderDivider()}
              </div>
            );
          case 'experience':
            return state.exp?.length > 0 && (
              <div style={mT}>
                {renderHeader('Experience')}
                {state.exp.map((e: any, i: number) => (
                  <div key={i} style={{ marginBottom: state.compactMode ? '10px' : '18px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                      <div style={{ fontSize: '14px', fontWeight: 600, color: textCol }}>{e.role}</div>
                      <div style={{ fontSize: '11px', color: mutedCol }}>{e.start} - {e.end}</div>
                    </div>
                    <div style={{ fontSize: '12px', color: ac, marginBottom: '5px' }}>{e.company}</div>
                    <div style={{ fontSize: '12px', color: mutedCol }}>{renderBullets(e.desc)}</div>
                  </div>
                ))}
                {renderDivider()}
              </div>
            );
          case 'internships':
            return state.intern?.length > 0 && (
              <div style={mT}>
                {renderHeader('Internships')}
                {state.intern.map((e: any, i: number) => (
                  <div key={i} style={{ marginBottom: '18px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                      <div style={{ fontSize: '14px', fontWeight: 600, color: textCol }}>{e.role}</div>
                      <div style={{ fontSize: '11px', color: mutedCol }}>{e.start} - {e.end}</div>
                    </div>
                    <div style={{ fontSize: '12px', color: ac, marginBottom: '5px' }}>{e.company}</div>
                    <div style={{ fontSize: '12px', color: mutedCol }}>{renderBullets(e.desc)}</div>
                  </div>
                ))}
              </div>
            );
          case 'education':
            return state.edu?.length > 0 && (
              <div style={mT}>
                {renderHeader('Education')}
                {state.edu.map((e: any, i: number) => (
                  <div key={i} style={{ marginBottom: '12px' }}>
                    <div style={{ fontSize: '13px', fontWeight: 600, color: textCol }}>{e.degree}</div>
                    <div style={{ fontSize: '12px', color: mutedCol }}>{e.school} | {e.year}</div>
                  </div>
                ))}
              </div>
            );
          case 'skills':
            return state.skills?.length > 0 && (
              <div style={mT}>
                {renderHeader('Skills')}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: '12px' }}>
                  {state.skills.map((s: any, i: number) => (
                    <div key={i}>
                      <div style={{ fontSize: '11px', fontWeight: 600 }}>{s.name}</div>
                      {renderSkillLevel(s.pct)}
                    </div>
                  ))}
                </div>
              </div>
            );
          case 'languages':
            return state.lang?.length > 0 && (
              <div style={mT}>
                {renderHeader('Languages')}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px' }}>
                  {state.lang.map((l: any, i: number) => (
                    <div key={i} style={{ fontSize: '12px' }}>
                      <span style={{ fontWeight: 600 }}>{l.lang}</span>: <span style={{ color: mutedCol }}>{l.level}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          case 'certifications':
            return state.cert?.length > 0 && (
              <div style={mT}>
                {renderHeader('Certifications')}
                {state.cert.map((c: any, i: number) => (
                  <div key={i} style={{ marginBottom: '8px' }}>
                    <div style={{ fontSize: '13px', fontWeight: 600 }}>{c.name}</div>
                    <div style={{ fontSize: '11px', color: mutedCol }}>{c.issuer} | {c.year}</div>
                  </div>
                ))}
              </div>
            );
          case 'projects':
            return state.proj?.length > 0 && (
              <div style={mT}>
                {renderHeader('Projects')}
                {state.proj.map((p: any, i: number) => (
                  <div key={i} style={{ marginBottom: '15px' }}>
                    <div style={{ fontSize: '14px', fontWeight: 600 }}>{p.name}</div>
                    <div style={{ fontSize: '11px', color: ac, marginBottom: '3px' }}>{p.link}</div>
                    <div style={{ fontSize: '12px', color: mutedCol }}>{renderBullets(p.desc)}</div>
                  </div>
                ))}
              </div>
            );
          case 'awards':
            return state.award?.length > 0 && (
              <div style={mT}>
                {renderHeader('Awards')}
                {state.award.map((a: any, i: number) => (
                  <div key={i} style={{ marginBottom: '8px' }}>
                    <div style={{ fontSize: '13px', fontWeight: 600 }}>{a.name}</div>
                    <div style={{ fontSize: '11px', color: mutedCol }}>{a.issuer} | {a.year}</div>
                  </div>
                ))}
              </div>
            );
          case 'interests':
            return state.interests && (
              <div style={mT}>
                {renderHeader('Interests')}
                <div style={{ fontSize: '12px', color: mutedCol }}>{state.interests}</div>
              </div>
            );
          default: return null;
        }
      };

      return (
        <div id="cv-preview" style={{ 
          width: PAGE_DIMS[pageSize as keyof typeof PAGE_DIMS].w, 
          minHeight: PAGE_DIMS[pageSize as keyof typeof PAGE_DIMS].h,
          fontFamily: state.font,
          fontSize: `${state.fontSize}%`,
          fontWeight: state.fontWeight,
          lineHeight: state.lineHeight,
          background: 'white',
          position: 'relative',
          overflow: 'hidden',
          boxShadow: '0 20px 60px rgba(0,0,0,0.6)'
        }}>
          {/* Template 1: Modern Minimal */}
          {t.style === 't1' && (
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
              <div style={{ background: ac, padding: `${state.marginTop}px ${state.marginRight}px ${state.marginTop * 0.7}px ${state.marginLeft}px`, display: 'flex', gap: '20px', alignItems: 'center' }}>
                {renderPhoto(76)}
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '30px', fontWeight: 700, color: 'white' }}>{state.name || 'Your Name'}</div>
                  <div style={{ fontSize: '13px', color: 'rgba(255,255,255,0.75)' }}>{state.title}</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', fontSize: '11px', color: 'rgba(255,255,255,0.65)', marginTop: '5px' }}>
                    {state.email && <span>{state.showProfileIcons ? '✉ ' : ''}{state.email}</span>}
                    {state.phone && <span>{state.showProfileIcons ? '📞 ' : ''}{state.phone}</span>}
                    {state.location && <span>{state.showProfileIcons ? '📍 ' : ''}{state.location}</span>}
                  </div>
                </div>
                {state.showQRCode && <div style={{ marginLeft: 'auto' }}>{renderQR(60)}</div>}
              </div>
              <div style={{ display: 'flex', flex: 1 }}>
                <div style={{ width: '220px', background: sc, padding: '20px 15px', color: sideIsDark ? 'white' : '#333', position: 'relative' }}>
                  {renderSidebarPattern()}
                  <div style={{ position: 'relative', zIndex: 1 }}>
                    {renderHeader('Personal Profile')}
                    <div style={{ fontSize: '12px', marginBottom: '20px' }}>{state.summary}</div>
                    {renderHeader('Skills')}
                    {state.skills.map((s: any, i: number) => (
                      <div key={i} style={{ marginBottom: '10px' }}>
                        <div style={{ fontSize: '11px', display: 'flex', justifyContent: 'space-between' }}><span>{s.name}</span></div>
                        {renderSkillLevel(s.pct)}
                      </div>
                    ))}
                  </div>
                </div>
                <div style={{ flex: 1, padding: '20px', background: 'white' }}>
                  {state.sectionOrder.map((sec: string) => {
                    if (sec === 'summary' || sec === 'skills') return null; // Already in sidebar
                    return renderSection(sec);
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Template 2: Bold Side */}
          {t.style === 't2' && (
            <div style={{ display: 'flex', height: '100%' }}>
              <div style={{ width: '240px', background: sc, padding: '40px 20px', color: sideIsDark ? 'white' : '#333', position: 'relative' }}>
                {renderSidebarPattern()}
                <div style={{ position: 'relative', zIndex: 1 }}>
                  {renderPhoto(100, `4px solid ${ac}`)}
                  <div style={{ fontSize: '10px', fontWeight: 700, color: ac, textTransform: 'uppercase', marginBottom: '10px', marginTop: state.photoData ? '20px' : '0' }}>Contact</div>
                  {state.email && <div style={{ fontSize: '11px', marginBottom: '5px' }}>{state.showProfileIcons ? '✉ ' : ''}{state.email}</div>}
                  {state.phone && <div style={{ fontSize: '11px', marginBottom: '5px' }}>{state.showProfileIcons ? '📞 ' : ''}{state.phone}</div>}
                  {state.location && <div style={{ fontSize: '11px', marginBottom: '20px' }}>{state.showProfileIcons ? '📍 ' : ''}{state.location}</div>}
                  
                  {state.showQRCode && <div style={{ marginBottom: '30px' }}>{renderQR(80)}</div>}
                  {renderHeader('Skills')}
                  {state.skills.map((s: any, i: number) => (
                    <div key={i} style={{ marginBottom: '10px' }}>
                      <div style={{ fontSize: '11px' }}>{s.name}</div>
                      {renderSkillLevel(s.pct)}
                    </div>
                  ))}
                </div>
              </div>
              <div style={{ flex: 1, padding: '40px', background: 'white' }}>
                <div style={{ fontSize: '36px', fontWeight: 700, color: '#1a1a2e', marginBottom: '5px' }}>{state.name}</div>
                <div style={{ fontSize: '16px', color: ac, fontWeight: 500, marginBottom: '30px' }}>{state.title}</div>
                {state.sectionOrder.map((sec: string) => renderSection(sec))}
              </div>
            </div>
          )}

          {/* Template 3: Executive */}
          {t.style === 't3' && (
            <div style={{ padding: `${state.marginTop}px ${state.marginRight}px` }}>
              <div style={{ textAlign: 'center', borderBottom: `2px solid ${ac}`, paddingBottom: '20px', marginBottom: '20px' }}>
                <div style={{ fontSize: '32px', fontWeight: 700, color: '#1a1a2e' }}>{state.name}</div>
                <div style={{ fontSize: '14px', color: ac, textTransform: 'uppercase', marginTop: '5px' }}>
                  <span style={{ letterSpacing: '1px' }}>{state.title}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'center', gap: '15px', fontSize: '11px', color: mutedCol, marginTop: '10px' }}>
                  <span>{state.email}</span> | <span>{state.phone}</span> | <span>{state.location}</span>
                </div>
              </div>
              {state.sectionOrder.map((sec: string) => renderSection(sec))}
            </div>
          )}

          {/* Template 5: Cyberpunk */}
          {t.style === 't5' && (
            <div style={{ background: '#000', color: '#fff', height: '100%', padding: '40px', border: `10px solid ${ac}` }}>
              <div style={{ borderBottom: `4px solid ${ac}`, paddingBottom: '20px', marginBottom: '30px' }}>
                <div style={{ fontSize: '48px', fontWeight: 900, textTransform: 'uppercase', color: ac, textShadow: `2px 2px 0px #fff` }}>{state.name}</div>
                <div style={{ fontSize: '18px', fontWeight: 700, color: '#fff', background: ac, display: 'inline-block', padding: '2px 10px', marginTop: '10px' }}>{state.title}</div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '40px' }}>
                <div>
                  {renderHeader('Contact')}
                  <div style={{ fontSize: '12px', marginBottom: '20px' }}>
                    <div>{state.email}</div>
                    <div>{state.phone}</div>
                    <div>{state.location}</div>
                  </div>
                  {renderHeader('Skills')}
                  {state.skills.map((s: any, i: number) => (
                    <div key={i} style={{ marginBottom: '10px' }}>
                      <div style={{ fontSize: '11px' }}>{s.name}</div>
                      {renderSkillLevel(s.pct)}
                    </div>
                  ))}
                </div>
                <div>
                  {state.sectionOrder.map((sec: string) => {
                    if (sec === 'skills') return null;
                    return renderSection(sec);
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Template 6: Swiss Grid */}
          {t.style === 't6' && (
            <div style={{ padding: '60px', fontFamily: 'Helvetica, Arial, sans-serif' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '60px', borderBottom: '2px solid #000', paddingBottom: '40px', marginBottom: '40px' }}>
                <div style={{ fontSize: '64px', fontWeight: 800, lineHeight: 0.9, letterSpacing: '-2px' }}>{state.name?.split(' ')[0]}<br/>{state.name?.split(' ')[1]}</div>
                <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
                  <div style={{ fontSize: '20px', fontWeight: 700, marginBottom: '10px' }}>{state.title}</div>
                  <div style={{ fontSize: '12px' }}>{state.email} / {state.phone} / {state.location}</div>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '60px' }}>
                <div>{renderSection('summary')}{renderSection('experience')}</div>
                <div>{renderSection('skills')}{renderSection('education')}{renderSection('projects')}</div>
              </div>
            </div>
          )}

          {/* Template 7: Brutalist */}
          {t.style === 't7' && (
            <div style={{ padding: '40px', border: '4px solid #000' }}>
              <div style={{ background: '#000', color: '#fff', padding: '20px', marginBottom: '40px' }}>
                <div style={{ fontSize: '40px', fontWeight: 900 }}>{state.name}</div>
                <div style={{ fontSize: '20px' }}>{state.title}</div>
              </div>
              <div style={{ border: '4px solid #000', padding: '20px', marginBottom: '20px' }}>
                {renderSection('summary')}
              </div>
              <div style={{ display: 'flex', gap: '20px' }}>
                <div style={{ flex: 2, border: '4px solid #000', padding: '20px' }}>{renderSection('experience')}</div>
                <div style={{ flex: 1, border: '4px solid #000', padding: '20px' }}>{renderSection('skills')}{renderSection('education')}</div>
              </div>
            </div>
          )}

          {/* Template 8: Retro Terminal */}
          {t.style === 't8' && (
            <div style={{ background: '#000', color: ac, fontFamily: 'monospace', padding: '40px', height: '100%' }}>
              <div style={{ borderBottom: `1px solid ${ac}`, paddingBottom: '10px', marginBottom: '20px' }}>
                <div>&gt; WHOAMI</div>
                <div style={{ fontSize: '24px', fontWeight: 700 }}>{state.name}</div>
                <div>&gt; POSITION: {state.title}</div>
              </div>
              <div style={{ marginBottom: '20px' }}>
                <div>&gt; CONTACT</div>
                <div style={{ paddingLeft: '20px' }}>
                  {state.email} | {state.phone} | {state.location}
                </div>
              </div>
              {state.sectionOrder.map((sec: string) => (
                <div key={sec} style={{ marginBottom: '20px' }}>
                  <div>&gt; {SEC_LABELS[sec].toUpperCase()}</div>
                  <div style={{ paddingLeft: '20px' }}>{renderSection(sec)}</div>
                </div>
              ))}
            </div>
          )}

          {/* Template 9: Magazine Style */}
          {t.style === 't9' && (
            <div style={{ padding: '0', display: 'grid', gridTemplateColumns: '1.5fr 1fr', height: '100%' }}>
              <div style={{ padding: '60px 40px' }}>
                <div style={{ fontSize: '80px', fontWeight: 900, lineHeight: 0.8, marginBottom: '20px', letterSpacing: '-4px' }}>{state.name?.split(' ')[0]}<br/><span style={{ color: ac }}>{state.name?.split(' ')[1]}</span></div>
                <div style={{ fontSize: '20px', fontWeight: 300, marginBottom: '40px', fontStyle: 'italic' }}>{state.title}</div>
                {renderSection('summary')}
                {renderSection('experience')}
              </div>
              <div style={{ background: '#f4f4f4', padding: '60px 30px', borderLeft: '1px solid #ddd' }}>
                {renderSection('skills')}
                {renderSection('education')}
                {renderSection('projects')}
                {renderSection('awards')}
              </div>
            </div>
          )}

          {/* Template 10: The Architect */}
          {t.style === 't10' && (
            <div style={{ padding: '40px', border: `1px solid ${ac}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '40px' }}>
                <div>
                  <div style={{ fontSize: '42px', fontWeight: 300, letterSpacing: '4px', textTransform: 'uppercase' }}>{state.name}</div>
                  <div style={{ fontSize: '14px', color: ac, letterSpacing: '2px', marginTop: '5px' }}>{state.title}</div>
                </div>
                <div style={{ textAlign: 'right', fontSize: '11px', color: mutedCol }}>
                  <div>{state.email}</div>
                  <div>{state.phone}</div>
                  <div>{state.location}</div>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '40px' }}>
                <div>
                  {renderSection('skills')}
                  {renderSection('education')}
                </div>
                <div style={{ borderLeft: `1px solid ${ac}`, paddingLeft: '40px' }}>
                  {renderSection('summary')}
                  {renderSection('experience')}
                </div>
              </div>
            </div>
          )}

          {/* Template 11: Creative Bloom */}
          {t.style === 't11' && (
            <div style={{ padding: '40px', borderRadius: '30px', background: '#fff' }}>
              <div style={{ display: 'flex', gap: '30px', alignItems: 'center', marginBottom: '40px' }}>
                {renderPhoto(120, `6px solid ${ac}`)}
                <div>
                  <div style={{ fontSize: '38px', fontWeight: 800, color: '#1a1a2e' }}>{state.name}</div>
                  <div style={{ fontSize: '18px', color: ac, fontWeight: 600 }}>{state.title}</div>
                  <div style={{ display: 'flex', gap: '15px', marginTop: '10px', fontSize: '12px', color: mutedCol }}>
                    <span>{state.email}</span> • <span>{state.location}</span>
                  </div>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '30px' }}>
                <div style={{ background: `${ac}10`, padding: '25px', borderRadius: '20px' }}>
                  {renderSection('summary')}
                  {renderSection('skills')}
                </div>
                <div>
                  {renderSection('experience')}
                  {renderSection('education')}
                </div>
              </div>
            </div>
          )}

          {/* Template 12: Data Scientist */}
          {t.style === 't12' && (
            <div style={{ padding: '40px', background: '#0f172a', color: '#f1f5f9' }}>
              <div style={{ display: 'flex', borderBottom: `1px solid ${ac}`, paddingBottom: '20px', marginBottom: '30px' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '32px', fontWeight: 700, color: ac }}>{state.name}</div>
                  <div style={{ fontSize: '16px', fontWeight: 500 }}>{state.title}</div>
                </div>
                <div style={{ textAlign: 'right', fontSize: '11px' }}>
                  <div>{state.email}</div>
                  <div>{state.phone}</div>
                  <div>{state.location}</div>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '30px' }}>
                <div>
                  {renderSection('summary')}
                  {renderSection('experience')}
                  {renderSection('projects')}
                </div>
                <div style={{ background: 'rgba(255,255,255,0.05)', padding: '20px', borderRadius: '8px' }}>
                  {renderSection('skills')}
                  {renderSection('education')}
                  {renderSection('certifications')}
                </div>
              </div>
            </div>
          )}

          {/* Template 13: Bento Grid */}
          {t.style === 't13' && (
            <div style={{ padding: '30px', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px' }}>
              <div style={{ gridColumn: 'span 2', background: ac, color: 'white', padding: '30px', borderRadius: '16px' }}>
                <div style={{ fontSize: '40px', fontWeight: 800 }}>{state.name}</div>
                <div style={{ fontSize: '18px', opacity: 0.9 }}>{state.title}</div>
              </div>
              <div style={{ background: '#f1f5f9', padding: '20px', borderRadius: '16px' }}>
                <div style={{ fontWeight: 700, marginBottom: '10px' }}>Contact</div>
                <div style={{ fontSize: '11px' }}>{state.email}<br/>{state.phone}<br/>{state.location}</div>
              </div>
              <div style={{ gridColumn: 'span 1', background: '#f8fafc', padding: '20px', borderRadius: '16px', border: '1px solid #e2e8f0' }}>
                {renderSection('skills')}
              </div>
              <div style={{ gridColumn: 'span 2', background: '#ffffff', padding: '20px', borderRadius: '16px', border: '1px solid #e2e8f0' }}>
                {renderSection('experience')}
              </div>
              <div style={{ gridColumn: 'span 3', background: '#f1f5f9', padding: '20px', borderRadius: '16px' }}>
                {renderSection('summary')}
              </div>
            </div>
          )}

          {/* Template 14: Minimalist Serif */}
          {t.style === 't14' && (
            <div style={{ padding: '60px', fontFamily: 'serif' }}>
              <div style={{ textAlign: 'center', marginBottom: '60px' }}>
                <div style={{ fontSize: '48px', fontWeight: 400, letterSpacing: '2px' }}>{state.name}</div>
                <div style={{ fontSize: '14px', fontStyle: 'italic', color: ac, marginTop: '10px' }}>{state.title}</div>
                <div style={{ marginTop: '20px', fontSize: '11px', color: mutedCol, letterSpacing: '1px' }}>
                  {state.email} • {state.phone} • {state.location}
                </div>
              </div>
              <div style={{ maxWidth: '600px', margin: '0 auto' }}>
                {state.sectionOrder.map((sec: string) => renderSection(sec))}
              </div>
            </div>
          )}

          {/* Template 15: Dark Mode Elite */}
          {t.style === 't15' && (
            <div style={{ background: '#000', color: '#fff', padding: '0', height: '100%' }}>
              <div style={{ background: ac, color: '#000', padding: '60px 40px' }}>
                <div style={{ fontSize: '56px', fontWeight: 900, textTransform: 'uppercase', lineHeight: 1 }}>{state.name}</div>
                <div style={{ fontSize: '20px', fontWeight: 700, marginTop: '10px' }}>{state.title}</div>
              </div>
              <div style={{ padding: '40px', display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '40px' }}>
                <div>
                  <div style={{ fontSize: '12px', color: ac, fontWeight: 700, marginBottom: '20px' }}>CONTACT</div>
                  <div style={{ fontSize: '13px', marginBottom: '40px' }}>
                    <div>{state.email}</div>
                    <div>{state.phone}</div>
                    <div>{state.location}</div>
                  </div>
                  {renderSection('skills')}
                </div>
                <div>
                  {renderSection('summary')}
                  {renderSection('experience')}
                  {renderSection('education')}
                </div>
              </div>
            </div>
          )}

          {/* Fallback for other templates (t4, etc.) */}
          {t.style !== 't1' && t.style !== 't2' && t.style !== 't3' && t.style !== 't5' && t.style !== 't6' && t.style !== 't7' && t.style !== 't8' && t.style !== 't9' && t.style !== 't10' && t.style !== 't11' && t.style !== 't12' && t.style !== 't13' && t.style !== 't14' && t.style !== 't15' && (
            <div style={{ padding: '40px' }}>
              <div style={{ fontSize: '32px', fontWeight: 700, color: ac }}>{state.name || 'Your Name'}</div>
              <div style={{ fontSize: '16px', color: mutedCol }}>{state.title}</div>
              <hr style={{ margin: '20px 0', borderColor: ac }} />
              {state.sectionOrder.map((sec: string) => renderSection(sec))}
            </div>
          )}
        </div>
      );
    };

    // UI Components
    const CardItem = ({ title, onRemove, children }: any) => (
      <div className="card-item">
        <div className="card-item-header">
          <span className="card-item-title">{title}</span>
          <div className="card-actions">
            <button className="card-btn card-remove" onClick={onRemove}>×</button>
          </div>
        </div>
        {children}
      </div>
    );

    return (
      <div className={viewMode === 'mobile' ? 'mode-mobile mview-' + mobileTab : 'mode-desktop'}>
        {!user && <LandingPage />}
        
        {/* Topbar */}
        <div className="topbar">
          <div className="logo">BuildMy<span>Resume</span></div>
          <button className="top-btn" onClick={() => setStartModal(true)}>✦ New</button>
          <button className="top-btn" onClick={() => fileInputRef.current?.click()}>↑ Import</button>
          <input type="file" ref={fileInputRef} accept=".txt,.pdf,.doc,.docx" style={{ display: 'none' }} onChange={handleUpload} />
          <button className="top-btn" onClick={() => setProfilesModal(true)}>⊞ Profiles</button>
          <div className="top-sep"></div>
          <div className="view-switcher">
            <button className={`view-btn ${viewMode === 'desktop' ? 'active-view' : ''}`} onClick={() => setViewMode('desktop')}>Desktop</button>
            <button className={`view-btn ${viewMode === 'mobile' ? 'active-view' : ''}`} onClick={() => setViewMode('mobile')}>Mobile</button>
          </div>
          <div className="top-sep"></div>
          <button className="top-btn" onClick={undo} disabled={undoStack.length === 0}>↩</button>
          <button className="top-btn" onClick={redo} disabled={redoStack.length === 0}>↪</button>
          <div className="top-sep"></div>
          {user ? (
            <div className="user-menu" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <img src={user.photoURL || `https://ui-avatars.com/api/?name=${user.displayName}`} className="user-avatar" style={{ width: '32px', height: '32px', borderRadius: '50%', cursor: 'pointer' }} onClick={() => setShowResumesModal(true)} />
              <button className="top-btn" onClick={handleLogout}>Logout</button>
            </div>
          ) : (
            <button className="top-btn primary" onClick={handleLogin}>Login</button>
          )}
        </div>

        <div className="main">
          {/* Left Panel */}
          <div className="left-panel">
            <div className="panel-tabs">
              {['content', 'sections', 'design', 'templates', 'jobs'].map(t => (
                <div key={t} className={`panel-tab ${activeTab === t ? 'active' : ''}`} onClick={() => setActiveTab(t)}>{t}</div>
              ))}
            </div>
            <div className="panel-body">
              {activeTab === 'content' && (
                <>
                  <div className="section-label">AI Superpowers</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '20px' }}>
                    <button className="add-btn" onClick={startInterview} style={{ background: 'var(--accent)', color: 'white', border: 'none' }}>🎙️ AI Interview Mode</button>
                    <button className="add-btn" onClick={() => setStartModal(true)}>📂 Import Resume</button>
                  </div>

                  <div className="section-label">Save & Backup</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '20px' }}>
                    <button className="add-btn" onClick={() => saveResumeToCloud()} style={{ background: 'var(--accent)', color: 'white', border: 'none' }}>☁ Save to Cloud</button>
                    <button className="add-btn" onClick={() => setShowResumesModal(true)}>📂 My Resumes</button>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '20px' }}>
                    <button className="add-btn" onClick={saveToBrowser}>💾 Save Locally</button>
                    <button className="add-btn" onClick={exportJSON}>📤 Export JSON</button>
                  </div>

                  <div className="section-label">AI Settings</div>
                  <div className="field">
                    <label>Writing Tone</label>
                    <select className="field" value={tone} onChange={e => setTone(e.target.value)}>
                      <option>Professional</option>
                      <option>Creative</option>
                      <option>Modern</option>
                      <option>Academic</option>
                      <option>Minimalist</option>
                    </select>
                  </div>

                  <div className="section-label">Personal Info</div>
                  <div className="photo-upload-area" onClick={() => photoInputRef.current?.click()}>
                    {state.photoData ? <img src={state.photoData} className="photo-preview" /> : <div className="photo-placeholder">👤</div>}
                    <div className="photo-hint">Click to add photo</div>
                  </div>
                  <input type="file" ref={photoInputRef} accept="image/*" style={{ display: 'none' }} onChange={handlePhoto} />
                  <div className="field"><label>Full Name</label><input type="text" value={state.name} onChange={e => setState({ ...state, name: e.target.value })} /></div>
                  <div className="field"><label>Job Title</label><input type="text" value={state.title} onChange={e => setState({ ...state, title: e.target.value })} /></div>
                  <div className="two-col">
                    <div className="field"><label>Email</label><input type="text" value={state.email} onChange={e => setState({ ...state, email: e.target.value })} /></div>
                    <div className="field"><label>Phone</label><input type="text" value={state.phone} onChange={e => setState({ ...state, phone: e.target.value })} /></div>
                  </div>
                  <div className="two-col">
                    <div className="field"><label>Location</label><input type="text" value={state.location} onChange={e => setState({ ...state, location: e.target.value })} /></div>
                    <div className="field"><label>Website</label><input type="text" value={state.web} onChange={e => setState({ ...state, web: e.target.value })} /></div>
                  </div>
                  
                  <div className="section-label">Summary</div>
                  <div className="field">
                    <textarea value={state.summary} onChange={e => setState({ ...state, summary: e.target.value })} />
                    <button className="enhance-btn" onClick={() => aiEnhanceField('summary', state.summary)}>✨ Enhance</button>
                  </div>
                  <button className="add-btn" onClick={aiSummaryTemplate}>✦ AI Summary Template</button>

                  <div className="section-label">Experience</div>
                  {state.exp.map((e: any, i: number) => (
                    <CardItem key={i} title={`Job ${i+1}`} onRemove={() => { const n = [...state.exp]; n.splice(i, 1); setState({ ...state, exp: n }); }}>
                      <div className="field"><input type="text" placeholder="Role" value={e.role} onChange={v => { const n = [...state.exp]; n[i].role = v.target.value; setState({ ...state, exp: n }); }} /></div>
                      <div className="field"><input type="text" placeholder="Company" value={e.company} onChange={v => { const n = [...state.exp]; n[i].company = v.target.value; setState({ ...state, exp: n }); }} /></div>
                      <div className="two-col">
                        <div className="field"><input type="text" placeholder="Start" value={e.start} onChange={v => { const n = [...state.exp]; n[i].start = v.target.value; setState({ ...state, exp: n }); }} /></div>
                        <div className="field"><input type="text" placeholder="End" value={e.end} onChange={v => { const n = [...state.exp]; n[i].end = v.target.value; setState({ ...state, exp: n }); }} /></div>
                      </div>
                      <div className="field">
                        <textarea placeholder="Description" value={e.desc} onChange={v => { const n = [...state.exp]; n[i].desc = v.target.value; setState({ ...state, exp: n }); }} />
                        <button className="enhance-btn" onClick={() => aiImproveBullets('exp', i)}>✨ Improve Bullets</button>
                      </div>
                    </CardItem>
                  ))}
                  <button className="add-btn" onClick={() => setState({ ...state, exp: [...state.exp, { role: '', company: '', start: '', end: '', desc: '' }] })}>+ Add Experience</button>

                  <div className="section-label">Education</div>
                  {state.edu.map((e: any, i: number) => (
                    <CardItem key={i} title={`Edu ${i+1}`} onRemove={() => { const n = [...state.edu]; n.splice(i, 1); setState({ ...state, edu: n }); }}>
                      <div className="field"><input type="text" placeholder="Degree" value={e.degree} onChange={v => { const n = [...state.edu]; n[i].degree = v.target.value; setState({ ...state, edu: n }); }} /></div>
                      <div className="field"><input type="text" placeholder="School" value={e.school} onChange={v => { const n = [...state.edu]; n[i].school = v.target.value; setState({ ...state, edu: n }); }} /></div>
                      <div className="field"><input type="text" placeholder="Year" value={e.year} onChange={v => { const n = [...state.edu]; n[i].year = v.target.value; setState({ ...state, edu: n }); }} /></div>
                    </CardItem>
                  ))}
                  <button className="add-btn" onClick={() => setState({ ...state, edu: [...state.edu, { degree: '', school: '', year: '' }] })}>+ Add Education</button>

                  <div className="section-label">Internships</div>
                  {state.intern.map((e: any, i: number) => (
                    <CardItem key={i} title={`Internship ${i+1}`} onRemove={() => { const n = [...state.intern]; n.splice(i, 1); setState({ ...state, intern: n }); }}>
                      <div className="field"><input type="text" placeholder="Role" value={e.role} onChange={v => { const n = [...state.intern]; n[i].role = v.target.value; setState({ ...state, intern: n }); }} /></div>
                      <div className="field"><input type="text" placeholder="Company" value={e.company} onChange={v => { const n = [...state.intern]; n[i].company = v.target.value; setState({ ...state, intern: n }); }} /></div>
                      <div className="two-col">
                        <div className="field"><input type="text" placeholder="Start" value={e.start} onChange={v => { const n = [...state.intern]; n[i].start = v.target.value; setState({ ...state, intern: n }); }} /></div>
                        <div className="field"><input type="text" placeholder="End" value={e.end} onChange={v => { const n = [...state.intern]; n[i].end = v.target.value; setState({ ...state, intern: n }); }} /></div>
                      </div>
                      <div className="field">
                        <textarea placeholder="Description" value={e.desc} onChange={v => { const n = [...state.intern]; n[i].desc = v.target.value; setState({ ...state, intern: n }); }} />
                        <button className="enhance-btn" onClick={() => aiImproveBullets('intern', i)}>✨ Improve Bullets</button>
                      </div>
                    </CardItem>
                  ))}
                  <button className="add-btn" onClick={() => setState({ ...state, intern: [...state.intern, { role: '', company: '', start: '', end: '', desc: '' }] })}>+ Add Internship</button>

                  <div className="section-label">Projects</div>
                  {state.proj.map((p: any, i: number) => (
                    <CardItem key={i} title={`Project ${i+1}`} onRemove={() => { const n = [...state.proj]; n.splice(i, 1); setState({ ...state, proj: n }); }}>
                      <div className="field"><input type="text" placeholder="Project Name" value={p.name} onChange={v => { const n = [...state.proj]; n[i].name = v.target.value; setState({ ...state, proj: n }); }} /></div>
                      <div className="field"><input type="text" placeholder="Link (Github/Live)" value={p.link} onChange={v => { const n = [...state.proj]; n[i].link = v.target.value; setState({ ...state, proj: n }); }} /></div>
                      <div className="field">
                        <textarea placeholder="Description" value={p.desc} onChange={v => { const n = [...state.proj]; n[i].desc = v.target.value; setState({ ...state, proj: n }); }} />
                        <button className="enhance-btn" onClick={() => aiImproveBullets('proj', i)}>✨ Improve Bullets</button>
                      </div>
                    </CardItem>
                  ))}
                  <button className="add-btn" onClick={() => setState({ ...state, proj: [...state.proj, { name: '', link: '', desc: '' }] })}>+ Add Project</button>

                  <div className="section-label">Certifications</div>
                  {state.cert.map((c: any, i: number) => (
                    <CardItem key={i} title={`Cert ${i+1}`} onRemove={() => { const n = [...state.cert]; n.splice(i, 1); setState({ ...state, cert: n }); }}>
                      <div className="field"><input type="text" placeholder="Name" value={c.name} onChange={v => { const n = [...state.cert]; n[i].name = v.target.value; setState({ ...state, cert: n }); }} /></div>
                      <div className="field"><input type="text" placeholder="Issuer" value={c.issuer} onChange={v => { const n = [...state.cert]; n[i].issuer = v.target.value; setState({ ...state, cert: n }); }} /></div>
                      <div className="field"><input type="text" placeholder="Year" value={c.year} onChange={v => { const n = [...state.cert]; n[i].year = v.target.value; setState({ ...state, cert: n }); }} /></div>
                    </CardItem>
                  ))}
                  <button className="add-btn" onClick={() => setState({ ...state, cert: [...state.cert, { name: '', issuer: '', year: '' }] })}>+ Add Certification</button>

                  <div className="section-label">Languages</div>
                  {state.lang.map((l: any, i: number) => (
                    <div key={i} className="two-col" style={{ marginBottom: '10px' }}>
                      <input type="text" placeholder="Language" value={l.lang} onChange={v => { const n = [...state.lang]; n[i].lang = v.target.value; setState({ ...state, lang: n }); }} />
                      <select value={l.level} onChange={v => { const n = [...state.lang]; n[i].level = v.target.value; setState({ ...state, lang: n }); }}>
                        <option>Native</option>
                        <option>Fluent</option>
                        <option>Intermediate</option>
                        <option>Basic</option>
                      </select>
                      <button onClick={() => { const n = [...state.lang]; n.splice(i, 1); setState({ ...state, lang: n }); }}>×</button>
                    </div>
                  ))}
                  <button className="add-btn" onClick={() => setState({ ...state, lang: [...state.lang, { lang: '', level: 'Fluent' }] })}>+ Add Language</button>

                  <div className="section-label">Interests</div>
                  <div className="field">
                    <textarea placeholder="Hobbies, interests..." value={state.interests} onChange={e => setState({ ...state, interests: e.target.value })} />
                    <button className="enhance-btn" onClick={() => aiEnhanceField('interests', state.interests)}>✨ Enhance</button>
                  </div>

                  <div className="section-label">Skills</div>
                  <div className="skill-tags">
                    {state.skills.map((s: any, i: number) => (
                      <div key={i} className="skill-tag">{s.name} <button onClick={() => { const n = [...state.skills]; n.splice(i, 1); setState({ ...state, skills: n }); }}>×</button></div>
                    ))}
                  </div>
                  <div className="skill-input-row">
                    <input type="text" id="new-skill" placeholder="Add skill..." onKeyDown={e => { if(e.key === 'Enter') { const v = (e.target as any).value; if(v) { setState({ ...state, skills: [...state.skills, { name: v, level: 'Intermediate', pct: 60 }] }); (e.target as any).value = ''; } } }} />
                  </div>
                  <button className="add-btn" style={{ marginTop: '10px' }} onClick={suggestSkills}>🧠 Suggest Skills for ${state.title || 'Role'}</button>
                </>
              )}
              {activeTab === 'sections' && (
                <>
                  <div className="section-label">Order & Visibility</div>
                  <div ref={sectionOrderRef}>
                    {state.sectionOrder.map((sec: string) => (
                      <div key={sec} className="sec-drag-item" data-sec={sec}>
                        <span className="sec-drag-icon">⠿</span>
                        <span className="sec-drag-label">{SEC_LABELS[sec]}</span>
                        <span className="sec-drag-vis" onClick={() => setState((prev: any) => ({ ...prev, sectionVisible: { ...prev.sectionVisible, [sec]: prev.sectionVisible[sec] === false } }))}>
                          {state.sectionVisible[sec] === false ? '👁‍🗨' : '👁'}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="section-label">Auto-hide</div>
                  <div className="toggle-row">
                    <span>Hide empty sections</span>
                    <label className="toggle-switch"><input type="checkbox" checked={state.autoHide} onChange={e => setState({ ...state, autoHide: e.target.checked })} /><span className="toggle-track"></span></label>
                  </div>
                </>
              )}
              {activeTab === 'design' && (
                <>
                  <div className="section-label">Bullet Style</div>
                  <select className="field" value={state.bulletStyle} onChange={e => setState({ ...state, bulletStyle: e.target.value })}>
                    <option value="disc">Standard Dot</option>
                    <option value="circle">Hollow Circle</option>
                    <option value="square">Square</option>
                    <option value="arrow">Arrow (→)</option>
                    <option value="bubble">Bubble (•)</option>
                    <option value="none">None</option>
                  </select>

                  <div className="section-label">Skill Design</div>
                  <select className="field" value={state.skillStyle} onChange={e => setState({ ...state, skillStyle: e.target.value })}>
                    <option value="bar">Progress Bar</option>
                    <option value="dots">Dots (1-5)</option>
                    <option value="stars">Stars (★)</option>
                    <option value="text">Text Only</option>
                  </select>

                  <div className="section-label">Header Style</div>
                  <select className="field" value={state.headerStyle} onChange={e => setState({ ...state, headerStyle: e.target.value })}>
                    <option value="none">Plain</option>
                    <option value="underline">Underline</option>
                    <option value="background">Background Pill</option>
                    <option value="border-left">Left Border</option>
                  </select>

                  <div className="section-label">Photo Shape</div>
                  <select className="field" value={state.photoShape} onChange={e => setState({ ...state, photoShape: e.target.value })}>
                    <option value="circle">Circle</option>
                    <option value="rounded">Rounded Square</option>
                    <option value="square">Square</option>
                  </select>

                  <div className="section-label">Title Case</div>
                  <select className="field" value={state.titleCase} onChange={e => setState({ ...state, titleCase: e.target.value })}>
                    <option value="uppercase">UPPERCASE</option>
                    <option value="capitalize">Capitalize</option>
                  </select>

                  <div className="section-label">Divider Style</div>
                  <select className="field" value={state.dividerStyle} onChange={e => setState({ ...state, dividerStyle: e.target.value })}>
                    <option value="none">None</option>
                    <option value="solid">Solid Line</option>
                    <option value="dashed">Dashed Line</option>
                    <option value="dotted">Dotted Line</option>
                  </select>

                  <div className="toggle-row" style={{ marginTop: '15px' }}>
                    <span>Compact Mode</span>
                    <label className="toggle-switch"><input type="checkbox" checked={state.compactMode} onChange={e => setState({ ...state, compactMode: e.target.checked })} /><span className="toggle-track"></span></label>
                  </div>

                  <div className="toggle-row" style={{ marginTop: '10px' }}>
                    <span>Show Section Icons</span>
                    <label className="toggle-switch"><input type="checkbox" checked={state.showSectionIcons} onChange={e => setState({ ...state, showSectionIcons: e.target.checked })} /><span className="toggle-track"></span></label>
                  </div>

                  <div className="toggle-row" style={{ marginTop: '10px' }}>
                    <span>Show Profile Icons</span>
                    <label className="toggle-switch"><input type="checkbox" checked={state.showProfileIcons} onChange={e => setState({ ...state, showProfileIcons: e.target.checked })} /><span className="toggle-track"></span></label>
                  </div>

                  <div className="toggle-row" style={{ marginTop: '10px' }}>
                    <span>Show QR Code</span>
                    <label className="toggle-switch"><input type="checkbox" checked={state.showQRCode} onChange={e => setState({ ...state, showQRCode: e.target.checked })} /><span className="toggle-track"></span></label>
                  </div>
                  {state.showQRCode && (
                    <div className="field" style={{ marginTop: '10px' }}>
                      <label>QR Link (Portfolio/LinkedIn)</label>
                      <input type="text" placeholder="https://..." value={state.qrUrl} onChange={e => setState({ ...state, qrUrl: e.target.value })} />
                    </div>
                  )}

                  <div className="section-label">Page Size</div>
                  <select className="field" value={pageSize} onChange={e => setPageSize(e.target.value)}>
                    <option value="a4">A4 (International)</option>
                    <option value="letter">Letter (US)</option>
                  </select>

                  <div className="section-label">Sidebar Pattern</div>
                  <select className="field" value={state.sidebarPattern} onChange={e => setState({ ...state, sidebarPattern: e.target.value })}>
                    <option value="none">None</option>
                    <option value="dots">Subtle Dots</option>
                    <option value="lines">Subtle Lines</option>
                    <option value="grid">Subtle Grid</option>
                  </select>

                  <div className="section-label">Accent Color</div>
                  <div className="color-row">
                    {['#2563eb', '#7c3aed', '#dc2626', '#059669', '#d97706'].map(c => (
                      <div key={c} className={`color-swatch ${state.accentColor === c ? 'active' : ''}`} style={{ background: c }} onClick={() => setState({ ...state, accentColor: c })} />
                    ))}
                    <div className="color-custom"><input type="color" value={state.accentColor} onChange={e => setState({ ...state, accentColor: e.target.value })} /></div>
                  </div>
                  <div className="section-label">Secondary Color</div>
                  <div className="color-row">
                    {['#f8fafc', '#f0f9ff', '#faf5ff', '#1e293b', '#0f172a'].map(c => (
                      <div key={c} className={`color-swatch ${state.secondaryColor === c ? 'active' : ''}`} style={{ background: c }} onClick={() => setState({ ...state, secondaryColor: c })} />
                    ))}
                    <div className="color-custom"><input type="color" value={state.secondaryColor} onChange={e => setState({ ...state, secondaryColor: e.target.value })} /></div>
                  </div>
                  <div className="section-label">Font Color</div>
                  <div className="color-row">
                    {['#1a1a2e', '#334155', '#4b5563', '#000000', '#ffffff'].map(c => (
                      <div key={c} className={`color-swatch ${state.fontColor === c ? 'active' : ''}`} style={{ background: c, border: c === '#ffffff' ? '1px solid #ddd' : 'none' }} onClick={() => setState({ ...state, fontColor: c })} />
                    ))}
                    <div className="color-custom"><input type="color" value={state.fontColor} onChange={e => setState({ ...state, fontColor: e.target.value })} /></div>
                  </div>
                  <div className="section-label">Font Family</div>
                  <select className="field" value={state.font} onChange={e => setState({ ...state, font: e.target.value })}>
                    <option value="'DM Sans',sans-serif">DM Sans</option>
                    <option value="'Playfair Display',serif">Playfair Display</option>
                    <option value="Georgia,serif">Georgia</option>
                    <option value="'Inter',sans-serif">Inter</option>
                    <option value="'Roboto',sans-serif">Roboto</option>
                  </select>

                  <div className="two-col">
                    <div className="field">
                      <label>Font Weight</label>
                      <select value={state.fontWeight} onChange={e => setState({ ...state, fontWeight: e.target.value })}>
                        <option value="300">Light</option>
                        <option value="400">Regular</option>
                        <option value="500">Medium</option>
                        <option value="600">Semi-Bold</option>
                        <option value="700">Bold</option>
                      </select>
                    </div>
                    <div className="field">
                      <label>Line Height</label>
                      <input type="number" step="0.1" min="1" max="2" value={state.lineHeight} onChange={e => setState({ ...state, lineHeight: parseFloat(e.target.value) })} />
                    </div>
                  </div>

                  <div className="section-label">Font Size</div>
                  <input type="range" min="80" max="120" value={state.fontSize} onChange={e => setState({ ...state, fontSize: parseInt(e.target.value) })} />
                  <div className="section-label">Margins & Spacing</div>
                  <div className="two-col">
                    <div className="field"><label>Top (mm)</label><input type="number" value={state.marginTop} onChange={e => setState({ ...state, marginTop: parseInt(e.target.value) })} /></div>
                    <div className="field"><label>Bottom (mm)</label><input type="number" value={state.marginBottom} onChange={e => setState({ ...state, marginBottom: parseInt(e.target.value) })} /></div>
                  </div>
                  <div className="two-col">
                    <div className="field"><label>Left (mm)</label><input type="number" value={state.marginLeft} onChange={e => setState({ ...state, marginLeft: parseInt(e.target.value) })} /></div>
                    <div className="field"><label>Right (mm)</label><input type="number" value={state.marginRight} onChange={e => setState({ ...state, marginRight: parseInt(e.target.value) })} /></div>
                  </div>
                  <div className="field">
                    <label>Section Spacing (px)</label>
                    <input type="range" min="10" max="60" value={state.sectionSpacing} onChange={e => setState({ ...state, sectionSpacing: parseInt(e.target.value) })} />
                  </div>
                </>
              )}
              {activeTab === 'templates' && (
                <div className="templates-grid">
                  {TEMPLATES.map((t, i) => (
                    <div key={i} className={`tpl-card ${state.template === i ? 'active' : ''}`} onClick={() => setState({ ...state, template: i, accentColor: t.palette[0], secondaryColor: t.palette[1] })}>
                      <div className="tpl-thumb" style={{ background: t.palette[1], color: t.palette[0] }}>
                        {t.badge && <span className="tpl-badge">{t.badge}</span>}
                        {t.style.toUpperCase()}
                      </div>
                      <div className="tpl-label">{t.name}</div>
                    </div>
                  ))}
                </div>
              )}
              {activeTab === 'jobs' && (
                <div className="jobs-panel">
                  <div className="section-label">Job Finder</div>
                  <div className="field">
                    <label>Job Title / Keywords</label>
                    <input type="text" placeholder="e.g. Frontend Developer" value={jobQuery} onChange={e => setJobQuery(e.target.value)} />
                  </div>
                  <div className="field">
                    <label>Location</label>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <input type="text" placeholder="e.g. London or Remote" value={jobLocation} onChange={e => setJobLocation(e.target.value)} style={{ flex: 1 }} />
                      <button className="add-btn" onClick={getCurrentLocation} style={{ width: 'auto', padding: '0 12px' }} title="Use my current location">📍</button>
                    </div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                    <button className="add-btn" onClick={() => findJobs(false)}>🔍 Find Best Jobs</button>
                    <button className="add-btn" onClick={() => findJobs(true)} style={{ background: 'var(--accent)', color: 'white', border: 'none' }}>🧠 Match My Resume</button>
                  </div>
                  
                  <div className="jobs-list" style={{ marginTop: '20px' }}>
                    {jobs.map((j, i) => (
                      <div key={i} className="job-card" style={{ border: '1px solid var(--border)', padding: '15px', borderRadius: '8px', marginBottom: '10px', background: 'var(--surface2)' }}>
                        <div style={{ fontWeight: 700, fontSize: '14px', color: 'var(--accent)' }}>{j.title}</div>
                        <div style={{ color: 'var(--muted)', fontSize: '12px' }}>{j.company} • {j.location}</div>
                        <div style={{ fontSize: '11px', marginTop: '5px', color: 'var(--text)' }}>{j.desc}</div>
                        <button className="add-btn" style={{ marginTop: '10px', fontSize: '10px' }} onClick={() => window.open(`https://www.google.com/search?q=${j.title}+${j.company}+jobs`, '_blank')}>View Details</button>
                      </div>
                    ))}
                    {jobs.length === 0 && <div style={{ textAlign: 'center', color: 'var(--muted)', marginTop: '40px' }}>Search for jobs to see results here.</div>}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Preview Area */}
          <div className="preview-area">
            <div className="preview-controls">
              {[0.5, 0.65, 0.8, 1.0].map(z => (
                <button key={z} className={`zoom-btn ${zoom === z ? 'active-z' : ''}`} onClick={() => setZoom(z)}>{z*100}%</button>
              ))}
              <button className="fit-btn" onClick={() => setZoom(0.65)}>⊡ Fit</button>
            </div>
            <div className="cv-wrapper" style={{ transform: `scale(${zoom})` }}>
              {renderCV()}
            </div>
          </div>

          {/* Right Panel */}
          <div className="right-panel">
            <div className="rpanel-section">
              <h3>CV Score</h3>
              <div className="score-ring-wrap">
                <div style={{ fontSize: '24px', fontWeight: 700, color: state.accentColor }}>{Math.round((state.name?10:0)+(state.exp.length*10)+(state.skills.length*5))}%</div>
              </div>
            </div>
            <div className="rpanel-section">
              <h3>🎯 ATS Score</h3>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '20px', color: '#50c878' }}>{atsScore || '—'}</div>
                <button className="export-btn" onClick={runATSCheck} style={{ marginTop: '10px' }}>Run ATS Check</button>
              </div>
              {atsIssues.length > 0 && <div style={{ fontSize: '10px', color: '#e05c5c', marginTop: '10px' }}>{atsIssues.slice(0,3).join(', ')}</div>}
            </div>
            <div className="rpanel-section">
              <h3>✨ AI Superpowers</h3>
              <button className="export-btn" onClick={generateCoverLetter}>✉ Cover Letter</button>
              <button className="export-btn" onClick={generateLinkedInHeadline}>💼 LinkedIn Headline</button>
              <button className="export-btn" onClick={analyzeKeywords}>🔍 Keyword Analyzer</button>
              <button className="export-btn" onClick={suggestImprovements}>💡 Full CV Review</button>
            </div>
            <div className="rpanel-section">
              <h3>Export</h3>
              <button className="export-btn export-pdf" onClick={exportPDF}>📄 PDF (High Quality)</button>
              <button className="export-btn export-png" onClick={exportPNG}>🖼 PNG Image</button>
              <button className="export-btn export-word" onClick={exportWord}>📝 Word (.doc)</button>
              <button className="export-btn export-txt" onClick={exportTXT}>🔤 Plain Text</button>
              <button className="export-btn" onClick={() => window.print()}>🖨 Print</button>
            </div>
          </div>
        </div>

        {/* Mobile Nav */}
        <div className="mobile-nav">
          {['edit', 'preview', 'design', 'tools', 'export'].map(t => (
            <button key={t} className={`mobile-nav-btn ${mobileTab === t ? 'active-mnav' : ''}`} onClick={() => setMobileTab(t)}>
              <span style={{ textTransform: 'capitalize' }}>{t}</span>
            </button>
          ))}
        </div>

        {/* Mobile Overlay Panels */}
        {viewMode === 'mobile' && (mobileTab === 'tools' || mobileTab === 'export') && (
          <div className="mobile-overlay-panel open">
            <div className="panel-inner">
              {mobileTab === 'tools' && (
                <>
                  <div className="section-label">✨ AI Superpowers</div>
                  <button className="export-btn" onClick={generateCoverLetter}>✉ Cover Letter</button>
                  <button className="export-btn" onClick={generateLinkedInHeadline}>💼 LinkedIn Headline</button>
                  <button className="export-btn" onClick={analyzeKeywords}>🔍 Keyword Analyzer</button>
                  <button className="export-btn" onClick={suggestImprovements}>💡 Full CV Review</button>
                  
                  <div className="section-label">ATS Check</div>
                  <div className="score-ring-wrap">
                    <div style={{ fontSize: '24px', fontWeight: 700, color: 'var(--accent)' }}>{getATSData().score}%</div>
                    <div className="score-label">ATS Match Score</div>
                  </div>
                  {getATSData().issues.map((iss, i) => (
                    <div key={i} className="tip-card warn">{iss}</div>
                  ))}
                </>
              )}
              {mobileTab === 'export' && (
                <>
                  <div className="section-label">Download Resume</div>
                  <button className="export-btn export-pdf" onClick={exportPDF}>📄 PDF (High Quality)</button>
                  <button className="export-btn export-png" onClick={exportPNG}>🖼 PNG Image</button>
                  <button className="export-btn export-word" onClick={exportWord}>📝 Word (.doc)</button>
                  <button className="export-btn export-txt" onClick={exportTXT}>🔤 Plain Text</button>
                  <button className="export-btn" onClick={() => window.print()}>🖨 Print</button>
                </>
              )}
            </div>
          </div>
        )}

        {/* Modals */}
        {startModal && (
          <div className="modal-overlay open">
            <div className="modal">
              <h2>Start Your Resume</h2>
              <div className="modal-actions">
                <button className="modal-btn primary" onClick={() => setStartModal(false)}>✦ Start Fresh</button>
                <button className="modal-btn" onClick={() => { loadSample(); setStartModal(false); }}>📋 Load Sample</button>
                <button className="modal-btn" onClick={() => { fileInputRef.current?.click(); setStartModal(false); }}>↑ Upload CV</button>
              </div>
            </div>
          </div>
        )}

        {profilesModal && (
          <div className="modal-overlay open">
            <div className="modal">
              <h2>CV Profiles</h2>
              <div className="profile-list">
                <div className="profile-item active-p">Current Draft</div>
              </div>
              <div className="modal-actions">
                <button className="modal-btn primary" onClick={() => setProfilesModal(false)}>Close</button>
              </div>
            </div>
          </div>
        )}

        {aiOutput.show && (
          <div className="modal-overlay open">
            <div className="modal" style={{ width: '600px' }}>
              <h2>{aiOutput.title}</h2>
              <div style={{ background: 'var(--surface2)', padding: '15px', borderRadius: '8px', whiteSpace: 'pre-wrap', maxHeight: '400px', overflowY: 'auto' }}>{aiOutput.text}</div>
              <div className="modal-actions">
                <button className="modal-btn primary" onClick={() => { navigator.clipboard.writeText(aiOutput.text); notify('Copied!'); }}>Copy</button>
                <button className="modal-btn" onClick={() => setAiOutput({ ...aiOutput, show: false })}>Close</button>
              </div>
            </div>
          </div>
        )}

        {/* AI Interview Modal */}
        {interviewMode && (
          <div className="modal-overlay open" style={{ zIndex: 2000 }}>
            <div className="modal" style={{ maxWidth: '600px', height: '80vh', display: 'flex', flexDirection: 'column', padding: 0 }}>
              <div className="modal-header" style={{ padding: '20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h2 style={{ margin: 0 }}>🎙️ AI Resume Interview</h2>
                <button className="modal-close" onClick={() => setInterviewMode(false)} style={{ background: 'none', border: 'none', fontSize: '24px', cursor: 'pointer', color: 'var(--muted)' }}>×</button>
              </div>
              <div className="modal-body" style={{ flex: 1, overflowY: 'auto', padding: '20px', display: 'flex', flexDirection: 'column', gap: '15px' }}>
                {interviewMessages.map((m, i) => (
                  <div key={i} style={{ 
                    alignSelf: m.role === 'ai' ? 'flex-start' : 'flex-end',
                    background: m.role === 'ai' ? 'var(--surface2)' : 'var(--accent)',
                    color: m.role === 'ai' ? 'var(--text)' : 'white',
                    padding: '12px 16px',
                    borderRadius: '12px',
                    maxWidth: '85%',
                    fontSize: '14px',
                    lineHeight: '1.5',
                    boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                  }}>
                    {m.text}
                  </div>
                ))}
                {isInterviewing && <div style={{ color: 'var(--muted)', fontSize: '12px' }}>AI is thinking...</div>}
              </div>
              <div className="modal-footer" style={{ padding: '15px', borderTop: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', gap: '10px' }}>
                  <input 
                    type="text" 
                    className="field" 
                    placeholder="Type your answer..." 
                    value={interviewInput} 
                    onChange={e => setInterviewInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleInterviewMessage()}
                    style={{ marginBottom: 0, flex: 1 }}
                  />
                  <button className="add-btn" onClick={handleInterviewMessage} disabled={isInterviewing} style={{ width: 'auto', padding: '0 20px' }}>Send</button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Auth Modal */}
        {showAuthModal && (
          <div className="modal-overlay open">
            <div className="modal">
              <h2>Login Required</h2>
              <p>Please login with Google to save your resumes to the cloud.</p>
              <div className="modal-actions">
                <button className="modal-btn primary" onClick={() => { handleLogin(); setShowAuthModal(false); }}>Login with Google</button>
                <button className="modal-btn" onClick={() => setShowAuthModal(false)}>Cancel</button>
              </div>
            </div>
          </div>
        )}

        {/* My Resumes Modal */}
        {showResumesModal && (
          <div className="modal-overlay open">
            <div className="modal" style={{ width: '500px' }}>
              <h2>My Saved Resumes</h2>
              <div className="resume-list" style={{ maxHeight: '400px', overflowY: 'auto', marginTop: '20px' }}>
                {userResumes.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '20px', color: 'var(--muted)' }}>No resumes saved yet.</div>
                ) : (
                  userResumes.map(r => (
                    <div key={r.id} style={{ 
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center', 
                      padding: '12px', background: 'var(--surface2)', borderRadius: '8px', marginBottom: '10px' 
                    }}>
                      <div>
                        <div style={{ fontWeight: 600 }}>{r.name}</div>
                        <div style={{ fontSize: '11px', color: 'var(--muted)' }}>
                          Last updated: {r.updatedAt?.toDate ? r.updatedAt.toDate().toLocaleDateString() : 'Just now'}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button className="card-btn" onClick={() => loadResume(r)}>Load</button>
                        <button className="card-btn card-remove" onClick={() => deleteResume(r.id)}>×</button>
                      </div>
                    </div>
                  ))
                )}
              </div>
              <div className="modal-actions">
                <button className="modal-btn primary" onClick={() => setShowResumesModal(false)}>Close</button>
              </div>
            </div>
          </div>
        )}

        {/* Loading & Notif */}
        {loading.show && <div className="loading-overlay show"><div className="loading-spinner"></div><div>{loading.text}</div></div>}
        {notif.show && <div className={`notif show ${notif.err ? 'err' : ''}`}>{notif.text}</div>}
      </div>
    );

    function loadSample() {
      setState((prev: any) => ({
        ...prev,
        name: 'Ahmed Ak',
        title: 'Senior Product Designer',
        email: 'alex.chen@example.com',
        phone: '+1 (555) 123-4567',
        location: 'San Francisco, CA',
        web: 'alexchen.design',
        summary: 'Creative product designer with 8+ years experience building user-centric digital products. Expert in design systems, interaction design, and rapid prototyping. Proven track record of improving user engagement by 40% through data-driven design iterations.',
        skills: [
          { name: 'Figma', level: 'Expert', pct: 95 },
          { name: 'React', level: 'Advanced', pct: 80 },
          { name: 'TypeScript', level: 'Advanced', pct: 75 },
          { name: 'Design Systems', level: 'Expert', pct: 90 },
          { name: 'User Research', level: 'Intermediate', pct: 65 }
        ],
        exp: [
          { 
            role: 'Lead Designer', 
            company: 'Stripe', 
            start: '2021', 
            end: 'Present', 
            desc: '• Led design systems for the core dashboard, improving developer handoff efficiency by 30%.\n• Managed a team of 4 designers to launch the new checkout experience used by millions.\n• Collaborated with engineering to implement accessible UI components.' 
          },
          { 
            role: 'Senior Product Designer', 
            company: 'Airbnb', 
            start: '2018', 
            end: '2021', 
            desc: '• Redesigned the search experience, resulting in a 15% increase in booking conversion.\n• Conducted over 50 user interviews to identify pain points in the host onboarding flow.\n• Developed interactive prototypes using Framer for high-fidelity testing.' 
          }
        ],
        edu: [
          { degree: 'M.Des Interaction Design', school: 'Carnegie Mellon University', year: '2016' },
          { degree: 'BFA Graphic Design', school: 'Rhode Island School of Design', year: '2014' }
        ],
        intern: [
          { role: 'Design Intern', company: 'Google', start: '2015', end: '2015', desc: 'Assisted in the design of Material Design components.' }
        ],
        proj: [
          { name: 'EcoTrack App', link: 'github.com/alex/eco', desc: 'A mobile app to track personal carbon footprint with real-time data visualization.' }
        ],
        award: [
          { name: 'Red Dot Design Award', issuer: 'Red Dot', year: '2022' }
        ],
        lang: [
          { lang: 'English', level: 'Native' },
          { lang: 'Mandarin', level: 'Fluent' }
        ],
        cert: [
          { name: 'Google UX Design Professional Certificate', issuer: 'Coursera', year: '2020' }
        ]
      }));
    }
  }
