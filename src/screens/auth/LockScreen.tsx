import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { Lock, Delete } from 'lucide-react';

export const LockScreen: React.FC = () => {
  const { currentUser, unlockWithPin, currentShop } = useAuth();
  const [pin, setPin] = useState('');
  const [error, setError] = useState(false);

  const handleKeyPress = (num: string) => {
    if (pin.length < 4) {
      const nextPin = pin + num;
      setPin(nextPin);
      if (nextPin.length === 4) {
        verifyPin(nextPin);
      }
    }
  };

  const handleBackspace = () => {
    setPin((prev) => prev.slice(0, -1));
    setError(false);
  };

  const verifyPin = async (inputPin: string) => {
    const success = await unlockWithPin(inputPin);
    if (!success) {
      setError(true);
      setTimeout(() => {
        setPin('');
        setError(false);
      }, 700);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-100/95 dark:bg-slate-950/95 text-slate-900 dark:text-white p-4 backdrop-blur-sm transition-colors">
      <div className="w-full max-w-xs text-center space-y-4">
        <div className="w-12 h-12 mx-auto rounded-2xl bg-white dark:bg-slate-900 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shadow-md border border-slate-200 dark:border-slate-800">
          <Lock className="w-6 h-6" />
        </div>

        <div>
          <h2 className="text-base font-bold tracking-tight">Screen Locked</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {currentShop?.name || 'ShopLedger'} &bull; {currentUser?.name}
          </p>
        </div>

        {/* PIN Dots Indicator */}
        <div className="flex justify-center gap-3 py-1">
          {[0, 1, 2, 3].map((idx) => (
            <div
              key={idx}
              className={`w-3.5 h-3.5 rounded-full border transition-all duration-150 ${
                error
                  ? 'border-rose-500 bg-rose-500 animate-shake'
                  : pin.length > idx
                  ? 'border-emerald-500 bg-emerald-500 scale-110'
                  : 'border-slate-300 dark:border-slate-700 bg-transparent'
              }`}
            />
          ))}
        </div>

        {error && <p className="text-xs text-rose-500 font-semibold">Incorrect PIN code</p>}

        {/* Numpad */}
        <div className="grid grid-cols-3 gap-2 max-w-[220px] mx-auto pt-1">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
            <button
              key={digit}
              type="button"
              onClick={() => handleKeyPress(digit)}
              className="h-12 rounded-xl bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 active:scale-95 text-base font-bold border border-slate-200 dark:border-slate-800 shadow-2xs transition cursor-pointer flex items-center justify-center text-slate-900 dark:text-white"
            >
              {digit}
            </button>
          ))}
          <div />
          <button
            type="button"
            onClick={() => handleKeyPress('0')}
            className="h-12 rounded-xl bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 active:scale-95 text-base font-bold border border-slate-200 dark:border-slate-800 shadow-2xs transition cursor-pointer flex items-center justify-center text-slate-900 dark:text-white"
          >
            0
          </button>
          <button
            type="button"
            onClick={handleBackspace}
            className="h-12 rounded-xl bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 active:scale-95 text-sm font-semibold border border-slate-200 dark:border-slate-800 shadow-2xs transition cursor-pointer flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-white"
          >
            <Delete className="w-4 h-4" />
          </button>
        </div>

        <p className="text-[10px] text-slate-400">PIN: 1234 or 2026</p>
      </div>
    </div>
  );
};
