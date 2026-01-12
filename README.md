# NSU Advising Slot Checker

A standalone website for students to check their designated advising time slots for Spring 2026 registration.

## Features

- 🎨 Beautiful dark UI with Apple-like typography
- ⏱️ Real-time countdown timer to advising slots
- 🔄 Live status updates (UPCOMING → LIVE → PASSED)
- 📱 Fully responsive design
- 🔒 Secure Supabase database integration

## Setup

### 1. Database Setup

Run the SQL in `database-setup.sql` in your Supabase SQL Editor:

1. Go to [Supabase Dashboard](https://supabase.com/dashboard)
2. Select your project
3. Go to SQL Editor
4. Paste and run the contents of `database-setup.sql`

### 2. Configure Supabase Credentials

Edit `config.js` with your Supabase credentials:

```javascript
const CONFIG = {
    SUPABASE_URL: 'https://your-project.supabase.co',
    SUPABASE_ANON_KEY: 'your-anon-key-here'
};
```

Get your credentials from: **Project Settings → API**

### 3. Add Student Data

Insert student advising slots into the `student_advising_slots` table:

```sql
INSERT INTO student_advising_slots (nsu_id, advising_date, slot1, slot2) VALUES
    ('2321854', '21-Nov-2025', '1:32 PM - 1:52 PM', '7:19 PM - 7:39 PM');
```

### 4. Deploy

Simply upload all files to any static hosting:
- Vercel
- Netlify
- GitHub Pages
- Any web server

## Database Schema

| Column | Type | Description |
|--------|------|-------------|
| `nsu_id` | TEXT | 7-digit student ID (unique) |
| `advising_date` | TEXT | Date in "DD-Mon-YYYY" format |
| `slot1` | TEXT | First slot "h:mm AM/PM - h:mm AM/PM" |
| `slot2` | TEXT | Second slot "h:mm AM/PM - h:mm AM/PM" |

## Files

```
advising-slot/
├── index.html          # Main HTML page
├── app.js              # Application logic
├── config.js           # Supabase configuration
├── database-setup.sql  # SQL migration script
├── favicon.svg         # Site favicon
└── README.md           # This file
```

## Usage

1. Student enters their 7-digit NSU ID
2. System auto-fetches their advising schedule
3. Displays date, time slots, and live countdown
4. Status updates in real-time as slots become active/pass

## Tech Stack

- Vanilla JavaScript (no framework)
- Tailwind CSS (via CDN)
- Supabase (database)
- Font Awesome (icons)
- Inter font (Apple-like typography)
