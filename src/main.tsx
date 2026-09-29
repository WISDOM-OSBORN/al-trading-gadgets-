import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { testFirestoreConnection } from './db/firebase';

// Verify Firestore connection on startup
testFirestoreConnection().catch((err) => console.warn('Firestore initialization notice:', err));

createRoot(document.getElementById('root')!).render(<App />);
