# AL-Q ELECTRICALS – Fast Sales & Inventory Ledger

AL-Q ELECTRICALS is a mobile-first Progressive Web App (PWA) designed for shop owners and managers in Ghana to maintain an accurate stock ledger and record counter sales instantly with or without an internet connection.

---

## 1. Business Profile & Team Roles

- **Business Name:** **AL-Q ELECTRICALS**
- **Admin 1:** `rajifarrid@gmail.com` (Owner / Admin Access)
- **Admin 2:** `wisdomosborn65@gmail.com` (Owner / Admin Access)
- **Seller:** `abuyahwisdomosborn@gmail.com` (Counter Staff Access)
- **Currency:** Ghanaian Cedi (`GH₵` / `GHS`)

All accounts are pre-configured in Firestore and local offline databases with instant Google / Gmail sign-in.

---

## 2. Instant Popout Sale Recording (Zero Scrolling Required)

1. **Select an Item:** Tap any item from the catalog list.
2. **Instant Popout Box:** Right under the selected item, a dedicated sales card pops out:
   - **Number of items to sell:** Quick `-` / `+` stepper, large number input, and quick-pick chips (`1`, `2`, `3`, `5`, `10`).
   - **Total Sale Amount (GH₵):** Pre-calculated at `quantity * item.sellingPrice`, and directly editable if giving a customer discount.
   - **Stock Preview:** Instantly calculates remaining stock left in store.
3. **1-Tap Record:**
   - Tap **"Record Sale • GH₵ [Amount]"**.
   - Captures the exact timestamp down to the second (e.g. `1:45:31 PM`).
   - Deducts stock immediately from Firestore and local Dexie DB.
   - Closes the popout box and displays the top success confirmation banner.

---

## 3. Ghana Currency & Modern Theme Modes

- **Ghanaian Cedi (GH₵ / GHS):** Native currency throughout the application (e.g. `GH₵ 140.00`).
- **1-Tap Dark & Light Theme Switcher:**
  - Located directly in the top header and on the login screen.
  - **Light Mode:** High-contrast crisp white surfaces, clean slate-100 backgrounds, vivid emerald accents.
  - **Dark Mode:** Deep slate-950 background, glowing emerald accents, clear high-contrast white text.

---

## 4. Cloud Database (Firebase Firestore) & Offline Sync

- Connected directly to Google Cloud Firestore database (`ai-studio-shopledgerofflin-7d2e1883-bd65-45d2-83f9-ea983f248f10`).
- All sales, item updates, and stock ledger entries persist in Cloud Firestore and sync automatically.
- Operates with complete offline fallback via IndexedDB when there is poor or no internet.
