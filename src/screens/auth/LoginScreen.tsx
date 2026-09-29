import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { Zap, Shield, Sun, Moon } from 'lucide-react';

export const LoginScreen: React.FC = () => {
  const { loginWithGoogle, loginWithGmail, switchUser } = useAuth();
  const { isDark, toggleTheme } = useTheme();
  const [gmail, setGmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGoogleSignIn = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const success = await loginWithGoogle();
      if (!success) {
        setError('Popup closed or blocked. You can enter your Gmail below.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleGmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!gmail.trim()) return;

    try {
      setIsLoading(true);
      setError(null);
      const success = await loginWithGmail(gmail.trim());
      if (!success) {
        setError('Could not authenticate user from Firestore.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100 dark:bg-slate-950 text-slate-900 dark:text-white p-4 transition-colors relative">
      {/* Top right theme toggle */}
      <button
        onClick={toggleTheme}
        className="absolute top-4 right-4 p-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-amber-400 shadow-xs cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800 transition"
        title={isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
      >
        {isDark ? <Sun className="w-4 h-4 fill-amber-400" /> : <Moon className="w-4 h-4" />}
      </button>

      <div className="w-full max-w-sm space-y-5">
        {/* Brand */}
        <div className="text-center space-y-1">
          <div className="w-12 h-12 mx-auto rounded-xl bg-emerald-600 text-white flex items-center justify-center shadow-lg">
            <Zap className="w-6 h-6 fill-current" />
          </div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">ShopLedger</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">Ghana Sales & Inventory Platform</p>
        </div>

        {/* 1. Google / Gmail Sign In Button */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-200 dark:border-slate-800 shadow-sm space-y-3">
          <button
            onClick={handleGoogleSignIn}
            disabled={isLoading}
            className="w-full py-2.5 px-4 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-bold text-xs hover:bg-slate-800 dark:hover:bg-slate-100 transition flex items-center justify-center gap-2.5 cursor-pointer shadow-sm disabled:opacity-50"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24">
              <path
                fill="#4285F4"
                d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.66-5.17 3.66-9.17z"
              />
              <path
                fill="#34A853"
                d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.33 24 12 24z"
              />
              <path
                fill="#FBBC05"
                d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 10.03 0 12s.45 3.82 1.25 5.42l4.03-3.15z"
              />
              <path
                fill="#EA4335"
                d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.33 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"
              />
            </svg>
            <span>Sign in with Google / Gmail</span>
          </button>

          <div className="relative flex py-1 items-center">
            <div className="flex-grow border-t border-slate-200 dark:border-slate-800" />
            <span className="shrink-0 px-2 text-[10px] text-slate-400 uppercase font-semibold">
              Or enter Gmail
            </span>
            <div className="flex-grow border-t border-slate-200 dark:border-slate-800" />
          </div>

          {/* 2. Direct Gmail Input (Authenticated from Firestore) */}
          <form onSubmit={handleGmailSubmit} className="space-y-2 text-xs">
            <input
              type="email"
              required
              value={gmail}
              onChange={(e) => setGmail(e.target.value)}
              placeholder="e.g. wisdomosborn65@gmail.com"
              className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
            />

            {error && <p className="text-[11px] text-rose-500 font-medium">{error}</p>}

            <button
              type="submit"
              disabled={isLoading || !gmail.trim()}
              className="w-full py-2 rounded-xl bg-emerald-600 text-white font-bold hover:bg-emerald-700 transition cursor-pointer disabled:opacity-50 shadow-sm"
            >
              {isLoading ? 'Connecting...' : 'Enter with Gmail'}
            </button>
          </form>
        </div>

        {/* 3. Quick Demo Roles */}
        <div className="space-y-1.5 pt-1">
          <span className="text-[10px] uppercase font-bold text-slate-400 dark:text-slate-500 tracking-wider block text-center">
            Quick Demo Accounts
          </span>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => switchUser('user-owner-01')}
              className="p-2.5 rounded-xl bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 text-left transition cursor-pointer shadow-2xs"
            >
              <p className="font-bold text-xs text-slate-900 dark:text-white flex items-center gap-1">
                <Shield className="w-3 h-3 text-indigo-500" />
                Owner
              </p>
              <p className="text-[10px] text-slate-500 dark:text-slate-400">Alex Rivera</p>
            </button>

            <button
              onClick={() => switchUser('user-seller-01')}
              className="p-2.5 rounded-xl bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 text-left transition cursor-pointer shadow-2xs"
            >
              <p className="font-bold text-xs text-slate-900 dark:text-white flex items-center gap-1">
                <Zap className="w-3 h-3 text-emerald-500" />
                Seller
              </p>
              <p className="text-[10px] text-slate-500 dark:text-slate-400">Samira Chen</p>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
