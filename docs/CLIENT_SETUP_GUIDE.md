# MBUMAH HARDWARE POS — Client Setup & Daily Use Guide

*This guide is written for the shop owner/staff — no technical knowledge needed.
Give it to the client together with the installed laptop.*

---

## 1. What you received

Your laptop is now your shop's computer. It contains the complete Mbumah
Hardware POS system:

- The till (selling screen), stock/inventory, customers, debts, reports
- Your own database stored **inside this laptop** — no internet needed to sell
- Two icons on the Desktop: **Mbumah POS** and **Backup POS Data**

> Keep this laptop safe, plugged in, and cleaned regularly — it holds your
> whole business records.

---

## 2. First-time installation (done ONCE — already done by your technician)

If you ever need to install it again on a new laptop:

1. Copy the folder `mbumah-hardware-pos` onto the new laptop (USB stick works)
2. Open the folder and **double-click `Install-Mbumah-POS.bat`**
3. Wait 15–30 minutes. Do not close the black window.
4. When you see the green **INSTALL COMPLETE** message, it is ready.
5. Two new icons appear on the Desktop.

**First login:**

- Open the **Mbumah POS** icon
- Username: `admin@mbumahhardware.co.ke` — Password: `password123`
- **CHANGE THE PASSWORD IMMEDIATELY** (click your name → Profile → Security)
- Write the new password down and keep it somewhere safe (and secret)

---

## 3. Every morning — opening the shop

1. Double-click **Mbumah POS** on the Desktop
2. Two black windows will open — **leave them open**. They are the shop's engine.
3. The POS screen opens in the browser automatically. Log in and start selling.

**Selling:** find the item (scan or search) → it goes into the cart → click
**Pay** → choose Cash or M-Pesa → the receipt prints automatically.

---

## 4. Every evening — closing the shop

1. Finish the day's shift (Dashboard → End Shift) and count the drawer
2. Close the two black windows (click the X on each)
3. Double-click **Backup POS Data** → click Y → done
4. Copy the `MbumahBackups` folder (on the Desktop) to your USB stick or OneDrive

> ⚠ A backup that stays only on the same laptop is NOT a backup. Always keep a
> copy outside the laptop (USB stick or cloud).

---

## 5. If something goes wrong

| Problem | What to do |
|---|---|
| Power went off / laptop restarted | Double-click **Mbumah POS** again — nothing is lost, all sales are saved |
| The POS screen won't open | Check the two black windows are open. If one closed, double-click **Mbumah POS** again |
| Receipt printer not printing | Use **Chrome or Edge** browser. When asked, click **Allow** for the printer. Check the printer cable |
| Selling is slow | Close other programs (games, videos). Keep the laptop charger plugged in |
| Forgot your password | Ask the owner/admin to reset it, or contact support below |
| A red error appears | Take a photo of the screen and send it to support — do not reinstall anything |
| Laptop asks to update / restart | It is OK — after restart, double-click **Mbumah POS** again |

**One important setting:** Windows Settings → Power → set **Sleep = Never**
(while plugged in). If the laptop sleeps, the other shop devices cannot connect.

---

## 6. Good habits (do and don't)

**DO:**
- ✅ Back up every evening (Backup POS Data)
- ✅ Keep the laptop charged and updated (Windows updates are fine)
- ✅ Use Chrome or Edge for the POS
- ✅ Count the drawer and close the shift every day

**DON'T:**
- ❌ Don't delete any files or folders inside `mbumah-hardware-pos`
- ❌ Don't share the admin password with everyone — cashiers get their own accounts
- ❌ Don't install games or other software on this laptop
- ❌ Don't use the same laptop for personal browsing during shop hours

**About internet:** selling, printing, stock and reports work **without
internet**. Internet is only needed for M-Pesa payments, KRA/eTIMS receipts,
and SMS messages.

---

## 7. Training on demo data (first days)

The system comes with **practice data** (demo sales, demo customers) so staff
can learn safely. When you are ready to start **real** selling:

1. Ask your technician (or do it yourself): double-click **`Wipe-Demo-Data.bat`**
   inside the `mbumah-hardware-pos` folder, type `GO-LIVE-WIPE` and press Enter
2. This clears all practice sales — your products, staff accounts and settings stay
3. Now start real selling

---

## 8. Support contacts

Fill this in and keep it with the laptop:

- Technician / Support name: ______________________
- Phone / WhatsApp: ______________________
- Email: ______________________
- Laptop password hint kept: ☐ (do NOT write the actual password here)

---

## 9. Uninstalling the POS (moving to a new laptop or stopping use)

Double-click **Uninstall-Mbumah-POS.bat** in the app folder
(`C:\Users\yourname\mbumah-hardware-pos`), or on Linux/macOS run
`bash deploy/nodocker/uninstall-nodocker.sh` inside the app folder.

The uninstaller always:

1. **Offers one final backup** — accept it (Y). Backups live in
   `Desktop\MbumahBackups` and are **never** deleted by the uninstaller.
2. Stops the Mbumah POS background jobs (only the ones from this app).
3. Removes the **Mbumah POS** and **Backup POS Data** desktop shortcuts.
4. Asks a final question — you must **type DELETE in capitals** before the
   app folder and its database are removed. Answer anything else and the
   folder is kept.

To move to a new laptop: uninstall here (keep the backup folder on a USB
stick), then run `Install-Mbumah-POS.bat` on the new laptop and copy the
backup with your technician.


---

## 10. Staying up to date (updates, backups & rollback)

Your POS looks after itself at night, while the shop is closed:

- **23:00 — Nightly update.** The system quietly checks the internet for a
  newer version of Mbumah POS. It only installs it between **22:00 and
  06:00**, it always saves a copy of your data first, and if anything about
  the new version does not pass its health checks it **puts the previous
  version back by itself**. You do not have to do anything. If the laptop is
  switched off at that time, it simply tries again the next night.
- **02:30 — Nightly backup.** A copy of your sales database is saved into
  `Desktop\MbumahBackups`. Copy that folder to a USB stick or OneDrive about
  once a week — a backup that only lives on the same laptop is not a real
  backup.

Things you can do yourself:

- **Update right now** (instead of waiting for the night): double-click
  **Update-Mbumah-POS.bat** in the app folder.
- **Go back to an earlier version** (only if support asks you to):
  double-click **Rollback-Mbumah-POS.bat**, pick the version from the list,
  and wait. Your sales data is never changed by this.
- **Back up right now**: the **Backup POS Data** desktop icon (unchanged).

Your sales data is **never** touched by updates or rollbacks — every new
version is checked against your data before it is allowed to serve the shop.
