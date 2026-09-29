# ShopLedger – Fast Offline Sales & Inventory Ledger

ShopLedger is a mobile-first Progressive Web App (PWA) designed for shop owners and managers in Ghana to maintain an accurate stock ledger and record counter sales instantly with or without an internet connection.

---

## 1. Ghana Currency & Modern Theme Modes

- **Ghanaian Cedi (GH₵ / GHS):** Native currency throughout the application, formatted cleanly (e.g. `GH₵ 150.00`).
- **1-Tap Dark & Light Theme Switcher:**
  - Located directly in the top header and on the login screen.
  - **Light Mode:** High-contrast crisp white surfaces, clean slate-100 backgrounds, vivid emerald accents.
  - **Dark Mode:** Deep slate-950 background, glowing emerald accents, clear high-contrast white text.
  - Preference is saved locally and applies instantly across the entire platform.

---

## 2. Core Workflow (Streamlined & Direct)

1. **Owner Uploads Inventory:** The owner imports a CSV containing all items in the shop (name, SKU, cost price, selling price, quantity, category, etc.).
2. **Instant Counter Sales (Seller / Manager):**
   - Tap any item from the catalog or search by name / SKU.
   - Enter quantity and the sale amount in Ghanaian Cedis (`GH₵`, pre-filled from retail price, fully editable).
   - Tap **Record Sale**.
3. **Immediate System Ledger Update:**
   - **Specific Time Sold:** Records the exact time with hours, minutes, and seconds (e.g. `2:43:10 PM`).
   - **Allocates System Invoice Number:** Assigns an offline-safe reference number (e.g., `#INV-D01-0005`).
   - **Deducts Stock:** Immediately takes out the sold units from the store ledger.
   - **Remaining Items Tracked:** Shows remaining stock on the item and in the confirmation banner (e.g. *"43 items left in stock"*).
4. **Cloud Database (Firebase Firestore):**
   - Connected directly to Google Cloud Firestore database (`ai-studio-shopledgerofflin-7d2e1883-bd65-45d2-83f9-ea983f248f10`).
   - All sales, item updates, and stock ledger entries persist in Cloud Firestore and sync automatically.
   - Operates with complete offline fallback via IndexedDB when there is poor or no internet.
5. **No Tickets, No Printing Clutter:**
   - No receipt printing or ticket popup dialogs.
   - Minimal words and clean header for maximum speed and simplicity.

---

## 3. Gmail Authentication & Firestore Developer Management

### 3.1 Authenticating Users with Gmail
- **Sign In with Google:** Click "Sign in with Google / Gmail" to authenticate via Google Auth.
- **Direct Gmail Input:** Users can enter their Gmail address directly (e.g., `wisdomosborn65@gmail.com`).
- The developer account (`wisdomosborn65@gmail.com`) automatically receives full **Owner** access.

### 3.2 Managing Users Directly in Firestore
As the developer, you can create or authenticate users directly from Cloud Firestore in the `users` collection:
```json
// Firestore Document path: /users/{userId}
{
  "uid": "user-wisdomosborn65",
  "email": "wisdomosborn65@gmail.com",
  "name": "Wisdom Osborn",
  "role": "owner",          // "owner" for store owner/admin, "seller" for staff
  "active": true,
  "shopId": "shop-01",
  "deviceCode": "D01",
  "createdAt": 1727645000000
}
```
When a user signs in with that Gmail, the app queries Firestore, pulls their designated role (`owner` or `seller`), and automatically grants the appropriate permissions.

---

## 4. Screens & Features

- **Sell (Counter):** Search shop items, select an item, specify quantity & amount in `GH₵`, tap *Record Sale*, and see immediate confirmation with system invoice # and remaining stock.
- **My Sales (Staff):** Chronological ledger of all sales recorded today or over the past 7 days with timestamps, invoice numbers, amounts, and item details.
- **Stock Lookup (Staff):** Read-only view of current stock levels and remaining units in the shop.
- **Inventory Master (Owner):** Full inventory CRUD, bulk CSV upload with column mapping and validation, downloadable sample gadget CSV, and stock adjustment logs.
- **Sales & Deductions Ledger (Owner):** Master audit trail of every sale, timestamp, cashier, amount, and stock restoration via voiding.
- **Reports (Owner):** Daily breakdown of sales revenue, total units deducted from inventory, and transaction frequency.
